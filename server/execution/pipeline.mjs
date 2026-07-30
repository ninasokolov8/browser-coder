/**
 * The one execution pipeline.
 *
 * validate -> admit -> job -> resolve version -> adapter prepare -> launch
 *
 * Every run in the service takes this path. There is no separate buffered
 * implementation and no separate interactive implementation: a run always
 * produces a live process with an open stdin, and the CALLER decides whether to
 * stream the events or collect them into one result.
 *
 * That is the answer to two problems at once.
 *
 * The architectural one: the pre-refactor code had four implementations per
 * language and a `Run and Debug` panel with a fifth transport, so behaviour
 * drifted by entry point. Different flags, different disable_functions lists,
 * different timeouts.
 *
 * The product one: whether a program can accept keyboard input was decided by
 * running regexes over the source to guess whether it called `input()`. A guess
 * that says no when the answer is yes produces a program that hangs until the
 * timeout and loses everything after the prompt - and the guess has to be right
 * for six languages, across aliases and indirection, in helper modules the
 * regex never sees. Making every run a session removes the guess entirely: the
 * capability is always there, and a program that never reads stdin is simply one
 * that never uses it.
 */

import { validateFileSet, resolveEntryPoint, DEFAULT_PATH_LIMITS } from '../domain/paths.mjs';
import { TerminationReason, classifyExit } from '../domain/termination.mjs';
import { createGraphicsChannel, readGraphicsChannel } from '../graphics/turtle.mjs';
import { resolveVersion } from '../languages/catalog.mjs';
import { getAdapter } from '../languages/registry.mjs';
import { log } from '../logging.mjs';
import { validateCodeSecurity } from '../security/validate.mjs';
import { Job } from './job.mjs';
import { spawnManaged } from './process-runner.mjs';
import { buildSandboxEnv } from './sandbox-env.mjs';

/** A typed refusal that the HTTP layer maps to a status code. */
export class ExecutionRefused extends Error {
  constructor(code, message, { status = 400, blocked = false, details = null } = {}) {
    super(message);
    this.name = 'ExecutionRefused';
    this.code = code;
    this.status = status;
    this.blocked = blocked;
    this.details = details;
  }
}

export class ExecutionPipeline {
  /**
   * @param {object} options
   * @param {object} options.config       CONFIG
   * @param {string} options.jobRoot      parent directory for job directories
   * @param {string} options.templateRoot parent directory for warm toolchain templates
   */
  constructor({ config, jobRoot, templateRoot }) {
    this.config = config;
    this.jobRoot = jobRoot;
    this.templateRoot = templateRoot;

    /**
     * Admission accounting.
     *
     * A counter, not a queue: the configured `maxQueueSize` never had one
     * (V-35). What matters for correctness is that the slot is reserved
     * ATOMICALLY before any async preparation, which is the check/reserve race
     * in V-27 - the pre-refactor code checked the limit, then awaited
     * compilation, then recorded the session, so N concurrent requests could all
     * pass a check for one remaining slot.
     */
    this.active = 0;
    this.totalStarted = 0;
    this.liveJobDirs = new Set();
  }

  get activeCount() {
    return this.active;
  }

  /** Reserve a slot or refuse. Synchronous by design - see V-27. */
  admit() {
    if (this.active >= this.config.execution.maxConcurrent) {
      throw new ExecutionRefused(
        'at_capacity',
        'Server at capacity - please try again',
        { status: 503 },
      );
    }
    this.active++;
    this.totalStarted++;
  }

  release() {
    if (this.active > 0) this.active--;
  }

  /**
   * Validate a request without touching the filesystem.
   *
   * Separated from `start` so the HTTP layer can reject a bad request before any
   * directory is created or any slot reserved.
   *
   * @param {object} request
   * @param {string} request.language
   * @param {unknown} [request.version]
   * @param {string} [request.code]        single-file form
   * @param {Array} [request.files]        multi-file form
   * @param {unknown} [request.entryPoint]
   */
  validate(request) {
    const { language, version, code, files, entryPoint } = request;

    if (!language || typeof language !== 'string') {
      throw new ExecutionRefused('language_missing', 'Missing language');
    }

    const adapter = getAdapter(language);
    if (!adapter) {
      throw new ExecutionRefused('language_unsupported', `Unsupported language: ${language}`);
    }

    const resolvedVersion = resolveVersion(language, version);
    if (!resolvedVersion.ok) {
      throw new ExecutionRefused(resolvedVersion.code, resolvedVersion.message, {
        details: { available: resolvedVersion.available },
      });
    }
    const profile = resolvedVersion.profile;

    // ── Normalize both request shapes into one file set ───────────────────────
    let fileSet;
    if (Array.isArray(files) && files.length > 0) {
      const validated = validateFileSet(files, {
        limits: {
          ...DEFAULT_PATH_LIMITS,
          maxPathChars: this.config.execution.maxPathChars,
        },
        maxFiles: this.config.execution.maxProjectFiles,
        maxTotalContentChars: this.config.execution.maxCodeChars,
      });
      if (!validated.ok) {
        throw new ExecutionRefused(validated.code, validated.message);
      }
      fileSet = validated.files;
    } else if (typeof code === 'string' && code.length > 0) {
      if (code.length > this.config.execution.maxCodeChars) {
        throw new ExecutionRefused(
          'code_too_large',
          `Code too large (max ${this.config.execution.maxCodeChars / 1000}KB)`,
        );
      }
      // A single file is a one-file project. The adapter names it, because Java
      // requires the filename to match the public class and PHP needs its tag.
      const normalized = adapter.normalizeSingleFile
        ? adapter.normalizeSingleFile(code)
        : code;
      fileSet = [
        { name: adapter.defaultEntryName(code, profile), content: normalized, isMain: true },
      ];
    } else {
      throw new ExecutionRefused('code_missing', 'Missing code or files');
    }

    // ── Language-specific file policy ────────────────────────────────────────
    // Runs BEFORE anything is written, so a refused file never reaches disk.
    // This is what stops MSBuild control files (V-06).
    if (adapter.validateFiles) {
      const verdict = adapter.validateFiles(fileSet, profile);
      if (!verdict.ok) {
        throw new ExecutionRefused(verdict.code, verdict.message);
      }
    }

    // ── Dangerous-pattern policy ─────────────────────────────────────────────
    for (const file of fileSet) {
      if (!file.content) continue;
      const verdict = validateCodeSecurity(language, file.content);
      if (!verdict.safe) {
        log('warn', 'security_block', {
          language,
          file: file.name,
          reason: verdict.reason,
          // The matched fragment is user source. Bounded deliberately - see
          // section 17.8 and the redact() helper.
          matchedLength: verdict.matched ? String(verdict.matched).length : 0,
        });
        throw new ExecutionRefused(
          'policy_denied',
          fileSet.length > 1 ? `${file.name}: ${verdict.reason}` : verdict.reason,
          { status: 403, blocked: true },
        );
      }
    }

    const resolvedEntry = resolveEntryPoint(fileSet, entryPoint);
    if (!resolvedEntry.ok) {
      throw new ExecutionRefused(resolvedEntry.code, resolvedEntry.message);
    }

    // Exactly one file carries the flag, so a stale isMain in the request cannot
    // override the resolved entry point in an adapter that consults it.
    for (const file of fileSet) file.isMain = file.name === resolvedEntry.entryPoint;

    return { adapter, profile, files: fileSet, entryPoint: resolvedEntry.entryPoint };
  }

  /**
   * Start a run.
   *
   * Returns a handle whose process is already live. The caller streams
   * `onStdout`/`onStderr`, writes stdin, and awaits `done`.
   *
   * @returns {Promise<RunHandle>}
   */
  async start(request, hooks = {}) {
    const plan = this.validate(request);

    // Reserved only after validation passes, so a malformed request cannot
    // occupy a slot, and reserved BEFORE preparation, so preparation cannot
    // overrun the limit (V-27).
    this.admit();

    const job = new Job(this.jobRoot, hooks.jobKind || 'run');
    this.liveJobDirs.add(job.dir);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      this.liveJobDirs.delete(job.dir);
      this.release();
      job.dispose();
    };

    try {
      job.writeFiles(plan.files);

      // Allocated for every run: cheap, and it means the adapter never has to ask
      // whether graphics "might" be used.
      const graphics = createGraphicsChannel(job);

      const timeoutMs = hooks.timeoutMs ?? this.config.execution.timeoutMs;
      const sandboxEnv = buildSandboxEnv({
        jobDir: job.dir,
        config: this.config,
        extra: graphics.env,
      });

      const prepared = await plan.adapter.prepare({
        job,
        files: plan.files,
        entryPoint: plan.entryPoint,
        profile: plan.profile,
        config: this.config,
        graphics,
        sandboxEnv,
        templateRoot: this.templateRoot,
        timeoutMs,
      });

      // A compile or lint failure is a terminal result, not a live session. The
      // program never started, so there is nothing to stream and nothing to
      // accept input.
      if (prepared.kind === 'diagnostics') {
        const termination = classifyExit({
          code: 1,
          signal: null,
          serviceReason: TerminationReason.COMPILE_ERROR,
        });
        finish();
        return {
          kind: 'diagnostics',
          profile: plan.profile,
          entryPoint: plan.entryPoint,
          result: {
            stdout: '',
            stderr: prepared.stderr,
            termination,
            phase: 'compile',
            blocked: prepared.blocked === true,
            durationMs: prepared.durationMs,
            graphics: null,
            truncated: false,
          },
        };
      }

      const managed = spawnManaged({
        command: prepared.command,
        args: prepared.args,
        cwd: prepared.cwd || job.dir,
        env: { ...sandboxEnv, ...(prepared.extraEnv || {}) },
        timeoutMs: prepared.timeoutMs ?? timeoutMs,
        maxOutputChars: this.config.execution.maxOutputChars,
        // Always true. This is the "every run is interactive" decision.
        stdin: true,
        onStdout: hooks.onStdout,
        onStderr: hooks.onStderr,
        transformStderr: prepared.transformStderr,
      });

      const done = managed.done.then(result => {
        // Read the drawing BEFORE disposing the job, and only from the path this
        // service allocated. See server/graphics/turtle.mjs for why that
        // direction matters (V-01).
        let graphicsData = null;
        try {
          graphicsData = readGraphicsChannel(graphics.path);
        } catch (error) {
          log('warn', 'graphics_read_failed', { error: error.message });
        }

        // `dotnet run` reports build errors on stdout and still exits nonzero, so
        // the adapter gets a chance to reclassify after the fact.
        let phase = 'run';
        let stdout = result.stdout;
        let stderr = result.stderr;
        if (!result.termination.succeeded && plan.adapter.classifyFailure) {
          const reclassified = plan.adapter.classifyFailure(result, job);
          if (reclassified) {
            phase = reclassified.phase;
            stdout = reclassified.stdout;
            stderr = reclassified.stderr;
          }
        }

        finish();

        return {
          stdout,
          stderr,
          termination: result.termination,
          phase,
          blocked: false,
          durationMs: result.durationMs,
          graphics: graphicsData,
          truncated: result.truncated,
        };
      });

      // A failure inside `done` must still release the slot and the directory.
      done.catch(() => finish());

      return {
        kind: 'session',
        profile: plan.profile,
        entryPoint: plan.entryPoint,
        jobDir: job.dir,
        pid: managed.pid,
        writeStdin: managed.writeStdin,
        closeStdin: managed.closeStdin,
        stop: managed.stop,
        done,
      };
    } catch (error) {
      finish();
      throw error;
    }
  }

  /**
   * Run to completion and collect one result - the v1 `/api/run` shape.
   *
   * A thin adapter over `start`, which is what section 22.1 requires: no language
   * execution logic in the facade.
   */
  async run(request) {
    const handle = await this.start(request, { jobKind: 'run' });
    if (handle.kind === 'diagnostics') {
      return { ...handle.result, profile: handle.profile, entryPoint: handle.entryPoint };
    }

    // Buffered semantics: the contract says stdin is closed immediately unless
    // input was supplied, so a program that reads input gets EOF rather than
    // blocking until the wall-clock timeout.
    handle.closeStdin();

    const result = await handle.done;
    return { ...result, profile: handle.profile, entryPoint: handle.entryPoint };
  }

  stats() {
    return {
      active: this.active,
      total: this.totalStarted,
      maxConcurrent: this.config.execution.maxConcurrent,
      load: `${((this.active / this.config.execution.maxConcurrent) * 100).toFixed(1)}%`,
    };
  }
}

export default ExecutionPipeline;
