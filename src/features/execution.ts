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
import { renderTurtle, clearTurtleCanvas } from '../components/turtle';
import type { TurtleData } from '../components/turtle';
import { showKeywordHelpPopup } from '../components/keyword-help';
import { runBtn } from '../components/dom';
import { getOrCreateModel } from './editor-core';
import { isCssFile, isHtmlFile, openWebPreview } from './live-preview';

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
    // Never open the turtle window for a compile/syntax error: the program
    // never actually ran, so there is nothing to draw. This guarantees "if
    // there is a syntax error, nothing runs and nothing is drawn".
    let turtleRenderErr: string | null = null;
    if (
      data.phase !== 'compile' &&
      data.turtleData &&
      (data.turtleData.shapes?.length > 0 || data.turtleData.cursors?.length > 0)
    ) {
      try {
        renderTurtle(data.turtleData as TurtleData);
      } catch (renderErr) {
        turtleRenderErr = String(renderErr);
      }
    }

    renderRunResult(data, lang.id);
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

runBtn.addEventListener("click", () => runCode(editor.getValue()));

// Keyboard shortcuts
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
  runBtn.click();
});

editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
  // Save current tab
  const activeTab = tabManager.getActiveTab();
  if (activeTab) {
    tabManager.saveCurrentTab();
    setStatus(`Saved ${activeTab.file.name}`);
  }
});

// Ctrl+N - New file
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, async () => {
  const newTab = await tabManager.createNewFile(runtime.currentLang, runtime.currentVersion);
  if (newTab) {
    const model = getOrCreateModel(newTab);
    editor.setModel(model);
    setStatus(`Created ${newTab.file.name}`);
  }
});

// Ctrl+W - Close current tab
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, async () => {
  const activeTab = tabManager.getActiveTab();
  if (activeTab && tabManager.getTabCount() > 1) {
    await tabManager.closeTab(activeTab.file.id);
  }
});

// Format document
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
  editor.getAction("editor.action.formatDocument")?.run();
});

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

