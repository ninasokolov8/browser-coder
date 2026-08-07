/**
 * C# / .NET adapter.
 *
 * V-06 - MSBuild control-file injection. The multi-file path wrote EVERY supplied
 *   file into the project directory and then ran `dotnet run`. MSBuild
 *   automatically imports `Directory.Build.props` and `Directory.Build.targets`
 *   from the project directory, and an MSBuild target can execute arbitrary
 *   commands:
 *
 *     <Project><Target Name="X" BeforeTargets="Build">
 *       <Exec Command="..." />
 *     </Target></Project>
 *
 *   The C# pattern corpus never fired, because it models C# source and this is
 *   XML. So a "C# project" could run shell commands with the API container's
 *   authority. `validateFiles` now refuses build-control files outright: the
 *   project file is generated from a trusted template and is never user-supplied.
 *   This is the fix the blueprint asks for until builds run in an isolated
 *   sandbox.
 *
 * V-32 - `csharp10` compiled as C# 12. `<LangVersion>` is a real compiler switch,
 *   so the two profiles now differ genuinely. Both target the installed .NET
 *   runtime, and the profile's runtimeNote says so rather than implying that
 *   selecting C# 10 provides .NET 6.
 *
 * V-37 - the warm template was built with a synchronous 120-second spawn from the
 *   executor constructor, before the server listened. Preparation is now lazy and
 *   awaited per run, so a cold or failed template delays one request instead of
 *   the whole process start.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runToCompletion } from '../../execution/process-runner.mjs';
import { log } from '../../logging.mjs';
import { diagnostics, stripJobPaths } from '../adapter-kit.mjs';
import { WORKSPACE_ENV } from './python.mjs';

/**
 * Files MSBuild treats as build instructions rather than source.
 *
 * Matched on the basename and on the extension, because MSBuild's automatic
 * imports are by convention: any `.props`/`.targets` can be imported, and
 * `Directory.Build.*` and `Directory.Packages.props` are picked up implicitly.
 * `nuget.config` can redirect package restore to an attacker-controlled feed.
 */
const FORBIDDEN_BASENAMES = new Set([
  'directory.build.props',
  'directory.build.targets',
  'directory.packages.props',
  'directory.solution.props',
  'directory.solution.targets',
  'nuget.config',
  'global.json',
  'msbuild.rsp',
  'dotnet.rsp',
]);

const FORBIDDEN_EXTENSIONS = ['.csproj', '.props', '.targets', '.sln', '.fsproj', '.vbproj', '.proj'];

/**
 * The one place the framework version is written.
 *
 * A debug run has to find the assembly the build produced, and its path contains
 * this string. Two copies would be a build that succeeds and a debugger that cannot
 * find what it built.
 */
const TARGET_FRAMEWORK = 'net8.0';

/** The generated project file. Trusted: never assembled from user input. */
function projectFileContents(profile) {
  const langVersion = profile.sourceLevel ? `\n    <LangVersion>${profile.sourceLevel}</LangVersion>` : '';
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>${TARGET_FRAMEWORK}</TargetFramework>${langVersion}
    <Nullable>disable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AllowUnsafeBlocks>false</AllowUnsafeBlocks>
    <RootNamespace>UserProgram</RootNamespace>
    <AssemblyName>UserProgram</AssemblyName>
    <UseAppHost>false</UseAppHost>
    <EnableDefaultCompileItems>true</EnableDefaultCompileItems>
    <!-- Restore must never reach the network: the job has no dependencies and a
         restore attempt would either hang or contact an external feed. -->
    <RestoreSources></RestoreSources>
    <AutoGenerateBindingRedirects>false</AutoGenerateBindingRedirects>
    <GenerateDocumentationFile>false</GenerateDocumentationFile>
    <SatelliteResourceLanguages>en</SatelliteResourceLanguages>
  </PropertyGroup>
</Project>
`;
}

const PROJECT_FILE_NAME = 'UserProgram.csproj';

/** Where the DAP debug adapter lives in the image, next to the language's other files. */
export const CSHARP_ADAPTER_DIR = fileURLToPath(new URL('../../../languages/csharp/', import.meta.url));

/** Environment the debug adapter reads to know what to attach to. */
export const DOTNET_ASSEMBLY_ENV = 'BROWSER_CODER_DOTNET_ASSEMBLY';
export const DEBUG_ENTRY_ENV = 'BROWSER_CODER_DEBUG_ENTRY';
export const DOTNET_DEBUGGER_ENV = 'BROWSER_CODER_DOTNET_DEBUGGER';

/**
 * Build the project and hand the assembly to the debug adapter.
 *
 * Two departures from a normal run, both forced:
 *
 *  - **`build`, not `run`.** A debugger attaches to an assembly. `dotnet run` builds
 *    one and then launches it behind an MSBuild process this adapter does not control,
 *    so the build has to be a separate step for its output path to be known at all.
 *  - **Debug configuration, not Release.** Release optimises: locals are held in
 *    registers rather than slots, calls are inlined, and lines are reordered - so a
 *    student stepping through their own code watches it jump around and finds half
 *    their variables missing. That is not a debugger, it is a puzzle.
 *
 * A build failure comes back as diagnostics, exactly as a normal run's does, so
 * clicking Debug on a program with a syntax error reports the error rather than
 * starting a session against an assembly that was never produced.
 */
async function prepareDebugLaunch(ctx, startedAt) {
  const { job, entryPoint } = ctx;

  const build = await runToCompletion({
    command: ctx.config.tools.dotnet,
    args: ['build', '-c', 'Debug', '--no-restore', '--nologo', '-v', 'q', job.dir],
    cwd: job.dir,
    env: ctx.sandboxEnv,
    timeoutMs: ctx.config.execution.csharpTimeoutMs,
    maxOutputChars: ctx.config.execution.maxOutputChars,
  });

  if (!build.termination.succeeded) {
    // The compiler writes its errors to stdout here, as it does for a normal run.
    const message = cleanBuildOutput(build.stdout || build.stderr, job.dir).trim();
    return diagnostics(message || `dotnet build exited with ${build.termination.exitCode}`, build.durationMs);
  }

  const assembly = path.join(job.dir, 'bin', 'Debug', TARGET_FRAMEWORK, 'UserProgram.dll');
  if (!fs.existsSync(assembly)) {
    return diagnostics(
      'The project built but produced no assembly to debug.',
      Date.now() - startedAt,
    );
  }

  return {
    kind: 'launch',
    command: ctx.config.tools.node,
    args: ['--no-warnings', path.join(CSHARP_ADAPTER_DIR, 'debug_adapter.mjs')],
    cwd: job.dir,
    timeoutMs: ctx.config.execution.csharpTimeoutMs,
    extraEnv: {
      [DOTNET_ASSEMBLY_ENV]: assembly,
      [WORKSPACE_ENV]: path.resolve(job.dir),
      // Which source file `lines` (the frozen single-file form) refers to.
      [DEBUG_ENTRY_ENV]: entryPoint || 'Program.cs',
      [DOTNET_DEBUGGER_ENV]: ctx.config.tools.dotnetDebugger,
    },
    transformStderr: text => cleanBuildOutput(text, job.dir),
  };
}

/**
 * A warm, restored project per language level.
 *
 * Restore and first build dominate C# latency, so a template is built once and
 * copied per run. Keyed by LangVersion because the property is baked into the
 * generated project file.
 */
const templates = new Map();

async function ensureTemplate(ctx, profile) {
  const key = profile.sourceLevel || 'default';
  if (templates.has(key)) return templates.get(key);

  const promise = (async () => {
    const dir = path.join(ctx.templateRoot, `csharp-template-${key}`);
    const marker = path.join(dir, 'obj', 'project.assets.json');

    if (fs.existsSync(marker)) return dir;

    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, PROJECT_FILE_NAME), projectFileContents(profile), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.writeFileSync(path.join(dir, 'Program.cs'), 'System.Console.WriteLine("template");\n', {
      encoding: 'utf8',
      mode: 0o600,
    });

    log('info', 'csharp_template_warming', { langVersion: key });
    const build = await runToCompletion({
      command: ctx.config.tools.dotnet,
      args: ['build', '-c', 'Release', '--nologo', '-v', 'q'],
      cwd: dir,
      env: ctx.sandboxEnv,
      // Bounded, and awaited rather than blocking startup (V-37).
      timeoutMs: 180000,
      maxOutputChars: 20000,
    });

    if (!build.termination.succeeded) {
      // Not fatal: the per-run build can still restore, just slower. Logged
      // without the build output, which can contain absolute host paths.
      log('warn', 'csharp_template_build_failed', {
        langVersion: key,
        reason: build.termination.reason,
      });
    } else {
      log('info', 'csharp_template_ready', { langVersion: key });
    }
    return dir;
  })();

  templates.set(key, promise);
  return promise;
}

export const csharpAdapter = {
  id: 'csharp',

  defaultEntryName() {
    return 'Program.cs';
  },

  /**
   * Refuse build-control files before anything is written to disk.
   *
   * Rejecting rather than ignoring is deliberate: an author who supplied a
   * `.csproj` intended it to take effect, so silently dropping it would produce a
   * project that builds differently from what they wrote, with no explanation.
   */
  validateFiles(files) {
    for (const file of files) {
      const basename = path.basename(file.name).toLowerCase();
      const extension = path.extname(basename);

      if (FORBIDDEN_BASENAMES.has(basename) || FORBIDDEN_EXTENSIONS.includes(extension)) {
        return {
          ok: false,
          code: 'csharp_build_file_not_allowed',
          message:
            `"${file.name}" is an MSBuild project or control file and cannot be supplied. ` +
            'The project file is generated by the service. Send only .cs source files.',
        };
      }
    }
    return { ok: true };
  },

  /**
   * C# can be debugged.
   *
   * Through `dncdbg`, over DAP, spoken by a client written for this project - see
   * languages/csharp/dap.mjs. It is the only .NET debugger that works on musl -
   * netcoredbg segfaults there, for a reason recorded in blueprint section 49 - and it
   * is unpacked into the image rather than compiled. Where it is absent the run reports
   * `debug:unsupported` rather than pretending.
   */
  supportsDebug: true,

  async prepare(ctx) {
    const { job, files, profile } = ctx;
    const startedAt = Date.now();
    const debugging = ctx.debug?.enabled === true;

    const sourceFiles = files.filter(file => file.name.toLowerCase().endsWith('.cs'));
    if (sourceFiles.length === 0) {
      return diagnostics('No .cs source files were provided.', Date.now() - startedAt);
    }

    // Copy the warm template in, then write the trusted project file. Order
    // matters: the template's own project file must not survive, because it may
    // have been generated for a different language level.
    try {
      const templateDir = await ensureTemplate(ctx, profile);
      if (fs.existsSync(templateDir)) {
        // NEVER copy the template's source. The pipeline writes the student's
        // files into job.dir BEFORE prepare() runs (see pipeline.mjs:
        // job.writeFiles then adapter.prepare), and `force: true` overwrote them -
        // so the template's placeholder `Console.WriteLine("template")` replaced
        // Program.cs and EVERY C# program printed "template" and exited 0. The
        // student's code was never compiled.
        //
        // The placeholder-removal guard below this used to be the only defence,
        // and it only fired when the student had NOT supplied a Program.cs - which
        // is the one case where nothing needed protecting.
        //
        // Only the build state is worth copying: obj/ and bin/ hold the restored
        // package graph, which is the entire point of warming a template.
        fs.cpSync(templateDir, job.dir, {
          recursive: true,
          force: true,
          filter: source => !source.toLowerCase().endsWith('.cs'),
        });
      }
    } catch (error) {
      log('warn', 'csharp_template_copy_failed', { error: error.message });
    }

    fs.writeFileSync(path.join(job.dir, PROJECT_FILE_NAME), projectFileContents(profile), {
      encoding: 'utf8',
      mode: 0o600,
    });

    if (debugging) return prepareDebugLaunch(ctx, startedAt);

    return {
      kind: 'launch',
      command: ctx.config.tools.dotnet,
      args: [
        'run',
        '-c', 'Release',
        // --no-restore is safe because the template is already restored, and it
        // is also what keeps a build from attempting network access.
        '--no-restore',
        '--nologo',
        '-v', 'q',
        '--project', job.dir,
      ],
      cwd: job.dir,
      timeoutMs: ctx.config.execution.csharpTimeoutMs,
      transformStderr: text => cleanBuildOutput(text, job.dir),
    };
  },

  /**
   * `dotnet run` reports compile errors on STDOUT and still exits nonzero, so the
   * pipeline needs a way to recognise a build failure after the fact.
   */
  classifyFailure(result, job) {
    const combined = `${result.stdout || ''}${result.stderr || ''}`;
    if (/\(\d+,\d+\):\s+(?:error|warning)\s+CS\d+/i.test(combined)) {
      return {
        phase: 'compile',
        stderr: cleanBuildOutput(combined, job.dir),
        stdout: '',
      };
    }
    return null;
  },
};

/** Strip MSBuild ceremony so a student sees only their own errors. */
function cleanBuildOutput(text, jobDir) {
  if (!text) return '';
  return stripJobPaths(text, jobDir)
    .replace(/\s*\[[^\]]*\.csproj\]/g, '')
    .replace(/^Build\s+(FAILED|succeeded)\.?\s*$/gim, '')
    .replace(/^\s*\d+\s+(Error|Warning)\(s\)\s*$/gim, '')
    .replace(/^Time Elapsed\s.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default csharpAdapter;
