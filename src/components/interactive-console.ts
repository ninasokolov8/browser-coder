// @ts-nocheck
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
  es: EventSource;
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
  const { sessionId, es } = active;
  active = null;
  try { es.close(); } catch { /* noop */ }
  fetch(`/api/run/interactive/${sessionId}/close`, { method: 'POST' }).catch(() => {});
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

    void (async () => {
      let sessionId: string;
      try {
        const resp = await fetch('/api/run/interactive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, language: langId }),
        });
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

        sessionId = data.sessionId;
        if (!sessionId) {
          append('ERROR: server did not start a session\n', 'error');
          setStatus('Run failed');
          settle({ stdout: '', stderr: 'no session', exitCode: 1, durationMs: 0 });
          return;
        }
      } catch (e: any) {
        append(String(e?.message || e) + '\n', 'error');
        setStatus('Run failed');
        settle({ stdout: '', stderr: String(e?.message || e), exitCode: 1, durationMs: 0 });
        return;
      }

      // ── Attach the live output stream ──────────────────────────────────────
      const es = new EventSource(`/api/run/interactive/${sessionId}/stream`);
      active = { sessionId, es };

      inputLine.style.display = '';
      input.focus();

      es.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'stdout') { aggStdout += msg.data; append(msg.data); }
        else if (msg.type === 'stderr') { aggStderr += msg.data; append(msg.data, 'error'); }
        else if (msg.type === 'exit') {
          active = null;
          try { es.close(); } catch { /* noop */ }
          finishRun(msg.exitCode, msg.durationMs, msg.note, msg.turtleData);
        }
      };

      es.onerror = () => {
        // CONNECTING => the browser is auto-retrying a transient blip; ignore.
        // CLOSED     => the stream is dead and won't retry; end the run.
        if (es.readyState !== EventSource.CLOSED) return;
        if (settled || active === null) return;
        active = null;
        append('\n[connection lost]\n', 'error');
        setStatus('Run failed');
        settle({ stdout: aggStdout, stderr: aggStderr, exitCode: -1, durationMs: 0 });
      };

      const submit = () => {
        const value = input.value;
        // Echo the typed line so the transcript reads like a real terminal.
        append(value + '\n');
        input.value = '';
        fetch(`/api/run/interactive/${sessionId}/stdin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: value }),
        }).catch(() => {});
        input.focus();
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    })();
  });
}
