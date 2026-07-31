/**
 * The editor's right-click actions: "Explain this keyword" and "Run selection".
 *
 * Split out of execution.ts. Both are Monaco editor actions guarded by a context
 * key, and both are registered as a side effect of importing this module - see the
 * note in editor-commands.ts about why main.ts imports the pieces explicitly.
 */

import * as monaco from 'monaco-editor';

import { getKeywordExplanation } from '../languages';
import { t } from '../i18n';
import { getUILang } from './wrapped-i18n';
import { runtime } from '../app/runtime';
import { showKeywordHelpPopup } from '../components/keyword-help';
import { runCode } from './execution';

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
  } });

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
  } });
