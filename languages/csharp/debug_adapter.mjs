/**
 * The C# debug adapter.
 *
 * Speaks DAP to `dncdbg` on one side (see `dap.mjs` for the envelope) and this
 * IDE's NDJSON frames on the other - the same `hello` / `breakpoints` / `stopped` /
 * `evaluated` / `terminated` vocabulary the other four adapters use.
 *
 * ## Why there is a translation layer at all
 *
 * DAP is itself a debug-adapter protocol, so translating one into another looks like
 * work for its own sake. It is not, for two reasons.
 *
 * The first is that this IDE's protocol is frozen (section 22): the client, the
 * channel, the panel and four other languages already speak it, and adopting DAP
 * wholesale would mean either rewriting all of them or having C# be the one language
 * that behaves differently. The second is that DAP is a negotiation, not a format -
 * capabilities, reverse requests, variable references that must be walked lazily -
 * and the parts of it a teaching IDE needs are a small fraction of that.
 *
 * ## What runs where
 *
 * The .NET runtime cannot be debugged from inside itself the way Python and JavaScript
 * can, so this is a supervising process, like Java and PHP: it spawns the debugger,
 * which spawns the student's program. The run pipeline kills the process GROUP, so
 * both die with it.
 *
 * ## The ordering DAP requires
 *
 * `initialize`, then the adapter answers and later emits `initialized`. Breakpoints may
 * only be set between that event and `configurationDone`, and the program does not
 * start until `configurationDone` returns. That window is where the IDE's first
 * `setBreakpoints` has to land, so - as in the other adapters - it is waited for, with
 * a bound so a client that never sends one still gets its program run.
 */

import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { DapConnection } from './dap.mjs';
import { resolveInWorkspace, workspaceRelative } from '../shared/workspace-paths.mjs';

const PORT = Number(process.env.BROWSER_CODER_DEBUG_PORT || 0);
const TOKEN = process.env.BROWSER_CODER_DEBUG_TOKEN || '';
const WORKSPACE = process.env.BROWSER_CODER_WORKSPACE || process.cwd();
/** The built assembly to launch, e.g. `<job>/bin/Debug/net8.0/UserProgram.dll`. */
const ASSEMBLY = process.env.BROWSER_CODER_DOTNET_ASSEMBLY || '';
/** The source file the IDE calls the entry point, relative to the workspace. */
const ENTRY = process.env.BROWSER_CODER_DEBUG_ENTRY || 'Program.cs';
const DEBUGGER_BIN = process.env.BROWSER_CODER_DOTNET_DEBUGGER || 'dncdbg';

if (!PORT || !TOKEN || !ASSEMBLY) {
  process.stderr.write('csharp debug adapter: missing session environment\n');
  process.exit(2);
}

const MAX_STACK = 50;
const MAX_VALUE_CHARS = 200;
const FIRST_BREAKPOINTS_WAIT_MS = 5000;

const workspaceRoot = path.resolve(WORKSPACE);

// ── The IDE channel ─────────────────────────────────────────────────────────

const channel = net.connect(PORT, '127.0.0.1');
channel.setNoDelay(true);

let channelBuffer = '';
let channelClosed = false;

function send(frame) {
  if (channelClosed || channel.destroyed) return;
  try {
    channel.write(`${JSON.stringify(frame)}\n`);
  } catch {
    // Losing the debugger must not lose the run.
  }
}

channel.on('error', () => { channelClosed = true; });
channel.on('close', () => { channelClosed = true; });
channel.on('connect', () => send({ type: 'hello', token: TOKEN, language: 'csharp' }));

// ── The debugger process ────────────────────────────────────────────────────

/*
 * The debugger is `dncdbg`, not `netcoredbg`, and the reason is a real bug.
 *
 * netcoredbg builds on Alpine and runs - `--version` is fine - and then segfaults the
 * instant it launches a program. Measured here, and it is not this project's build:
 * it is dotnet/runtime#103741 with Samsung/netcoredbg#206.
 *
 * On musl, and ONLY on musl, CoreCLR's PAL is compiled with ENSURE_PRIMARY_STACK_SIZE,
 * so `PAL_InitializeCoreCLR` probes the stack with `_alloca(1.5 MB)`. netcoredbg calls
 * `coreclr_initialize` from `ManagedCallback::CreateProcess`, which mscordbi dispatches
 * on a thread whose stack is exactly 1.5 MB - so the probe overflows the stack it is
 * probing. The probe size and the thread size are the same constant, so no stack flag
 * fixes it (an 8 MB `-Wl,-z,stack-size` build was tried and still segfaults). The
 * runtime issue is open with milestone "Future"; the fix has to be in the caller.
 *
 * `dncdbg` is the netcoredbg maintainer's own fork, where that fix exists: the CLR is
 * initialised from the main thread instead. It is DAP-only, which is what this adapter
 * speaks anyway, and it publishes linux-musl-x64 binaries, so the image copies one in
 * rather than compiling a debugger.
 *
 * ## Why stdio is safe here
 *
 * DAP is on this process's pipe to the debugger, and the debuggee's own output arrives
 * as `output` EVENTS rather than being written to that pipe directly - verified
 * against a real session. netcoredbg let the debuggee inherit the protocol stream,
 * which deadlocked the framer at the program's first `Console.WriteLine`; dncdbg does
 * not, which is what makes stdio usable and avoids opening a port at all.
 */
const debugger_ = spawn(DEBUGGER_BIN, [], {
  cwd: workspaceRoot,
  stdio: ['pipe', 'pipe', 'pipe'],
});

// The DEBUGGER's own stderr, not the program's. Diagnostics belong in the log.
debugger_.stderr.on('data', chunk => {
  process.stderr.write(`csharp debug adapter: ${chunk}`);
});

const connection = new DapConnection(debugger_.stdin, debugger_.stdout);

let exitCode = 0;
let finished = false;

/**
 * End the session, and do not leave a zombie behind.
 *
 * The obvious teardown - kill the debugger, then exit on a short timer - leaks a
 * process every single debug run. Node reaps its own children, but only while it is
 * alive: exiting immediately after `kill()` reparents the dying debugger to PID 1,
 * which in this image is the server itself, and a Node process is not an init and
 * does not reap strangers. Measured: one `[dncdbg]` zombie per C# debug run, none for
 * an ordinary run.
 *
 * That is not cosmetic. The production compose sets `pids_limit: 512`, so a
 * long-running replica accumulating one dead PID per debug session eventually cannot
 * fork at all - and the first symptom is every language failing to run, not
 * debugging.
 *
 * So: ask it to stop, WAIT for it, and only then exit. The wait is bounded, because a
 * debugger that will not die must not hold the job open either - and if that bound is
 * ever hit, the container's init reaps what is left (`init: true` in compose).
 */
function finish() {
  if (finished) return;
  finished = true;
  if (!channelClosed) {
    channelClosed = true;
    try { channel.end(); } catch { /* already gone */ }
  }

  const leave = () => process.exit(exitCode);

  if (debugger_.exitCode !== null || debugger_.signalCode !== null) {
    setTimeout(leave, 50);
    return;
  }

  const giveUp = setTimeout(leave, 2000);
  debugger_.once('exit', () => {
    clearTimeout(giveUp);
    setTimeout(leave, 50);
  });
  try { debugger_.kill(); } catch { /* already gone */ }
}

debugger_.on('exit', () => {
  // If the debugger dies without ever reporting the program's fate, the run still has
  // to end - otherwise the IDE waits on a session that no longer exists.
  if (!finished) {
    send({ type: 'terminated', exitCode });
    finish();
  }
});

// ── State ───────────────────────────────────────────────────────────────────

/** Breakpoints the IDE asked for: absolute source path -> lines. */
let wanted = new Map();
/** The conditions for those breakpoints: absolute path -> line -> expression. */
let wantedConditions = new Map();
/** The thread the program is stopped on, and the frame a watch resolves against. */
let pausedThread = null;
let pausedFrame = null;

let markBreakpointsReceived = () => {};
const firstBreakpointsCommand = Promise.race([
  new Promise(resolve => { markBreakpointsReceived = resolve; }),
  new Promise(resolve => setTimeout(resolve, FIRST_BREAKPOINTS_WAIT_MS)),
]);

// ── Program output ──────────────────────────────────────────────────────────

/*
 * The program's stdout arrives as DAP events, not down a pipe.
 *
 * The debugger owns the debuggee's console and republishes it as `output` events, so
 * this process's own stdout is the only place it can go - and it must go there
 * unmodified, because the run pipeline treats this process's stdout AS the program's.
 */

/**
 * Remarks the debugger makes about symbols, which are not the program's output.
 *
 * These arrive on the `stderr` category alongside the program's real stderr, so they
 * cannot be filtered by category. A student compiling a plain console program has done
 * nothing wrong and must not be shown "Could not load state machine method info from
 * PDB file" as if their code produced it.
 */
const DEBUGGER_CHATTER = [
  /^Could not load state machine method info from PDB file\.?$/,
  /^Symbols not found\.?$/,
  /^Loaded '.*'\. Symbols? (loaded|not found)\.?$/,
];

function isDebuggerChatter(line) {
  const trimmed = line.trim();
  return trimmed !== '' && DEBUGGER_CHATTER.some(pattern => pattern.test(trimmed));
}

connection.on('output', body => {
  const text = String(body?.output ?? '');
  if (!text) return;

  if (body.category === 'stderr') {
    const kept = text
      .split(/(?<=\n)/)
      .filter(line => !isDebuggerChatter(line))
      .join('');
    if (kept) process.stderr.write(kept);
    return;
  }

  // `console` is the debugger talking about itself; only the program's own streams
  // reach the student.
  if (body.category === 'stdout' || body.category === undefined) process.stdout.write(text);
});

/*
 * A breakpoint that resolves later.
 *
 * The debugger answers `setBreakpoints` before the program exists, with
 * `verified: false` and "The breakpoint is pending and will be resolved when
 * debugging starts". Treating that as "not armed" reported every breakpoint as
 * rejected - the margin showed nothing and the program then stopped anyway, which is
 * the most confusing pair of behaviours available.
 *
 * So pending counts as armed, and the `breakpoint` event that arrives when the module
 * loads is what corrects the answer if it turns out it could not bind.
 */
connection.on('breakpoint', body => {
  const breakpoint = body?.breakpoint;
  if (!breakpoint || body.reason !== 'changed') return;

  const known = breakpointsById.get(breakpoint.id);
  if (!known) return;
  if (breakpoint.verified === false) {
    known.rejected = true;
    republishBreakpoints();
  } else if (known.rejected) {
    known.rejected = false;
    republishBreakpoints();
  }
});

// ── Values ──────────────────────────────────────────────────────────────────

/**
 * One DAP variable, rendered the way the variables panel expects.
 *
 * The debugger has already formatted the value - `"hello"`, `42`, `int[3]`,
 * `{Person}` - so this is a shape conversion rather than a rendering. The one thing
 * worth doing is capping it: a collection with ten thousand entries has a value string
 * to match, and the panel is a panel.
 */
function describe(variable) {
  const raw = String(variable?.value ?? '');
  const text = raw.length > MAX_VALUE_CHARS ? `${raw.slice(0, MAX_VALUE_CHARS)}…` : raw;
  const type = variable?.type ? String(variable.type) : 'unknown';
  return raw.length > MAX_VALUE_CHARS ? { text, type, length: raw.length } : { text, type };
}

/** The locals of one frame, one level deep. */
async function localsOf(frameId) {
  const scopes = await connection.request('scopes', { frameId });
  if (!scopes.success) return [];

  const locals = [];
  for (const scope of scopes.body?.scopes ?? []) {
    // Only the frame's own variables. `Static members` and the like are a different
    // question, and expanding everything on every stop is what makes a debugger slow.
    if (!/local|argument/i.test(scope.name ?? '')) continue;
    if (!scope.variablesReference) continue;

    const variables = await connection.request('variables', {
      variablesReference: scope.variablesReference,
    });
    if (!variables.success) continue;

    for (const variable of variables.body?.variables ?? []) {
      locals.push({ name: String(variable.name ?? '?'), value: describe(variable) });
    }
  }
  return locals;
}

// ── Stopping ────────────────────────────────────────────────────────────────

const STOP_REASONS = new Set(['step', 'breakpoint', 'exception', 'pause', 'entry']);

async function reportStop(body) {
  const threadId = body?.threadId;
  if (threadId === undefined) return;
  pausedThread = threadId;

  const trace = await connection.request('stackTrace', {
    threadId,
    startFrame: 0,
    levels: MAX_STACK,
  });
  if (!trace.success) return;

  const rawFrames = trace.body?.stackFrames ?? [];
  if (rawFrames.length === 0) return;

  const described = rawFrames.map(frame => ({
    id: frame.id,
    name: String(frame.name ?? '(method)'),
    // Null for anything the student did not write - a frame inside the base class
    // library, which they cannot open and do not need to see.
    file: workspaceRelative(workspaceRoot, frame.source?.path ?? ''),
    line: Number(frame.line ?? 0),
  }));

  const own = described.filter(frame => frame.file !== null && frame.file !== '');
  const shown = own.length > 0 ? own : described;
  pausedFrame = shown[0].id;

  const reason = STOP_REASONS.has(body.reason) ? body.reason : 'breakpoint';

  send({
    type: 'stopped',
    // DAP calls the first stop "entry"; the IDE's vocabulary has no such reason and
    // a student sees it as a step, which is what it looks like.
    reason: reason === 'entry' ? 'step' : reason,
    file: shown[0].file ?? 'unknown',
    line: shown[0].line,
    stack: shown.map(frame => ({
      name: frame.name,
      file: frame.file ?? 'unknown',
      line: frame.line,
    })),
    locals: await localsOf(shown[0].id),
    globals: [],
  });
}

connection.on('stopped', body => {
  reportStop(body).catch(error => {
    process.stderr.write(`csharp debug adapter: reporting a stop failed - ${error?.stack || error}\n`);
  });
});

connection.on('exited', body => {
  const code = Number(body?.exitCode);
  exitCode = Number.isFinite(code) ? code : 0;
});

connection.on('terminated', () => {
  send({ type: 'terminated', exitCode });
  finish();
});

// ── Breakpoints ─────────────────────────────────────────────────────────────

/**
 * Arm every wanted breakpoint and report what took.
 *
 * DAP's `setBreakpoints` REPLACES the whole set for one source, so a file that used to
 * have breakpoints and no longer does must still be sent - with an empty list - or its
 * old ones stay armed. `armedFiles` is what remembers that.
 */
let armedFiles = new Set();
/** Breakpoint id -> where it is and whether the debugger later rejected it. */
const breakpointsById = new Map();

/** Send the current picture of what is armed, after the debugger changed its mind. */
function republishBreakpoints() {
  const byFile = {};
  for (const record of breakpointsById.values()) {
    if (record.rejected) continue;
    (byFile[record.file] ??= []).push(record.line);
  }
  for (const lines of Object.values(byFile)) lines.sort((a, b) => a - b);

  send({ type: 'breakpoints', lines: byFile[ENTRY] ?? [], files: byFile });
}

async function applyBreakpoints() {
  breakpointsById.clear();
  const nowArmed = new Set();

  for (const [absolute, lines] of wanted) {
    const relative = workspaceRelative(workspaceRoot, absolute) ?? path.basename(absolute);

    /*
     * Conditions go to the debugger, which compiles and evaluates them itself.
     *
     * DAP's `SourceBreakpoint` carries a `condition`, and the initialize response
     * reports `supportsConditionalBreakpoints: true` - so a loop with a condition on
     * it never round-trips to this process. Evaluating here instead would mean a stop
     * and a resume per iteration.
     */
    const forFile = wantedConditions.get(absolute) ?? {};

    const reply = await connection.request('setBreakpoints', {
      source: { path: absolute, name: path.basename(absolute) },
      breakpoints: lines.map(line => (
        forFile[line] ? { line, condition: forFile[line] } : { line }
      )),
      lines,
    });
    if (!reply.success) continue;

    (reply.body?.breakpoints ?? []).forEach((breakpoint, index) => {
      const line = Number(breakpoint.line ?? lines[index]);
      if (!Number.isInteger(line)) return;
      // Pending is armed. See the `breakpoint` event handler above for why.
      breakpointsById.set(breakpoint.id ?? `${relative}:${line}`, {
        file: relative,
        line,
        rejected: false,
      });
      nowArmed.add(absolute);
    });
  }

  // Clear the files that had breakpoints a moment ago and do not now: DAP's
  // `setBreakpoints` REPLACES the set for one source, so a file that is no longer
  // mentioned keeps whatever it had unless it is explicitly emptied.
  for (const absolute of armedFiles) {
    if (wanted.has(absolute)) continue;
    await connection.request('setBreakpoints', {
      source: { path: absolute, name: path.basename(absolute) },
      breakpoints: [],
      lines: [],
    });
  }
  armedFiles = nowArmed;

  republishBreakpoints();
}

// ── Watch expressions ───────────────────────────────────────────────────────

async function evaluateExpression(expression) {
  const text = String(expression ?? '').trim();
  if (!text) return { error: 'Nothing to evaluate' };
  if (pausedFrame === null) return { error: 'The program is not paused' };

  const reply = await connection.request('evaluate', {
    expression: text,
    frameId: pausedFrame,
    context: 'watch',
  });

  if (!reply.success) {
    // The debugger puts the compiler's own complaint here, which is more useful than
    // anything this adapter could invent.
    return { error: String(reply.message || 'That expression could not be evaluated') };
  }

  return {
    value: describe({ value: reply.body?.result, type: reply.body?.type }),
  };
}

// ── The IDE's commands ──────────────────────────────────────────────────────

/** DAP's stepping commands all need the thread and all behave the same way. */
async function step(command) {
  if (pausedThread === null) return;
  const threadId = pausedThread;
  pausedThread = null;
  pausedFrame = null;
  await connection.request(command, { threadId });
}

async function handleCommand(command) {
  switch (command?.command) {
    case 'setBreakpoints': {
      wanted = new Map();
      wantedConditions = new Map();

      const add = (absolute, lines, forFile) => {
        if (!absolute || !Array.isArray(lines)) return;
        const valid = lines.filter(line => Number.isInteger(line) && line > 0);
        if (valid.length === 0) return;
        wanted.set(absolute, [...(wanted.get(absolute) ?? []), ...valid]);

        // Resolved to the same absolute path as the lines they belong to, so the
        // two cannot disagree about which file a relative path meant.
        for (const [line, expression] of Object.entries(forFile ?? {})) {
          const at = Number(line);
          if (!Number.isInteger(at)) continue;
          const existing = wantedConditions.get(absolute) ?? {};
          existing[at] = expression;
          wantedConditions.set(absolute, existing);
        }
      };

      // `lines` still means the entry file; `files` is the multi-file form. The
      // empty-string key in `conditions` means the entry file too.
      const conditions = command.conditions ?? {};
      add(resolveInWorkspace(workspaceRoot, ENTRY), command.lines, conditions['']);
      for (const [file, lines] of Object.entries(command.files ?? {})) {
        add(resolveInWorkspace(workspaceRoot, file), lines, conditions[file]);
      }

      await applyBreakpoints();
      markBreakpointsReceived();
      return;
    }

    case 'continue': {
      if (pausedThread === null) return;
      const threadId = pausedThread;
      pausedThread = null;
      pausedFrame = null;
      await connection.request('continue', { threadId });
      return;
    }

    case 'next':
      await step('next');
      return;

    case 'stepIn':
      await step('stepIn');
      return;

    case 'stepOut':
      await step('stepOut');
      return;

    case 'evaluate': {
      const expression = String(command.expression ?? '');
      send({ type: 'evaluated', expression, ...(await evaluateExpression(expression)) });
      return;
    }

    case 'stop':
      await connection.request('terminate', {});
      // A debugger that will not stop must not keep the job alive.
      setTimeout(() => { try { debugger_.kill(); } catch { /* gone */ } }, 500);
      return;

    default:
      send({ type: 'error', message: `unknown command: ${command?.command}` });
  }
}

/*
 * One command at a time, in order.
 *
 * A student who clicks Step twice quickly sends two commands before the first stop
 * comes back, and `pausedThread` is read and cleared around each one. Serialising the
 * handler keeps that consistent; DAP itself would happily interleave them.
 */
/*
 * ...and they are held until the debugger is configurable.
 *
 * `hello` is what makes the server report `debug:attached`, and a client reacts to
 * that by sending `setBreakpoints` at once - but `hello` goes out when the socket to
 * the IDE opens, before `initialize` has even been sent. DAP will not accept
 * breakpoints until the `initialized` event, so a command arriving in that window has
 * nowhere to go, and dropping it means nothing is armed and the program runs straight
 * past the student's breakpoint.
 */
let markReady = () => {};
const ready = new Promise(resolve => { markReady = resolve; });
let handling = ready;

channel.on('data', chunk => {
  channelBuffer += chunk.toString('utf8');
  let index;
  while ((index = channelBuffer.indexOf('\n')) !== -1) {
    const line = channelBuffer.slice(0, index);
    channelBuffer = channelBuffer.slice(index + 1);
    if (!line.trim()) continue;

    let command;
    try {
      command = JSON.parse(line);
    } catch {
      continue;
    }

    handling = handling
      .then(() => handleCommand(command), () => handleCommand(command))
      .catch(error => {
        process.stderr.write(`csharp debug adapter: ${error?.stack || error}\n`);
      });
  }
});

// ── Startup ─────────────────────────────────────────────────────────────────

const initialized = connection.waitForEvent('initialized', 30000);

await connection.request('initialize', {
  clientID: 'browser-coder',
  clientName: 'browser-coder',
  adapterID: 'coreclr',
  locale: 'en',
  linesStartAt1: true,
  columnsStartAt1: true,
  pathFormat: 'path',
  supportsVariableType: true,
  supportsRunInTerminalRequest: false,
});

/*
 * `launch` is sent BEFORE `configurationDone` and does not start the program.
 *
 * This is the part of DAP that reads backwards. The launch request tells the adapter
 * what to run and returns immediately; the program is actually started by
 * `configurationDone`. Sending them in the intuitive order - configure, then launch -
 * means the breakpoints are set against nothing, because there is no session yet.
 */
const launch = connection.request('launch', {
  name: 'browser-coder',
  type: 'coreclr',
  request: 'launch',
  program: ASSEMBLY,
  args: [],
  cwd: workspaceRoot,
  stopAtEntry: false,
  // Frames inside the base class library are noise to someone learning, and the
  // stack filter above depends on this to keep them out of stepping too.
  justMyCode: true,
  env: {},
  console: 'internalConsole',
});

await initialized;
// Anything the client already sent runs now. No `attached` frame: the server derives
// `debug:attached` from `hello`, and sending one as well made the client see the same
// event twice.
markReady();

// The one window in which breakpoints may be set. Do not waste it.
await firstBreakpointsCommand;

await connection.request('configurationDone', {});
await launch;

send({ type: 'started' });
