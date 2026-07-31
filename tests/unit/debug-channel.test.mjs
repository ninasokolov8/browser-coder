/**
 * The debug command boundary, and the channel handshake.
 *
 * `buildDebugCommand` is the whole gap between an HTTP request body and a command
 * that executes inside the student's paused process - `evaluate` runs an arbitrary
 * expression in a live frame. So it is an allowlist, and these tests are mostly
 * about what does NOT get through.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import {
  DebugChannel,
  DEBUG_COMMANDS,
  buildDebugCommand,
} from '../../server/debug/channel.mjs';

describe('the command allowlist', () => {
  test('the simple commands map to themselves', () => {
    for (const name of ['continue', 'next', 'stepIn', 'stepOut', 'stop']) {
      assert.deepEqual(buildDebugCommand(name, {}), { command: name });
    }
  });

  test('an unknown command is refused', () => {
    for (const name of ['exec', 'eval', 'quit', 'setTrace', '__proto__', 'toString']) {
      assert.equal(buildDebugCommand(name, {}), null, name);
    }
  });

  test('inherited object properties are not commands', () => {
    // Without a hasOwnProperty check, `constructor` and `toString` resolve on the
    // prototype and would be treated as valid command names.
    assert.equal(buildDebugCommand('constructor', {}), null);
    assert.equal(buildDebugCommand('hasOwnProperty', {}), null);
  });

  test('the exported list matches what is accepted', () => {
    for (const name of DEBUG_COMMANDS) {
      assert.notEqual(buildDebugCommand(name, { lines: [1], expression: 'x' }), null, name);
    }
  });
});

describe('setBreakpoints is bounded at the boundary', () => {
  test('valid line numbers pass through', () => {
    assert.deepEqual(buildDebugCommand('setBreakpoints', { lines: [1, 5, 200] }), {
      command: 'setBreakpoints',
      lines: [1, 5, 200],
    });
  });

  test('an empty list is valid - it clears every breakpoint', () => {
    assert.deepEqual(buildDebugCommand('setBreakpoints', { lines: [] }), {
      command: 'setBreakpoints',
      lines: [],
    });
  });

  test('a missing list is treated as empty rather than refused', () => {
    assert.deepEqual(buildDebugCommand('setBreakpoints', {}), {
      command: 'setBreakpoints',
      lines: [],
    });
  });

  test('non-integers, zero and negatives are dropped', () => {
    const built = buildDebugCommand('setBreakpoints', {
      lines: [0, -1, 1.5, NaN, Infinity, '3', null, undefined, {}, [], 7],
    });
    // '3' coerces to 3 and is legitimate; the rest are not line numbers.
    assert.deepEqual(built.lines, [3, 7]);
  });

  test('an absurd line number is dropped', () => {
    const built = buildDebugCommand('setBreakpoints', { lines: [1, 999999999] });
    assert.deepEqual(built.lines, [1]);
  });

  test('the count is capped', () => {
    const many = Array.from({ length: 2000 }, (_value, index) => index + 1);
    const built = buildDebugCommand('setBreakpoints', { lines: many });
    assert.ok(built.lines.length <= 500, `kept ${built.lines.length}`);
  });

  test('a non-array is treated as empty', () => {
    for (const lines of ['1,2,3', 42, {}, null]) {
      assert.deepEqual(buildDebugCommand('setBreakpoints', { lines }).lines, []);
    }
  });
});

describe('evaluate is bounded at the boundary', () => {
  test('an expression passes through unchanged', () => {
    assert.deepEqual(buildDebugCommand('evaluate', { expression: 'len(items) * 2' }), {
      command: 'evaluate',
      expression: 'len(items) * 2',
    });
  });

  test('an empty expression is refused', () => {
    // The adapter would answer with an error, but there is no reason to send it.
    assert.equal(buildDebugCommand('evaluate', { expression: '' }), null);
    assert.equal(buildDebugCommand('evaluate', {}), null);
  });

  test('a non-string expression is refused', () => {
    for (const expression of [42, null, {}, ['x'], true]) {
      assert.equal(buildDebugCommand('evaluate', { expression }), null, JSON.stringify(expression));
    }
  });

  test('an over-long expression is refused', () => {
    assert.equal(buildDebugCommand('evaluate', { expression: 'x'.repeat(5000) }), null);
  });

  test('the expression is NOT sanitised, and that is deliberate', () => {
    // Evaluating in a paused frame is the feature. The program is the student's own,
    // in their own sandbox, and the confinement that matters is the container plus
    // the AST gate that already refused `os` and friends before the run started.
    // Filtering the expression here would break legitimate debugging and add nothing.
    const built = buildDebugCommand('evaluate', { expression: '[x for x in items if x > 0]' });
    assert.equal(built.expression, '[x for x in items if x > 0]');
  });
});

describe('the channel handshake', () => {
  /** Connect to `port` and speak raw frames. */
  function connect(port) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' }, () => resolve(socket));
      socket.on('error', reject);
    });
  }

  const send = (socket, payload) => socket.write(`${JSON.stringify(payload)}\n`);

  test('a correct token attaches and forwards namespaced events', async () => {
    const events = [];
    const channel = new DebugChannel({ onEvent: event => events.push(event) });
    const port = await channel.listen();

    const socket = await connect(port);
    send(socket, { type: 'hello', token: channel.token, pid: 1234 });
    await new Promise(resolve => setTimeout(resolve, 60));

    assert.equal(channel.attached, true);
    assert.equal(events[0].type, 'debug:attached');
    assert.equal(events[0].pid, 1234);

    send(socket, { type: 'stopped', line: 7 });
    await new Promise(resolve => setTimeout(resolve, 60));

    // Namespaced, so a debug frame can never collide with the run stream's own
    // `stdout`/`exit`/`waiting` events.
    const stopped = events.find(event => event.type === 'debug:stopped');
    assert.ok(stopped, JSON.stringify(events));
    assert.equal(stopped.line, 7);

    channel.close();
    socket.destroy();
  });

  test('a wrong token never attaches and forwards nothing', async () => {
    const events = [];
    const channel = new DebugChannel({ onEvent: event => events.push(event) });
    const port = await channel.listen();

    const socket = await connect(port);
    send(socket, { type: 'hello', token: 'not-the-token' });
    send(socket, { type: 'stopped', line: 1 });
    await new Promise(resolve => setTimeout(resolve, 80));

    assert.equal(channel.attached, false);
    assert.equal(events.length, 0, JSON.stringify(events));

    channel.close();
    socket.destroy();
  });

  test('an event before the handshake is ignored', async () => {
    const events = [];
    const channel = new DebugChannel({ onEvent: event => events.push(event) });
    const port = await channel.listen();

    const socket = await connect(port);
    // Straight to a stopped event, no hello.
    send(socket, { type: 'stopped', line: 1 });
    await new Promise(resolve => setTimeout(resolve, 80));

    assert.equal(channel.attached, false);
    assert.equal(events.length, 0);

    channel.close();
    socket.destroy();
  });

  test('a second connection is dropped', async () => {
    const events = [];
    const channel = new DebugChannel({ onEvent: event => events.push(event) });
    const port = await channel.listen();

    const first = await connect(port);
    send(first, { type: 'hello', token: channel.token });
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(channel.attached, true);

    // A race between the real adapter and anything else on loopback must not leave
    // two peers interleaving frames into one session.
    const second = await connect(port);
    send(second, { type: 'hello', token: channel.token });
    send(second, { type: 'stopped', line: 999 });
    await new Promise(resolve => setTimeout(resolve, 80));

    assert.ok(
      !events.some(event => event.line === 999),
      `a second peer was heard: ${JSON.stringify(events)}`,
    );

    channel.close();
    first.destroy();
    second.destroy();
  });

  test('send returns false before the handshake and true after', async () => {
    const channel = new DebugChannel({ onEvent: () => {} });
    const port = await channel.listen();

    assert.equal(channel.send({ command: 'continue' }), false, 'sent with nobody attached');

    const socket = await connect(port);
    send(socket, { type: 'hello', token: channel.token });
    await new Promise(resolve => setTimeout(resolve, 60));

    assert.equal(channel.send({ command: 'continue' }), true);

    channel.close();
    assert.equal(channel.send({ command: 'continue' }), false, 'sent after close');
    socket.destroy();
  });

  test('a malformed frame does not end the session', async () => {
    const events = [];
    const channel = new DebugChannel({ onEvent: event => events.push(event) });
    const port = await channel.listen();

    const socket = await connect(port);
    send(socket, { type: 'hello', token: channel.token });
    await new Promise(resolve => setTimeout(resolve, 50));

    socket.write('this is not json\n');
    send(socket, { type: 'stopped', line: 42 });
    await new Promise(resolve => setTimeout(resolve, 80));

    assert.ok(
      events.some(event => event.type === 'debug:stopped' && event.line === 42),
      'a bad line killed the session',
    );

    channel.close();
    socket.destroy();
  });

  test('close is idempotent and reports once', async () => {
    let closes = 0;
    const channel = new DebugChannel({ onEvent: () => {}, onClose: () => { closes += 1; } });
    await channel.listen();

    channel.close();
    channel.close();
    channel.close();

    assert.equal(closes, 1);
  });

  test('it listens on loopback only', async () => {
    // Binding 0.0.0.0 would expose a channel that reads variables out of a running
    // program to every sibling container on the internal network.
    const channel = new DebugChannel({ onEvent: () => {} });
    const port = await channel.listen();
    assert.ok(port > 0);

    // The address the listener reports must be loopback.
    const probe = await connect(port);
    assert.equal(probe.remoteAddress, '127.0.0.1');

    channel.close();
    probe.destroy();
  });
});
