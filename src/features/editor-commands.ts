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

import { runtime, requireEditor, requireTabManager } from '../app/runtime';
import { debugBtn, runBtn, stopBtn } from '../components/dom';
import { setStatus } from '../components/output';
import { bindButton, bindKeybinding } from '../commands';
import { isRunActive, requestStop } from '../components/run-controls.ts';
import { runCode } from './execution';
import { languageCan } from '../languages/loader';
import { getOrCreateModel } from './editor-core';
import { describeFormatResult, hasFormatter, takeLastFormatResult } from './formatting';
import { downloadSelectedItem, importFromPicker } from './explorer/operations';
import { explorerState } from './explorer/state';
import { runStudentTests } from './tests/run.ts';
import { shareProject } from './share.ts';
import { t } from '../i18n/index.ts';

// The shared accessors, not a private copy. See the note in app/runtime.ts.
const editor = requireEditor();
const tabManager = requireTabManager();

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
  title: 'command.run',
  capability: 'run',
  when: () => !isRunActive(),
  run: async () => { await runCode(editor.getValue()); },
});

commands.register({
  id: 'workspace.debug',
  title: 'command.debug',
  // Same capability as Run, deliberately: debugging IS running, and a task that
  // forbids running must not be debuggable either. A separate capability would be a
  // second switch for one permission, and the host has no way to express it.
  capability: 'run',
  when: () => {
    const model = editor.getModel();
    // Offered only where it can work. A greyed button with a tooltip is honest;
    // a button that starts a run which silently ignores every breakpoint is not.
    return !isRunActive()
      && model !== null
      && languageCan(model.getLanguageId(), 'debug');
  },
  run: async () => { await runCode(editor.getValue(), { debug: true }); },
});

/*
 * Check my work.
 *
 * Gated on the same 'run' capability as Run and Debug: running the marking harness
 * IS running, and a task that forbids running must not be markable either.
 *
 * Deliberately NOT gated on a harness existing. That check needs the workspace
 * snapshot, which is async, and a command's `when` is synchronous - so the command
 * is always offered and says 'this task has no checks' when there are none. An
 * always-present item that sometimes says nothing to do beats an item that appears
 * and disappears for reasons the student cannot see.
 */
commands.register({
  id: 'workspace.runTests',
  title: 'command.checkWork',
  capability: 'run',
  when: () => !isRunActive(),
  run: () => runStudentTests(),
});

/*
 * Share a snapshot of this project.
 *
 * No capability gate. Sharing is not running and not editing - a read-only embed is
 * exactly the situation where a student most wants to send somebody what they are
 * looking at, and there is no host permission that means 'may not be seen'.
 */
commands.register({
  id: 'workspace.share',
  title: 'command.shareProject',
  run: async () => {
    const link = await shareProject();
    if (!link) return;

    // Copying can fail - clipboard access needs a secure context and, in some
    // browsers, a recent user gesture. The link is shown either way, because a link
    // the student can read and retype beats a silent failure.
    try {
      await navigator.clipboard?.writeText(link);
      setStatus(t('share.copied'));
    } catch {
      setStatus(t('share.link', { link }));
    }
  },
});

commands.register({
  id: 'workspace.saveFile',
  title: 'command.save',
  // Saving is not gated on `edit`: autosave persists a dirty document anyway, so
  // refusing an explicit save would only make the shortcut feel broken while
  // changing nothing about what reaches storage.
  when: () => tabManager.getActiveTab() !== null,
  run: async () => {
    const activeTab = tabManager.getActiveTab();
    if (!activeTab) return;
    await tabManager.saveCurrentTab();
    setStatus(t('status.savedFile', { name: activeTab.file.name }));
  },
});

commands.register({
  id: 'workspace.newFile',
  title: 'command.newFile',
  capability: 'structure',
  run: async () => {
    // A command runs long after registration, so the current language is re-read
    // and re-checked rather than captured.
    if (!runtime.currentLang || !runtime.currentVersion) return;
    const newTab = await tabManager.createNewFile(runtime.currentLang, runtime.currentVersion);
    if (newTab) {
      editor.setModel(getOrCreateModel(newTab));
      setStatus(t('status.createdFile', { name: newTab.file.name }));
    }
  },
});

commands.register({
  id: 'workspace.closeTab',
  title: 'command.closeTab',
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
  title: 'command.formatDocument',
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

// Import and export, in the palette.
//
// Importing used to require knowing to drag a file from the desktop: there was no
// <input type="file"> in the app, no Import command, and no menu item - so on a tablet,
// or for anyone who did not think to try dragging, getting a file in was impossible.
commands.register({
  id: 'workspace.importFiles',
  title: 'command.importFiles',
  capability: 'structure',
  run: () => importFromPicker({ directory: false }, null),
});

commands.register({
  id: 'workspace.importFolder',
  title: 'command.importFolder',
  capability: 'structure',
  run: () => importFromPicker({ directory: true }, null),
});

commands.register({
  id: 'workspace.downloadItem',
  title: 'command.downloadItem',
  when: () => explorerState.selectedIds.size === 1,
  run: () => downloadSelectedItem(),
});

/**
 * Stop the running program.
 *
 * A command and not only a button, so it is in the palette, is keybindable, and is
 * reachable from the keyboard by a student who cannot use a mouse. Deliberately has NO
 * capability requirement: stopping is not an edit and not a run, and an embed that
 * forbids running must still let a student end something already going.
 *
 * `when` keeps it out of the palette while nothing is running, so it is never offered
 * as an action that would do nothing.
 */
commands.register({
  id: 'workspace.stopRun',
  title: 'command.stopRun',
  when: () => isRunActive(),
  run: () => requestStop(),
});

bindButton(commands, runBtn, 'workspace.run');
bindButton(commands, stopBtn, 'workspace.stopRun');

/*
 * `workspace.runTests` has no button, deliberately.
 *
 * It briefly had one. A marking harness is a file a TEACHER ships - `X_HIDDEN_tests.py`
 * and the like - and no Step-Up task ships one, so for every student the button did
 * nothing they could see. A control that is inert for everybody is worse than no
 * control: it teaches that buttons in this IDE may or may not work.
 *
 * The command, the BCTEST protocol and the checklist all remain. A task that does ship
 * a harness can reach it from the palette, and if harnesses ever become part of the
 * curriculum this is one line to put back.
 */
// Bound through the registry like every other control, so its enabled state and its
// refusal both come from the command's own declaration rather than from CSS.
bindButton(commands, debugBtn, 'workspace.debug');

// `when` depends on the ACTIVE MODEL. Step-Up supplies that model after the button is
// initially bound, and tab/language changes can replace it later. Without these
// notifications Debug stays frozen in whatever state the empty bootstrap model gave it.
editor.onDidChangeModel(() => commands.notifyEnablementChanged());
monaco.editor.onDidChangeModelLanguage(() => commands.notifyEnablementChanged());
window.addEventListener('runStateChanged', () => commands.notifyEnablementChanged());

bindKeybinding(commands, editor, monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, 'workspace.run');
// Shift+F5 is Stop in VS Code, and it already stops a DEBUG session here - so the
// same key now ends a plain run too, rather than meaning two different things
// depending on how the program happened to be started.
bindKeybinding(commands, editor, monaco.KeyMod.Shift | monaco.KeyCode.F5, 'workspace.stopRun');
bindKeybinding(commands, editor, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, 'workspace.saveFile');
bindKeybinding(commands, editor, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, 'workspace.newFile');
bindKeybinding(commands, editor, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, 'workspace.closeTab');
bindKeybinding(
  commands,
  editor,
  monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
  'editor.formatDocument',
);
