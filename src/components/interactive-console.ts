//
// The run console: the ONE transport for executing a program.
//
// It used to be the special case. `runCode` pattern-matched the source with a
// regex - `input(`, `Scanner`, `readline`, `Console.ReadLine`, `STDIN` - and sent
// anything that matched here, while everything else took a buffered /api/run
// round trip that returned a single JSON blob at the end.
//
// That split was wrong in three ways, and blueprint section 12 had already called
// for deleting it:
//
//   1. A missed detection was a HANG, not a fallback. Any way of reading stdin the
//      regex did not anticipate - a helper wrapping input(), an idiom not on the
//      list - took the buffered path and blocked until the timeout with no prompt.
//   2. An ordinary run did not stream. A program printing for ten seconds showed
//      nothing for ten seconds. Every real IDE streams its output.
//   3. Two client paths meant two result shapes, two error renderings, and two
//      places to change anything about running code. They had already drifted:
//      only the buffered one resolved turtle.bgpic() images.
//
// The server has always been ready for this - every run spawns with stdin open and
// the buffered route simply closes it immediately - so the only thing standing in
// the way was the regex. It is gone.
//
// Protocol:
//   POST /api/run/interactive           -> NDJSON stream, or JSON for a compile error
//   POST /api/run/interactive/:id/stdin -> one line of input
//   POST /api/run/interactive/:id/close -> stop
//
// /api/run still exists and is still a frozen contract - Step-Up calls it
// server-side - it is simply no longer how the IDE runs code.
import { panelContentEl } from './dom';
import { setStatus } from './output';
import { renderTurtle } from './turtle';
import { t } from '../i18n/index.ts';
import { inlineMissingAssets, isMissingBlobResponse } from '../features/asset-transport.ts';

export interface RunConsoleOptions {
  /**
   * Resolve a turtle background image named by `turtle.bgpic("maze.svg")` to a
   * data URL.
   *
   * Injected rather than imported so this module keeps no dependency on the
   * workspace. It exists at all because only the buffered path used to do this,
   * so unifying on this one would otherwise have silently dropped bgpic support.
   */
  resolveImage?: (name: string) => Promise<string | null>;

  /** Called once the stream is live, so a caller can stop its own spinner. */
  onStreamStart?: () => void;

  /**
   * Every `debug:` frame from the run.
   *
   * The debugger shares this stream deliberately - see the note in
   * server/http/routes/run.mjs - so the console is where the frames arrive, and it
   * hands them on rather than knowing what they mean. Injected rather than imported
   * for the same reason `resolveImage` is: this module stays free of any dependency
   * on the editor or the workspace.
   */
  onDebugEvent?: (event: DebugStreamEvent) => void;

  /**
   * Ask the server to attach a debugger to this run.
   *
   * A run without it is byte-identical to before, which is what keeps the v1
   * surface frozen.
   */
  debug?: boolean;
  /** Maps a completed stdout line to the print statement that most likely emitted it. */
  traceOutput?: (line: string) => { file: string; line: number } | null;
}

/** One frame from the debug half of the stream, with the `debug:` prefix removed. */
export interface DebugStreamEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface InteractiveResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

interface ActiveSession {
  /**
   * Null until the server names the session.
   *
   * Which is not immediately: the `session` frame is the first thing on the stream,
   * and the stream does not open until `pipeline.start` has finished compiling - up to
   * 30 s for Java and 45 s for C#. This used to be the moment `active` was assigned,
   * so for that whole window `stopInteractive()` returned early and the Stop button did
   * nothing at all. The session is registered when the REQUEST starts instead, and this
   * is filled in when the name arrives.
   */
  sessionId: string | null;
  controller: AbortController;
}

let active: ActiveSession | null = null;

function compileLabel(langId: string): string {
  switch (langId) {
    case 'java':       return 'Compile Error (javac)';
    case 'csharp':     return 'Compile Error (dotnet build)';
    case 'typescript': return 'TypeScript Error';
    case 'php':        return 'Parse Error (php -l)';
    case 'python':     return 'Problem Detected - code was not run';
    default:           return 'Compile Error';
  }
}

/** Terminate any running interactive session (kills the server-side process). */
/**
 * The live session's id, or null when nothing is running.
 *
 * Exposed so the debugger can address its control endpoints without the console
 * having to know what a debug command is - the console owns the stream, the debugger
 * owns the protocol.
 */
export function activeSessionId(): string | null {
  return active?.sessionId ?? null;
}

export function stopInteractive(): void {
  stopActiveSession(false);
}

/**
 * Release a run while the document itself is leaving.
 *
 * `sendBeacon` survives page teardown more reliably than a normal fetch. Aborting
 * the stream is still essential: it makes the server's response-close handler the
 * source of truth even when the beacon cannot be sent (offline, process crash, or
 * a browser that has already begun destroying the page).
 */
export function stopInteractiveOnPageExit(): void {
  stopActiveSession(true);
}

function stopActiveSession(pageIsExiting: boolean): void {
  if (!active) return;
  const { sessionId, controller } = active;
  active = null;
  // Ask the server to kill the sandbox, then drop the stream. Aborting alone
  // would also stop it (the request's close handler kills the process), but
  // the explicit call makes cleanup immediate and independent of socket teardown.
  if (sessionId) {
    const closeUrl = `/api/run/interactive/${sessionId}/close`;
    const sentByBeacon = pageIsExiting &&
      typeof navigator.sendBeacon === 'function' &&
      navigator.sendBeacon(closeUrl);
    if (!sentByBeacon) {
      fetch(closeUrl, { method: 'POST', keepalive: pageIsExiting }).catch(() => {});
    }
  }
  try { controller.abort(); } catch { /* noop */ }
}

/**
 * Run code interactively. Renders a live console into the output panel and
 * resolves with the aggregated result once the program exits (matching the
 * shape used by the buffered path so Step-Up notifications stay consistent).
 *
 * @param langId  language id
 * @param payload the same request body the buffered /api/run path builds -
 *                either { code } (snippet mode) or { files, entryPoint }
 *                (project/full mode), so every mode is supported.
 */
export function runProgram(
  langId: string,
  payload: Record<string, unknown>,
  options: RunConsoleOptions = {},
): Promise<InteractiveResult> {

  return new Promise<InteractiveResult>((resolve) => {
    // ── Build the console DOM inside the output panel ────────────────────────
    panelContentEl.dir = 'ltr';
    panelContentEl.innerHTML = '';

    // A div may contain the clickable output-line buttons. A span containing
    // interactive block children is invalid markup and confusing to assistive tech.
    const outEl = document.createElement('div');
    outEl.className = 'term-out';

    const inputLine = document.createElement('div');
    inputLine.className = 'term-input-line';
    inputLine.style.display = 'none';
    const caret = document.createElement('span');
    caret.className = 'term-caret';
    caret.textContent = '▸';
    const input = document.createElement('input');
    input.className = 'term-input';
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = t('panel.stdinHint');
    input.setAttribute('aria-label', t('panel.stdinLabel'));

    // End-of-input.
    //
    // The server has always had /eof, and nothing in the UI ever called it. A
    // program that reads UNTIL end of input - `for line in sys.stdin`, a JS
    // `process.stdin` reader, `while (scanner.hasNextLine())` - therefore had no
    // way to finish: the student could type lines forever and the program never
    // received EOF. In a real terminal this is Ctrl+D,
    // so that works here, with a button because Ctrl+D is not discoverable.
    const eofButton = document.createElement('button');
    eofButton.className = 'term-eof';
    eofButton.type = 'button';
    eofButton.textContent = t('panel.endInput');
    eofButton.title = t('panel.endInputHint');

    inputLine.appendChild(caret);
    inputLine.appendChild(input);
    inputLine.appendChild(eofButton);

    panelContentEl.appendChild(outEl);
    panelContentEl.appendChild(inputLine);

    let aggStdout = '';
    let aggStderr = '';
    let settled = false;

    const append = (text: string, cls?: string) => {
      const node = document.createElement('span');
      if (cls) node.className = cls;
      node.textContent = text;
      outEl.appendChild(node);
      panelContentEl.scrollTop = panelContentEl.scrollHeight;
    };

    const appendTrace = (text: string, file: string, line: number) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'output-trace-line';
      button.dataset.outputFile = file;
      button.dataset.outputLine = String(line);
      button.title = t('output.jumpToLine', { line });
      const badge = document.createElement('span');
      badge.className = 'output-trace-badge';
      badge.textContent = `${line} → `;
      button.append(badge, document.createTextNode(text));
      outEl.appendChild(button);
      panelContentEl.scrollTop = panelContentEl.scrollHeight;
    };

    let pendingStdout = '';
    let pendingStdoutNode: HTMLSpanElement | null = null;
    const appendStdout = (chunk: string) => {
      pendingStdout += chunk;
      pendingStdoutNode?.remove();
      pendingStdoutNode = null;
      let newline = pendingStdout.indexOf('\n');
      while (newline !== -1) {
        const lineText = pendingStdout.slice(0, newline);
        pendingStdout = pendingStdout.slice(newline + 1);
        const location = options.traceOutput?.(lineText) ?? null;
        if (location) appendTrace(lineText + '\n', location.file, location.line);
        else append(lineText + '\n');
        newline = pendingStdout.indexOf('\n');
      }
      if (pendingStdout) {
        pendingStdoutNode = document.createElement('span');
        pendingStdoutNode.textContent = pendingStdout;
        outEl.appendChild(pendingStdoutNode);
      }
    };

    // Preserve stream ordering when a partial stdout line is followed by stderr,
    // typed input, or a debugger log event. Otherwise the next stdout chunk removes
    // the old node and appends it after the intervening event.
    const commitPendingStdout = () => {
      if (!pendingStdoutNode) return;
      pendingStdoutNode.textContent = pendingStdout;
      pendingStdoutNode = null;
      pendingStdout = '';
    };

    const settle = (result: InteractiveResult) => {
      if (settled) return;
      settled = true;
      inputLine.remove();
      // The Run/Stop pair is owned by run-controls.ts. This module used to set
      // `runBtn.disabled` here and below, competing with run-loader.ts and
      // execution.ts for one button - which is how Run ended up disabled for the
      // whole run with no Stop anywhere.
      resolve(result);
    };

    const finishRun = async (
      exitCode: number,
      durationMs: number,
      note?: string | null,
      turtleData?: any
    ) => {
      if (pendingStdout) {
        pendingStdoutNode?.remove();
        const location = options.traceOutput?.(pendingStdout) ?? null;
        if (location) appendTrace(pendingStdout, location.file, location.line);
        else append(pendingStdout);
        pendingStdout = '';
        pendingStdoutNode = null;
      }
      inputLine.remove();
      if (note === 'idle-timeout') append('\n[stopped: no input received in time]\n', 'error');
      else if (note === 'time-limit') append('\n[stopped: time limit reached]\n', 'error');

      // Turtle drawings only open on a clean finish, matching the buffered
      // path: a program that crashed part-way must not flash a half drawing.
      if (
        exitCode === 0 &&
        turtleData &&
        ((turtleData.shapes?.length ?? 0) > 0 || (turtleData.cursors?.length ?? 0) > 0)
      ) {
        try {
          // bgpic("maze.svg") names a project file. Python reports only the name,
          // so the image has to be resolved from the workspace before rendering.
          const picName = turtleData.pic;
          if (picName && options.resolveImage) {
            const picUrl = await options.resolveImage(picName);
            if (picUrl) {
              turtleData.picData = picUrl;
            } else {
              append(
                `
[turtle: background image "${picName}" was not found in this project. ` +
                `Add an .svg file with that name - bgpic() reads SVG images from the workspace.]
`,
                'info',
              );
            }
          }
          renderTurtle(turtleData, { live: options.debug === true });
        } catch (renderErr) {
          append(`\n[turtle render error: ${String(renderErr)}]\n`, 'error');
        }
      }

      const footer = exitCode === 0 ? '[exit 0 ✓]' : `[exit code: ${exitCode}]`;
      append('\n' + footer, exitCode === 0 ? 'success' : 'error');
      setStatus(exitCode === 0 ? t('status.readySuccess') : t('status.runtimeError'));
      settle({ stdout: aggStdout, stderr: aggStderr, exitCode, durationMs: durationMs || 0 });
    };

    setStatus(t('status.running'));

    let sessionId = '';

    // Send one line to the program. The caret is hidden again immediately:
    // the program is now busy consuming that line, and the server will send a
    // fresh {type:'waiting'} when (and only when) it stops for the next one.
    const submit = () => {
      if (!sessionId || settled) return;
      const value = input.value;
      commitPendingStdout();
      append(value + '\n');
      input.value = '';
      inputLine.style.display = 'none';
      setStatus(t('status.running'));
      fetch(`/api/run/interactive/${sessionId}/stdin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: value }),
      }).catch(() => {});
    };

    /**
     * Close the program's stdin, the way Ctrl+D does in a terminal.
     *
     * Distinct from `close`, which kills the process. This says "there is no more
     * input", letting a program that reads until end-of-input finish normally and
     * print whatever it computed. Without it such a program keeps waiting, exactly
     * as a terminal program does while stdin remains open.
     */
    let sentEof = false;
    const sendEof = () => {
      if (!sessionId || settled || sentEof) return;
      sentEof = true;
      commitPendingStdout();
      append('\n[end of input]\n', 'info');
      inputLine.style.display = 'none';
      setStatus(t('status.running'));
      fetch(`/api/run/interactive/${sessionId}/eof`, { method: 'POST' }).catch(() => {});
    };

    eofButton.addEventListener('click', event => {
      event.preventDefault();
      sendEof();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
      // Ctrl+D on an EMPTY line only, matching a real terminal: with text typed,
      // Ctrl+D would discard it, which is not what anyone expects.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && input.value === '') {
        e.preventDefault();
        sendEof();
      }
    });

    void (async () => {
      const controller = new AbortController();

      /*
       * This run's claim on the console, taken before the request goes out.
       *
       * Two things depend on it being an identity rather than a flag. Stop works during
       * compile, because there is something to abort before the server has named the
       * session. And teardown below releases the claim only if it is still THIS run's -
       * `active = null` unconditionally meant a slow run's stream ending after the
       * student had already started another one would silently disown the new one, and
       * Stop would then do nothing for the rest of it.
       */
      const session: ActiveSession = { sessionId: null, controller };
      active = session;
      const releaseSession = () => {
        if (active === session) active = null;
      };

      // Reveal the typing caret only once the program is actually waiting for
      // input (server sends {type:'waiting'}). Showing it immediately made the
      // caret appear over an empty console with no prompt for context, and
      // anything typed before the prompt arrived got echoed above it.
      const showInput = () => {
        if (settled) return;
        if (inputLine.style.display !== 'none') { input.focus(); return; }
        inputLine.style.display = '';
        // Deliberately states the CAPABILITY, not a claim about the program.
        // Without a pseudo-terminal a blocked read cannot be observed, so the
        // server infers it - and now that every run streams, the inference is
        // sometimes just 'this program went quiet'. Announcing "waiting for input"
        // for a program that is merely computing teaches the student to distrust
        // the prompt.
        setStatus(t('status.readyForInput'));
        input.focus();
        panelContentEl.scrollTop = panelContentEl.scrollHeight;
      };

      const handle = (msg: any) => {
        switch (msg.type) {
          case 'session':
            sessionId = msg.sessionId;
            session.sessionId = sessionId;
            // The stream is live from here, so the caller can drop its spinner
            // and let the console own the panel.
            options.onStreamStart?.();
            break;
          case 'stdout':
            aggStdout += msg.data;
            appendStdout(msg.data);
            break;
          case 'stderr':
            aggStderr += msg.data;
            commitPendingStdout();
            append(msg.data, 'error');
            break;
          case 'waiting':
            showInput();
            break;
          case 'ping':
            break;
          case 'exit':
            releaseSession();
            void finishRun(msg.exitCode, msg.durationMs, msg.note, msg.turtleData);
            break;
          default:
            // Debug frames are namespaced `debug:` by the server so they can never
            // collide with the cases above. Anything else is a frame from a newer
            // server than this client, and is ignored rather than logged - a v1
            // client must not become noisy against a v2 server.
            if (typeof msg.type === 'string' && msg.type.startsWith('debug:')) {
              const event = { ...msg, type: msg.type.slice('debug:'.length) };
              if (event.type === 'log') {
                commitPendingStdout();
                const line = Number(event.line ?? 0);
                const expression = String(event.expression ?? 'value');
                const described = event.error
                  ? String(event.error)
                  : String(event.value?.text ?? event.value ?? 'null');
                appendTrace(
                  `line ${line} → ${expression} = ${described}\n`,
                  String(event.file ?? ''),
                  line,
                );
              }
              options.onDebugEvent?.(event);
            }
            break;
        }
      };

      try {
        const send = (files: unknown) => fetch('/api/run/interactive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            ...(files ? { files } : {}),
            language: langId,
            // Omitted entirely unless asked for, so the request a v1 client sends is
            // unchanged rather than carrying `debug: false`.
            ...(options.debug ? { debug: true } : {}),
          }),
          signal: controller.signal,
        });

        let resp = await send(null);

        /*
         * The asset cache said the server had these bytes and it does not.
         *
         * Between the check and this request the entry can be swept on its TTL, or -
         * in production, behind least_conn with no session affinity - the run can
         * simply land on a different replica than the upload did. Neither is the
         * student's doing, and both are recoverable by sending the bytes the long way
         * exactly once. Only once: a second 409 is a real failure, not a race.
         */
        if (resp.status === 409) {
          const detail = await resp.clone().json().catch(() => null);
          if (isMissingBlobResponse(resp.status, detail)) {
            const inlined = inlineMissingAssets(
              (payload.files || []) as Parameters<typeof inlineMissingAssets>[0],
              detail.missing,
            );
            resp = await send(inlined);
          }
        }

        // Errors and compile failures are returned as a normal JSON body
        // BEFORE the stream starts, so they are safe to read whole.
        const contentType = resp.headers.get('Content-Type') || '';
        if (!resp.ok || !contentType.includes('ndjson')) {
          const data = await resp.json().catch(() => null);

          if (!resp.ok) {
            const msg = (data && data.error) || `HTTP ${resp.status}`;
            append(msg + '\n', 'error');
            append('[exit code: 1]', 'error');
            setStatus(t('status.runFailed'));
            settle({ stdout: '', stderr: String(msg), exitCode: 1, durationMs: 0 });
            return;
          }

          // Compile / lint error: the program never started.
          if (data && data.compile) {
            const c = data.compile;
            append(`── ${compileLabel(langId)} ──────────────────────────────────────\n`, 'info');
            if (c.stderr) append(c.stderr, 'error');
            append(`\n[exit code: ${c.exitCode ?? 1}]`, 'error');
            setStatus(t('status.compileError'));
            settle({ stdout: '', stderr: c.stderr || '', exitCode: c.exitCode ?? 1, durationMs: c.durationMs || 0 });
            return;
          }

          append('ERROR: unexpected response from server\n', 'error');
          setStatus(t('status.runFailed'));
          settle({ stdout: '', stderr: 'unexpected response', exitCode: 1, durationMs: 0 });
          return;
        }

        if (!resp.body) throw new Error(t('error.streamingUnsupported'));

        // ── Consume the NDJSON stream ──────────────────────────────────────
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let msg: any;
            try { msg = JSON.parse(line); } catch { continue; }
            handle(msg);
          }
        }

        // Stream ended without an exit event (server died / network dropped).
        if (!settled) {
          releaseSession();
          append('\n[connection lost]\n', 'error');
          setStatus(t('status.runFailed'));
          settle({ stdout: aggStdout, stderr: aggStderr, exitCode: -1, durationMs: 0 });
        }
      } catch (e: any) {
        if (settled) return;
        releaseSession();
        // An abort is a deliberate stop (new run / clear output), not a fault.
        if (e?.name === 'AbortError') {
          settle({ stdout: aggStdout, stderr: aggStderr, exitCode: -1, durationMs: 0 });
          return;
        }
        append('\n' + String(e?.message || e) + '\n', 'error');
        setStatus(t('status.runFailed'));
        settle({ stdout: aggStdout, stderr: aggStderr, exitCode: -1, durationMs: 0 });
      }
    })();
  });
}
