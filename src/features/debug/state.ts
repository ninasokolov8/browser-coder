/**
 * Debug session state: breakpoints, the current stop, and what the UI may do next.
 *
 * Pure. No DOM, no Monaco, no fetch - so it is tested in node, and so the question
 * "should Step Over be enabled right now?" has one answer rather than one per widget.
 *
 * That last point is the reason this file exists rather than the state living in the
 * view. A debugger has a small number of states and a large number of controls that
 * must agree about them: five toolbar buttons, the glyph margin, the current-line
 * highlight, the variables panel, the call stack. Deriving all of it from one place is
 * what stops "Continue" being clickable while nothing is paused - the same reasoning
 * as the command registry in Phase D.
 */

export type DebugStatus =
  /** No debug session. */
  | 'idle'
  /** Asked for, waiting for the adapter to attach. */
  | 'starting'
  /** Attached and the program is running. */
  | 'running'
  /** Stopped at a line, and the student can inspect and step. */
  | 'paused'
  /** The program hit an uncaught exception and is reported post-mortem. */
  | 'postMortem'
  /** The session ended. */
  | 'ended';

export interface DebugVariable {
  readonly name: string;
  readonly value: {
    readonly text: string;
    readonly type: string;
    readonly length?: number;
    readonly children?: readonly DebugVariable[];
  };
}

export interface DebugFrame {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

export interface DebugStop {
  readonly reason: string;
  readonly file: string;
  readonly line: number;
  readonly stack: readonly DebugFrame[];
  readonly locals: readonly DebugVariable[];
  readonly globals: readonly DebugVariable[];
  readonly exception?: { readonly type: string; readonly message: string };
  readonly postMortem?: boolean;
}

export interface DebugSnapshot {
  readonly status: DebugStatus;
  readonly stop: DebugStop | null;
  /** Breakpoint lines for the file being debugged, ascending. */
  readonly breakpoints: readonly number[];
  /** The document breakpoints belong to, so they are not shown against another file. */
  readonly documentId: string | null;
  readonly lastError: string | null;
  /** Result of the most recent `evaluate`, for the watch row. */
  readonly evaluated: { readonly expression: string; readonly text: string | null; readonly error: string | null } | null;
  /**
   * Expressions the student is watching, in the order they added them.
   *
   * Kept here rather than in the UI so the toolbar, the panel and the re-evaluation
   * that happens on every stop all read one list - the same reason every other piece of
   * debugger state lives in this object.
   */
  readonly watches: readonly string[];
  /**
   * The latest value of each watch, keyed by expression.
   *
   * Cleared on every stop before the new values are asked for, because a value from the
   * previous line looks exactly like a current one and is the most misleading thing a
   * debugger can show.
   */
  readonly watchValues: ReadonlyMap<string, { readonly text: string | null; readonly error: string | null }>;
}

/** What the toolbar may offer, derived rather than tracked. */
export interface DebugCapabilities {
  readonly canStart: boolean;
  readonly canContinue: boolean;
  readonly canStepOver: boolean;
  readonly canStepIn: boolean;
  readonly canStepOut: boolean;
  readonly canStop: boolean;
  readonly canEvaluate: boolean;
}

const PAUSED_STATES: readonly DebugStatus[] = ['paused'];

export function capabilitiesFor(status: DebugStatus): DebugCapabilities {
  const paused = PAUSED_STATES.includes(status);
  const live = status === 'running' || status === 'starting' || paused || status === 'postMortem';

  return {
    canStart: status === 'idle' || status === 'ended',
    canContinue: paused,
    canStepOver: paused,
    canStepIn: paused,
    canStepOut: paused,
    // Stop must work while RUNNING, not only while paused. A program stuck in a loop
    // is exactly when a student reaches for it, and the adapter supports it - the
    // server-side fix for stop-while-paused was needed for the other direction.
    canStop: live,
    // Post-mortem still allows evaluation: the frame is gone from the program's point
    // of view but the traceback keeps it alive, which is the whole value of stopping
    // where it broke.
    canEvaluate: paused || status === 'postMortem',
  };
}

/**
 * The session, as a small reducer over stream events.
 *
 * A class rather than free functions because the UI needs to subscribe, and because
 * breakpoints outlive a session - a student sets them, runs, fixes something, runs
 * again - while everything else is per-run.
 */
export class DebugSessionState {
  #status: DebugStatus = 'idle';
  #stop: DebugStop | null = null;
  #breakpoints = new Set<number>();
  #documentId: string | null = null;
  #lastError: string | null = null;
  #evaluated: DebugSnapshot['evaluated'] = null;
  #watches: string[] = [];
  #watchValues = new Map<string, { text: string | null; error: string | null }>();
  #listeners = new Set<(snapshot: DebugSnapshot) => void>();

  subscribe(listener: (snapshot: DebugSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  snapshot(): DebugSnapshot {
    return {
      status: this.#status,
      stop: this.#stop,
      breakpoints: [...this.#breakpoints].sort((a, b) => a - b),
      documentId: this.#documentId,
      lastError: this.#lastError,
      evaluated: this.#evaluated,
      watches: [...this.#watches],
      watchValues: new Map(this.#watchValues),
    };
  }

  /**
   * Start watching an expression.
   *
   * Refused when it is blank or already watched - a duplicate row would be evaluated
   * twice on every stop and shown twice for no benefit. Returns whether it was added,
   * so the caller can leave the input alone when it was not.
   */
  addWatch(expression: string): boolean {
    const trimmed = expression.trim();
    if (!trimmed || this.#watches.includes(trimmed)) return false;
    // The channel refuses anything longer, so refusing here means the student is told
    // by the input rather than by silence.
    if (trimmed.length > 2000) return false;

    this.#watches.push(trimmed);
    this.#emit();
    return true;
  }

  removeWatch(expression: string): void {
    const at = this.#watches.indexOf(expression);
    if (at === -1) return;
    this.#watches.splice(at, 1);
    this.#watchValues.delete(expression);
    this.#emit();
  }

  /** Every watch, so the caller can ask the adapter to evaluate each one. */
  watchExpressions(): readonly string[] {
    return [...this.#watches];
  }

  capabilities(): DebugCapabilities {
    return capabilitiesFor(this.#status);
  }

  #emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }

  // ── Breakpoints ───────────────────────────────────────────────────────────

  /**
   * Point the breakpoint set at a document, clearing it if that is a different file.
   *
   * Breakpoints belong to a file. Without this they would follow the student from
   * `main.py` to `helper.py` and appear against lines they never chose - and the
   * adapter would then arm them in the entry file, stopping somewhere unrelated.
   */
  setDocument(documentId: string | null): void {
    if (documentId === this.#documentId) return;
    this.#documentId = documentId;
    this.#breakpoints.clear();
    this.#emit();
  }

  toggleBreakpoint(line: number): boolean {
    if (!Number.isInteger(line) || line < 1) return false;
    if (this.#breakpoints.has(line)) this.#breakpoints.delete(line);
    else this.#breakpoints.add(line);
    this.#emit();
    return this.#breakpoints.has(line);
  }

  hasBreakpoint(line: number): boolean {
    return this.#breakpoints.has(line);
  }

  clearBreakpoints(): void {
    if (this.#breakpoints.size === 0) return;
    this.#breakpoints.clear();
    this.#emit();
  }

  breakpointLines(): number[] {
    return [...this.#breakpoints].sort((a, b) => a - b);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  starting(): void {
    this.#status = 'starting';
    this.#stop = null;
    this.#lastError = null;
    this.#evaluated = null;
    this.#emit();
  }

  /**
   * Apply one debug frame.
   *
   * Unknown frame types are ignored rather than treated as an error: a newer server
   * may send something this client does not model, and the session must keep working.
   */
  apply(event: { type: string; [key: string]: unknown }): void {
    switch (event.type) {
      case 'attached':
        this.#status = 'running';
        break;

      case 'started':
        // Only meaningful before the first stop; a `started` after a pause would be
        // the server repeating itself, and moving back to running would wrongly grey
        // out the step buttons.
        if (this.#status === 'starting' || this.#status === 'running') this.#status = 'running';
        break;

      case 'stopped': {
        const stop: DebugStop = {
          reason: String(event.reason ?? 'step'),
          file: String(event.file ?? ''),
          line: Number(event.line ?? 0),
          stack: Array.isArray(event.stack) ? (event.stack as DebugFrame[]) : [],
          locals: Array.isArray(event.locals) ? (event.locals as DebugVariable[]) : [],
          globals: Array.isArray(event.globals) ? (event.globals as DebugVariable[]) : [],
          exception: event.exception as DebugStop['exception'],
          postMortem: event.postMortem === true,
        };
        this.#stop = stop;
        this.#status = stop.postMortem ? 'postMortem' : 'paused';
        // Every watch value is now from the PREVIOUS line. A stale value looks exactly
        // like a current one, which is the most misleading thing a debugger can show,
        // so they are cleared here and asked for again by the UI.
        this.#watchValues.clear();
        break;
      }

      case 'breakpoints':
        // The adapter reports which lines it actually armed. A line it refused - a
        // blank line, a comment - is dropped here too, so the margin shows what is
        // real rather than what was asked for.
        if (Array.isArray(event.lines)) {
          this.#breakpoints = new Set(
            (event.lines as unknown[]).map(Number).filter(line => Number.isInteger(line) && line > 0),
          );
        }
        break;

      case 'evaluated': {
        const expression = String(event.expression ?? '');
        const text = (event.value as { text?: string } | undefined)?.text ?? null;
        const error = typeof event.error === 'string' ? event.error : null;

        this.#evaluated = { expression, text, error };
        // A result only lands in the watch list if that expression IS a watch. An
        // ad-hoc evaluation must not add a row the student never asked for.
        if (this.#watches.includes(expression)) {
          this.#watchValues.set(expression, { text, error });
        }
        break;
      }

      case 'terminated':
        this.#status = 'ended';
        this.#stop = null;
        break;

      case 'unsupported':
      case 'error':
        this.#lastError = typeof event.message === 'string' ? event.message : 'The debugger failed.';
        // Not `ended`: an `unsupported` run continues without a debugger, and calling
        // it ended would grey out Stop while a program was still running.
        break;

      default:
        break;
    }

    this.#emit();
  }

  /** The run finished, however it finished. */
  finished(): void {
    this.#status = 'ended';
    this.#stop = null;
    this.#emit();
  }

  reset(): void {
    this.#status = 'idle';
    this.#stop = null;
    this.#lastError = null;
    this.#evaluated = null;
    this.#emit();
  }
}
