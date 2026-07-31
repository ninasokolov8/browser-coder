// @ts-nocheck
import * as monaco from 'monaco-editor';
import { getLanguage, getKeywordExplanation } from '../languages';
import { t } from '../i18n';
import { getUILang } from './wrapped-i18n';
import { runtime } from '../app/runtime';
import { appConfig, policyState } from '../app/config';
import { normalizeProjectPath } from '../components/project-path';
import { collectWorkspaceSnapshot } from './workspace';
import { notifyRunResult } from '../integrations/stepup-bus';
import { setStatus, setOutput, appendOutput, setOutputHtml } from '../components/output';
import { startRunLoader, stopRunLoader } from '../components/run-loader';
import { runInteractive, codeReadsStdin, stopInteractive } from '../components/interactive-console';
import { renderTurtle, clearTurtleCanvas } from '../components/turtle';
import type { TurtleData } from '../components/turtle';
import { showKeywordHelpPopup } from '../components/keyword-help';
import { runBtn } from '../components/dom';
import { bindButton, bindKeybinding } from '../commands';
import { getOrCreateModel } from './editor-core';
import { isCssFile, isHtmlFile, isSvgFile, openWebPreview } from './live-preview';
import { resolveWorkspaceImageUrl } from '../components/svg-assets';
import { hideImageWindow, showImageWindow } from '../components/image-window';

function requireRuntime() {
  const editor = runtime.editor;
  const tabManager = runtime.tabManager;
  const storage = runtime.storage;
  if (!editor || !tabManager || !storage) {
    throw new Error('IDE is not ready yet. Please wait for initialization to finish.');
  }
  return { editor, tabManager, storage };
}

/**
 * Does this run need an interactive console? True when ANY file that will be
 * executed reads from stdin - not just the entry file, since a helper module
 * imported by the entry point may be the one calling input().
 */
function payloadReadsStdin(langId: string, body: Record<string, unknown>): boolean {
  const files = body.files as Array<{ content?: string }> | undefined;
  if (Array.isArray(files)) {
    return files.some(file => codeReadsStdin(langId, file?.content || ''));
  }
  return codeReadsStdin(langId, (body.code as string) || '');
}

// ── Output helpers ──────────────────────────────────────────────────────────

/** Escape text for safe embedding as HTML content. */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getCompileLabel(langId: string): string {
  switch (langId) {
    case 'java':       return 'Compile Error (javac)';
    case 'csharp':     return 'Compile Error (dotnet build)';
    case 'typescript': return 'TypeScript Error';
    case 'php':        return 'Parse Error (php -l)';
    case 'python':     return 'Problem Detected — code was not run';
    default:           return 'Compile Error';
  }
}

/**
 * Render a /api/run result into the output panel as formatted HTML.
 * Compile errors get a blue header and red error text.
 * Runtime output appears as-is with an optional red stderr section and a
 * green/red exit-code footer.
 */
function renderRunResult(
  data: { stdout?: string; stderr?: string; exitCode: number; phase?: string },
  langId: string
): void {
  const isCompile = data.phase === 'compile';
  const parts: string[] = [];

  if (isCompile) {
    parts.push(`<span class="info">── ${esc(getCompileLabel(langId))} ──────────────────────────────────────</span>\n`);
    if (data.stderr) {
      parts.push(`<span class="error">${esc(data.stderr)}</span>`);
    }
  } else {
    if (data.stdout) {
      parts.push(esc(data.stdout));
    }
    if (data.stderr) {
      if (parts.length > 0) parts.push('\n');
      const errLabel = langId === 'python' ? 'Python Error' : langId === 'java' ? 'Java Error' : langId === 'csharp' ? 'C# Error' : langId === 'php' ? 'PHP Error' : 'Error Output';
      parts.push(`<span class="info">── ${errLabel} ─────────────────────────────────────────────</span>\n`);
      parts.push(`<span class="error">${esc(data.stderr)}</span>`);
    }
  }

  // Trailing newline before footer
  if (parts.length > 0) {
    const last = parts[parts.length - 1];
    if (!last.endsWith('\n')) parts.push('\n');
  }

  if (data.exitCode === 0) {
    parts.push(`<span class="success">[exit 0 ✓]</span>`);
  } else {
    parts.push(`<span class="error">[exit code: ${data.exitCode}]</span>`);
  }

  setOutputHtml(parts.join(''));
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

export async function runCode(code: string) {
  const { editor, tabManager, storage } = requireRuntime();
  const activeTab = tabManager.getActiveTab();
  if (!activeTab) return;

  const lang = getLanguage(activeTab.file.language);
  if (!lang) return;

  if (isHtmlFile(activeTab.file) || isCssFile(activeTab.file)) {
    await openWebPreview();
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
      code,
    };

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
    isMain: normalizeProjectPath(file.path) === entryPoint,
  })),
  entryPoint,
};
}

    // ── Interactive stdin path ────────────────────────────────────────────
    // Programs that pause for keyboard input (input(), Scanner, readline,
    // Console.ReadLine, fgets(STDIN), …) cannot use the buffered /api/run
    // round-trip: it returns a single result and cannot wait mid-execution,
    // so the program would hang until the timeout and lose everything after
    // the prompt. Route them to the streaming console instead, which works
    // for BOTH snippet and multi-file project runs and every language.
    if (!appConfig.noOutput && payloadReadsStdin(lang.id, requestBody)) {
      stopRunLoader();
      clearTurtleCanvas();
      const result = await runInteractive(lang.id, requestBody);
      if (appConfig.isEmbedded) {
        notifyRunResult({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        });
      }
      return;
    }

    const resp = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const raw = await resp.text();
    let data: any = null;

    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    stopRunLoader();
    setOutput("");
    clearTurtleCanvas();
    hideImageWindow();

    if (!resp.ok) {
      setOutputHtml(
        `<span class="error">HTTP ${resp.status}\n${esc(raw || '(empty response)')}</span>\n` +
        `<span class="error">[exit code: 1]</span>`
      );
      setStatus("Run failed");
      return;
    }

    if (!data) {
      setOutputHtml(
        `<span class="error">ERROR: Server returned no JSON.\n${esc(raw || '(empty response)')}</span>\n` +
        `<span class="error">[exit code: 1]</span>`
      );
      setStatus("Run failed");
      return;
    }

    // ── Turtle graphics output ──────────────────────────────────────────
    // A run counts as turtle output when it drew something *or* left a turtle
    // on screen (a program may only place the cursor without drawing).
    //
    // Only open the turtle window when the program finished successfully
    // (exit 0). A compile/syntax error means the program never ran, and a
    // runtime error (e.g. a typo like `t.foward`) means it failed part-way -
    // in both cases we show only the error and draw nothing, so a broken
    // program never flashes a half-finished drawing.
    let turtleRenderErr: string | null = null;
    let missingTurtlePic: string | null = null;
    if (
      data.exitCode === 0 &&
      data.phase !== 'compile' &&
      data.turtleData &&
      (data.turtleData.shapes?.length > 0 || data.turtleData.cursors?.length > 0)
    ) {
      try {
        // bgpic("maze.svg") names a project file. Python only reports the name;
        // the image itself lives in the workspace, so resolve it here and hand
        // the renderer a data URL.
        const picName = (data.turtleData as TurtleData).pic;
        if (picName) {
          const picUrl = await resolveWorkspaceImageUrl(
            picName,
            normalizeProjectPath(activeTab.file.path || activeTab.file.name),
          );
          if (picUrl) (data.turtleData as TurtleData).picData = picUrl;
          else missingTurtlePic = picName;
        }
        renderTurtle(data.turtleData as TurtleData);
      } catch (renderErr) {
        turtleRenderErr = String(renderErr);
      }
    }

    renderRunResult(data, lang.id);
    if (missingTurtlePic) {
      appendOutput(
        `[turtle: background image "${missingTurtlePic}" was not found in this project. ` +
        `Add an .svg file with that name — bgpic() reads SVG images from the workspace.]`
      );
    }
    if (turtleRenderErr) appendOutput(`[turtle render error: ${turtleRenderErr}]`);

    setStatus(
      data.exitCode === 0
        ? 'Ready ✅'
        : data.phase === 'compile'
          ? 'Compile error ❌'
          : 'Runtime error ❌'
    );
    
    // Notify parent of run result (Step-Up integration)
    if (appConfig.isEmbedded) {
      notifyRunResult({
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        exitCode: data.exitCode ?? -1,
        durationMs: data.durationMs || 0
      });
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

const initialized = requireRuntime();
const editor = initialized.editor;
const tabManager = initialized.tabManager;

// ── Commands (V-17) ─────────────────────────────────────────────────────────
//
// Every one of these used to be wired directly to a handler that checked nothing.
// The run button was greyed by a CSS class while remaining fully clickable, and
// Ctrl+Enter, Ctrl+N and Ctrl+W had neither an indication nor a check - so a
// read-only, structure-locked embed ran code and created files. Declaring the
// capability once, and deriving both the UI state and the refusal from it, is what
// stops a future binding from reintroducing the hole.
const commands = runtime.commands!;

commands.register({
  id: 'workspace.run',
  title: 'Run',
  capability: 'run',
  run: () => runCode(editor.getValue()),
});

commands.register({
  id: 'workspace.saveFile',
  title: 'Save',
  // Saving is not gated on `edit`: autosave persists a dirty document anyway, so
  // refusing an explicit save would only make the shortcut feel broken while
  // changing nothing about what reaches storage.
  when: () => tabManager.getActiveTab() !== null,
  run: async () => {
    const activeTab = tabManager.getActiveTab();
    if (!activeTab) return;
    await tabManager.saveCurrentTab();
    setStatus(`Saved ${activeTab.file.name}`);
  },
});

commands.register({
  id: 'workspace.newFile',
  title: 'New file',
  capability: 'structure',
  run: async () => {
    const newTab = await tabManager.createNewFile(runtime.currentLang, runtime.currentVersion);
    if (newTab) {
      editor.setModel(getOrCreateModel(newTab));
      setStatus(`Created ${newTab.file.name}`);
    }
  },
});

commands.register({
  id: 'workspace.closeTab',
  title: 'Close tab',
  capability: 'structure',
  // Closing the last tab leaves the editor with nothing to show, which the empty
  // state handles - but the previous binding refused it silently, so keep that.
  when: () => tabManager.getActiveTab() !== null && tabManager.getTabCount() > 1,
  run: async () => {
    const activeTab = tabManager.getActiveTab();
    if (activeTab) await tabManager.closeTab(activeTab.file.id);
  },
});

commands.register({
  id: 'editor.formatDocument',
  title: 'Format document',
  capability: 'edit',
  run: () => {
    editor.getAction('editor.action.formatDocument')?.run();
  },
});

bindButton(commands, runBtn, 'workspace.run');

bindKeybinding(commands, editor, monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, 'workspace.run');
bindKeybinding(commands, editor, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, 'workspace.saveFile');
bindKeybinding(commands, editor, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, 'workspace.newFile');
bindKeybinding(commands, editor, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, 'workspace.closeTab');
bindKeybinding(
  commands,
  editor,
  monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
  'editor.formatDocument',
);

// "Explain this keyword" - right-click a keyword to see a plain-English
// explanation + example, backed by languages/*/keywords.json.
//
// The menu item only appears when the word under the cursor/selection is
// actually present in the active language's keyword dictionary - driven by
// a Monaco context key kept in sync on every cursor/selection/model change,
// so adding a new entry to keywords.json makes it "just work" with no other
// code changes, and it stays hidden for anything not in the file.
function resolveKeywordAtCursor(ed: monaco.editor.IStandaloneCodeEditor): string {
  const position = ed.getPosition();
  const model = ed.getModel();
  if (!position || !model) return "";

  const wordInfo = model.getWordAtPosition(position);
  if (wordInfo) return wordInfo.word;

  const selection = ed.getSelection();
  if (selection && !selection.isEmpty()) {
    return model.getValueInRange(selection).trim();
  }
  return "";
}

const keywordHelpAvailable = editor.createContextKey<boolean>("keywordHelpAvailable", false);

function updateKeywordHelpAvailability() {
  const word = resolveKeywordAtCursor(editor);
  if (!word) {
    keywordHelpAvailable.set(false);
    return;
  }
  const activeTab = tabManager.getActiveTab();
  const langId = activeTab ? activeTab.file.language : runtime.currentLang.id;
  keywordHelpAvailable.set(!!getKeywordExplanation(langId, word));
}

editor.onDidChangeCursorSelection(updateKeywordHelpAvailability);
editor.onDidChangeModel(updateKeywordHelpAvailability);

editor.addAction({
  id: "explainKeyword",
  label: t("editor.explainKeyword") || "💡 Explain this keyword",
  contextMenuGroupId: "9_cutcopypaste",
  contextMenuOrder: 1.5,
  precondition: "keywordHelpAvailable",
  run: (ed) => {
    const position = ed.getPosition();
    const model = ed.getModel();
    if (!position || !model) return;

    const wordInfo = model.getWordAtPosition(position);
    const word = wordInfo?.word || resolveKeywordAtCursor(ed);
    if (!word) return;

    const activeTab = tabManager.getActiveTab();
    const langId = activeTab ? activeTab.file.language : runtime.currentLang.id;
    const entry = getKeywordExplanation(langId, word, getUILang());
    if (!entry) return;

    // Position the popup near the clicked word on screen
    const coords = wordInfo
      ? ed.getScrolledVisiblePosition({ lineNumber: position.lineNumber, column: wordInfo.startColumn })
      : ed.getScrolledVisiblePosition(position);
    const editorDomNode = ed.getDomNode();
    const editorRect = editorDomNode?.getBoundingClientRect();
    const x = (editorRect?.left || 0) + (coords?.left || 0);
    const y = (editorRect?.top || 0) + (coords?.top || 0) + (coords?.height || 18);

    showKeywordHelpPopup(word, entry.type, entry.explanation, entry.example, entry.rtl, x, y);
  },
});

// "Run Selected" - right-click a selection to execute just those lines.
// Only appears when the selection covers at least one full line: either a
// multi-line selection, or a single line selected in its entirety (e.g.
// triple-click, or Home then Shift+End) - not for a plain cursor or a
// partial in-line text selection like a variable name.
const runSelectionAvailable = editor.createContextKey<boolean>("runSelectionAvailable", false);

function updateRunSelectionAvailability() {
  const selection = editor.getSelection();
  const model = editor.getModel();
  if (!selection || !model || selection.isEmpty()) {
    runSelectionAvailable.set(false);
    return;
  }
  if (selection.startLineNumber !== selection.endLineNumber) {
    runSelectionAvailable.set(true);
    return;
  }
  // Single line selected - only counts if the whole line is covered
  const lineMaxColumn = model.getLineMaxColumn(selection.startLineNumber);
  runSelectionAvailable.set(selection.startColumn === 1 && selection.endColumn === lineMaxColumn);
}

editor.onDidChangeCursorSelection(updateRunSelectionAvailability);
editor.onDidChangeModel(updateRunSelectionAvailability);

editor.addAction({
  id: "runSelectedLines",
  label: t("editor.runSelected") || "▶ Run Selected",
  contextMenuGroupId: "1_run",
  contextMenuOrder: 1,
  precondition: "runSelectionAvailable",
  run: (ed) => {
    const selection = ed.getSelection();
    const model = ed.getModel();
    if (!selection || !model) return;

    // Always execute the FULL lines touched by the selection, not just the
    // exact (possibly partial-column) selected text - matches how the
    // context menu becomes available in the first place.
    const startLine = selection.startLineNumber;
    const endLine = selection.endLineNumber;
    const code = model.getValueInRange(
      new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine))
    );
    if (!code.trim()) return;

    runCode(code);
  },
});

