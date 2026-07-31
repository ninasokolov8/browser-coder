/**
 * Commands, keybindings and the Run button.
 *
 * Split out of execution.ts, which had grown to 528 lines holding four unrelated
 * jobs: running code, rendering the files that are not programs, registering every
 * command and keybinding, and building two Monaco context-menu actions.
 *
 * The split has to preserve one non-obvious contract. These registrations happen as
 * a SIDE EFFECT of importing the module - there is no exported initialiser - so the
 * module must still be imported for the Run button to work at all. main.ts now
 * imports the three pieces explicitly and in order, which makes that visible rather
 * than hiding it behind a chain of imports between them.
 */

import * as monaco from 'monaco-editor';

import { runtime } from '../app/runtime';
import { debugBtn, runBtn } from '../components/dom';
import { setStatus } from '../components/output';
import { bindButton, bindKeybinding } from '../commands';
import { runCode } from './execution';
/**
 * Languages with a debug adapter on the server.
 *
 * Mirrors `supportsDebug` in the server adapters. Duplicated rather than fetched
 * because the button's enablement is needed before any request is made - and the
 * server still refuses honestly if this list is ever wrong, so the two cannot
 * disagree in a way that misleads: at worst the button is offered and the run
 * reports `debug:unsupported`.
 */
const DEBUGGABLE_LANGUAGES = new Set(['python']);
import { getOrCreateModel } from './editor-core';
import { describeFormatResult, hasFormatter, takeLastFormatResult } from './formatting';

function requireRuntime() {
  const editor = runtime.editor;
  const tabManager = runtime.tabManager;
  if (!editor || !tabManager) {
    throw new Error('IDE is not ready yet. Please wait for initialization to finish.');
  }
  return { editor, tabManager };
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
  id: 'workspace.debug',
  title: 'Start debugging',
  // Same capability as Run, deliberately: debugging IS running, and a task that
  // forbids running must not be debuggable either. A separate capability would be a
  // second switch for one permission, and the host has no way to express it.
  capability: 'run',
  when: () => {
    const model = editor.getModel();
    // Offered only where it can work. A greyed button with a tooltip is honest;
    // a button that starts a run which silently ignores every breakpoint is not.
    return model !== null && DEBUGGABLE_LANGUAGES.has(model.getLanguageId());
  },
  run: () => runCode(editor.getValue(), { debug: true }),
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
    // A command runs long after registration, so the current language is re-read
    // and re-checked rather than captured.
    if (!runtime.currentLang || !runtime.currentVersion) return;
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
  // Enabled only when something will actually happen. Monaco's action does
  // nothing at all for a language with no provider - no error, no message - so
  // without this the command was a no-op that read as "already formatted".
  when: () => {
    const model = editor.getModel();
    return model !== null && hasFormatter(model.getLanguageId());
  },
  run: async () => {
    const model = editor.getModel();
    if (!model) return;

    const fileName = tabManager.getActiveTab()?.file.name ?? 'the document';
    await editor.getAction('editor.action.formatDocument')?.run();

    // The local formatter declines to re-indent where guessing could corrupt the
    // program. Saying so is the difference between "it did less than you expected"
    // and the silent no-op this command used to be.
    setStatus(describeFormatResult(fileName, takeLastFormatResult(model)));
  },
});

bindButton(commands, runBtn, 'workspace.run');
// Bound through the registry like every other control, so its enabled state and its
// refusal both come from the command's own declaration rather than from CSS.
bindButton(commands, debugBtn, 'workspace.debug');

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
