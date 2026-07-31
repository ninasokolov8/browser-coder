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
import { requires } from './support/toolchain.mjs';

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
