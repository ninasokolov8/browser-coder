/**
 * The PHP debug adapter.
 *
 * Speaks DBGp to Xdebug on one side (see `dbgp.mjs` for the wire format) and this
 * IDE's NDJSON frames on the other - the same `hello` / `breakpoints` / `stopped` /
 * `evaluated` / `terminated` vocabulary the other three adapters use.
 *
 * ## The one structural difference from every other adapter here
 *
 * Xdebug dials out. The debugger listens on a port, PHP is started with that port in
 * its configuration, and the engine connects back. So this process binds first, spawns
 * second, and waits - the opposite of the Java adapter, which spawns a JVM and then
 * attaches to it.
 *
 * ## Why this is a supervising process
 *
 * The same reason as Java: the protocol is a socket, so somebody has to be on the
 * other end of it, and the run pipeline kills the process GROUP, so the child PHP dies
 * with its supervisor rather than outliving the job.
 *
 * ## The ordering
 *
 * Xdebug connects before the first line runs and waits for a command, which is exactly
 * the pause the other adapters have to engineer. Breakpoints are armed while it waits,
 * and only then is `run` sent. A client that never sends `setBreakpoints` still gets
 * its program run, after a bounded wait.
 */

import path from 'node:path';
import { spawn } from 'node:child_process';

import { createIdeDebugChannel } from '../shared/debug-channel.mjs';
import {
  DbgpListener,
  pathFromUri,
  resolveInWorkspace as resolveUnderRoot,
  uriFromPath,
  workspaceRelative as relativeToRoot,
} from './dbgp.mjs';

const PORT = Number(process.env.BROWSER_CODER_DEBUG_PORT || 0);
const TOKEN = process.env.BROWSER_CODER_DEBUG_TOKEN || '';
const WORKSPACE = process.env.BROWSER_CODER_WORKSPACE || process.cwd();
const PROGRAM = process.env.BROWSER_CODER_DEBUG_PROGRAM || '';
const PHP_BIN = process.env.BROWSER_CODER_PHP_BIN || 'php';
/** Interpreter flags the run pipeline would have passed, as a JSON array. */
const PHP_ARGS = (() => {
  try {
    const parsed = JSON.parse(process.env.BROWSER_CODER_PHP_ARGS || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
})();

if (!PORT || !TOKEN || !PROGRAM) {
  process.stderr.write('php debug adapter: missing session environment\n');
  process.exit(2);
}

/** Longest rendering of one value, matching the other adapters. */
const MAX_VALUE_CHARS = 200;
const MAX_STACK = 50;
/** How long to wait for the IDE's first `setBreakpoints` before running anyway. */
const FIRST_BREAKPOINTS_WAIT_MS = 5000;

const workspaceRoot = path.resolve(WORKSPACE);

// ── The IDE channel ─────────────────────────────────────────────────────────

const {
  socket: channel,
  send,
  close: closeChannel,
  handleCommands: handleChannelCommands,
} = createIdeDebugChannel(PORT);

// ── Paths ───────────────────────────────────────────────────────────────────

// Both live in `dbgp.mjs`, which a unit test can import - this file opens a socket on
// import and cannot be. See the note there for why that matters here specifically.
const resolveInWorkspace = relative => resolveUnderRoot(workspaceRoot, relative);
const workspaceRelative = absolute => relativeToRoot(workspaceRoot, absolute);

const programAbsolute = path.resolve(PROGRAM);
const entryRelative = workspaceRelative(programAbsolute) ?? path.basename(programAbsolute);

// ── The engine ──────────────────────────────────────────────────────────────

const listener = new DbgpListener();
const enginePort = await listener.listen();

const php = spawn(
  PHP_BIN,
  [
    ...PHP_ARGS,
    '-dzend_extension=xdebug',
    // `debug` alone: no profiling, no tracing, no code coverage. Each of the other
    // modes costs real time on every function call and none of them is wanted here.
    '-dxdebug.mode=debug',
    // Connect at startup rather than waiting for a trigger cookie, which is a web
    // request idea and cannot apply to a CLI run.
    '-dxdebug.start_with_request=yes',
    '-dxdebug.client_host=127.0.0.1',
    `-dxdebug.client_port=${enginePort}`,
    // Silence: Xdebug's own log would otherwise land in the student's stderr.
    '-dxdebug.log_level=0',
    // If nothing is listening, run the program instead of hanging forever waiting
    // for a debugger that will never arrive.
    '-dxdebug.start_upon_error=no',
    programAbsolute,
  ],
  { cwd: workspaceRoot, stdio: ['inherit', 'pipe', 'pipe'] },
);

php.stdout.on('data', chunk => process.stdout.write(chunk));
php.stderr.on('data', chunk => process.stderr.write(chunk));

let exitCode = 0;
php.on('exit', code => {
  exitCode = code ?? 0;
  send({ type: 'terminated', exitCode });
  finish();
});

/**
 * End the session, and do not leave a zombie behind.
 *
 * Usually reached from the interpreter's own `exit` handler, where there is nothing
 * left to wait for - but not always: an Xdebug that never dials back, or a teardown
 * from the IDE, both get here with PHP still running. Exiting then reparents it to
 * PID 1, which in this image is the server, and a Node process is not an init and does
 * not reap strangers. The production compose sets `pids_limit: 512`, so leaked PIDs
 * eventually stop the container forking anything.
 *
 * So: wait for it, bounded - a process that will not die must not hold the job open
 * either, and the container's init (`init: true` in compose) reaps what is left.
 */
function finish() {
  try { session?.close(); } catch { /* already gone */ }
  try { listener.close(); } catch { /* already closed */ }
  closeChannel();

  const leave = () => process.exit(exitCode);

  if (php.exitCode !== null || php.signalCode !== null) {
    setTimeout(leave, 50);
    return;
  }

  const giveUp = setTimeout(leave, 2000);
  php.once('exit', () => {
    clearTimeout(giveUp);
    setTimeout(leave, 50);
  });
  try { php.kill(); } catch { /* already gone */ }
}

// ── Session state ───────────────────────────────────────────────────────────

let session = null;
/** Breakpoints the IDE asked for: absolute path -> lines. */
let wanted = new Map();
/** Xdebug's ids for the breakpoints currently set, so a replacement can remove them. */
let breakpointIds = [];
/** The conditions for those breakpoints: absolute path -> line -> expression. */
let wantedConditions = new Map();
/** Absolute path -> line -> expression for points that report and immediately run on. */
let wantedLogpoints = new Map();
/** True between a `run`/`step_*` going out and its stop coming back. */
let running = false;
/** True once the program has stopped and is waiting for the student. */
let paused = false;

let markBreakpointsReceived = () => {};
const firstBreakpointsCommand = Promise.race([
  new Promise(resolve => { markBreakpointsReceived = resolve; }),
  new Promise(resolve => setTimeout(resolve, FIRST_BREAKPOINTS_WAIT_MS)),
]);

// ── Values ──────────────────────────────────────────────────────────────────

/** The text inside a `<property>`, decoded if Xdebug base64'd it. */
function propertyText(property) {
  const raw = property.text ?? '';
  if (property.attrs.encoding === 'base64') {
    try {
      return Buffer.from(raw, 'base64').toString('utf8');
    } catch {
      return raw;
    }
  }
  return raw;
}

/**
 * One `<property>` element, rendered the way the variables panel expects.
 *
 * PHP's types do not line up with any other language here, so the mapping is explicit:
 * `bool` arrives as the strings "0" and "1", an uninitialised variable has its own
 * type rather than being absent, and an array reports its size in an attribute because
 * its children may have been truncated by `max_children`.
 */
function describe(property) {
  const type = property.attrs.type ?? 'unknown';

  switch (type) {
    case 'bool':
      return { text: propertyText(property) === '1' ? 'true' : 'false', type: 'bool' };
    case 'null':
      return { text: 'null', type: 'null' };
    case 'int':
    case 'float':
      return { text: propertyText(property), type };
    case 'string': {
      const value = propertyText(property);
      const shown = value.length > MAX_VALUE_CHARS ? `${value.slice(0, MAX_VALUE_CHARS)}…` : value;
      const size = Number(property.attrs.size);
      return {
        text: JSON.stringify(shown),
        type: 'string',
        length: Number.isFinite(size) ? size : value.length,
      };
    }
    case 'array': {
      const count = Number(property.attrs.numchildren ?? 0);
      return { text: `array(${count} items)`, type: 'array', length: count };
    }
    case 'object': {
      const className = property.attrs.classname || 'object';
      const count = Number(property.attrs.numchildren ?? 0);
      return { text: `${className}(${count} properties)`, type: 'object', length: count };
    }
    case 'uninitialized':
      return { text: 'uninitialized', type: 'uninitialized' };
    default:
      return { text: propertyText(property) || type, type };
  }
}

/** The variables of one context at one stack depth. */
async function contextVariables(depth, context) {
  const reply = await session.command('context_get', `-d ${depth} -c ${context}`);
  if (!reply || reply.child('error')) return [];

  return reply.all('property').map(property => ({
    // PHP variable names carry their sigil; the panel shows what the student typed.
    name: property.attrs.name ?? property.attrs.fullname ?? '?',
    value: describe(property),
  }));
}

// ── Stopping ────────────────────────────────────────────────────────────────

/** Read the stack and report a stop to the IDE. */
async function reportStop(reason) {
  paused = true;

  const reply = await session.command('stack_get');
  const frames = (reply?.all('stack') ?? []).slice(0, MAX_STACK).map(frame => {
    const absolute = pathFromUri(frame.attrs.filename);
    return {
      // `{main}` is Xdebug's name for top-level code. A student has not written a
      // function called that and should not be shown it.
      name: frame.attrs.where === '{main}' ? '(main)' : (frame.attrs.where || '(function)'),
      file: workspaceRelative(absolute) ?? path.basename(absolute),
      line: Number(frame.attrs.lineno ?? 0),
    };
  });

  if (frames.length === 0) return;

  send({
    type: 'stopped',
    reason,
    file: frames[0].file,
    line: frames[0].line,
    stack: frames,
    locals: await contextVariables(0, 0),
    globals: [],
  });
}

/**
 * Send a command that continues the program, and report wherever it lands.
 *
 * `status` is the whole answer: `break` means it stopped somewhere, `stopping` means
 * the program finished and Xdebug is waiting to be released, and anything else means
 * the session is over.
 */
async function proceed(command, reason) {
  if (!session || running) return;
  running = true;
  paused = false;

  const reply = await session.command(command);
  running = false;

  if (!reply) return;

  const status = reply.attrs.status;
  if (status === 'break') {
    const stackReply = await session.command('stack_get');
    const top = stackReply?.all('stack')?.[0];
    const absolute = top ? pathFromUri(top.attrs.filename) : null;
    const line = Number(top?.attrs.lineno ?? 0);
    const expression = absolute ? (wantedLogpoints.get(absolute) ?? {})[line] : null;
    if (expression && reason === 'breakpoint') {
      paused = true;
      const result = await evaluateExpression(expression);
      send({
        type: 'log',
        file: workspaceRelative(absolute) ?? path.basename(absolute),
        line,
        expression,
        ...result,
      });
      paused = false;
      await proceed('run', 'breakpoint');
      return;
    }
    await reportStop(reason);
    return;
  }

  /*
   * `stopping` is not `stopped`.
   *
   * The program has run to its end but the engine is still holding the process open
   * waiting for a final command. Without this the PHP process never exits, the run
   * hangs until the session timer kills it, and the student sees their output followed
   * by nothing at all.
   */
  if (status === 'stopping') {
    await session.command('stop');
  }
}

// ── Breakpoints ─────────────────────────────────────────────────────────────

async function applyBreakpoints() {
  for (const id of breakpointIds) {
    await session.command('breakpoint_remove', `-d ${id}`);
  }
  breakpointIds = [];

  const acceptedByFile = {};
  const acceptedLogpoints = {};

  for (const [absolute, lines] of wanted) {
    const relative = workspaceRelative(absolute) ?? path.basename(absolute);
    const accepted = [];

    const forFile = wantedConditions.get(absolute) ?? {};

    for (const line of lines) {
      /*
       * A condition makes it a different BREAKPOINT TYPE, not an extra argument.
       *
       * DBGp has no condition flag on a line breakpoint. It has a separate type,
       * `conditional`, which takes a file and line like a line breakpoint and the
       * expression as its base64 payload - and Xdebug evaluates it itself, so a loop
       * with a condition never round-trips to this process. Verified against Xdebug
       * 3.5: a condition of `$i == 3` on a five-iteration loop printed 0, 1, 2 and
       * then stopped, with $i == 3 in the locals.
       */
      const condition = forFile[line];
      const reply = await session.command(
        'breakpoint_set',
        condition
          ? `-t conditional -f ${uriFromPath(absolute)} -n ${line}`
          : `-t line -f ${uriFromPath(absolute)} -n ${line}`,
        condition ? Buffer.from(condition, 'utf8').toString('base64') : null,
      );
      // Xdebug accepts a line breakpoint without checking that the line can hold
      // one, so this only fails when the file or the request is malformed.
      if (!reply || reply.child('error')) continue;
      const id = reply.attrs.id;
      if (id) breakpointIds.push(id);
      const logExpression = (wantedLogpoints.get(absolute) ?? {})[line];
      if (logExpression) (acceptedLogpoints[relative] ??= {})[line] = logExpression;
      else accepted.push(line);
    }

    if (accepted.length > 0) acceptedByFile[relative] = accepted.sort((a, b) => a - b);
  }

  send({
    type: 'breakpoints',
    lines: acceptedByFile[entryRelative] ?? [],
    files: acceptedByFile,
    logpoints: acceptedLogpoints,
  });
}

// ── Watch expressions ───────────────────────────────────────────────────────

/**
 * Evaluate an expression in the paused frame.
 *
 * Unlike Java, this is a real evaluator: `eval` hands the expression to the engine,
 * which runs it as PHP. That is more capable and also more dangerous - the expression
 * is arbitrary code with the program's own permissions - so it is only ever sent while
 * the program is paused, and the interpreter's own `disable_functions` list still
 * applies to whatever it calls.
 */
async function evaluateExpression(expression) {
  const text = String(expression ?? '').trim();
  if (!text) return { error: 'Nothing to evaluate' };
  if (!session || !paused) return { error: 'The program is not paused' };

  const reply = await session.command('eval', '', Buffer.from(text, 'utf8').toString('base64'));
  if (!reply) return { error: 'The debugger disconnected' };

  const error = reply.child('error');
  if (error) {
    const message = error.child('message')?.text?.trim();
    return { error: message || 'That expression could not be evaluated' };
  }

  const property = reply.child('property');
  if (!property) return { error: 'That expression produced no value' };
  return { value: describe(property) };
}

// ── The IDE's commands ──────────────────────────────────────────────────────

async function handleCommand(command) {
  switch (command?.command) {
    case 'setBreakpoints': {
      wanted = new Map();
      wantedConditions = new Map();
      wantedLogpoints = new Map();

      const add = (absolute, lines, forFile) => {
        if (!absolute || !Array.isArray(lines)) return;
        const existing = wanted.get(absolute) ?? [];
        wanted.set(absolute, [...existing, ...lines.filter(line => Number.isInteger(line) && line > 0)]);

        // Keyed by the same absolute path as the lines, so the two cannot disagree
        // about which file a relative path meant.
        for (const [line, expression] of Object.entries(forFile ?? {})) {
          const at = Number(line);
          if (!Number.isInteger(at)) continue;
          const held = wantedConditions.get(absolute) ?? {};
          held[at] = expression;
          wantedConditions.set(absolute, held);
        }
      };

      // `lines` still means the entry file; `files` is the multi-file form, and the
      // empty-string key in `conditions` means the entry file too.
      const conditions = command.conditions ?? {};
      add(programAbsolute, command.lines, conditions['']);
      for (const [file, lines] of Object.entries(command.files ?? {})) {
        add(resolveInWorkspace(file), lines, conditions[file]);
      }

      for (const [file, entries] of Object.entries(command.logpoints ?? {})) {
        const absolute = file === '' ? programAbsolute : resolveInWorkspace(file);
        if (!absolute || !entries || typeof entries !== 'object') continue;
        const held = wantedLogpoints.get(absolute) ?? {};
        for (const [line, expression] of Object.entries(entries)) {
          const at = Number(line);
          if (!Number.isInteger(at) || at < 1) continue;
          held[at] = expression;
          const existing = wanted.get(absolute) ?? [];
          wanted.set(absolute, [...existing, at]);
        }
        wantedLogpoints.set(absolute, held);
      }

      await applyBreakpoints();
      markBreakpointsReceived();
      return;
    }

    case 'continue':
      await proceed('run', 'breakpoint');
      return;

    case 'next':
      await proceed('step_over', 'step');
      return;

    case 'stepIn':
      await proceed('step_into', 'step');
      return;

    case 'stepOut':
      await proceed('step_out', 'step');
      return;

    case 'evaluate': {
      const expression = String(command.expression ?? '');
      send({ type: 'evaluated', expression, ...(await evaluateExpression(expression)) });
      return;
    }

    case 'stop':
      // `stop` asks the engine to end the script; the process exit that follows is
      // what reports the run as terminated.
      await session?.command('stop');
      setTimeout(() => { try { php.kill(); } catch { /* gone */ } }, 500);
      return;

    default:
      send({ type: 'error', message: `unknown command: ${command?.command}` });
  }
}

/*
 * Commands are handled one at a time, in order.
 *
 * DBGp allows exactly one outstanding command, and the IDE can legitimately send a
 * second one before the first is answered - a student who clicks Step twice quickly.
 * `DbgpSession` serialises the wire, but `proceed` also reads state around its call, so
 * the handler is serialised too.
 */
/*
 * ...and they are held until the engine exists.
 *
 * `hello` is what makes the server report `debug:attached`, and a client reacts to
 * that by sending `setBreakpoints` at once - but `hello` goes out when the socket to
 * the IDE opens, which is before Xdebug has dialled back. A command arriving in that
 * window has no engine to reach, and dropping it means nothing is armed and the
 * program runs straight past the student's breakpoint.
 */
let markReady = () => {};
const ready = new Promise(resolve => { markReady = resolve; });
handleChannelCommands({
  ready,
  handleCommand,
  reportError(error) {
    process.stderr.write(`php debug adapter: ${error?.stack || error}\n`);
  },
});

// ── Startup ─────────────────────────────────────────────────────────────────

channel.on('connect', () => send({ type: 'hello', token: TOKEN, language: 'php' }));

session = await listener.session;

// The init packet: Xdebug's greeting, sent before any command. It has to be consumed
// or it would be read as the answer to the first command sent.
await session.next();

/*
 * `max_depth 1`, deliberately.
 *
 * Xdebug walks nested structures eagerly, and the default depth means a variables
 * panel showing one array of objects fetches the whole graph on every single stop.
 * The panel shows one level and a summary; anything deeper is what a watch expression
 * is for.
 */
await session.command('feature_set', '-n max_depth -v 1');
await session.command('feature_set', '-n max_children -v 100');

// Anything the client already sent runs now. No `attached` frame: the server derives
// `debug:attached` from `hello`, and sending one as well made the client see the same
// event twice.
markReady();

// Xdebug is holding the program before its first line, which is exactly the pause the
// other adapters have to engineer. Do not waste it.
await firstBreakpointsCommand;

send({ type: 'started' });
handling = handling.then(() => proceed('run', 'breakpoint'));
