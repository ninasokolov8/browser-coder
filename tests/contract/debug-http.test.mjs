/**
 * Debugging over the real HTTP surface.
 *
 * The adapter's own contract test drives it directly. This one goes through
 * everything above it: the interactive route, the pipeline's channel allocation, the
 * NDJSON stream, and the control endpoints. A failure here is in the plumbing, not in
 * the debugger.
 *
 * Two properties matter beyond "it works":
 *
 *  - **The v1 surface is untouched.** A request with no `debug` flag must behave
 *    byte-identically to before, and must not receive a single `debug:` event.
 *  - **Debug frames share the run's stream.** One ordered transport, so a `stopped`
 *    event cannot overtake the output the program printed just before pausing.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from './support/server.mjs';
import { requires, requiresDebugger } from './support/toolchain.mjs';

const PROGRAM = [
  'total = 0',                 // 1
  'for index in range(3):',    // 2
  '    total += index',        // 3
  'print("total", total)',     // 4
  'print("done")',             // 5
].join('\n');

/** One streamed run, with the frames it produced and a way to send commands. */
class StreamedRun {
  events = [];
  sessionId = null;
  #waiters = [];
  #base;
  #done;

  constructor(base) {
    this.#base = base;
  }

  async start(body) {
    const response = await fetch(`${this.#base}/api/run/interactive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    assert.equal(response.ok, true, `start failed: ${response.status}`);
    assert.match(
      response.headers.get('content-type') || '',
      /application\/x-ndjson/,
      'a debug run must still be an NDJSON stream',
    );

    this.#done = (async () => {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === 'session') this.sessionId = event.sessionId;
          this.events.push(event);
          const at = this.#waiters.findIndex(waiter => waiter.type === event.type);
          if (at !== -1) {
            const [waiter] = this.#waiters.splice(at, 1);
            event.__taken = true;
            waiter.resolve(event);
          }
        }
      }
    })();

    return this;
  }

  /** Every event of a type received so far, taken or not. */
  seen(type) {
    return this.events.filter(event => event.type === type);
  }

  waitFor(type, timeoutMs = 25000) {
    const existing = this.events.find(event => event.type === type && !event.__taken);
    if (existing) {
      existing.__taken = true;
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for "${type}"; saw: ${this.events.map(e => e.type).join(', ')}`)),
        timeoutMs,
      );
      this.#waiters.push({ type, resolve: event => { clearTimeout(timer); resolve(event); } });
    });
  }

  /** Send a debug command, returning the HTTP status. */
  async debug(command, body = {}) {
    const response = await fetch(
      `${this.#base}/api/run/interactive/${this.sessionId}/debug/${command}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return response.status;
  }

  async close() {
    if (this.sessionId) {
      await fetch(`${this.#base}/api/run/interactive/${this.sessionId}/close`, { method: 'POST' })
        .catch(() => {});
    }
    await Promise.race([this.#done, new Promise(resolve => setTimeout(resolve, 3000))]);
  }
}

describe('debugging over HTTP', requires('python'), () => {
  let server;
  let base;

  before(async () => {
    server = await startServer();
    base = server.baseUrl;
  });

  after(async () => {
    await server?.stop();
  });

  test('a run with no debug flag receives no debug events at all', async () => {
    // The frozen v1 surface. A client that never asked must not see the new
    // vocabulary, or every existing consumer has to learn it.
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      code: 'print("plain")\n',
    });

    await run.waitFor('exit');
    const debugEvents = run.events.filter(event => String(event.type).startsWith('debug:'));
    assert.deepEqual(debugEvents, [], `v1 run saw: ${JSON.stringify(debugEvents)}`);

    const output = run.events.filter(event => event.type === 'stdout').map(event => event.data).join('');
    assert.match(output, /plain/);
    await run.close();
  });

  test('a debug run attaches and reports it', async () => {
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      code: PROGRAM,
      debug: true,
    });

    const attached = await run.waitFor('debug:attached');
    assert.ok(attached.pid > 0, 'no pid reported');
    const sessionAt = run.events.findIndex(event => event.type === 'session');
    const attachedAt = run.events.findIndex(event => event.type === 'debug:attached');
    assert.ok(sessionAt !== -1, 'the stream did not identify its session');
    assert.ok(
      sessionAt < attachedAt,
      `debugger attached before session ownership was established: ${run.events.map(e => e.type).join(', ')}`,
    );
    await run.close();
  });

  test('a breakpoint stops the program and reports variables', async () => {
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      code: PROGRAM,
      debug: true,
    });

    await run.waitFor('debug:attached');
    assert.equal(await run.debug('setBreakpoints', { lines: [4] }), 200);
    await run.waitFor('debug:breakpoints');

    const stopped = await run.waitFor('debug:stopped');
    assert.equal(stopped.line, 4);

    const total = (stopped.locals || []).find(entry => entry.name === 'total');
    assert.ok(total, `no locals: ${JSON.stringify(stopped.locals)}`);
    // 0 + 1 + 2 by the time line 4 runs.
    assert.equal(total.value.text, '3');

    // And the program finishes when told to continue.
    assert.equal(await run.debug('continue'), 200);
    const exit = await run.waitFor('exit');
    assert.equal(exit.exitCode, 0);
    await run.close();
  });

  test('output printed before a pause arrives before the pause', async () => {
    // Why debug frames ride the run's own stream rather than a second channel: two
    // transports cannot order events against each other, and a student would see the
    // program stop before seeing what it had just printed.
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      code: 'print("before the stop")\nx = 1\nprint("after")\n',
      debug: true,
    });

    await run.waitFor('debug:attached');
    await run.debug('setBreakpoints', { lines: [2] });
    await run.waitFor('debug:breakpoints');
    await run.waitFor('debug:stopped');

    const stdoutAt = run.events.findIndex(
      event => event.type === 'stdout' && /before the stop/.test(event.data || ''),
    );
    const stoppedAt = run.events.findIndex(event => event.type === 'debug:stopped');

    assert.ok(stdoutAt !== -1, 'the print never arrived');
    assert.ok(stdoutAt < stoppedAt, `stop (${stoppedAt}) arrived before print (${stdoutAt})`);

    await run.debug('continue');
    await run.waitFor('exit');
    await run.close();
  });

  test('stepping works over HTTP', async () => {
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      code: PROGRAM,
      debug: true,
    });

    await run.waitFor('debug:attached');
    await run.debug('setBreakpoints', { lines: [1] });
    await run.waitFor('debug:breakpoints');

    const first = await run.waitFor('debug:stopped');
    assert.equal(first.line, 1);

    assert.equal(await run.debug('next'), 200);
    const second = await run.waitFor('debug:stopped');
    assert.ok(second.line > first.line, `${first.line} -> ${second.line}`);

    await run.debug('continue');
    await run.waitFor('exit');
    await run.close();
  });

  test('evaluate runs in the paused frame', async () => {
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      code: PROGRAM,
      debug: true,
    });

    await run.waitFor('debug:attached');
    await run.debug('setBreakpoints', { lines: [4] });
    await run.waitFor('debug:stopped');

    assert.equal(await run.debug('evaluate', { expression: 'total * 10' }), 200);
    const evaluated = await run.waitFor('debug:evaluated');
    assert.equal(evaluated.value.text, '30');

    await run.debug('continue');
    await run.waitFor('exit');
    await run.close();
  });

  test('stop ends a program that is paused', async () => {
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      code: PROGRAM,
      debug: true,
    });

    await run.waitFor('debug:attached');
    await run.debug('setBreakpoints', { lines: [1] });
    await run.waitFor('debug:stopped');

    assert.equal(await run.debug('stop'), 200);
    const exit = await run.waitFor('exit');
    assert.ok(exit, 'the program never exited after stop');
    await run.close();
  });

  test('an unknown debug command is refused with 400', async () => {
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      code: PROGRAM,
      debug: true,
    });

    await run.waitFor('debug:attached');
    // Refused rather than silently dropped, and answered rather than left hanging -
    // Express 4 does not catch a rejection from an async handler, so an unwrapped
    // throw in the command path would have hung the request instead.
    assert.equal(await run.debug('exec', { expression: 'anything' }), 400);
    assert.equal(await run.debug('__proto__'), 400);

    await run.debug('continue');
    await run.close();
  });

  test('an empty evaluate expression is refused', async () => {
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      code: PROGRAM,
      debug: true,
    });

    await run.waitFor('debug:attached');
    assert.equal(await run.debug('evaluate', { expression: '' }), 400);
    await run.debug('continue');
    await run.close();
  });

  test('a debug command for an unknown session is 410', async () => {
    const response = await fetch(
      `${base}/api/run/interactive/not-a-real-session/debug/continue`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    // Indistinguishable from an expired session by design, so the endpoint reveals
    // nothing about what exists.
    assert.equal(response.status, 410);
  });

  test('a debug command on a non-debug session is refused, not ignored', async () => {
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      // Blocks on input, so the session is still alive when the command arrives.
      code: 'value = input("give me: ")\nprint(value)\n',
    });

    await run.waitFor('session');
    // 409: the session exists but has no debugger. Silently accepting would let a UI
    // show a breakpoint as armed when nothing is listening.
    assert.equal(await run.debug('continue'), 409);
    await run.close();
  });
});

/**
 * The same surface, in JavaScript.
 *
 * The point of this suite is that the DEBUGGER is a language-neutral contract: the
 * client's state machine, glyph margin and variables panel are written against
 * `attached` / `breakpoints` / `stopped` / `terminated`, not against Python. So the
 * assertions here are deliberately the same ones, against a different runtime and an
 * entirely different mechanism - V8's inspector attached from a worker thread, rather
 * than a `bdb` trace hook.
 */
describe('debugging JavaScript over HTTP', requires('javascript'), () => {
  let server;
  let base;

  const PROGRAM = [
    'let total = 0;',              // 1
    'for (let i = 0; i < 3; i++) {', // 2
    '  total += i;',               // 3
    '}',                           // 4
    'console.log("total", total);', // 5
    'console.log("done");',        // 6
  ].join('\n');

  before(async () => {
    server = await startServer();
    base = server.baseUrl;
  });

  after(async () => {
    await server?.stop();
  });

  test('a JavaScript run with no debug flag receives no debug events', async () => {
    const run = await new StreamedRun(base).start({
      language: 'javascript',
      version: 'es2022',
      code: 'console.log("plain");\n',
    });

    await run.waitFor('exit');
    const debugEvents = run.events.filter(event => String(event.type).startsWith('debug:'));
    assert.deepEqual(debugEvents, [], `v1 run saw: ${JSON.stringify(debugEvents)}`);
    await run.close();
  });

  test('the debugger attaches', async () => {
    const run = await new StreamedRun(base).start({
      language: 'javascript',
      version: 'es2022',
      code: PROGRAM,
      debug: true,
    });

    const attached = await run.waitFor('debug:attached');
    assert.ok(attached.pid > 0, 'no pid reported');
    assert.ok(
      run.events.findIndex(event => event.type === 'session')
        < run.events.findIndex(event => event.type === 'debug:attached'),
      `debugger attached before session ownership: ${run.events.map(e => e.type).join(', ')}`,
    );
    await run.debug('continue');
    await run.close();
  });

  test('a breakpoint stops the program and reports its variables', async () => {
    const run = await new StreamedRun(base).start({
      language: 'javascript',
      version: 'es2022',
      code: PROGRAM,
      debug: true,
    });

    await run.waitFor('debug:attached');
    assert.equal(await run.debug('setBreakpoints', { lines: [5] }), 200);
    await run.waitFor('debug:breakpoints');

    const stopped = await run.waitFor('debug:stopped');
    assert.equal(stopped.line, 5);
    assert.equal(stopped.file, 'main.mjs');

    const named = [...(stopped.locals || []), ...(stopped.globals || [])];
    const total = named.find(entry => entry.name === 'total');
    assert.ok(total, `no variable named total: ${JSON.stringify(named.map(e => e.name))}`);
    // 0 + 1 + 2 by the time line 5 runs.
    assert.equal(total.value.text, '3');

    assert.equal(await run.debug('continue'), 200);
    const exit = await run.waitFor('exit');
    assert.equal(exit.exitCode, 0);
    await run.close();
  });

  test('output printed before a pause arrives before the pause', async () => {
    const run = await new StreamedRun(base).start({
      language: 'javascript',
      version: 'es2022',
      code: 'console.log("before the stop");\nlet x = 1;\nconsole.log("after");\n',
      debug: true,
    });

    await run.waitFor('debug:attached');
    await run.debug('setBreakpoints', { lines: [2] });
    await run.waitFor('debug:breakpoints');
    await run.waitFor('debug:stopped');

    const stdoutAt = run.events.findIndex(
      event => event.type === 'stdout' && /before the stop/.test(event.data || ''),
    );
    const stoppedAt = run.events.findIndex(event => event.type === 'debug:stopped');

    assert.ok(stdoutAt !== -1, 'the print never arrived');
    assert.ok(stdoutAt < stoppedAt, `stop (${stoppedAt}) arrived before print (${stdoutAt})`);

    await run.debug('continue');
    await run.close();
  });

  test('step over advances one line', async () => {
    const run = await new StreamedRun(base).start({
      language: 'javascript',
      version: 'es2022',
      code: PROGRAM,
      debug: true,
    });

    await run.waitFor('debug:attached');
    await run.debug('setBreakpoints', { lines: [5] });
    await run.waitFor('debug:breakpoints');
    const first = await run.waitFor('debug:stopped');
    assert.equal(first.line, 5);

    assert.equal(await run.debug('next'), 200);
    const second = await run.waitFor('debug:stopped');
    assert.equal(second.line, 6, 'step over did not advance to the next line');

    await run.debug('continue');
    await run.close();
  });

  test('a program that dies reports where it died, before it reports the end', async () => {
    /*
     * One outcome, two mechanisms, and the difference is the Node version.
     *
     * The program is loaded with a dynamic `import()`, so a throw at module top level
     * rejects the loader's promise rather than propagating as a plain uncaught throw:
     *
     *   - Node 20 (what the production image runs) pauses, with V8 reporting
     *     `reason: "promiseRejection"`. A live pause, frames intact.
     *   - Node 22 (a common development machine) does not pause at all, so the
     *     adapter reconstructs the stop from the error after the fact - the same
     *     thing Python does by walking a traceback - and marks it `postMortem`.
     *
     * This test asserts what must be true on BOTH, because both are shipped. It used
     * to assert `postMortem: true` unconditionally, which passed on the development
     * machine and failed in the production image - and the failure was real: the
     * promiseRejection pause was falling through to "step", so a student on
     * production whose program threw saw the debugger stop on a line with no reason
     * given and no error anywhere.
     */
    const run = await new StreamedRun(base).start({
      language: 'javascript',
      version: 'es2022',
      code: 'const a = 1;\nthrow new RangeError("out of range");\n',
      debug: true,
    });

    await run.waitFor('debug:attached');
    const stopped = await run.waitFor('debug:stopped');
    assert.equal(stopped.reason, 'exception');
    assert.equal(stopped.exception?.type, 'RangeError');
    assert.match(stopped.exception?.message ?? '', /out of range/);
    // Line 2 is the throw - from the stack on the post-mortem path, from the pause
    // location on the live one - so this catches a regression in either.
    assert.equal(stopped.line, 2);
    assert.equal(stopped.file, 'main.mjs');

    const exit = await run.waitFor('exit');
    assert.equal(exit.exitCode, 1);

    // Checked once the run is over, so a second stop would have had time to arrive:
    // whichever path produced it, ONE error is reported ONCE. Both firing would show
    // the student the same failure twice, the second time with no variables.
    assert.equal(run.seen('debug:stopped').length, 1);
    await run.close();
  });

  test('the debug flag does not get a program past source validation', async () => {
    // The first line of defence is the static filter, and it must not have a hole in
    // the shape of `debug: true`. A JavaScript program may not reach `fs` at all -
    // which is also why the language-level guard behind it (fs_guard.mjs, replacing
    // the permission model the inspector cannot coexist with) is defence in depth
    // rather than the defence, and is tested directly in tests/unit/js-fs-guard.
    const response = await fetch(`${base}/api/run/interactive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'javascript',
        version: 'es2022',
        code: 'import fs from "node:fs";\nconsole.log(fs.readFileSync("/etc/passwd", "utf8"));\n',
        debug: true,
      }),
    });

    assert.equal(response.status, 403, 'a debug run bypassed the source filter');
    await response.body?.cancel();
  });
});

/**
 * A breakpoint in a file the program IMPORTS.
 *
 * The adapters could always stop in any workspace file - bdb and V8 both allow it, and
 * the Python adapter's `is_our_file` has always accepted the whole job directory. Only
 * the breakpoint-setting call was hardcoded to the entry file, so a student could put a
 * mark on a line in a module they wrote and the program would run straight past it.
 *
 * The wire had the same limit: `setBreakpoints` carried bare line numbers with no way
 * to say which file they belonged to.
 */
describe('breakpoints in more than one file', () => {
  let server;
  let base;

  before(async () => {
    server = await startServer();
    base = server.baseUrl;
  });

  after(async () => {
    await server?.stop();
  });

  test('python stops inside an imported module', requires('python'), async () => {
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      files: [
        {
          path: 'main.py',
          content: ['from helper import twice', 'print(twice(4))', 'print("done")'].join('\n'),
          isMain: true,
        },
        {
          path: 'helper.py',
          content: ['def twice(n):', '    doubled = n * 2', '    return doubled'].join('\n'),
        },
      ],
      entryPoint: 'main.py',
      debug: true,
    });

    await run.waitFor('debug:attached');

    // Line 3 of helper.py - `return doubled` - which the entry file cannot name.
    assert.equal(
      await run.debug('setBreakpoints', { lines: [], files: { 'helper.py': [3] } }),
      200,
    );
    const armed = await run.waitFor('debug:breakpoints');
    assert.deepEqual(armed.files?.['helper.py'], [3], JSON.stringify(armed));

    const stopped = await run.waitFor('debug:stopped');
    assert.equal(stopped.file, 'helper.py', 'stopped in the wrong file');
    assert.equal(stopped.line, 3);

    // And the local from the imported module is reported, not the caller's.
    const doubled = (stopped.locals || []).find(entry => entry.name === 'doubled');
    assert.ok(doubled, `no 'doubled' local: ${JSON.stringify(stopped.locals)}`);
    assert.equal(doubled.value.text, '8');

    await run.debug('continue');
    const exit = await run.waitFor('exit');
    assert.equal(exit.exitCode, 0);
    await run.close();
  });

  /*
   * A project that CONTAINS a turtle file is not a project that DRAWS.
   *
   * The turtle shim is injected whenever any .py file in the upload imports turtle,
   * because a helper module may be the one drawing. That made "the shim is loaded"
   * the only fact anything downstream had, and the shim answered every request for a
   * snapshot with a description of its untouched canvas - so debugging a file with no
   * turtle code in it attached a drawing to every pause, and the IDE opened a blank
   * 600x600 window and left it there for the rest of the session.
   *
   * Asserted over HTTP rather than against the shim alone because the whole point is
   * that the entry file and the file that mentions turtle are different files, which
   * only the real upload path can express.
   */
  test('a pause in a file that does not draw carries no drawing', requires('python'), async () => {
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      files: [
        {
          path: 'main.py',
          content: ['x = 10', 'for index in range(3):', '    x += 1', 'print(x)'].join('\n'),
          isMain: true,
        },
        // Never imported by main.py, and never run. Its mere presence is what used to
        // be enough, because the shim is injected for the whole project.
        {
          path: 'drawing.py',
          content: ['import turtle', 'def draw():', '    turtle.forward(50)'].join('\n'),
        },
      ],
      entryPoint: 'main.py',
      debug: true,
    });

    await run.waitFor('debug:attached');
    assert.equal(await run.debug('setBreakpoints', { lines: [3] }), 200);
    await run.waitFor('debug:breakpoints');

    /*
     * `x += 1` is inside `for index in range(3)`, so it pauses three times.
     *
     * Deliberately a loop rather than a single stop on the line after it: the bug was
     * reported against a loop, and the window appeared on the FIRST pause and stayed
     * for every one after it. Checking each pause is therefore the report's own shape.
     *
     * Every pause needs its own continue. Sending one and then waiting for `exit`
     * leaves the program suspended on the second iteration for the rest of the
     * timeout, which is exactly how the first version of this test failed.
     */
    const PAUSES = 3;
    for (let pause = 1; pause <= PAUSES; pause += 1) {
      const stopped = await run.waitFor('debug:stopped');
      assert.equal(stopped.line, 3, `pause ${pause} stopped on the wrong line`);
      assert.equal(
        stopped.turtleData,
        undefined,
        `pause ${pause} of a program with no turtle code got a drawing: `
        + JSON.stringify(stopped.turtleData),
      );
      assert.equal(await run.debug('continue'), 200, `continue ${pause} was refused`);
    }

    const exit = await run.waitFor('exit');
    assert.equal(exit.exitCode, 0);

    // And the finished run carries none either, so an ordinary Run of the same project
    // does not open the window at the end instead of at the first pause.
    assert.equal(
      exit.turtleData ?? null,
      null,
      `the finished run carried a drawing: ${JSON.stringify(exit.turtleData)}`,
    );
    await run.close();
  });

  /*
   * The other half of the same rule: a file that DOES draw still gets its drawing, so
   * the fix above cannot have been "stop sending turtle data".
   */
  test('a pause in a file that draws still carries the drawing', requires('python'), async () => {
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      files: [
        {
          path: 'main.py',
          content: [
            'import turtle',       // 1
            't = turtle.Turtle()', // 2
            't.forward(50)',       // 3
            'print("done")',       // 4
          ].join('\n'),
          isMain: true,
        },
      ],
      entryPoint: 'main.py',
      debug: true,
    });

    await run.waitFor('debug:attached');
    assert.equal(await run.debug('setBreakpoints', { lines: [4] }), 200);
    await run.waitFor('debug:breakpoints');

    const stopped = await run.waitFor('debug:stopped');
    assert.equal(stopped.line, 4);
    assert.ok(stopped.turtleData, 'a turtle program was given no drawing at its pause');
    assert.ok(
      (stopped.turtleData.shapes?.length ?? 0) > 0
      || (stopped.turtleData.cursors?.length ?? 0) > 0,
      `the drawing was empty: ${JSON.stringify(stopped.turtleData)}`,
    );

    await run.debug('continue');
    const exit = await run.waitFor('exit');
    assert.equal(exit.exitCode, 0);
    await run.close();
  });

  test('javascript stops inside an imported module', requires('javascript'), async () => {
    const run = await new StreamedRun(base).start({
      language: 'javascript',
      version: 'es2022',
      files: [
        {
          path: 'main.mjs',
          content: ['import { twice } from "./helper.mjs";', 'console.log(twice(4));'].join('\n'),
          isMain: true,
        },
        {
          path: 'helper.mjs',
          content: ['export function twice(n) {', '  const doubled = n * 2;', '  return doubled;', '}'].join('\n'),
        },
      ],
      entryPoint: 'main.mjs',
      debug: true,
    });

    await run.waitFor('debug:attached');

    assert.equal(
      await run.debug('setBreakpoints', { lines: [], files: { 'helper.mjs': [3] } }),
      200,
    );
    await run.waitFor('debug:breakpoints');

    const stopped = await run.waitFor('debug:stopped');
    assert.equal(stopped.file, 'helper.mjs', 'stopped in the wrong file');
    assert.equal(stopped.line, 3);

    await run.debug('continue');
    const exit = await run.waitFor('exit');
    assert.equal(exit.exitCode, 0);
    await run.close();
  });

  test('a path that escapes the job is refused, not armed', requires('python'), async () => {
    // The server validates it with the same rule a run payload goes through, and the
    // adapter checks again before opening anything - a value that arrived over a socket
    // is not something to trust on someone else's word.
    const run = await new StreamedRun(base).start({
      language: 'python',
      version: 'python3',
      code: 'print("safe")\n',
      debug: true,
    });

    await run.waitFor('debug:attached');
    assert.equal(
      await run.debug('setBreakpoints', { lines: [], files: { '../../escape.py': [1] } }),
      200,
    );

    const armed = await run.waitFor('debug:breakpoints');
    assert.deepEqual(armed.files ?? {}, {}, `a traversal was armed: ${JSON.stringify(armed)}`);

    await run.debug('continue');
    await run.waitFor('exit');
    await run.close();
  });
});

/**
 * Debugging TypeScript, which is not the language that runs.
 *
 * It was excluded from the debuggable set for a real reason: it is compiled to
 * JavaScript first, so a breakpoint on a `.ts` line armed against the emitted `.js`
 * would stop somewhere the student did not click. The compiler now emits a source map
 * for a debug run and the JavaScript debugger uses it in BOTH directions.
 *
 * The assertion that matters is the round trip: the stop must be reported at the line
 * of the `.ts` file, not of the `.js` nobody can see.
 */
describe('debugging TypeScript', requires('typescript'), () => {
  let server;
  let base;

  before(async () => {
    server = await startServer();
    base = server.baseUrl;
  });

  after(async () => {
    await server?.stop();
  });

  test('a .ts breakpoint stops at the .ts line', async () => {
    const run = await new StreamedRun(base).start({
      language: 'typescript',
      version: 'ts5',
      // Blank lines and a comment on purpose: the emitted JavaScript does NOT line up
      // with the source, which is the whole reason a map is needed. A naive
      // implementation that passed the line straight through would stop on the wrong
      // one here.
      code: [
        'interface Point { x: number; y: number }', // 1 - erased entirely
        '',                                          // 2
        '// a comment',                              // 3
        'const corner: Point = { x: 1, y: 2 };',     // 4
        'const total: number = corner.x + corner.y;',// 5
        'console.log(total);',                       // 6
      ].join('\n'),
      debug: true,
    });

    await run.waitFor('debug:attached');
    assert.equal(await run.debug('setBreakpoints', { files: { 'main.ts': [6] } }), 200);

    const armed = await run.waitFor('debug:breakpoints');
    assert.deepEqual(armed.files?.['main.ts'], [6], `armed in the wrong file: ${JSON.stringify(armed)}`);

    const stopped = await run.waitFor('debug:stopped');
    assert.equal(stopped.file, 'main.ts', 'reported the emitted .js instead of the source');
    assert.equal(stopped.line, 6, 'stopped at the wrong .ts line');

    // And the variable computed on the line above is there with its value.
    const named = [...(stopped.locals || []), ...(stopped.globals || [])];
    const total = named.find(entry => entry.name === 'total');
    assert.ok(total, `no 'total': ${JSON.stringify(named.map(entry => entry.name))}`);
    assert.equal(total.value.text, '3');

    await run.debug('continue');
    const exit = await run.waitFor('exit');
    assert.equal(exit.exitCode, 0);
    await run.close();
  });

  test('an ordinary TypeScript run still emits no debug events', async () => {
    // The map is emitted only for a debug run, and the v1 surface is untouched.
    const run = await new StreamedRun(base).start({
      language: 'typescript',
      version: 'ts5',
      code: 'const message: string = "plain";\nconsole.log(message);\n',
    });

    await run.waitFor('exit');
    const debugEvents = run.events.filter(event => String(event.type).startsWith('debug:'));
    assert.deepEqual(debugEvents, [], JSON.stringify(debugEvents));
    await run.close();
  });
});

/**
 * A compile failure on a DEBUG run must not take the server down.
 *
 * It did. The route sent a `debug:unsupported` notice before the response headers were
 * written; `send()` calls `res.write()`, and writing before `writeHead` makes Node
 * commit default headers. The compile-diagnostics branch then called `res.json()`,
 * which threw ERR_HTTP_HEADERS_SENT from an async continuation where Express cannot
 * catch it - and an uncaught exception ends the process, along with every other
 * student's run on it.
 *
 * Reaching it took nothing exotic: a student clicking Debug on a program that does not
 * compile.
 */
describe('a debug run that does not compile', requires('typescript'), () => {
  let server;
  let base;

  before(async () => {
    server = await startServer();
    base = server.baseUrl;
  });

  after(async () => {
    await server?.stop();
  });

  test('answers with the compile result rather than crashing', async () => {
    const response = await fetch(`${base}/api/run/interactive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'typescript',
        version: 'ts5',
        code: 'const value: number = "not a number";\n',
        debug: true,
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /application\/json/);

    const body = await response.json();
    assert.ok(body.compile, `no compile result: ${JSON.stringify(body)}`);
    assert.match(body.compile.stderr, /TS2322|not assignable/);
  });

  test('and the server is still answering afterwards', async () => {
    // The assertion that would have failed before the fix: the process was gone, so
    // this request never reached anything.
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200, 'the server died on the previous request');

    const run = await new StreamedRun(base).start({
      language: 'typescript',
      version: 'ts5',
      code: 'console.log("still here");\n',
    });
    await run.waitFor('exit');
    await run.close();
  });
});

/**
 * Debugging the three languages whose adapters supervise a separate process.
 *
 * Their own contract suites drive the adapters directly, which is the right place to
 * assert protocol behaviour - but it bypasses everything above them: the route that
 * decides a run is a debug run, the channel that relays commands, and the session that
 * ties the two together.
 *
 * That gap was not theoretical. Driving a real Java debug run over HTTP is how the
 * "command arrives before the adapter can serve it" bug was found: `setBreakpoints`
 * landed between `hello` and the JVM being attached, threw, and was lost - so nothing
 * armed and the program ran to completion. Every adapter-level test still passed,
 * because none of them send a command that early.
 */
describe('debugging a supervised language over HTTP', () => {
  let server;
  let base;

  before(async () => {
    server = await startServer();
    base = server.baseUrl;
  });

  after(async () => {
    await server?.stop();
  });

  /**
   * Each case stops on a line that has already assigned something, so the locals are
   * worth asserting on rather than being all defaults.
   */
  const CASES = [
    {
      language: 'java',
      version: 'java17',
      line: 4,
      code: [
        'public class Main {',                          // 1
        '  public static void main(String[] args) {',   // 2
        '    int total = 1 + 2;',                       // 3
        '    System.out.println(total);',               // 4
        '    System.out.println("done");',              // 5
        '  }',                                          // 6
        '}',                                            // 7
      ].join('\n'),
      local: 'total',
    },
    {
      language: 'php',
      version: 'php8',
      line: 3,
      code: ['<?php', '$total = 1 + 2;', 'echo $total . "\n";', 'echo "done\n";'].join('\n'),
      local: '$total',
    },
    {
      language: 'csharp',
      version: 'csharp12',
      line: 4,
      code: [
        'class Program {',                              // 1
        '  static void Main() {',                       // 2
        '    int total = 1 + 2;',                       // 3
        '    System.Console.WriteLine(total);',         // 4
        '    System.Console.WriteLine("done");',        // 5
        '  }',                                          // 6
        '}',                                            // 7
      ].join('\n'),
      local: 'total',
    },
  ];

  for (const testCase of CASES) {
    /*
     * `requires` checks the interpreter, which is not quite the whole story for PHP
     * (Xdebug is a compiled extension, and for C# the debugger is a separate binary).
     * A host with the language but not its debugger will fail here rather than skip -
     * which is the right way round: the image has both, and a deployment that lost one
     * should be loud.
     */
    describe(`${testCase.language} over HTTP`, requiresDebugger(testCase.language), () => {
      test('stops at the breakpoint, then runs to the end', async () => {
        const run = await new StreamedRun(base).start({
          language: testCase.language,
          version: testCase.version,
          code: testCase.code,
          debug: true,
        });

        await run.waitFor('debug:attached');

        // Sent immediately, with no further wait: this is the race described above.
        assert.equal(await run.debug('setBreakpoints', { lines: [testCase.line] }), 200);
        await run.waitFor('debug:breakpoints');

        const stopped = await run.waitFor('debug:stopped');
        assert.equal(stopped.line, testCase.line);
        const names = (stopped.locals ?? []).map(local => local.name);
        assert.ok(
          names.includes(testCase.local),
          `expected a local named ${testCase.local}, saw ${names.join(', ')}`,
        );

        await run.debug('continue');
        const exit = await run.waitFor('exit');
        assert.equal(exit.exitCode, 0);

        const printed = run.events
          .filter(event => event.type === 'stdout')
          .map(event => event.data)
          .join('');
        assert.match(printed, /3/);
        assert.match(printed, /done/);

        // Exactly one attach per run. The adapters used to send an `attached` frame of
        // their own ON TOP of the handshake, so the client saw the event twice.
        assert.equal(run.seen('debug:attached').length, 1);

        await run.close();
      });
    });
  }
});

/**
 * Conditional breakpoints, for every language that has a debugger.
 *
 * One test body across all six, because the whole point of the wire format is that the
 * client does not know which mechanism is underneath. They are very different:
 *
 *   Python      bdb's `set_break(cond=...)` - the engine compiles and tests it
 *   JavaScript  `Debugger.setBreakpointByUrl({condition})` - V8 tests it
 *   TypeScript  the same, against the mapped `.js` line
 *   PHP         DBGp's separate `conditional` breakpoint type
 *   C#          DAP's `SourceBreakpoint.condition`
 *   Java        NOTHING. JDWP has no expression modifier, so the adapter stops,
 *               evaluates, and resumes - see languages/java/condition.mjs
 *
 * The loop runs five times and the condition selects the fourth, so a breakpoint that
 * ignored its condition would stop on the first iteration and fail on the VALUE rather
 * than on some downstream symptom.
 */
describe('conditional breakpoints', () => {
  let server;
  let base;

  before(async () => {
    server = await startServer();
    base = server.baseUrl;
  });

  after(async () => {
    await server?.stop();
  });

  const CASES = [
    {
      language: 'python', version: 'python3', line: 3, condition: 'i == 3', local: 'i',
      code: ['total = 0', 'for i in range(5):', '    total += i', 'print("done")'].join('\n'),
    },
    {
      language: 'javascript', version: 'es2022', line: 3, condition: 'i === 3', local: 'i',
      code: ['let total = 0;', 'for (let i = 0; i < 5; i++) {', '  total += i;', '}', 'console.log("done");'].join('\n'),
    },
    {
      language: 'php', version: 'php8', line: 4, condition: '$i == 3', local: '$i',
      code: ['<?php', '$total = 0;', 'for ($i = 0; $i < 5; $i++) {', '  $total += $i;', '}', 'echo "done\n";'].join('\n'),
    },
    {
      language: 'java', version: 'java17', line: 5, condition: 'i == 3', local: 'i',
      code: [
        'public class Main {',                              // 1
        '  public static void main(String[] args) {',       // 2
        '    int total = 0;',                               // 3
        '    for (int i = 0; i < 5; i++) {',                // 4
        '      total += i;',                                // 5
        '    }',                                            // 6
        '    System.out.println("done");',                  // 7
        '  }',                                              // 8
        '}',                                                // 9
      ].join('\n'),
    },
    {
      language: 'csharp', version: 'csharp12', line: 5, condition: 'i == 3', local: 'i',
      code: [
        'class Program {',                                  // 1
        '  static void Main() {',                           // 2
        '    int total = 0;',                               // 3
        '    for (int i = 0; i < 5; i++) {',                // 4
        '      total += i;',                                // 5
        '    }',                                            // 6
        '    System.Console.WriteLine("done");',            // 7
        '  }',                                              // 8
        '}',                                                // 9
      ].join('\n'),
    },
  ];

  for (const testCase of CASES) {
    describe(testCase.language, requiresDebugger(testCase.language), () => {
      test('stops on the iteration the condition names, not the first', async () => {
        const run = await new StreamedRun(base).start({
          language: testCase.language,
          version: testCase.version,
          code: testCase.code,
          debug: true,
        });

        await run.waitFor('debug:attached');
        assert.equal(
          await run.debug('setBreakpoints', {
            lines: [testCase.line],
            conditions: { '': { [testCase.line]: testCase.condition } },
          }),
          200,
        );
        await run.waitFor('debug:breakpoints');

        const stopped = await run.waitFor('debug:stopped');
        assert.equal(stopped.line, testCase.line);

        const loopVariable = (stopped.locals ?? []).find(local => local.name === testCase.local);
        assert.ok(loopVariable, `no local named ${testCase.local}: ${JSON.stringify(stopped.locals)}`);
        assert.equal(
          loopVariable.value.text,
          '3',
          'stopped on the wrong iteration - the condition was ignored',
        );

        await run.debug('continue');
        const exit = await run.waitFor('exit');
        assert.equal(exit.exitCode, 0);

        // Exactly one stop: the condition is false on the other four iterations.
        assert.equal(run.seen('debug:stopped').length, 1);
        await run.close();
      });
    });
  }
});

/** A log point evaluates in the paused frame, reports, and resumes by itself. */
describe('log points print without stopping', () => {
  let server;
  let base;

  before(async () => {
    server = await startServer();
    base = server.baseUrl;
  });

  after(async () => {
    await server?.stop();
  });

  test('Python logpoints and stdout remain interleaved in source order',
    requiresDebugger('python'), async () => {
      const run = await new StreamedRun(base).start({
        language: 'python',
        version: 'python3',
        debug: true,
        code: ['x = 10', 'for i in range(3):', '    x += 1', '    print(x)'].join('\n'),
      });
      await run.waitFor('debug:attached');
      assert.equal(await run.debug('setBreakpoints', {
        lines: [], logpoints: { '': { 3: 'i' } },
      }), 200);
      await run.waitFor('debug:breakpoints');
      await run.waitFor('exit');

      const timeline = [];
      let stdout = '';
      for (const event of run.events) {
        if (event.type === 'debug:log') timeline.push(`i=${event.value.text}`);
        if (event.type !== 'stdout') continue;
        stdout += String(event.data ?? '');
        let newline;
        while ((newline = stdout.indexOf('\n')) !== -1) {
          timeline.push(`print=${stdout.slice(0, newline)}`);
          stdout = stdout.slice(newline + 1);
        }
      }
      assert.deepEqual(timeline, [
        'i=0', 'print=11', 'i=1', 'print=12', 'i=2', 'print=13',
      ]);
      await run.close();
    });

  const CASES = [
    {
      language: 'python', version: 'python3', line: 2, expression: 'i',
      code: ['for i in range(3):', '    value = i', 'print("done")'].join('\n'),
    },
    {
      language: 'javascript', version: 'es2022', line: 2, expression: 'i',
      code: ['for (let i = 0; i < 3; i++) {', '  const value = i;', '}', 'console.log("done");'].join('\n'),
    },
    {
      language: 'php', version: 'php8', line: 3, expression: '$i',
      code: ['<?php', 'for ($i = 0; $i < 3; $i++) {', '  $value = $i;', '}', 'echo "done\\n";'].join('\n'),
    },
    {
      language: 'java', version: 'java17', line: 4, expression: 'i',
      code: [
        'public class Main {',
        '  public static void main(String[] args) {',
        '    for (int i = 0; i < 3; i++) {',
        '      int value = i;',
        '    }',
        '    System.out.println("done");',
        '  }',
        '}',
      ].join('\n'),
    },
    {
      language: 'csharp', version: 'csharp12', line: 4, expression: 'i',
      code: [
        'class Program {',
        '  static void Main() {',
        '    for (int i = 0; i < 3; i++) {',
        '      int value = i;',
        '    }',
        '    System.Console.WriteLine("done");',
        '  }',
        '}',
      ].join('\n'),
    },
  ];

  for (const testCase of CASES) {
    describe(testCase.language, requiresDebugger(testCase.language), () => {
      test('reports every loop value and reaches exit without a paused event', async () => {
        const run = await new StreamedRun(base).start({
          language: testCase.language,
          version: testCase.version,
          code: testCase.code,
          debug: true,
        });

        await run.waitFor('debug:attached');
        assert.equal(await run.debug('setBreakpoints', {
          lines: [],
          logpoints: { '': { [testCase.line]: testCase.expression } },
        }), 200);
        await run.waitFor('debug:breakpoints');
        const exit = await run.waitFor('exit');
        assert.equal(exit.exitCode, 0);

        const logs = run.seen('debug:log');
        assert.equal(logs.length, 3, JSON.stringify(run.events));
        assert.deepEqual(logs.map(event => event.value?.text), ['0', '1', '2']);
        assert.equal(run.seen('debug:stopped').length, 0);
        await run.close();
      });
    });
  }
});
