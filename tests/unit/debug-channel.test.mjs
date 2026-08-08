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
      files: {},
      conditions: {},
    });
  });

  test('an empty list is valid - it clears every breakpoint', () => {
    assert.deepEqual(buildDebugCommand('setBreakpoints', { lines: [] }), {
      command: 'setBreakpoints',
      lines: [],
      files: {},
      conditions: {},
    });
  });

  test('a missing list is treated as empty rather than refused', () => {
    assert.deepEqual(buildDebugCommand('setBreakpoints', {}), {
      command: 'setBreakpoints',
      lines: [],
      files: {},
      conditions: {},
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

/**
 * Breakpoints in files other than the entry file.
 *
 * `lines` alone is the shape the first version of the protocol spoke and still means
 * the entry file, so a client that has not learned about `files` keeps working. The
 * paths in `files` are the interesting part: they name a file the ADAPTER will open, so
 * they go through the same rule a run payload does.
 */
describe('setBreakpoints across several files', () => {
  test('a per-file map is carried through', () => {
    const built = buildDebugCommand('setBreakpoints', {
      lines: [2],
      files: { 'main.py': [2], 'lib/util.py': [7, 9] },
    });

    assert.deepEqual(built.lines, [2], 'the v1 field must still carry the entry file');
    assert.deepEqual(built.files['lib/util.py'], [7, 9]);
  });

  test('a traversal is refused, so a breakpoint cannot name a file outside the job', () => {
    // The same rule a run payload goes through. A debug command must not be able to
    // reach a file a run could not.
    for (const hostile of ['../../etc/passwd.py', '/etc/passwd.py', 'C:/Windows/x.py']) {
      const built = buildDebugCommand('setBreakpoints', { files: { [hostile]: [1] } });
      assert.deepEqual(built.files, {}, `${hostile} was accepted`);
    }
  });

  test('a Windows separator is normalised rather than refused', () => {
    // Built from a char code so the backslash cannot be eaten in transit - a literal
    // `'lib\util.py'` is also an invalid unicode escape, which is how this was noticed.
    const windowsPath = `lib${String.fromCharCode(92)}util.py`;
    const built = buildDebugCommand('setBreakpoints', { files: { [windowsPath]: [3] } });
    assert.deepEqual(built.files, { 'lib/util.py': [3] });
  });

  test('a file with no valid lines is dropped, not sent empty', () => {
    const built = buildDebugCommand('setBreakpoints', {
      files: { 'a.py': [], 'b.py': [0, -1, 'x'], 'c.py': [4] },
    });
    assert.deepEqual(Object.keys(built.files), ['c.py']);
  });

  test('line numbers inside a file get the same validation as the entry file', () => {
    const built = buildDebugCommand('setBreakpoints', {
      files: { 'a.py': [0, -1, 1.5, '3', 7] },
    });
    assert.deepEqual(built.files['a.py'], [3, 7]);
  });

  test('the number of files is bounded', () => {
    const many = {};
    for (let index = 0; index < 500; index++) many[`file${index}.py`] = [1];
    const built = buildDebugCommand('setBreakpoints', { files: many });

    assert.ok(Object.keys(built.files).length <= 100, Object.keys(built.files).length);
  });

  test('a non-object files field is ignored rather than crashing', () => {
    for (const junk of [null, 'nope', 42, ['a.py']]) {
      const built = buildDebugCommand('setBreakpoints', { lines: [1], files: junk });
      assert.deepEqual(built.files, {}, JSON.stringify(junk));
      assert.deepEqual(built.lines, [1]);
    }
  });
});

describe('breakpoint conditions on the wire', () => {
  test('a condition rides along with the line it belongs to', () => {
    const command = buildDebugCommand('setBreakpoints', {
      lines: [4, 9],
      files: { 'lib/helper.py': [3] },
      conditions: { '': { 4: 'i == 5' }, 'lib/helper.py': { 3: 'n > 2' } },
    });

    assert.deepEqual(command, {
      command: 'setBreakpoints',
      lines: [4, 9],
      files: { 'lib/helper.py': [3] },
      // The empty string is the entry file, the same convention the explorer's manual
      // ordering uses for the workspace root.
      conditions: { '': { 4: 'i == 5' }, 'lib/helper.py': { 3: 'n > 2' } },
    });
  });

  test('no conditions gives an empty map, not a missing field', () => {
    // Additive, and consistently shaped: an adapter reads `command.conditions` without
    // having to know whether the client is new enough to send it.
    const command = buildDebugCommand('setBreakpoints', { lines: [1] });
    assert.deepEqual(command.conditions, {});
  });

  test('a condition for a line with no breakpoint is dropped', () => {
    /*
     * Otherwise a stale condition sits in the map forever, and the next
     * `setBreakpoints` that happens to use that line silently inherits it - a
     * breakpoint that will not stop, for a reason nothing on screen explains.
     */
    const command = buildDebugCommand('setBreakpoints', {
      lines: [4],
      conditions: { '': { 4: 'ok', 99: 'never armed' } },
    });
    assert.deepEqual(command.conditions, { '': { 4: 'ok' } });
  });

  test('a condition for a file with no breakpoints is dropped', () => {
    const command = buildDebugCommand('setBreakpoints', {
      lines: [],
      files: { 'a.py': [2] },
      conditions: { 'a.py': { 2: 'yes' }, 'b.py': { 5: 'no such file here' } },
    });
    assert.deepEqual(command.conditions, { 'a.py': { 2: 'yes' } });
  });

  test('an empty or over-long condition is refused, and the breakpoint survives', () => {
    const command = buildDebugCommand('setBreakpoints', {
      lines: [1, 2, 3],
      conditions: { '': { 1: '', 2: '   ', 3: 'x'.repeat(2001) } },
    });
    assert.deepEqual(command.lines, [1, 2, 3]);
    assert.deepEqual(command.conditions, {});
  });

  test('a condition is trimmed, not passed through raw', () => {
    const command = buildDebugCommand('setBreakpoints', {
      lines: [1],
      conditions: { '': { 1: '  i == 5  ' } },
    });
    assert.deepEqual(command.conditions, { '': { 1: 'i == 5' } });
  });

  test('a non-string condition is dropped rather than stringified', () => {
    // `[object Object]` is not an expression, and sending it would produce an
    // unreadable error from whichever engine tried to compile it.
    const command = buildDebugCommand('setBreakpoints', {
      lines: [1, 2],
      conditions: { '': { 1: { evil: true }, 2: 42 } },
    });
    assert.deepEqual(command.conditions, {});
  });

  test('conditions for a traversal path go nowhere, like its lines', () => {
    const command = buildDebugCommand('setBreakpoints', {
      lines: [],
      files: { '../escape.py': [1] },
      conditions: { '../escape.py': { 1: 'anything' } },
    });
    assert.deepEqual(command.files, {});
    assert.deepEqual(command.conditions, {});
  });

  test('a conditions field that is not an object is ignored', () => {
    for (const bad of [null, 'nope', 42, ['a']]) {
      const command = buildDebugCommand('setBreakpoints', { lines: [1], conditions: bad });
      assert.deepEqual(command.conditions, {}, `for ${JSON.stringify(bad)}`);
    }
  });
});

describe('log points on the wire', () => {
  test('an expression is kept without requiring a stopping breakpoint', () => {
    const command = buildDebugCommand('setBreakpoints', {
      lines: [],
      logpoints: { '': { 7: 'total' }, 'lib/helper.py': { 3: 'item' } },
    });
    assert.deepEqual(command.logpoints, {
      '': { 7: 'total' },
      'lib/helper.py': { 3: 'item' },
    });
  });

  test('paths, line numbers, expression length and whitespace are bounded', () => {
    const command = buildDebugCommand('setBreakpoints', {
      logpoints: {
        '../escape.py': { 1: 'secret' },
        'main.py': { 0: 'bad', 2: '  value  ', 3: '', 4: 'x'.repeat(2001) },
      },
    });
    assert.deepEqual(command.logpoints, { 'main.py': { 2: 'value' } });
  });
});
