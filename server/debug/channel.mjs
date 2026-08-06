/**
 * The server end of a debug session.
 *
 * One loopback listener per debugged run. The adapter connects back to it, and from
 * then on the two speak NDJSON: commands down, events up.
 *
 * ## Why the server listens rather than connecting
 *
 * The adapter starts as a child process and cannot be given a socket to accept on,
 * so somebody has to listen first. Listening here means the port is allocated and
 * bound BEFORE the child is spawned, so there is no window in which the adapter
 * tries to connect to a port that does not exist yet - which on a loaded machine is
 * the difference between a debugger that works and one that intermittently does not.
 *
 * ## Bound to loopback only
 *
 * `127.0.0.1` explicitly, never `0.0.0.0`. The container's network is
 * `internal: true`, but binding to all interfaces would still expose the debug
 * channel to sibling containers on that network - and the channel accepts commands
 * that read variables out of a running program. Loopback keeps the reachable set to
 * the container itself.
 *
 * ## Why the token is not the security boundary
 *
 * The student's own program can read `BROWSER_CODER_DEBUG_TOKEN` from its
 * environment and connect. That is accepted: impersonating your own debugger only
 * confuses your own UI, and the program already has everything the debugger could
 * tell it. The token exists so the server can tell a DIFFERENT session's process
 * apart from the one it is waiting for - a real risk with several concurrent runs on
 * one host, and one the server would otherwise have no way to detect.
 *
 * The first connection that presents the right token wins and every later one is
 * dropped, so a race cannot leave two adapters attached to one session.
 */

import net from 'node:net';
import crypto from 'node:crypto';

import { log } from '../logging.mjs';
// The same path rule a run payload goes through. A debug command must not be able to
// name a file a run could not.
import { normalizeWorkspacePath } from '../domain/paths.mjs';

/** Environment variables the adapter reads. */
export const DEBUG_PORT_ENV = 'BROWSER_CODER_DEBUG_PORT';
export const DEBUG_TOKEN_ENV = 'BROWSER_CODER_DEBUG_TOKEN';
export const DEBUG_PROGRAM_ENV = 'BROWSER_CODER_DEBUG_PROGRAM';

/**
 * How long to wait for the adapter to connect.
 *
 * Generous, because the interpreter has to start and import the adapter first. A run
 * that never connects is not left hanging: the channel reports the failure so the
 * route can tell the student the debugger did not attach, rather than streaming a
 * program that silently ignores every breakpoint.
 */
const CONNECT_TIMEOUT_MS = 20000;

/** A single frame cannot exceed this. A variables dump is the largest legitimate one. */
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

/** Total unparsed buffer, so a peer that never sends a newline cannot grow it forever. */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export class DebugChannel {
  #server = null;
  #socket = null;
  #buffer = '';
  #token;
  #onEvent;
  #onClose;
  #closed = false;
  #attached = false;

  /**
   * @param {object} options
   * @param {(event: object) => void} options.onEvent  called per event frame
   * @param {() => void} [options.onClose]             called once, when it ends
   */
  constructor({ onEvent, onClose }) {
    this.#token = crypto.randomBytes(16).toString('hex');
    this.#onEvent = onEvent;
    this.#onClose = onClose;
  }

  get token() {
    return this.#token;
  }

  get attached() {
    return this.#attached;
  }

  /**
   * Bind a loopback port and start listening.
   *
   * Resolves with the port once bound - before the adapter exists - so the caller can
   * put it in the child's environment.
   */
  async listen() {
    this.#server = net.createServer(socket => this.#onConnection(socket));

    // An error on the listener must not become an unhandled 'error' event and take
    // the process down; a debug session failing is not a reason to lose every other
    // run on this replica.
    this.#server.on('error', error => {
      log('warn', 'debug_listener_error', { error: error.message });
    });

    await new Promise((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(0, '127.0.0.1', () => {
        this.#server.removeListener('error', reject);
        resolve();
      });
    });

    // Nothing connected in time means the adapter never started. Reported rather
    // than left pending, so the student is told the debugger did not attach instead
    // of watching a program ignore every breakpoint.
    this.connectTimer = setTimeout(() => {
      if (!this.#attached && !this.#closed) {
        log('warn', 'debug_adapter_never_connected', {});
        this.#onEvent({ type: 'debug:error', message: 'The debugger did not attach.' });
        this.close();
      }
    }, CONNECT_TIMEOUT_MS);
    this.connectTimer.unref?.();

    return this.#server.address().port;
  }

  #onConnection(socket) {
    // Second and later connections are dropped. Without this, a race between the
    // real adapter and anything else on loopback could leave two peers attached to
    // one session and interleave their frames.
    if (this.#attached || this.#closed) {
      socket.destroy();
      return;
    }

    socket.setNoDelay(true);
    socket.on('error', () => {
      // A reset from the debugged process is ordinary teardown, not a fault.
    });
    socket.on('close', () => {
      if (this.#socket === socket) this.close();
    });
    socket.on('data', chunk => this.#onData(socket, chunk));

    this.#socket = socket;
  }

  #onData(socket, chunk) {
    this.#buffer += chunk.toString('utf8');

    if (this.#buffer.length > MAX_BUFFER_BYTES) {
      log('warn', 'debug_buffer_overflow', { bytes: this.#buffer.length });
      this.close();
      return;
    }

    let index;
    while ((index = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, index);
      this.#buffer = this.#buffer.slice(index + 1);
      if (!line.trim()) continue;

      if (line.length > MAX_FRAME_BYTES) {
        log('warn', 'debug_frame_too_large', { bytes: line.length });
        continue;
      }

      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        // A malformed frame is dropped, not fatal: one bad line must not end a
        // session the student is in the middle of.
        continue;
      }

      this.#handleFrame(socket, frame);
    }
  }

  #handleFrame(socket, frame) {
    if (!frame || typeof frame !== 'object') return;

    // The handshake. Until it arrives this peer has proved nothing, so no event of
    // its is forwarded to the client.
    if (!this.#attached) {
      if (frame.type !== 'hello' || frame.token !== this.#token) {
        log('warn', 'debug_handshake_rejected', { type: frame.type });
        socket.destroy();
        if (this.#socket === socket) this.#socket = null;
        return;
      }
      this.#attached = true;
      clearTimeout(this.connectTimer);
      this.#onEvent({ type: 'debug:attached', pid: frame.pid ?? null });
      return;
    }

    if (typeof frame.type !== 'string') return;

    // Namespaced on the way out, so debug frames cannot collide with the run
    // stream's own event types (`stdout`, `exit`, `waiting`, ...) now or later.
    this.#onEvent({ ...frame, type: `debug:${frame.type}` });
  }

  /** Send one command to the adapter. Returns false when there is nobody to send to. */
  send(command) {
    if (!this.#socket || this.#socket.destroyed || !this.#attached) return false;
    try {
      this.#socket.write(`${JSON.stringify(command)}\n`);
      return true;
    } catch (error) {
      log('warn', 'debug_send_failed', { error: error.message });
      return false;
    }
  }

  /** Idempotent: the socket close handler and an explicit stop both land here. */
  close() {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.connectTimer);

    const socket = this.#socket;
    this.#socket = null;
    try { socket?.destroy(); } catch { /* already gone */ }
    try { this.#server?.close(); } catch { /* already closed */ }
    this.#server = null;

    this.#onClose?.();
  }
}

/**
 * The commands a client may send, and the shape each one must have.
 *
 * An allowlist rather than a pass-through. The adapter evaluates `expression` inside
 * the paused program, so an unvalidated command object is a way to reach that with
 * whatever a request body happened to contain - and forwarding unknown commands
 * would silently couple the HTTP surface to whatever the adapter grows next.
 */
const COMMAND_SHAPES = {
  continue: () => ({ command: 'continue' }),
  next: () => ({ command: 'next' }),
  stepIn: () => ({ command: 'stepIn' }),
  stepOut: () => ({ command: 'stepOut' }),
  stop: () => ({ command: 'stop' }),

  setBreakpoints: body => {
    const clean = cleanLines(body?.lines);

    /*
     * Breakpoints in files OTHER than the entry file.
     *
     * `lines` alone is the v1 shape and still means the entry file, so a client that
     * has not learned about this keeps working unchanged. `files` maps a workspace path
     * to its lines, which is what makes a breakpoint in an imported module possible.
     *
     * Each path goes through the SAME rule the run payload uses, so a debug command
     * cannot name a file a run could not - a traversal here would ask the adapter to
     * arm a breakpoint outside the job directory.
     */
    const files = {};
    let paths = 0;
    if (body?.files && typeof body.files === 'object' && !Array.isArray(body.files)) {
      for (const [rawPath, rawLines] of Object.entries(body.files)) {
        if (paths >= MAX_BREAKPOINT_FILES) break;
        const normalized = normalizeWorkspacePath(rawPath);
        if (!normalized.ok) continue;

        const lines = cleanLines(rawLines);
        if (lines.length === 0) continue;

        files[normalized.path] = lines;
        paths += 1;
      }
    }

    return { command: 'setBreakpoints', lines: clean, files };
  },

  evaluate: body => {
    const expression = typeof body?.expression === 'string' ? body.expression : '';
    if (expression.length === 0 || expression.length > MAX_EXPRESSION_CHARS) return null;
    return { command: 'evaluate', expression };
  },
};

/** A file longer than this is not a thing a student is debugging. */
const MAX_BREAKPOINT_LINE = 1000000;
const MAX_BREAKPOINTS = 500;
const MAX_EXPRESSION_CHARS = 2000;
/** Files that may carry breakpoints in one command. The project cap is 300. */
const MAX_BREAKPOINT_FILES = 100;

/**
 * The line numbers in one list, validated.
 *
 * Dropped here rather than passed to the adapter to reject, so the boundary between an
 * HTTP body and a running program is in one place.
 */
function cleanLines(value) {
  const lines = Array.isArray(value) ? value : [];
  const clean = [];
  for (const raw of lines) {
    const line = Number(raw);
    if (Number.isInteger(line) && line > 0 && line <= MAX_BREAKPOINT_LINE) clean.push(line);
    if (clean.length >= MAX_BREAKPOINTS) break;
  }
  return clean;
}

/**
 * Validate a client command, returning the frame to send or null.
 *
 * Exported for its own tests: this is the whole boundary between an HTTP body and a
 * command that runs inside the student's paused process.
 */
export function buildDebugCommand(name, body) {
  const shape = Object.prototype.hasOwnProperty.call(COMMAND_SHAPES, name)
    ? COMMAND_SHAPES[name]
    : null;
  if (!shape) return null;
  return shape(body ?? {});
}

export const DEBUG_COMMANDS = Object.keys(COMMAND_SHAPES);

export default DebugChannel;
