/**
 * The Python debug adapter's protocol, against real CPython.
 *
 * Drives `languages/python/debug_adapter.py` directly - no server, no browser - so a
 * failure points at the adapter rather than at four layers of plumbing above it.
 * The adapter is the load-bearing half of the debugger: if breakpoints, stepping or
 * variable capture are wrong here, nothing built on top can be right.
 *
 * Three bugs were found and fixed by this file while it was being written, all
 * recorded in the assertions below:
 *
 *  - `bdb` stops on the program's FIRST line by design (pdb wants that; a "Start
 *    debugging" button does not), so it never reached a breakpoint.
 *  - `bdb.set_continue` removes the trace function when no breakpoints are set,
 *    which silently disables any breakpoint added while running.
 *  - `stop_here` returns False once continuing, so `user_exception` never fires -
 *    stopping where the program broke needs post-mortem off the traceback instead.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ADAPTER = resolve(import.meta.dirname, '../../languages/python/debug_adapter.py');

/**
 * The interpreter to test against, or null.
 *
 * An honest skip beats a green run over an untested adapter - the same rule the
 * language contract tests apply.
 */
function findPython() {
  for (const candidate of [process.env.PYTHON_BIN, 'python3', 'python']) {
    if (!candidate) continue;
    const probe = spawnSync(candidate, ['-c', 'import bdb, socket; print("ok")'], {
      encoding: 'utf8',
    });
    if (probe.status === 0 && /ok/.test(probe.stdout)) return candidate;
  }
  return null;
}

const PYTHON = findPython();
const skip = PYTHON ? false : 'no python3 with bdb on this host';

/** One debug session: spawns the adapter, speaks the protocol, collects events. */
class DebugSession {
  #server;
  #socket = null;
  #child = null;
  #buffer = '';
  #events = [];
  #waiters = [];

  stdout = '';
  stderr = '';
  exited = null;

  constructor(dir, source) {
    this.dir = dir;
    this.programPath = join(dir, 'main.py');
    writeFileSync(this.programPath, source, 'utf8');
  }

  async start() {
    this.#server = net.createServer(connection => {
      this.#socket = connection;
      connection.on('data', chunk => this.#onData(chunk));
      // Killing the child in dispose() resets the connection. On Windows Node
      // reports that as an unhandled 'error' and fails the whole FILE even though
      // every assertion passed; on Linux it is silent. Teardown noise is not a
      // test result.
      connection.on('error', () => {});
    });
    this.#server.on('error', () => {});
    await new Promise(resolve => this.#server.listen(0, '127.0.0.1', resolve));

    this.#child = spawn(PYTHON, ['-u', ADAPTER], {
      env: {
        ...process.env,
        BROWSER_CODER_DEBUG_PORT: String(this.#server.address().port),
        BROWSER_CODER_DEBUG_TOKEN: 'contract-token',
        BROWSER_CODER_DEBUG_PROGRAM: this.programPath,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.#child.stdout.on('data', data => { this.stdout += data.toString('utf8'); });
    this.#child.stderr.on('data', data => { this.stderr += data.toString('utf8'); });
    this.#child.on('exit', code => { this.exited = code; });
  }

  #onData(chunk) {
    this.#buffer += chunk.toString('utf8');
    let index;
    while ((index = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      this.#events.push(event);
      const waiterIndex = this.#waiters.findIndex(waiter => waiter.type === event.type);
      if (waiterIndex !== -1) {
        const [waiter] = this.#waiters.splice(waiterIndex, 1);
        event.__taken = true;
        waiter.resolve(event);
      }
    }
  }

  send(payload) {
    this.#socket?.write(`${JSON.stringify(payload)}\n`);
  }

  waitFor(type, timeoutMs = 20000) {
    const existing = this.#events.find(event => event.type === type && !event.__taken);
    if (existing) {
      existing.__taken = true;
      return Promise.resolve(existing);
    }
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for "${type}"; saw: ${this.#events.map(e => e.type).join(', ')}`)),
        timeoutMs,
      );
      this.#waiters.push({
        type,
        resolve: event => { clearTimeout(timer); resolvePromise(event); },
      });
    });
  }

  /**
   * Wait for the process itself to exit, not just for the `terminated` event.
   *
   * They are not the same moment. `terminated` travels over the debug socket while
   * the program's stdout is still draining down a separate pipe, so asserting on
   * captured output straight after `terminated` reads a partial buffer. It passed
   * on Linux and failed on Windows, which is the usual signature of this mistake.
   */
  waitForExit(timeoutMs = 15000) {
    if (this.exited !== null) return Promise.resolve(this.exited);
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('the debugged process did not exit')), timeoutMs);
      this.#child.on('exit', code => {
        clearTimeout(timer);
        // One more turn, so the last 'data' events are delivered.
        setImmediate(() => resolvePromise(code));
      });
    });
  }

  dispose() {
    try { this.#child?.kill(); } catch { /* already gone */ }
    try { this.#server?.close(); } catch { /* already closed */ }
    try { rmSync(this.dir, { recursive: true, force: true }); } catch { /* fine */ }
  }
}

function session(source) {
  return new DebugSession(mkdtempSync(join(tmpdir(), 'bc-dbg-')), source);
}

const PROGRAM = [
  'def add(a, b):',          // 1
  '    total = a + b',       // 2
  '    return total',        // 3
  '',                        // 4
  'numbers = [1, 2, 3]',     // 5
  'name = "world"',          // 6
  'result = add(10, 32)',    // 7
  'print("result", result)', // 8
  'print("done")',           // 9
].join('\n');

describe('breakpoints, stepping and variables', { skip }, () => {
  let debug;

  before(async () => {
    debug = session(PROGRAM);
    await debug.start();
  });

  after(() => debug?.dispose());

  test('the adapter connects and identifies its session', async () => {
    const hello = await debug.waitFor('hello');
    assert.equal(hello.token, 'contract-token');
    assert.ok(hello.pid > 0);
  });

  test('breakpoints set before the program starts are accepted', async () => {
    debug.send({ command: 'setBreakpoints', lines: [7, 9] });
    const accepted = await debug.waitFor('breakpoints');
    assert.deepEqual(accepted.lines, [7, 9]);
    await debug.waitFor('started');
  });

  let firstStop;

  test('it runs to the first breakpoint, not to line 1', async () => {
    // bdb stops on the first line by design. Reaching line 7 is the fix.
    firstStop = await debug.waitFor('stopped');
    assert.equal(firstStop.line, 7);
    assert.equal(firstStop.file, 'main.py');
  });

  test('module variables assigned so far are visible', () => {
    const names = firstStop.locals.map(entry => entry.name);
    assert.ok(names.includes('numbers'), names.join(','));
    assert.ok(names.includes('name'), names.join(','));
  });

  test('a function definition is not listed as data', () => {
    // `add` is code. Listing it beside `numbers` pushes the student's real data
    // off the panel.
    assert.ok(!firstStop.locals.some(entry => entry.name === 'add'));
  });

  test('globals is empty at module level rather than duplicating locals', () => {
    // At module level f_globals IS f_locals, so reporting both lists every name
    // twice.
    assert.deepEqual(firstStop.globals, []);
  });

  test('a list is described with its length and its items', () => {
    const numbers = firstStop.locals.find(entry => entry.name === 'numbers');
    assert.equal(numbers.value.type, 'list');
    assert.equal(numbers.value.length, 3);
    assert.equal(numbers.value.children.length, 3);
    assert.equal(numbers.value.children[0].value.text, '1');
  });

  test('the call stack has one frame, named for the module', () => {
    assert.equal(firstStop.stack.length, 1);
    assert.equal(firstStop.stack[0].name, '(module)');
    assert.equal(firstStop.stack[0].line, 7);
  });

  test('an expression evaluates in the paused frame', async () => {
    debug.send({ command: 'evaluate', expression: 'len(numbers) * 2' });
    const evaluated = await debug.waitFor('evaluated');
    assert.equal(evaluated.value.text, '6');
  });

  test('a failing expression reports the error instead of killing the session', async () => {
    debug.send({ command: 'evaluate', expression: 'nope_does_not_exist' });
    const evaluated = await debug.waitFor('evaluated');
    assert.match(evaluated.error, /NameError/);
  });

  let inside;

  test('step-in enters the function and deepens the stack', async () => {
    debug.send({ command: 'stepIn' });
    inside = await debug.waitFor('stopped');
    assert.equal(inside.stack.length, 2);
    assert.equal(inside.stack[0].name, 'add');
    assert.equal(inside.stack[1].name, '(module)');
  });

  test('parameters are visible as locals', () => {
    const names = inside.locals.map(entry => entry.name);
    assert.ok(names.includes('a') && names.includes('b'), names.join(','));
  });

  test('step-over advances, and an assigned local becomes visible', async () => {
    // step-in stops on the `def` line, where the frame exists but no body line has
    // run, so reaching line 3 takes more than one step.
    let current = inside;
    for (let attempt = 0; attempt < 4 && current.line < 3; attempt += 1) {
      debug.send({ command: 'next' });
      current = await debug.waitFor('stopped');
    }
    assert.equal(current.line, 3);
    const total = current.locals.find(entry => entry.name === 'total');
    assert.equal(total.value.text, '42');
  });

  test('step-out returns to the caller', async () => {
    debug.send({ command: 'stepOut' });
    const out = await debug.waitFor('stopped');
    assert.ok(out.stack.length <= 2, JSON.stringify(out.stack));
  });

  test('continue reaches the next breakpoint with the result assigned', async () => {
    debug.send({ command: 'continue' });
    const second = await debug.waitFor('stopped');
    assert.equal(second.line, 9);
    const result = second.locals.find(entry => entry.name === 'result');
    assert.equal(result.value.text, '42');
  });

  test('the program finishes cleanly and its output is unpolluted', async () => {
    debug.send({ command: 'continue' });
    const terminated = await debug.waitFor('terminated');
    assert.equal(terminated.exitCode, 0);
    await debug.waitForExit();

    assert.match(debug.stdout, /result 42/);
    assert.match(debug.stdout, /done/);
    // The protocol must never reach the student's own streams.
    assert.doesNotMatch(debug.stdout, /"type"/);
    assert.equal(debug.stderr.trim(), '');
  });
});

describe('stopping where the program broke', { skip }, () => {
  let debug;

  before(async () => {
    debug = session([
      'def divide(a, b):',        // 1
      '    return a / b',         // 2
      '',                         // 3
      'print("before")',          // 4
      'result = divide(10, 0)',   // 5
    ].join('\n'));
    await debug.start();
    await debug.waitFor('hello');
    // Deliberately NO breakpoints: this also proves tracing survives a continue,
    // which bdb's own set_continue would have torn down.
    debug.send({ command: 'setBreakpoints', lines: [] });
    await debug.waitFor('breakpoints');
    await debug.waitFor('started');
  });

  after(() => debug?.dispose());

  // Captured once and shared: there is only ever one post-mortem stop, so a second
  // `waitFor('stopped')` would wait for an event that never arrives.
  let postMortem;

  test('an uncaught exception stops at the line that raised it', async () => {
    postMortem = await debug.waitFor('stopped');
    assert.equal(postMortem.reason, 'exception');
    assert.equal(postMortem.postMortem, true);
    // Line 2 - inside divide - not line 5 where it was called from. The deepest
    // frame that belongs to the student is where their mistake is.
    assert.equal(postMortem.line, 2);
    assert.equal(postMortem.exception.type, 'ZeroDivisionError');
    assert.match(postMortem.exception.message, /division by zero/);
  });

  test('the variables at the point of failure are still inspectable', () => {
    // The whole value of post-mortem: by the time a traceback is printed the state
    // is gone, but the traceback's frames keep it alive.
    const names = postMortem.locals.map(entry => entry.name);
    assert.ok(names.includes('a') && names.includes('b'), names.join(','));
    assert.equal(postMortem.locals.find(entry => entry.name === 'a').value.text, '10');
    assert.equal(postMortem.locals.find(entry => entry.name === 'b').value.text, '0');
  });

  test('the failing call stack is reported innermost first', () => {
    assert.equal(postMortem.stack.length, 2);
    assert.equal(postMortem.stack[0].name, 'divide');
    assert.equal(postMortem.stack[0].line, 2);
    assert.equal(postMortem.stack[1].name, '(module)');
    assert.equal(postMortem.stack[1].line, 5);
  });

  test('an expression can still be evaluated in the failed frame', async () => {
    debug.send({ command: 'evaluate', expression: 'a * 2' });
    const evaluated = await debug.waitFor('evaluated');
    assert.equal(evaluated.value.text, '20');
  });

  test('stepping a finished program is refused rather than hanging', async () => {
    debug.send({ command: 'next' });
    const error = await debug.waitFor('error');
    assert.match(error.message, /already stopped/);
  });

  test('the traceback the student sees contains none of the debugger', async () => {
    debug.send({ command: 'continue' });
    const terminated = await debug.waitFor('terminated');
    assert.equal(terminated.exitCode, 1);
    await debug.waitForExit();

    assert.doesNotMatch(debug.stderr, /debug_adapter/);
    assert.doesNotMatch(debug.stderr, /bdb\.py/);
    // Their own two frames, under the name they know the file by.
    assert.match(debug.stderr, /File "main\.py", line 5/);
    assert.match(debug.stderr, /File "main\.py", line 2/);
    assert.match(debug.stderr, /ZeroDivisionError/);
    // And no temporary job path.
    assert.doesNotMatch(debug.stderr, /bc-dbg-/);
  });
});

describe('a breakpoint added while the program runs', { skip }, () => {
  let debug;

  before(async () => {
    debug = session([
      'import time',                    // 1
      'total = 0',                      // 2
      'for index in range(3):',         // 3
      '    total = total + index',      // 4
      '    time.sleep(0.05)',           // 5
      'print("total", total)',          // 6
    ].join('\n'));
    await debug.start();
    await debug.waitFor('hello');
    debug.send({ command: 'setBreakpoints', lines: [] });
    await debug.waitFor('breakpoints');
    await debug.waitFor('started');
  });

  after(() => debug?.dispose());

  test('takes effect, because the trace function is never torn down', async () => {
    // bdb.set_continue calls sys.settrace(None) when no breakpoints exist, which
    // makes this silently impossible. Using it would have looked fine until a
    // student set a breakpoint mid-run and nothing happened.
    debug.send({ command: 'setBreakpoints', lines: [6] });
    const accepted = await debug.waitFor('breakpoints');
    assert.deepEqual(accepted.lines, [6]);

    const stopped = await debug.waitFor('stopped');
    assert.equal(stopped.line, 6);
    const total = stopped.locals.find(entry => entry.name === 'total');
    assert.equal(total.value.text, '3');
  });
});
