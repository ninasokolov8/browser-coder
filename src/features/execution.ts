import * as monaco from 'monaco-editor';
import { getLanguage } from '../languages';
import { runtime } from '../app/runtime';
import { appConfig } from '../app/config';
import { normalizeProjectPath } from '../components/project-path';
import { collectWorkspaceSnapshot } from './workspace';
import { notifyRunResult } from '../integrations/stepup-bus';
import { setStatus, setOutputHtml } from '../components/output';
import { startRunLoader, stopRunLoader } from '../components/run-loader';
import { runProgram, stopInteractive } from '../components/interactive-console';
import { clearTurtleCanvas } from '../components/turtle';
import { publishRunDiagnostics } from '../diagnostics/server-source';
import { isCssFile, isHtmlFile, isMarkdownFile, isSvgFile, openWebPreview } from './live-preview';
import { resolveWorkspaceImageUrl } from '../components/svg-assets';
import { showImageWindow } from '../components/image-window';
import { escapeHtml } from '../components/html-escape.ts';

function requireRuntime() {
  const editor = runtime.editor;
  const tabManager = runtime.tabManager;
  const storage = runtime.storage;
  if (!editor || !tabManager || !storage) {
    throw new Error('IDE is not ready yet. Please wait for initialization to finish.');
  }
  return { editor, tabManager, storage };
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

export async function runCode(code: string) {
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
      const errors = markers.filter(
        (m: monaco.editor.IMarker) => m.severity === monaco.MarkerSeverity.Error
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
  startRunLoader();

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

const languageFiles = workspaceFiles.filter(file =>
  !file.language || file.language === lang.id
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
  storedActiveFile?.path ||
  activeTab.file.path ||
  activeTab.file.name
);

const activeSnapshotFile = languageFiles.find(file =>
  normalizeProjectPath(file.path) === entryPoint
);

// `code` is the editor value at the instant Run was requested. It wins over
// any delayed IndexedDB/autosave value for the entry point.
if (activeSnapshotFile) activeSnapshotFile.content = code;

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
  files: languageFiles.map(file => ({
    ...file,
    isMain: normalizeProjectPath(file.path) === entryPoint })),
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
    const result = await runProgram(lang.id, requestBody, {
      // Stop the spinner the moment the stream is live: from then on the console
      // owns the panel and shows progress by printing.
      onStreamStart: () => stopRunLoader(),

      // turtle.bgpic("maze.svg") names a workspace file. Python reports only the
      // name, so it is resolved here, where the workspace is in scope.
      resolveImage: (name: string) =>
        resolveWorkspaceImageUrl(
          name,
          normalizeProjectPath(activeTab.file.path || activeTab.file.name),
        ) });

    // Compiler and runtime errors become editor markers and Problems entries, not
    // just a paragraph of text. For Python, Java, PHP and C# this is the ONLY thing
    // that knows what is wrong - Monaco has no language service for them.
    if (runtime.workspace && runtime.models && runtime.diagnostics) {
      publishRunDiagnostics({
        store: runtime.diagnostics,
        service: runtime.workspace,
        models: runtime.models,
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

    if (appConfig.isEmbedded) {
      notifyRunResult({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs });
    }
  } catch (e: any) {
    stopRunLoader();
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
    // Safety net: guarantees the button is never left stuck in a disabled/spinning state
    stopRunLoader();
  }
}
