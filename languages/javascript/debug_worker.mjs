/**
 * The JavaScript debugger, in a worker thread.
 *
 * This thread owns two things: the Chrome DevTools Protocol session attached to the
 * MAIN thread (where the student's program runs) and the NDJSON socket back to the
 * server. It works because a worker's event loop keeps running while the main thread
 * is paused - see the note in `debug_adapter.mjs`.
 *
 * The frames on the wire are the ones `languages/python/debug_adapter.py` already
 * emits, deliberately and to the character: `hello`, `breakpoints`, `stopped`,
 * `evaluated`, `terminated`. The client's whole debug surface - the state machine, the
 * glyph margin, the variables panel - is written against that vocabulary and knows
 * nothing about languages. A second dialect would mean a second UI.
 */

import net from 'node:net';
import inspector from 'node:inspector';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

const { port, token, program, pid } = workerData;

const PROGRAM_URL = pathToFileURL(program).href;
const PROGRAM_NAME = path.basename(program);

/** Longest rendering of one value. A student's variable, not a data dump. */
const MAX_VALUE_CHARS = 200;
/** Most variables reported per scope. */
const MAX_VARIABLES = 200;
/** Deepest stack reported. Recursion can produce thousands of identical frames. */
const MAX_STACK = 50;

const session = new inspector.Session();
session.connectToMainThread();

// ── The socket ──────────────────────────────────────────────────────────────

const socket = net.connect(port, '127.0.0.1');
socket.setNoDelay(true);

let buffer = '';
let closed = false;

function send(frame) {
  if (closed || socket.destroyed) return;
  try {
    socket.write(`${JSON.stringify(frame)}\n`);
  } catch {
    // The server has gone. The program keeps running: losing the debugger must not
    // lose the run.
  }
}

socket.on('error', () => {
  closed = true;
});

socket.on('close', () => {
  closed = true;
  // A closed channel means nobody is listening for a pause, so leaving the program
  // stopped would freeze it forever with no way to resume.
  resumeIfPaused();
});

socket.on('data', chunk => {
  buffer += chunk.toString('utf8');
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    let command;
    try {
      command = JSON.parse(line);
    } catch {
      continue;
    }
    handleCommand(command);
  }
});

socket.on('connect', () => {
  send({ type: 'hello', token, pid });
  arm();
});

// ── CDP helpers ─────────────────────────────────────────────────────────────

function post(method, params = {}) {
  return new Promise(resolve => {
    session.post(method, params, (error, result) => {
      resolve(error ? { error } : { result: result ?? {} });
    });
  });
}

// ── Breakpoints ─────────────────────────────────────────────────────────────

/** line -> the breakpoint id V8 gave us, so a removal can name it. */
const breakpoints = new Map();

/**
 * Arm the requested lines and report which ones took.
 *
 * V8 answers with the location it actually bound to, which is not always the line that
 * was asked for - a blank line or a comment binds to the next statement. Reporting
 * V8's answer rather than the request is what keeps the margin honest, and it is the
 * same contract the Python adapter has.
 */
async function setBreakpoints(lines) {
  for (const [, id] of breakpoints) {
    await post('Debugger.removeBreakpoint', { breakpointId: id });
  }
  breakpoints.clear();

  const accepted = [];
  for (const line of lines) {
    const { result, error } = await post('Debugger.setBreakpointByUrl', {
      lineNumber: line - 1,
      url: PROGRAM_URL,
    });
    if (error || !result?.breakpointId) continue;

    // `locations` is empty when the script has not been parsed yet - which is the
    // normal case, because breakpoints are armed before the program is imported. The
    // breakpoint is still registered and binds on parse, so the requested line is
    // reported.
    const bound = result.locations?.[0]?.lineNumber;
    const at = typeof bound === 'number' ? bound + 1 : line;
    breakpoints.set(at, result.breakpointId);
    accepted.push(at);
  }

  accepted.sort((a, b) => a - b);
  send({ type: 'breakpoints', lines: accepted });
}

/**
 * Script ids belonging to the student's file.
 *
 * Frames are matched by script id, not by `url`. V8 leaves `url` EMPTY on the call
 * frames of an exception pause - measured, not assumed - so a URL filter silently
 * dropped every frame exactly when the stack mattered most. `scriptParsed` always
 * carries the url, so it is recorded once and the id is used from then on.
 */
const programScripts = new Set();

session.on('Debugger.scriptParsed', message => {
  if (message.params.url === PROGRAM_URL) programScripts.add(message.params.scriptId);
});

function isProgramFrame(frame) {
  return programScripts.has(frame.location?.scriptId) || frame.url === PROGRAM_URL;
}

async function arm() {
  await post('Debugger.enable');
  // Uncaught only. Pausing on every caught exception would stop inside library code a
  // student never wrote, which reads as the debugger being broken.
  //
  // It rarely fires, because a program loaded with `import()` has the loader's own
  // handler above it and V8 therefore calls its exceptions caught. The case that
  // matters - the program dying with an error - is covered by the post-mortem stop
  // built from the real error when the run ends, which is what Python reports too.
  await post('Debugger.setPauseOnExceptions', { state: 'uncaught' });
  await post('Runtime.enable');
  parentPort.postMessage({ kind: 'armed' });
}

// ── Values ──────────────────────────────────────────────────────────────────

/**
 * One variable, in the shape the client's variables panel already renders.
 *
 * `{text, type, length?}` - the same object the Python adapter produces from `repr()`.
 */
function describe(remote) {
  if (!remote) return { text: 'undefined', type: 'undefined' };

  const type = remote.subtype || remote.type;

  if (remote.type === 'string') {
    const value = String(remote.value ?? '');
    const shown = value.length > MAX_VALUE_CHARS ? `${value.slice(0, MAX_VALUE_CHARS)}…` : value;
    return { text: JSON.stringify(shown), type: 'string', length: value.length };
  }

  if (remote.type === 'function') {
    // `description` is the whole source of the function, which is not a value.
    const name = remote.className === 'Function' ? remote.description?.split('(')[0] : '';
    return { text: `${(name || 'function').trim()}()`, type: 'function' };
  }

  if (remote.subtype === 'array') {
    return {
      text: remote.description || 'Array',
      type: 'array',
      length: typeof remote.value?.length === 'number' ? remote.value.length : undefined,
    };
  }

  const text = remote.value !== undefined
    ? String(remote.value)
    : String(remote.description ?? remote.type);

  return {
    text: text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text,
    type,
  };
}

/** Read one scope object into `{name, value}` rows. */
async function readScope(scope) {
  const objectId = scope?.object?.objectId;
  if (!objectId) return [];

  const { result, error } = await post('Runtime.getProperties', {
    objectId,
    ownProperties: true,
    generatePreview: false,
  });
  if (error) return [];

  const rows = [];
  for (const property of result.result ?? []) {
    if (rows.length >= MAX_VARIABLES) break;
    // A getter has no `value` and reading it would run student code at a moment the
    // program is stopped - a side effect the student did not ask for.
    if (!property.value) continue;
    rows.push({ name: property.name, value: describe(property.value) });
  }
  return rows;
}

// ── Pausing ─────────────────────────────────────────────────────────────────

let paused = false;
/** The frame `evaluate` runs in: the student's innermost, not node's. */
let currentTopFrameId = null;

function resumeIfPaused() {
  if (!paused) return;
  paused = false;
  session.post('Debugger.resume');
}

session.on('Debugger.resumed', () => {
  paused = false;
});

session.on('Debugger.paused', async message => {
  paused = true;
  const params = message.params;

  // Only the student's own frames. Node's internals are on this stack too, and a
  // student stepping into `node:internal/modules` has been failed by their tools.
  const own = (params.callFrames ?? []).filter(isProgramFrame);
  const top = own[0] ?? params.callFrames?.[0];
  if (!top) {
    resumeIfPaused();
    return;
  }
  currentTopFrameId = top.callFrameId ?? null;

  const stack = own.slice(0, MAX_STACK).map(frame => ({
    name: frame.functionName || '(module)',
    file: PROGRAM_NAME,
    line: frame.location.lineNumber + 1,
  }));

  const scopes = top.scopeChain ?? [];
  const locals = [];
  for (const scope of scopes) {
    if (scope.type !== 'local' && scope.type !== 'closure' && scope.type !== 'block') continue;
    locals.push(...(await readScope(scope)));
  }

  // Module scope, never the global object: `global` holds every built-in in the
  // runtime and would bury the four names the student actually wrote. Module scope is
  // what corresponds to Python's module-level globals.
  const moduleScope = scopes.find(scope => scope.type === 'module');
  const globals = moduleScope ? await readScope(moduleScope) : [];

  const event = {
    type: 'stopped',
    reason: params.reason === 'exception' ? 'exception' : (params.hitBreakpoints?.length ? 'breakpoint' : 'step'),
    file: PROGRAM_NAME,
    line: top.location.lineNumber + 1,
    stack,
    locals,
    globals,
  };

  if (params.reason === 'exception') {
    const thrown = params.data;
    event.exception = {
      type: thrown?.className || 'Error',
      message: String(thrown?.description || thrown?.value || 'Uncaught exception')
        .split('\n')[0],
    };
    // Not `postMortem`: V8 stops at the throw with the frame still live, so stepping
    // and evaluation both still work - strictly more than Python's post-mortem, and
    // the client already treats a plain `stopped` with an exception correctly.
  }

  send(event);
});

// ── Commands ────────────────────────────────────────────────────────────────

async function evaluate(expression) {
  if (!paused) {
    send({ type: 'evaluated', expression, error: 'Not paused' });
    return;
  }

  const { result, error } = await post('Debugger.evaluateOnCallFrame', {
    callFrameId: currentTopFrameId,
    expression,
    // Side effects are allowed: a student evaluating `total = 0` while paused is
    // legitimate, and refusing it silently would be more confusing than doing it.
    silent: true,
    returnByValue: false,
  });

  if (error || result?.exceptionDetails) {
    send({
      type: 'evaluated',
      expression,
      error: String(
        result?.exceptionDetails?.exception?.description
        || result?.exceptionDetails?.text
        || error?.message
        || 'Could not evaluate',
      ).split('\n')[0],
    });
    return;
  }

  send({ type: 'evaluated', expression, value: describe(result.result) });
}

function handleCommand(command) {
  switch (command?.command) {
    case 'setBreakpoints':
      void setBreakpoints(Array.isArray(command.lines) ? command.lines : []);
      return;
    case 'continue':
      resumeIfPaused();
      return;
    case 'next':
      if (paused) {
        paused = false;
        session.post('Debugger.stepOver');
      }
      return;
    case 'stepIn':
      if (paused) {
        paused = false;
        session.post('Debugger.stepInto');
      }
      return;
    case 'stepOut':
      if (paused) {
        paused = false;
        session.post('Debugger.stepOut');
      }
      return;
    case 'evaluate':
      void evaluate(String(command.expression || ''));
      return;
    case 'stop':
      // Terminates the main thread's execution wherever it is - including while it is
      // paused, which is exactly when a student reaches for Stop. Resuming first is
      // required: a paused isolate does not run the termination either.
      session.post('Runtime.terminateExecution');
      resumeIfPaused();
      send({ type: 'terminated', exitCode: null });
      closeChannel();
      return;
    default:
      send({ type: 'error', message: `unknown command: ${command?.command}` });
  }
}

function closeChannel() {
  if (closed) return;
  closed = true;
  try {
    socket.end();
  } catch {
    /* already gone */
  }
}

// ── The end of the run ──────────────────────────────────────────────────────

/**
 * Where in the student's file an error was thrown, read from its stack.
 *
 * `at ... (file:///…/main.mjs:12:7)` and the bare `file:///…/main.mjs:12:7` form are
 * both produced by V8 depending on whether the frame has a function name.
 */
function stackFrames(stack) {
  const frames = [];
  for (const line of String(stack || '').split('\n')) {
    const match = line.match(/at (?:(.+?) \()?(file:[^\s)]+):(\d+):(\d+)\)?/);
    if (!match) continue;
    if (match[2] !== PROGRAM_URL) continue;
    frames.push({
      name: match[1] && match[1] !== 'file' ? match[1] : '(module)',
      file: PROGRAM_NAME,
      line: Number(match[3]),
    });
  }
  return frames;
}

parentPort.on('message', message => {
  if (message?.kind !== 'finished') return;

  /*
   * A program that died reports where it died, before it reports that it ended.
   *
   * This is the post-mortem stop, and it is built from the error rather than from a
   * debugger pause because V8 does not consider a dynamically imported module's throw
   * "uncaught" - the loader's own handler is above it - so `setPauseOnExceptions`
   * never fires for the one case a student most needs. The frames are recovered from
   * the stack, which is the same information Python's post-mortem walks a traceback
   * for. Variables are not available here, and that is recorded as a gap rather than
   * faked.
   */
  const error = message.error;
  if (error) {
    const frames = stackFrames(error.stack);
    send({
      type: 'stopped',
      reason: 'exception',
      postMortem: true,
      file: PROGRAM_NAME,
      line: frames[0]?.line ?? 1,
      stack: frames,
      locals: [],
      globals: [],
      exception: { type: error.name || 'Error', message: error.message || '' },
    });
  }

  send({ type: 'terminated', exitCode: message.exitCode ?? 0 });
  closeChannel();
  // Let the write drain before the thread goes away.
  setTimeout(() => process.exit(0), 50);
});
