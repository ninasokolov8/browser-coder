import * as monaco from 'monaco-editor';
import { getErrorExplanation, getLanguage } from '../languages';
import { runtime, requireEditor, requireStorage, requireTabManager } from '../app/runtime';
import { appConfig } from '../app/config';
import { normalizeProjectPath } from '../components/project-path';
import { collectWorkspaceSnapshot } from './workspace';
import { withCachedAssets } from './asset-transport.ts';
import { notifyRunResult } from '../integrations/stepup-bus';
import { appendOutputHtml, setStatus, setOutputHtml } from '../components/output';
import { runEnded, runStarted } from '../components/run-controls.ts';
import { runProgram, stopInteractive } from '../components/interactive-console';
import { clearTurtleCanvas } from '../components/turtle';
import { publishRunDiagnostics } from '../diagnostics/server-source';
import { ASSET_LANGUAGE_ID } from '../workspace/assets.ts';
import { debugState, syncBreakpoints } from './debug/ui.ts';
import { isCssFile, isHtmlFile, isMarkdownFile, isSvgFile, openWebPreview } from './live-preview';
import { resolveWorkspaceImageUrl } from '../components/svg-assets';
import { showImageWindow } from '../components/image-window';
import { escapeHtml } from '../components/html-escape.ts';
import { parseCompilerOutput } from '../diagnostics/compiler-output.ts';
import { buildErrorHelpBlock, selectErrorKey } from './error-help.ts';
import { getUILang } from './wrapped-i18n';
import { announce, describeRunOutcome } from '../components/announce.ts';
import { OutputTraceMapper } from './output-trace.ts';
import { firstAidButtonHtml, safeFixFor } from './error-first-aid.ts';

/**
 * The three the run path needs, resolved together.
 *
 * A thin grouping over the shared accessors in app/runtime.ts rather than a fourth
 * private copy of the readiness check - it used to be one, with its own message.
 */
function requireRuntime() {
  return { editor: requireEditor(), tabManager: requireTabManager(), storage: requireStorage() };
}

// ── Output helpers ──────────────────────────────────────────────────────────

/**
 * Escape text for embedding in the output panel's markup.
 *
 * Was a local three-character escaper that omitted quotes - the weakest of four
 * copies in the codebase. Now the shared one; see src/components/html-escape.ts.
 */
const esc = escapeHtml;

/**
 * The one sentence a screen reader should hear about what went wrong.
 *
 * The parser's message, trimmed to its first line and given a location. Everything
 * after that first line is a stack trace, which is not something to read aloud.
 */
function firstErrorSentence(languageId: string, output: string): string | null {
  const [diagnostic] = parseCompilerOutput(languageId, output);
  if (!diagnostic) return null;

  const message = diagnostic.message.split('\n')[0].trim();
  if (!message) return null;
  return `${message} on line ${diagnostic.line} of ${diagnostic.file}.`;
}

/**
 * Explain the error a failed run produced, under the run's own output.
 *
 * The traceback stays on screen - a student has to learn to read the real thing
 * eventually - and the explanation goes below it. The message explained is the one the
 * FIRST diagnostic carries, which is also the one the editor marker points at, so the
 * squiggle and the paragraph are always about the same line.
 *
 * Silent when there is no entry. A confidently wrong explanation in a teaching tool is
 * worse than none: it teaches the student the wrong model of what their program did.
 */
function explainRunFailure(languageId: string, output: string, source: string, file: string): void {
  const language = getLanguage(languageId);
  const entries = language?.errors;
  if (!entries) return;

  const [diagnostic] = parseCompilerOutput(languageId, output);
  if (!diagnostic) return;

  const key = selectErrorKey(languageId, diagnostic.message, Object.keys(entries));
  if (!key) return;

  const help = getErrorExplanation(languageId, key, getUILang());
  if (!help) return;

  const block = buildErrorHelpBlock(key, help);
  // Hebrew is right-to-left inside a panel that is deliberately forced LTR, because
  // the panel's other content is raw program output. Only the prose is turned round.
  const dir = block.rtl ? ' dir="rtl"' : '';

  const lines = [
    '',
    `<span class="info">── What this means ─────────────────────────────────────────</span>`,
    `<span class="info">${esc(block.heading)}</span>`,
    `<span${dir}>${esc(block.explanation)}</span>`,
  ];
  if (block.cause) {
    lines.push('', '<span class="info">Common cause</span>');
    lines.push(`<span class="warning"${dir}>${esc(block.cause)}</span>`);
  }
  if (block.example) {
    lines.push('', '<span class="info">Example</span>');
    lines.push(`<span class="success">${esc(block.example)}</span>`);
  }
  const fix = safeFixFor(languageId, source, diagnostic.line, diagnostic.message);
  if (fix) lines.push('', firstAidButtonHtml(fix, diagnostic.message, file));

  appendOutputHtml(`\n${lines.join('\n')}`);
}

/**
 * "Run" an SVG file: open the picture in its own floating window — the same kind
 * of window a turtle drawing opens in — and list the ways to import it in the
 * Output panel.
 */
function showSvgPreview(filePath: string, source: string): void {
  const fileName = normalizeProjectPath(filePath).split('/').pop() || 'image.svg';

  clearTurtleCanvas();          // one graphics window on screen at a time
  showImageWindow(fileName, source);

  setOutputHtml(
    `<span class="info">── SVG Image — ${esc(fileName)} ───────────────────────────────</span>\n` +
    `Opened in its own window. Import this image into another file:\n\n` +
    `  HTML     ${esc(`<img src="./${fileName}" alt="">`)}\n` +
    `  CSS      ${esc(`background-image: url("./${fileName}");`)}\n` +
    `  Python   ${esc(`turtle.bgpic("${fileName}")`)}\n`
  );
  setStatus('SVG image shown ✅');
}

export async function runCode(
  code: string,
  options: {
    debug?: boolean;
    /**
     * The lines being run, when this is a selection rather than the whole file.
     *
     * Used to scope the pre-run diagnostics gate. Without it, an error anywhere in a
     * file blocks running any part of it - which defeats the point of running a
     * fragment while the rest is mid-edit.
     */
    markerRange?: { startLine: number; endLine: number };
    /**
     * Run a DIFFERENT file as the entry point, keeping the whole project.
     *
     * For "Check my work": the marking harness is the program, and the student's own
     * code is the rest of the payload it imports. Everything else about the run - the
     * snapshot, the diagnostics gate, the stream, the console - is identical, which is
     * the entire reason this is an option here rather than a second pipeline.
     */
    entryPointOverride?: string;
  } = {},
) {
  const { editor, tabManager, storage } = requireRuntime();
  const activeTab = tabManager.getActiveTab();
  if (!activeTab) return;

  const lang = getLanguage(activeTab.file.language);
  if (!lang) return;

  // HTML, CSS and Markdown are rendered, not executed. Markdown goes through the
  // same publisher so relative images in the notes resolve.
  if (isHtmlFile(activeTab.file) || isCssFile(activeTab.file) || isMarkdownFile(activeTab.file)) {
    await openWebPreview();
    return;
  }

  // A plain-text data file is not a program either. Same reasoning as JSON below:
  // saying so beats forwarding it to a sandbox that answers with a syntax error from
  // a language the student never chose. There is nothing to validate, so it only
  // explains how the file is meant to be used.
  if (lang.id === 'text') {
    setStatus('Data file');
    setOutputHtml(
      `<span class="info">${esc(activeTab.file.name)} is a data file, so there is nothing to run.</span>\n` +
      `<span class="info">Read it from a program - in Python, ` +
      `open("${esc(activeTab.file.name)}").read().</span>`,
    );
    return;
  }

  // JSON is data. Running it is meaningless, and the honest answer is to say so and
  // report whether it parses - not to hand it to a runtime that will reject it with
  // something less useful, and not to do nothing at all.
  if (lang.id === 'json') {
    try {
      JSON.parse(code);
      setStatus('Valid JSON ✅');
      setOutputHtml(
        `<span class="info">${esc(activeTab.file.name)} is valid JSON.</span>\n` +
        `<span class="info">JSON is data, so there is nothing to run. ` +
        `Load it from a program - in Python, json.load(open("${esc(activeTab.file.name)}")).</span>`,
      );
    } catch (error) {
      setStatus('Invalid JSON ❌');
      setOutputHtml(
        `<span class="error">${esc(activeTab.file.name)} is not valid JSON.</span>\n` +
        `<span class="error">${esc(error instanceof Error ? error.message : String(error))}</span>`,
      );
    }
    return;
  }

  // An SVG file is an image, not a program: Run shows what it looks like and
  // reminds the student how to import it elsewhere.
  if (isSvgFile(activeTab.file)) {
    showSvgPreview(activeTab.file.path || activeTab.file.name, code);
    return;
  }

  // ── Pre-run TypeScript diagnostics gate ────────────────────────────────────
  // Monaco's TypeScript language service runs client-side and maintains an
  // up-to-date set of error markers. Block the run when there are Error-level
  // markers so the user gets immediate, in-IDE feedback instead of a cryptic
  // runtime failure.
  if (lang.id === 'typescript') {
    const model = editor.getModel();
    if (model) {
      const markers = monaco.editor.getModelMarkers({ resource: model.uri });
      const range = options.markerRange;
      const errors = markers.filter(
        (m: monaco.editor.IMarker) =>
          m.severity === monaco.MarkerSeverity.Error &&
          // Scoped to the lines actually being run. A selection run is not blocked by
          // an error elsewhere in the file; a whole-file run has no range and so is
          // gated exactly as before.
          (!range || (m.startLineNumber >= range.startLine && m.startLineNumber <= range.endLine))
      );
      if (errors.length > 0) {
        const errLines = errors
          .map((m: monaco.editor.IMarker) => {
            const file = m.resource.path.split('/').pop() ?? 'user.ts';
            return `${file}:${m.startLineNumber}:${m.startColumn}  ${m.message}`;
          })
          .join('\n');
        setOutputHtml(
          `<span class="info">── TypeScript Error ──────────────────────────────────────────</span>\n` +
          `<span class="error">${esc(errLines)}</span>\n` +
          `<span class="error">[exit code: 1]</span>`
        );
        setStatus('Compile error ❌');
        if (appConfig.isEmbedded) {
          notifyRunResult({ stdout: '', stderr: errLines, exitCode: 1, durationMs: 0 });
        }
        return;
      }
    }
  }

  // Kill any still-running interactive session from a previous run before
  // starting a new one (buffered or interactive).
  stopInteractive();

  setStatus("Running…");
  // One owner for the Run/Stop pair, and the point at which Stop becomes available.
  // It is armed HERE rather than when the stream opens, because the compile happens
  // first - up to 30 s for Java and 45 s for C# - and a student must be able to
  // abandon a run during it.
  runStarted(options.debug ? 'debug' : 'run', () => stopInteractive());

  try {
    let requestBody: Record<string, unknown> = {
      language: lang.id,
      version: activeTab.file.version,
      code };

    // In full/project mode, execute the complete workspace. The API already
    // supports files[] + entryPoint; this makes imports between local files
    // work while keeping snippet mode fully backward compatible.
if (appConfig.ideMode !== 'snippet') {
// Persist the active editor value before collecting the project. This keeps
// native runs and Step-Up initiated runs on the exact same code snapshot.
await tabManager.saveCurrentTab();
const workspaceFiles = await collectWorkspaceSnapshot();

/*
 * Source files for this language, PLUS the companion files a program reads.
 *
 * The filter used to be "this language only", which quietly broke two features
 * that depend on the workspace reaching the sandbox:
 *
 *   - turtle.bgpic("maze.svg") and register_shape("cursor.svg") name a workspace
 *     file, and an .svg has language `svg`, so it was never sent. The shim then
 *     looked for a file that was not there and silently drew nothing.
 *   - H4 made open("data.txt") legal and confined to the workspace - but a
 *     data file in the project was never written into the job directory, so the
 *     only files a program could read were ones it had just created itself.
 *
 * Companion files are data, never compiled: the server writes them into the job
 * directory and the entry point is still a source file. The project size policy
 * bounds the total, so a workspace full of large images is refused by the same
 * limit that bounds source - with a clear message rather than a silent drop.
 */
const COMPANION_LANGUAGES = new Set([ASSET_LANGUAGE_ID, 'svg', 'json', 'markdown', 'css', 'html', 'text']);

const languageFiles = workspaceFiles.filter(file =>
  !file.language || file.language === lang.id || COMPANION_LANGUAGES.has(file.language)
);

/*
 * Do not trust activeTab.file.path here.
 *
 * The tab may contain stale path metadata after:
 * - loading a project,
 * - replacing all files,
 * - moving files,
 * - renaming folders,
 * - restoring IndexedDB data.
 *
 * Read the current file record from storage, which is the same source used
 * by collectWorkspaceSnapshot().
 */
const storedActiveFile = await storage.getFile(activeTab.file.id);

const entryPoint = normalizeProjectPath(
  // "Check my work" runs the marking harness as the program and the student's own
  // file as one of its imports, so the override wins over the active tab.
  options.entryPointOverride ||
  storedActiveFile?.path ||
  activeTab.file.path ||
  activeTab.file.name
);

const activeSnapshotFile = languageFiles.find(file =>
  normalizeProjectPath(file.path) === entryPoint
);

// `code` is the editor value at the instant Run was requested. It wins over
// any delayed IndexedDB/autosave value for the entry point.
//
// NOT when the entry point was overridden. Then `code` is still the file on
// screen and the entry point is the marking harness, so writing one over the
// other would run the student's own code as though it were the marking script -
// and every check would pass.
if (activeSnapshotFile && !options.entryPointOverride) activeSnapshotFile.content = code;

const entryPointExists = !!activeSnapshotFile;

if (!entryPointExists) {
  throw new Error(
    `Active file was not found in the project snapshot.\n` +
    `Entry point: ${entryPoint}\n` +
    `Available files:\n` +
    languageFiles.map(file => `- ${file.path}`).join('\n')
  );
}

requestBody = {
  language: lang.id,
  version: activeTab.file.version,
  // Mark the active file explicitly as well as sending entryPoint. This keeps
  // native and embedded/project execution correct even with older compatible
  // backends that prefer the per-file isMain flag.
  //
  // Assets that the server already has are replaced by their digest, so a project
  // with a 2 MiB image does not send 2.8 MB of base64 on every single Run. Any
  // failure - no secure context, no cache configured, a failed upload - returns the
  // files untouched, which is the shape that has always worked.
  files: await withCachedAssets(
    languageFiles.map(file => ({
      ...file,
      isMain: normalizeProjectPath(file.path) === entryPoint })),
  ),
  entryPoint };
}

    // ── One transport ────────────────────────────────────────────────────
    //
    // Every run streams. There is no longer a regex deciding whether this
    // program 'looks like' it reads input, and no buffered branch behind it - see
    // the note at the top of interactive-console.ts for why that split was wrong.
    //
    // /api/run still exists and is unchanged; Step-Up calls it server-side. The
    // IDE simply no longer uses it.
    // A debug run announces itself before the stream opens, so the toolbar appears
    // immediately rather than only once the adapter attaches.
    if (options.debug) debugState.starting();

    const outputTrace = new OutputTraceMapper(
      code,
      lang.id,
      normalizeProjectPath(activeTab.file.path || activeTab.file.name),
      (options.markerRange?.startLine ?? 1) - 1,
    );
    const result = await runProgram(lang.id, requestBody, {
      // The console owns the panel from here and shows progress by printing. The
      // Run/Stop state is deliberately NOT changed: the program is still running,
      // and Stop must stay available for exactly as long as that is true.
      onStreamStart: () => {},

      debug: options.debug === true,
      traceOutput: line => outputTrace.locationFor(line),

      onDebugEvent: event => {
        debugState.apply(event);
        // Breakpoints go out as soon as the adapter is listening. Earlier would race
        // the connection; later would miss a breakpoint on the program's first lines.
        if (event.type === 'attached') syncBreakpoints();
      },

      // turtle.bgpic("maze.svg") names a workspace file. Python reports only the
      // name, so it is resolved here, where the workspace is in scope.
      resolveImage: (name: string) =>
        resolveWorkspaceImageUrl(
          name,
          normalizeProjectPath(activeTab.file.path || activeTab.file.name),
        ) });

    // However the run ended, the session is over: no stale current-line arrow, no
    // step buttons left enabled.
    if (options.debug) debugState.finished();

    // Compiler and runtime errors become editor markers and Problems entries, not
    // just a paragraph of text. For Python, Java, PHP and C# this is the ONLY thing
    // that knows what is wrong - Monaco has no language service for them.
    if (runtime.workspace && runtime.models && runtime.diagnostics) {
      publishRunDiagnostics({
        store: runtime.diagnostics,
        service: runtime.workspace,
        languageId: lang.id,
        // Both streams: javac and node use stderr, php -l splits across the two,
        // and a Python traceback can arrive on either depending on the phase.
        output: `${result.stderr || ''}
${result.stdout || ''}`,
        entryDocumentId: activeTab.file.id,
        documentCount: Array.isArray(requestBody.files)
          ? (requestBody.files as unknown[]).length
          : 1 });
    }

    // After the program's own output and its exit line, never instead of them. Only
    // for a run that actually failed: explaining an error to someone whose program
    // worked is noise.
    const combinedOutput = `${result.stderr || ''}\n${result.stdout || ''}`;
    if (result.exitCode !== 0) {
      explainRunFailure(
        lang.id,
        combinedOutput,
        code,
        normalizeProjectPath(activeTab.file.path || activeTab.file.name),
      );
    }

    // Said once, to a screen reader. The panel itself is not a live region because a
    // program that prints two hundred lines would read all two hundred aloud.
    announce(
      describeRunOutcome({
        exitCode: result.exitCode,
        errorSummary: result.exitCode === 0
          ? null
          : firstErrorSentence(lang.id, combinedOutput),
        problemCount: runtime.diagnostics?.counts().total ?? 0,
      }),
    );

    if (appConfig.isEmbedded) {
      notifyRunResult({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs });
    }

    // Returned so a caller can read what the program printed. "Check my work" needs
    // it: the harness reports its verdict on stdout, and parsing that is the whole
    // feature. Every other caller ignores it, exactly as before.
    return result;
  } catch (e: any) {
    setOutputHtml(
      `<span class="error">ERROR: ${esc(e?.message || String(e))}</span>\n` +
      `<span class="error">[exit code: 1]</span>`
    );
    setStatus("Run failed");
    
    // Notify parent of error
    if (appConfig.isEmbedded) {
      notifyRunResult({
        stdout: '',
        stderr: e?.message || String(e),
        exitCode: -1,
        durationMs: 0
      });
    }
  } finally {
    // Safety net: the buttons are never left stuck mid-run, whatever path we left by.
    runEnded();
  }
}
