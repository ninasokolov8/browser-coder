/**
 * The editor's right-click actions: "Explain this keyword" and "Run selection".
 *
 * Split out of execution.ts. Both are Monaco editor actions guarded by a context
 * key, and both are registered as a side effect of importing this module - see the
 * note in editor-commands.ts about why main.ts imports the pieces explicitly.
 */

import * as monaco from 'monaco-editor';

import { getKeywordExplanation, languageCan } from '../languages';
import { t } from '../i18n';
import { getUILang } from './wrapped-i18n';
import { runtime } from '../app/runtime';
import { showKeywordHelpPopup } from '../components/keyword-help';
import { runCode } from './execution';
import {
  coversWholeLines,
  dedent,
  selectedLineRange,
  type LineRange,
} from './selection-run.ts';

function requireEditor(): monaco.editor.IStandaloneCodeEditor {
  const editor = runtime.editor;
  if (!editor) {
    throw new Error('IDE is not ready yet. Please wait for initialization to finish.');
  }
  return editor;
}

const editor = requireEditor();
const tabManager = runtime.tabManager!;

// "Explain this keyword" - right-click a keyword to see a plain-English
// explanation + example, backed by languages/*/keywords.json.
//
// The menu item only appears when the word under the cursor/selection is
// actually present in the active language's keyword dictionary - driven by
// a Monaco context key kept in sync on every cursor/selection/model change,
// so adding a new entry to keywords.json makes it "just work" with no other
// code changes, and it stays hidden for anything not in the file.
/**
 * Widened to ICodeEditor, which is what Monaco hands an action callback. Only the
 * position and the model are read, and both exist on the narrower type.
 */
function resolveKeywordAtCursor(ed: monaco.editor.ICodeEditor): string {
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
  const langId = activeTab ? activeTab.file.language : runtime.currentLang?.id;
  keywordHelpAvailable.set(!!langId && !!getKeywordExplanation(langId, word));
}

editor.onDidChangeCursorSelection(updateKeywordHelpAvailability);
editor.onDidChangeModel(updateKeywordHelpAvailability);

const explainKeywordAction: monaco.editor.IActionDescriptor = {
  id: "explainKeyword",
  // No `|| 'fallback'`: t() returns the key when a translation is missing, never an
  // empty string, so the alternative was dead code that read as a safety net.
  label: t("editor.explainKeyword"),
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
    const langId = activeTab ? activeTab.file.language : runtime.currentLang?.id;
    if (!langId) return;

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
  } };

// "Run Selected" - right-click a selection to execute just those lines.
//
// Offered only when the selection covers at least one whole line AND the active
// language can actually run a fragment. The decisions are in `selection-run.ts`,
// which is pure and tested; this half only reads the editor.
const runSelectionAvailable = editor.createContextKey<boolean>("runSelectionAvailable", false);

function activeLanguageId(): string | undefined {
  return tabManager.getActiveTab()?.file.language ?? runtime.currentLang?.id;
}

/**
 * One rule, read by three things: the context key that shows the menu item, the
 * command's own enablement, and the command's guard when it actually runs.
 *
 * They must not disagree. A command enabled by a looser rule than the menu means the
 * keybinding runs something the menu would not offer - here, the whole line the cursor
 * merely rests on.
 */
function hasRunnableSelection(): boolean {
  const selection = editor.getSelection();
  const model = editor.getModel();
  if (!selection || !model || !languageCan(activeLanguageId(), 'runSelection')) return false;
  return coversWholeLines(selection, line => model.getLineMaxColumn(line));
}

function updateRunSelectionAvailability() {
  runSelectionAvailable.set(hasRunnableSelection());
}

editor.onDidChangeCursorSelection(updateRunSelectionAvailability);
editor.onDidChangeModel(updateRunSelectionAvailability);

/**
 * The code a "Run Selected" would execute, or null when there is nothing to run.
 *
 * Whole lines, because a fragment of a line is not a statement - but the *lines the
 * student actually highlighted*, which is not the same as the selection's end line.
 */
function selectedProgram(): { code: string; range: LineRange } | null {
  const selection = editor.getSelection();
  const model = editor.getModel();
  if (!selection || !model || !hasRunnableSelection()) return null;

  const range = selectedLineRange(selection);
  const raw = model.getValueInRange(
    new monaco.Range(range.startLine, 1, range.endLine, model.getLineMaxColumn(range.endLine)),
  );
  // Sending an indented block verbatim is an IndentationError for code that is
  // correct where it sits.
  const code = dedent(raw);
  return code.trim() ? { code, range } : null;
}

// Through the registry, like every other way of running code. This was the one
// caller that reached `runCode` directly, so a task with `allowRun: false` refused
// the Run button and Ctrl+Enter and then executed anything the student right-clicked.
runtime.commands?.register({
  id: 'workspace.runSelection',
  title: 'Run selection',
  capability: 'run',
  when: () => selectedProgram() !== null,
  run: () => {
    const selected = selectedProgram();
    if (!selected) return;
    // The pre-run diagnostics gate is scoped to these lines: an error on line 40 of a
    // file being edited must not refuse a run of line 1, which is the main reason to
    // run a fragment at all.
    return runCode(selected.code, { markerRange: selected.range });
  },
});

const runSelectionAction: monaco.editor.IActionDescriptor = {
  id: "runSelectedLines",
  label: t("editor.runSelected"),
  contextMenuGroupId: "1_run",
  contextMenuOrder: 1,
  precondition: "runSelectionAvailable",
  // Ctrl+Shift+Enter, so the feature is reachable without the right-click menu -
  // which is switched off entirely in a readonly embed, and which the app's own
  // command palette never listed because this was not a registry command.
  keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
  run: () => {
    void runtime.commands?.execute('workspace.runSelection', { source: 'ui' });
  } };

/**
 * (Re-)register both context-menu actions.
 *
 * Monaco has no API for relabelling an action that has already been added, and the
 * labels were captured once at import time - so a student who switched the UI to
 * Hebrew went on right-clicking into an English menu for the rest of the session.
 * `languageChanged` is dispatched by the i18n module and, until now, nothing listened
 * to it at all.
 */
let contextActions: monaco.IDisposable[] = [];

function registerContextMenuActions(): void {
  for (const action of contextActions) action.dispose();
  contextActions = [
    editor.addAction({ ...explainKeywordAction, label: t("editor.explainKeyword") }),
    editor.addAction({ ...runSelectionAction, label: t("editor.runSelected") }),
  ];
}

registerContextMenuActions();
window.addEventListener('languageChanged', registerContextMenuActions);
