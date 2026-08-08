/**
 * The debugger's surface: breakpoint margin, toolbar, variables and call stack.
 *
 * Everything here is derived from `DebugSessionState`. No widget keeps its own idea of
 * whether the program is paused, which is what stops the toolbar and the margin
 * disagreeing - the same reasoning as the command registry in Phase D.
 *
 * The state module is pure and tested in node; this file is the part that needs a
 * browser, so it is deliberately thin: read a snapshot, render it.
 */

import * as monaco from 'monaco-editor';

import { runtime } from '../../app/runtime';
import { escapeHtml } from '../../components/html-escape.ts';
import { activeSessionId } from '../../components/interactive-console.ts';
import { setStatus } from '../../components/output';
import {
  DebugSessionState,
  type DebugSnapshot,
  type DebugVariable,
} from './state.ts';
import {
  describeChange,
  VariableHistory,
  type VariableChange,
} from './variable-diff.ts';
import type { Disposable } from '../../workspace/types.ts';

/**
 * The previous pause's locals, so each stop can be shown as a change rather than a
 * fresh list of numbers.
 *
 * Module-level because there is one debugger. Reset when a session ends, so the first
 * stop of the next run highlights nothing - everything is new then, and marking it all
 * would be noise on the one stop where the student is orienting themselves.
 */
const variableHistory = new VariableHistory();

/** One session state for the whole IDE. */
export const debugState = new DebugSessionState();

const BREAKPOINT_GLYPH = 'debug-breakpoint-glyph';
/** A breakpoint with a condition. Visibly different, or a student cannot tell why it did not stop. */
const CONDITIONAL_GLYPH = 'debug-breakpoint-glyph debug-breakpoint-conditional';
const CURRENT_LINE = 'debug-current-line';

let decorations: monaco.editor.IEditorDecorationsCollection | null = null;

/**
 * Send one debug command to the live session.
 *
 * Silently does nothing when there is no session - a keybinding pressed with nothing
 * running is not an error worth a message.
 */
async function sendCommand(command: string, body: Record<string, unknown> = {}): Promise<void> {
  const sessionId = activeSessionId();
  if (!sessionId) return;

  try {
    const response = await fetch(`/api/run/interactive/${sessionId}/debug/${command}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // 409 means the session has no debugger, which happens if the student presses
      // a debug control during an ordinary run. Reported quietly rather than thrown:
      // it is a mis-click, not a fault.
      const detail = await response.json().catch(() => null);
      setStatus(detail?.error || `Debug command failed (${response.status})`);
    }
  } catch {
    // The stream is the source of truth for session liveness; a failed control
    // request during teardown is expected.
  }
}

/**
 * Push EVERY breakpoint to the running adapter, in every file.
 *
 * `lines` still carries the entry file, because that is the shape the first version of
 * the protocol spoke and a client or adapter that only knows it must keep working.
 * `files` carries the rest, keyed by workspace PATH - the only name the two sides
 * share, since a document id means nothing to a process running in a job directory.
 */
export function syncBreakpoints(): void {
  if (!activeSessionId()) return;

  const workspace = runtime.workspace;
  const files: Record<string, number[]> = {};
  let entryLines: number[] = [];

  const activeId = runtime.tabManager?.getActiveTab()?.file.id ?? null;

  for (const [documentId, lines] of debugState.allBreakpoints()) {
    const path = workspace?.pathOf(documentId);
    if (!path) continue;
    files[path] = lines;
    if (documentId === activeId) entryLines = lines;
  }

  /*
   * Conditions travel keyed the same way the breakpoints are, and the EMPTY STRING
   * means the entry file - the one `lines` refers to.
   *
   * That key is not invented here: the explorer's manual ordering already uses the
   * empty string for the workspace root, for the same reason - a place that has no
   * name of its own but has to be addressable alongside things that do.
   */
  const conditions: Record<string, Record<number, string>> = {};
  for (const [documentId, forDocument] of debugState.allConditions()) {
    const path = workspace?.pathOf(documentId);
    if (!path) continue;
    conditions[path] = forDocument;
    if (documentId === activeId) conditions[''] = forDocument;
  }

  void sendCommand('setBreakpoints', { lines: entryLines, files, conditions });
}

// ── Editor decorations ──────────────────────────────────────────────────────

function renderDecorations(snapshot: DebugSnapshot): void {
  const editor = runtime.editor;
  if (!editor) return;

  const model = editor.getModel();
  if (!model) return;

  decorations ??= editor.createDecorationsCollection([]);

  const lineCount = model.getLineCount();
  const wanted: monaco.editor.IModelDeltaDecoration[] = [];

  const conditioned = new Set(snapshot.conditionedBreakpoints);

  for (const line of snapshot.breakpoints) {
    // Clamped: a breakpoint can outlive the lines it was set on if the student
    // deletes them, and Monaco throws on an out-of-range decoration.
    if (line > lineCount) continue;

    /*
     * A conditional breakpoint looks different, and its hover says the condition.
     *
     * Without that, a breakpoint that does not stop is indistinguishable from a broken
     * debugger - which is the single most confusing thing this feature could do to a
     * beginner. The condition itself is in the tooltip because it is the answer to the
     * question they will actually be asking.
     */
    const condition = conditioned.has(line) ? debugState.breakpointCondition(line) : null;

    wanted.push({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: condition ? CONDITIONAL_GLYPH : BREAKPOINT_GLYPH,
        glyphMarginHoverMessage: {
          value: condition
            ? `Stops when \`${condition}\` — click to remove`
            : 'Breakpoint — click to remove',
        },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    });
  }

  // The current line, only while genuinely stopped in the file on screen. A
  // highlight left behind after the program ended reads as "still paused".
  const stop = snapshot.stop;
  if (stop && stop.line >= 1 && stop.line <= lineCount) {
    /*
     * Is the program stopped in the file on screen?
     *
     * The adapter reports a workspace-relative PATH now that a breakpoint can be in any
     * file - it used to report a bare basename, and comparing a path against a name
     * would leave the arrow off every stop in a subfolder. Both are accepted: the path
     * when the workspace can resolve one, and the name as the fallback that keeps a
     * v1-shaped answer working.
     */
    const activeTab = runtime.tabManager?.getActiveTab();
    const activePath = activeTab ? runtime.workspace?.pathOf(activeTab.file.id) : null;
    const activeName = activeTab?.file.name;
    const sameFile = !stop.file
      || (activePath ? stop.file === activePath : false)
      || (activeName ? stop.file === activeName : false);

    if (sameFile) {
      wanted.push({
        range: new monaco.Range(stop.line, 1, stop.line, 1),
        options: {
          isWholeLine: true,
          className: CURRENT_LINE,
          glyphMarginClassName: snapshot.status === 'postMortem'
            ? 'debug-exception-glyph'
            : 'debug-current-glyph',
        },
      });
    }
  }

  decorations.set(wanted);
}

// ── Toolbar ─────────────────────────────────────────────────────────────────

interface ToolbarButton {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly enabled: (snapshot: DebugSnapshot) => boolean;
  readonly run: () => void;
}

const BUTTONS: readonly ToolbarButton[] = [
  {
    id: 'debug-continue',
    label: '▶',
    title: 'Continue (F5)',
    enabled: () => debugState.capabilities().canContinue,
    run: () => void sendCommand('continue'),
  },
  {
    id: 'debug-step-over',
    label: '⤼',
    title: 'Step over (F10)',
    enabled: () => debugState.capabilities().canStepOver,
    run: () => void sendCommand('next'),
  },
  {
    id: 'debug-step-in',
    label: '⤓',
    title: 'Step into (F11)',
    enabled: () => debugState.capabilities().canStepIn,
    run: () => void sendCommand('stepIn'),
  },
  {
    id: 'debug-step-out',
    label: '⤒',
    title: 'Step out (Shift+F11)',
    enabled: () => debugState.capabilities().canStepOut,
    run: () => void sendCommand('stepOut'),
  },
  {
    id: 'debug-stop',
    label: '■',
    title: 'Stop debugging (Shift+F5)',
    enabled: () => debugState.capabilities().canStop,
    run: () => void sendCommand('stop'),
  },
];

function buildToolbar(host: HTMLElement): void {
  if (host.dataset.built === '1') return;
  host.dataset.built = '1';

  for (const button of BUTTONS) {
    const element = document.createElement('button');
    element.id = button.id;
    element.type = 'button';
    element.className = 'debug-btn';
    element.textContent = button.label;
    element.title = button.title;
    element.addEventListener('click', () => {
      // Re-checked at click time rather than trusting the disabled attribute: a
      // stale button is exactly how a command reaches a session that cannot serve it.
      if (button.enabled(debugState.snapshot())) button.run();
    });
    host.appendChild(element);
  }
}

function renderToolbar(host: HTMLElement, snapshot: DebugSnapshot): void {
  for (const button of BUTTONS) {
    const element = document.getElementById(button.id) as HTMLButtonElement | null;
    if (!element) continue;
    const enabled = button.enabled(snapshot);
    element.disabled = !enabled;
    element.classList.toggle('disabled', !enabled);
  }
  host.hidden = snapshot.status === 'idle';
}

// ── Variables and call stack ────────────────────────────────────────────────

function variableRow(
  variable: DebugVariable,
  depth: number,
  change: VariableChange = 'same',
  previousText?: string,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'debug-var-row';
  if (change !== 'same') row.classList.add(`debug-var-${change}`);
  row.style.paddingLeft = `${8 + depth * 14}px`;

  const name = document.createElement('span');
  name.className = 'debug-var-name';
  name.textContent = variable.name;

  const value = document.createElement('span');
  value.className = 'debug-var-value';

  /*
   * The old value, struck through, before the new one.
   *
   * This is the whole point of the panel for a student: seeing `2` become `3` is what
   * teaches that a variable is a box whose contents change, and reading it as a pair
   * costs nothing where re-deriving it from memory costs everything.
   */
  if (change === 'changed' && previousText !== undefined) {
    const was = document.createElement('span');
    was.className = 'debug-var-was';
    was.textContent = previousText;
    row.appendChild(was);
  }
  // textContent throughout: a value is `repr()` of something the student created,
  // and a crafted __repr__ returning markup must never be parsed as HTML.
  value.textContent = variable.value.text;

  const type = document.createElement('span');
  type.className = 'debug-var-type';
  type.textContent = variable.value.type;

  row.append(name, value, type);
  return row;
}

function renderVariables(host: HTMLElement, snapshot: DebugSnapshot): void {
  host.textContent = '';

  if (!snapshot.stop) {
    const empty = document.createElement('div');
    empty.className = 'debug-empty';
    empty.textContent = snapshot.status === 'running'
      ? 'Running. Variables appear when the program stops.'
      : 'Set a breakpoint and start debugging.';
    host.appendChild(empty);
    return;
  }

  if (snapshot.stop.exception) {
    const banner = document.createElement('div');
    banner.className = 'debug-exception';
    banner.textContent = `${snapshot.stop.exception.type}: ${snapshot.stop.exception.message}`;
    host.appendChild(banner);
  }

  /*
   * Locals are diffed against the previous pause; globals are not.
   *
   * A global changing is rarely what a student is stepping to watch, and diffing both
   * would put two kinds of highlight on screen competing for the same attention.
   */
  const diffed = variableHistory.record(snapshot.stop.stack, snapshot.stop.locals);
  const changeOf = new Map(diffed.map(entry => [entry.variable.name, entry]));

  const sections: Array<[string, readonly DebugVariable[]]> = [
    ['Locals', snapshot.stop.locals],
    ['Globals', snapshot.stop.globals],
  ];

  for (const [title, variables] of sections) {
    // An empty Globals section is omitted rather than shown empty: at module level
    // `f_globals is f_locals`, so the adapter deliberately leaves it blank and a
    // visible empty heading would look like a bug.
    if (variables.length === 0) continue;

    const heading = document.createElement('div');
    heading.className = 'debug-section';
    heading.textContent = title;
    host.appendChild(heading);

    for (const variable of variables) {
      const entry = title === 'Locals' ? changeOf.get(variable.name) : undefined;
      host.appendChild(variableRow(variable, 0, entry?.change ?? 'same', entry?.previousText));
      for (const child of variable.value.children ?? []) {
        host.appendChild(variableRow(child, 1));
      }
    }
  }

  /*
   * And the same fact in words, when exactly one thing moved.
   *
   * "side went from 2 to 3" is the sentence a student would say out loud. Reading it
   * once is what turns a highlighted row into an understood one. Suppressed when
   * several things changed - then the list itself is clearer than a summary of it.
   */
  const sentence = describeChange(diffed);
  if (sentence) {
    const heading = document.createElement('div');
    heading.className = 'debug-section';
    heading.textContent = 'This step';
    host.appendChild(heading);

    const line = document.createElement('div');
    line.className = 'debug-step-note';
    line.textContent = sentence;
    host.appendChild(line);
  }

  if (snapshot.evaluated) {
    const row = document.createElement('div');
    row.className = 'debug-eval-result';
    row.textContent = snapshot.evaluated.error
      ? `${snapshot.evaluated.expression} → ${snapshot.evaluated.error}`
      : `${snapshot.evaluated.expression} → ${snapshot.evaluated.text}`;
    row.classList.toggle('error', Boolean(snapshot.evaluated.error));
    host.appendChild(row);
  }
}

// ── Watch expressions ───────────────────────────────────────────────────────

/**
 * Build the watch panel once.
 *
 * The `evaluate` command has existed in both adapters since the debugger was written,
 * and is covered by contract tests - but nothing in the UI ever sent one, so a student
 * could see the variables that happened to be in scope and could not ask a question
 * about anything else. This is that question box.
 */
function buildWatchPanel(host: HTMLElement): void {
  if (host.dataset.built === '1') return;
  host.dataset.built = '1';

  const form = document.createElement('form');
  form.className = 'debug-watch-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'debug-watch-input';
  input.placeholder = 'Watch an expression…';
  input.setAttribute('aria-label', 'Watch an expression');
  // The channel refuses anything longer, so the browser stops it here instead of the
  // student typing into a box whose contents will be silently dropped.
  input.maxLength = 2000;

  form.appendChild(input);
  form.addEventListener('submit', event => {
    event.preventDefault();
    // Cleared only on success, so a rejected duplicate leaves the text to edit rather
    // than making the student type it again.
    if (debugState.addWatch(input.value)) input.value = '';
  });

  const list = document.createElement('div');
  list.className = 'debug-watch-list';

  host.appendChild(form);
  host.appendChild(list);
}

function renderWatches(host: HTMLElement, snapshot: DebugSnapshot): void {
  const list = host.querySelector('.debug-watch-list');
  if (!list) return;

  list.textContent = '';

  for (const expression of snapshot.watches) {
    const row = document.createElement('div');
    row.className = 'debug-watch-row';

    const name = document.createElement('span');
    name.className = 'debug-var-name';
    name.textContent = expression;

    const value = document.createElement('span');
    const result = snapshot.watchValues.get(expression);
    if (!result) {
      // No value YET is different from an error, and different again from a value of
      // null - saying so beats showing an empty cell the student has to interpret.
      value.className = 'debug-var-value debug-watch-pending';
      value.textContent = snapshot.status === 'paused' || snapshot.status === 'postMortem'
        ? '…'
        : 'not running';
    } else {
      value.className = result.error ? 'debug-var-value debug-watch-error' : 'debug-var-value';
      // textContent throughout: the value is a repr of something the student created,
      // and a crafted __repr__ returning markup must never be parsed as HTML.
      value.textContent = result.error ?? result.text ?? 'None';
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'debug-watch-remove';
    remove.textContent = '×';
    remove.title = `Stop watching ${expression}`;
    remove.setAttribute('aria-label', `Stop watching ${expression}`);
    remove.addEventListener('click', () => debugState.removeWatch(expression));

    row.appendChild(name);
    row.appendChild(value);
    row.appendChild(remove);
    list.appendChild(row);
  }
}

function renderCallStack(host: HTMLElement, snapshot: DebugSnapshot): void {
  host.textContent = '';
  const stack = snapshot.stop?.stack ?? [];
  if (stack.length === 0) return;

  const heading = document.createElement('div');
  heading.className = 'debug-section';
  heading.textContent = 'Call stack';
  host.appendChild(heading);

  stack.forEach((frame, index) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'debug-frame-row';
    row.classList.toggle('innermost', index === 0);
    row.textContent = `${frame.name}  ${frame.file}:${frame.line}`;
    row.addEventListener('click', () => {
      const editor = runtime.editor;
      if (!editor) return;
      editor.revealLineInCenter(frame.line);
      editor.setPosition({ lineNumber: frame.line, column: 1 });
      editor.focus();
    });
    host.appendChild(row);
  });
}

// ── Wiring ──────────────────────────────────────────────────────────────────

/**
 * Attach the debugger UI.
 *
 * Returns a disposable, but in practice lives for the session - the IDE has one
 * editor and one debug state.
 */
export function initializeDebugUi(): Disposable {
  const editor = runtime.editor;
  const toolbarHost = document.getElementById('debug-toolbar');
  const variablesHost = document.getElementById('debug-variables');
  const stackHost = document.getElementById('debug-callstack');

  if (!editor || !toolbarHost || !variablesHost || !stackHost) {
    return { dispose: () => {} };
  }

  buildToolbar(toolbarHost);

  // Clicking the glyph margin toggles a breakpoint, which is where every IDE puts it.
  const marginSubscription = editor.onMouseDown(event => {
    if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
    const line = event.target.position?.lineNumber;
    if (!line) return;

    debugState.toggleBreakpoint(line);
    // Pushed immediately, so a breakpoint added mid-run takes effect on THIS run -
    // which is what the adapter's reader thread exists to make possible.
    syncBreakpoints();
  });

  /*
   * Teach the state how to turn the adapter's paths back into documents.
   *
   * The adapter answers `breakpoints` keyed by workspace path, because that is the only
   * name it and the IDE both know. Without this the answer cannot be attributed to a
   * file, and the margin would go on showing what was REQUESTED rather than what was
   * actually armed - which is the difference between a mark that means something and a
   * mark that is a guess.
   */
  debugState.resolvePathsWith(path => {
    const workspace = runtime.workspace;
    if (!workspace) return null;
    for (const document of workspace.allDocuments()) {
      if (workspace.pathOf(document.id) === path) return document.id;
    }
    return null;
  });

  // Breakpoints belong to a file, so the margin follows the active document.
  const trackDocument = (): void => {
    debugState.setDocument(runtime.tabManager?.getActiveTab()?.file.id ?? null);
  };
  const modelSubscription = editor.onDidChangeModel(trackDocument);
  trackDocument();

  const panelsHost = document.getElementById('debug-panels');
  const watchHost = document.getElementById('debug-watch');
  if (watchHost) buildWatchPanel(watchHost);

  /*
   * Ask the adapter for every watch, each time the program stops.
   *
   * A watch is only meaningful in a paused frame - the `evaluate` command needs one -
   * so this fires on the transition into `paused` or `postMortem` rather than on every
   * snapshot, which would re-request on each keystroke in the watch input.
   */
  let lastStopKey = '';
  const refreshWatches = (snapshot: DebugSnapshot): void => {
    const paused = snapshot.status === 'paused' || snapshot.status === 'postMortem';
    if (!paused) {
      lastStopKey = '';
      return;
    }

    const key = `${snapshot.stop?.file}:${snapshot.stop?.line}:${snapshot.watches.join(',')}`;
    if (key === lastStopKey) return;
    lastStopKey = key;

    for (const expression of debugState.watchExpressions()) {
      void sendCommand('evaluate', { expression });
    }
  };

  const unsubscribe = debugState.subscribe(snapshot => {
    renderDecorations(snapshot);
    renderToolbar(toolbarHost, snapshot);
    renderVariables(variablesHost, snapshot);
    renderCallStack(stackHost, snapshot);
    if (watchHost) renderWatches(watchHost, snapshot);
    refreshWatches(snapshot);

    // The panels take vertical space from the editor, so they appear only for a live
    // session and go away when it ends - an empty Variables pane permanently below
    // the code would be a worse default than not having the feature.
    if (panelsHost) panelsHost.hidden = snapshot.status === 'idle' || snapshot.status === 'ended';

    // A finished session's values must not be diffed against the next one's: they
    // belong to a different execution, and "changed since last time" would be a
    // comparison across two different programs.
    if (snapshot.status === 'idle' || snapshot.status === 'ended') variableHistory.reset();

    if (snapshot.lastError) setStatus(snapshot.lastError);
  });

  // Keybindings, matching what a student will already know from VS Code.
  const keys: Array<[number, string]> = [
    [monaco.KeyCode.F5, 'continue'],
    [monaco.KeyCode.F10, 'next'],
    [monaco.KeyCode.F11, 'stepIn'],
    [monaco.KeyMod.Shift | monaco.KeyCode.F11, 'stepOut'],
    [monaco.KeyMod.Shift | monaco.KeyCode.F5, 'stop'],
  ];

  for (const [keybinding, command] of keys) {
    editor.addCommand(keybinding, () => {
      const can = debugState.capabilities();
      const allowed =
        (command === 'continue' && can.canContinue) ||
        (command === 'next' && can.canStepOver) ||
        (command === 'stepIn' && can.canStepIn) ||
        (command === 'stepOut' && can.canStepOut) ||
        (command === 'stop' && can.canStop);
      if (allowed) void sendCommand(command);
    });
  }

  // Ctrl+F9 toggles a breakpoint on the cursor line, for keyboard-only use.
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F9, () => {
    const line = editor.getPosition()?.lineNumber;
    if (!line) return;
    debugState.toggleBreakpoint(line);
    syncBreakpoints();
  });

  /*
   * Shift+F9 puts a condition on the breakpoint at the cursor.
   *
   * A keyboard command rather than a right-click menu, for two reasons: the glyph
   * margin's context menu is Monaco's, not ours, and the accessibility work made
   * keyboard reach a requirement rather than a nicety. Shift+F9 is what every other
   * IDE binds this to, so it is not a new thing to learn.
   *
   * `prompt` is the right control here despite being unfashionable: it is modal,
   * focus-managed and screen-reader-announced by the browser itself, which a
   * hand-rolled inline input in the glyph margin would have to reimplement. The
   * existing text is pre-filled so editing one is not retyping it, and clearing the
   * box removes the condition.
   */
  editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F9, () => {
    const line = editor.getPosition()?.lineNumber;
    if (!line) return;

    const existing = debugState.breakpointCondition(line);
    const answer = window.prompt(
      `Stop at line ${line} only when this is true (leave empty for always):`,
      existing ?? '',
    );
    // Cancel is null and means "change nothing"; an empty string is a decision to
    // remove the condition, and the two must not be confused.
    if (answer === null) return;

    debugState.setBreakpointCondition(line, answer);
    syncBreakpoints();
    setStatus(
      answer.trim()
        ? `Line ${line} now stops only when ${answer.trim()}`
        : `Line ${line} now stops every time`,
    );
  });

  return {
    dispose: () => {
      marginSubscription.dispose();
      modelSubscription.dispose();
      unsubscribe();
      decorations?.clear();
    },
  };
}

/** Escaped for the one place markup is built rather than assembled from nodes. */
export const escapeForDebug = escapeHtml;
