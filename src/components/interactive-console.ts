//
// Interactive console: runs a program that PAUSES for keyboard input
// (Python input(), Java Scanner, JS readline/prompt, PHP fgets(STDIN),
// C# Console.ReadLine, …) and lets the user type answers into the output
// panel, exactly like a real IDE terminal.
//
// A normal run posts to /api/run and gets one buffered JSON result back, which
// cannot support a program that waits mid-execution. This module instead uses
// the streaming session endpoints:
//   POST /api/run/interactive            -> { sessionId } (or { compile })
//   GET  /api/run/interactive/:id/stream -> Server-Sent Events (stdout/stderr/exit)
//   POST /api/run/interactive/:id/stdin  -> one line of input
//   POST /api/run/interactive/:id/close  -> stop
import { panelContentEl, runBtn } from './dom';
import { setStatus } from './output';
import { renderTurtle } from './turtle';
import { t } from '../i18n';

export interface InteractiveResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

interface ActiveSession {
  sessionId: string;
  controller: AbortController;
}

let active: ActiveSession | null = null;

export function isInteractiveActive(): boolean {
  return !!active;
}

/** Detect whether user code reads from stdin, so we know to run it interactively. */
export function codeReadsStdin(langId: string, code: string): boolean {
  if (!code) return false;
  switch (langId) {
    case 'python':
      return /(^|[^.\w])input\s*\(/.test(code) || /\bsys\s*\.\s*stdin\b/.test(code);
    case 'javascript':
    case 'typescript':
      return /\bprompt\s*\(/.test(code)
        || /\bprocess\s*\.\s*stdin\b/.test(code)
        || /\breadline\b/.test(code)
        || /\bcreateInterface\b/.test(code);
    case 'php':
      return /\bSTDIN\b/.test(code) || /\breadline\s*\(/.test(code);
    case 'java':
      return /\bSystem\s*\.\s*in\b/.test(code)
        || /\bnew\s+Scanner\b/.test(code)
        || /\bSystem\s*\.\s*console\s*\(/.test(code);
    case 'csharp':
      return /\bConsole\s*\.\s*Read(Line|Key)?\s*\(/.test(code)
        || /\bConsole\s*\.\s*In\b/.test(code);
    default:
      return false;
  }
}

function compileLabel(langId: string): string {
  switch (langId) {
    case 'java':       return 'Compile Error (javac)';
    case 'csharp':     return 'Compile Error (dotnet build)';
    case 'typescript': return 'TypeScript Error';
    case 'php':        return 'Parse Error (php -l)';
    case 'python':     return 'Problem Detected — code was not run';
    default:           return 'Compile Error';
  }
}

/** Terminate any running interactive session (kills the server-side process). */
export function stopInteractive(): void {
  if (!active) return;
  const { sessionId, controller } = active;
  active = null;
  // Ask the server to kill the sandbox, then drop the stream. Aborting alone
  // would also stop it (the request's close handler kills the process), but
  // the explicit call makes cleanup immediate and independent of socket teardown.
  if (sessionId) {
    fetch(`/api/run/interactive/${sessionId}/close`, { method: 'POST' }).catch(() => {});
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
export function runInteractive(
  langId: string,
  payload: Record<string, unknown>
): Promise<InteractiveResult> {
  stopInteractive();

  return new Promise<InteractiveResult>((resolve) => {
    // ── Build the console DOM inside the output panel ────────────────────────
    panelContentEl.dir = 'ltr';
    panelContentEl.innerHTML = '';

    const outEl = document.createElement('span');
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
    input.placeholder = t('panel.stdinHint') || 'type your answer, then press Enter';
    input.setAttribute('aria-label', t('panel.stdinLabel') || 'Program input');
    inputLine.appendChild(caret);
    inputLine.appendChild(input);

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

    const settle = (result: InteractiveResult) => {
      if (settled) return;
      settled = true;
      inputLine.remove();
      runBtn.disabled = false;
      resolve(result);
    };

    const finishRun = (
      exitCode: number,
      durationMs: number,
      note?: string | null,
      turtleData?: any
    ) => {
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
          renderTurtle(turtleData);
        } catch (renderErr) {
          append(`\n[turtle render error: ${String(renderErr)}]\n`, 'error');
        }
      }

      const footer = exitCode === 0 ? '[exit 0 ✓]' : `[exit code: ${exitCode}]`;
      append('\n' + footer, exitCode === 0 ? 'success' : 'error');
      setStatus(exitCode === 0 ? 'Ready ✅' : 'Runtime error ❌');
      settle({ stdout: aggStdout, stderr: aggStderr, exitCode, durationMs: durationMs || 0 });
    };

    runBtn.disabled = true;
    setStatus('Running…');

    let sessionId = '';

    // Send one line to the program. The caret is hidden again immediately:
    // the program is now busy consuming that line, and the server will send a
    // fresh {type:'waiting'} when (and only when) it stops for the next one.
    const submit = () => {
      if (!sessionId || settled) return;
      const value = input.value;
      append(value + '\n');
      input.value = '';
      inputLine.style.display = 'none';
      setStatus('Running…');
      fetch(`/api/run/interactive/${sessionId}/stdin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: value }),
      }).catch(() => {});
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    void (async () => {
      const controller = new AbortController();

      // Reveal the typing caret only once the program is actually waiting for
      // input (server sends {type:'waiting'}). Showing it immediately made the
      // caret appear over an empty console with no prompt for context, and
      // anything typed before the prompt arrived got echoed above it.
      const showInput = () => {
        if (settled) return;
        if (inputLine.style.display !== 'none') { input.focus(); return; }
        inputLine.style.display = '';
        setStatus('Waiting for input ⌨️');
        input.focus();
        panelContentEl.scrollTop = panelContentEl.scrollHeight;
      };

      const handle = (msg: any) => {
        switch (msg.type) {
          case 'session':
            sessionId = msg.sessionId;
            active = { sessionId, controller };
            break;
          case 'stdout':
            aggStdout += msg.data;
            append(msg.data);
            break;
          case 'stderr':
            aggStderr += msg.data;
            append(msg.data, 'error');
            break;
          case 'waiting':
            showInput();
            break;
          case 'ping':
            break;
          case 'exit':
            active = null;
            finishRun(msg.exitCode, msg.durationMs, msg.note, msg.turtleData);
            break;
        }
      };

      try {
        const resp = await fetch('/api/run/interactive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, language: langId }),
          signal: controller.signal,
        });

        // Errors and compile failures are returned as a normal JSON body
        // BEFORE the stream starts, so they are safe to read whole.
        const contentType = resp.headers.get('Content-Type') || '';
        if (!resp.ok || !contentType.includes('ndjson')) {
          const data = await resp.json().catch(() => null);

          if (!resp.ok) {
            const msg = (data && data.error) || `HTTP ${resp.status}`;
            append(msg + '\n', 'error');
            append('[exit code: 1]', 'error');
            setStatus('Run failed');
            settle({ stdout: '', stderr: String(msg), exitCode: 1, durationMs: 0 });
            return;
          }

          // Compile / lint error: the program never started.
          if (data && data.compile) {
            const c = data.compile;
            append(`── ${compileLabel(langId)} ──────────────────────────────────────\n`, 'info');
            if (c.stderr) append(c.stderr, 'error');
            append(`\n[exit code: ${c.exitCode ?? 1}]`, 'error');
            setStatus('Compile error ❌');
            settle({ stdout: '', stderr: c.stderr || '', exitCode: c.exitCode ?? 1, durationMs: c.durationMs || 0 });
            return;
          }

          append('ERROR: unexpected response from server\n', 'error');
          setStatus('Run failed');
          settle({ stdout: '', stderr: 'unexpected response', exitCode: 1, durationMs: 0 });
          return;
        }

        if (!resp.body) throw new Error('streaming is not supported by this browser');

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
          active = null;
          append('\n[connection lost]\n', 'error');
          setStatus('Run failed');
          settle({ stdout: aggStdout, stderr: aggStderr, exitCode: -1, durationMs: 0 });
        }
      } catch (e: any) {
        if (settled) return;
        active = null;
        // An abort is a deliberate stop (new run / clear output), not a fault.
        if (e?.name === 'AbortError') {
          settle({ stdout: aggStdout, stderr: aggStderr, exitCode: -1, durationMs: 0 });
          return;
        }
        append('\n' + String(e?.message || e) + '\n', 'error');
        setStatus('Run failed');
        settle({ stdout: aggStdout, stderr: aggStderr, exitCode: -1, durationMs: 0 });
      }
    })();
  });
}
