/**
 * The debugger's controls, and the sentence that says what the program is doing.
 *
 * ## Why this is not icon-only
 *
 * Every professional editor shows five bare glyphs here, and that works because a
 * professional already knows what an arrow arcing over a dot means. A fifteen-year-old
 * who has never used a debugger sees five identical grey marks and clicks the leftmost
 * one. `⤼`, `⤓` and `⤒` in particular are not guessable by anyone who has not been
 * taught them - which is the entire audience for this IDE.
 *
 * So each control carries its name. Learning "Step over" from a button is the point;
 * being able to recognise the icon later, in some other editor, is a bonus the icon
 * still delivers because it is the same icon.
 *
 * ## Why there is a status line
 *
 * A debugger has modes, and a student who does not know which one they are in cannot
 * tell a broken program from a paused one. "Paused on line 4" answers the question the
 * whole toolbar raises, in the place they are already looking. It is also the only part
 * of the toolbar that changes on its own, so it is what tells them something happened.
 */

import type { DebugSnapshot } from './state.ts';

export interface ToolbarAction {
  readonly id: string;
  readonly label: string;
  /** Shown in the tooltip after the label. */
  readonly shortcut: string;
  readonly icon: string;
  /** Destructive actions are styled apart, so Stop is never pressed by accident. */
  readonly tone?: 'stop';
  readonly enabled: (snapshot: DebugSnapshot) => boolean;
  readonly run: () => void;
}

/**
 * 16x16, `currentColor`, no fills that fight a theme.
 *
 * Drawn rather than taken from a font: the glyphs that exist for these actions are
 * inconsistent between platforms - `⤼` renders as a box on some Windows fonts - and a
 * control whose meaning depends on the machine is not a control.
 */
const ICONS = {
  continue: '<path d="M4.5 3.2v9.6l8-4.8z"/>',
  stepOver:
    '<path d="M2.6 8.6a5.4 5.4 0 0 1 10.4-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
    + '<path d="M13.4 3.1v3.6h-3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<circle cx="8" cy="12.4" r="1.9"/>',
  stepInto:
    '<path d="M8 2v6.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
    + '<path d="M5.4 6l2.6 2.6L10.6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<circle cx="8" cy="12.6" r="1.9"/>',
  stepOut:
    '<path d="M8 8.4V2.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
    + '<path d="M5.4 4.8L8 2.2l2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<circle cx="8" cy="12.6" r="1.9"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.4"/>',
} as const;

function icon(body: string): string {
  return `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">${body}</svg>`;
}

/**
 * Build the five controls.
 *
 * The capability predicates and the handlers are injected, so this module has no
 * opinion about how a command reaches the adapter - it only decides what a student
 * sees and when it is available.
 */
export function debugActions(
  capabilities: () => {
    canContinue: boolean;
    canStepOver: boolean;
    canStepIn: boolean;
    canStepOut: boolean;
    canStop: boolean;
  },
  send: (command: string) => void,
): ToolbarAction[] {
  return [
    {
      id: 'debug-continue',
      label: 'Continue',
      shortcut: 'F5',
      icon: ICONS.continue,
      enabled: () => capabilities().canContinue,
      run: () => send('continue'),
    },
    {
      id: 'debug-step-over',
      label: 'Step over',
      shortcut: 'F10',
      icon: ICONS.stepOver,
      enabled: () => capabilities().canStepOver,
      run: () => send('next'),
    },
    {
      id: 'debug-step-in',
      label: 'Step into',
      shortcut: 'F11',
      icon: ICONS.stepInto,
      enabled: () => capabilities().canStepIn,
      run: () => send('stepIn'),
    },
    {
      id: 'debug-step-out',
      label: 'Step out',
      shortcut: 'Shift+F11',
      icon: ICONS.stepOut,
      enabled: () => capabilities().canStepOut,
      run: () => send('stepOut'),
    },
    {
      id: 'debug-stop',
      label: 'Stop',
      shortcut: 'Shift+F5',
      icon: ICONS.stop,
      tone: 'stop',
      enabled: () => capabilities().canStop,
      run: () => send('stop'),
    },
  ];
}

/**
 * What the program is doing, in one sentence a student can act on.
 *
 * Named for the state they can see rather than the state machine's own words: there is
 * no such thing as "postMortem" to a fifteen-year-old, but "stopped because of an
 * error" is exactly what happened.
 */
export function describeStatus(snapshot: DebugSnapshot): string {
  switch (snapshot.status) {
    case 'starting':
      return 'Starting…';
    case 'running':
      return 'Running — it will pause at your next breakpoint';
    case 'paused':
      return snapshot.stop
        ? `Paused on line ${snapshot.stop.line}`
        : 'Paused';
    case 'postMortem':
      return snapshot.stop
        ? `Stopped by an error on line ${snapshot.stop.line}`
        : 'Stopped by an error';
    case 'ended':
      return 'Finished';
    default:
      return '';
  }
}

/** Create the buttons once. Idempotent, so re-initialising cannot double them. */
export function buildToolbar(
  host: HTMLElement,
  actions: readonly ToolbarAction[],
  currentSnapshot: () => DebugSnapshot,
): void {
  if (host.dataset.built === '1') return;
  host.dataset.built = '1';
  host.textContent = '';

  const status = document.createElement('span');
  status.id = 'debug-status';
  status.className = 'debug-status';
  host.appendChild(status);

  const group = document.createElement('div');
  group.className = 'debug-actions';
  host.appendChild(group);

  for (const action of actions) {
    const button = document.createElement('button');
    button.id = action.id;
    button.type = 'button';
    button.className = `debug-btn${action.tone === 'stop' ? ' debug-btn-stop' : ''}`;
    button.title = action.shortcut ? `${action.label} (${action.shortcut})` : action.label;
    button.innerHTML = `${icon(action.icon)}<span class="debug-btn-label">${action.label}</span>`;

    button.addEventListener('click', () => {
      // Re-checked at click time rather than trusting the disabled attribute: a stale
      // button is exactly how a command reaches a session that cannot serve it.
      if (action.enabled(currentSnapshot())) action.run();
    });

    group.appendChild(button);
  }
}

/** Reflect the snapshot. The only thing that varies is enablement and the sentence. */
export function renderToolbar(
  host: HTMLElement,
  actions: readonly ToolbarAction[],
  snapshot: DebugSnapshot,
): void {
  for (const action of actions) {
    const element = document.getElementById(action.id) as HTMLButtonElement | null;
    if (!element) continue;
    element.disabled = !action.enabled(snapshot);
  }

  const status = document.getElementById('debug-status');
  if (status) {
    status.textContent = describeStatus(snapshot);
    status.dataset.state = snapshot.status;
  }

  host.hidden = snapshot.status === 'idle';
}
