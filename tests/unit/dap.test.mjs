/**
 * The Debug Adapter Protocol envelope, without netcoredbg.
 *
 * `tests/contract/csharp-debug.test.mjs` proves the debugger works against the real
 * thing, but it skips wherever `netcoredbg` is absent - which is every machine that has
 * not built it, because it is not packaged for Alpine and has to come from the image's
 * builder stage. These tests need nothing but Node.
 *
 * The framing is the part worth pinning. It is the same `Content-Length` envelope as
 * LSP, and the two mistakes everyone makes with it are counting the length in
 * characters instead of bytes, and assuming one chunk is one message.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { DapConnection, DapFramer, encodeMessage } from '../../languages/csharp/dap.mjs';

/** Encode the way a debug adapter would. */
function framed(object) {
  return encodeMessage(object);
}

describe('framing', () => {
  test('one message in one chunk', () => {
    const framer = new DapFramer();
    const messages = framer.push(framed({ seq: 1, type: 'event', event: 'initialized' }));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].event, 'initialized');
  });

  test('a message split across chunks is reassembled', () => {
    const framer = new DapFramer();
    const packet = framed({ seq: 1, type: 'response', command: 'initialize', success: true });

    // Split inside the header, then inside the JSON.
    assert.deepEqual(framer.push(packet.subarray(0, 8)), []);
    assert.deepEqual(framer.push(packet.subarray(8, 30)), []);
    const messages = framer.push(packet.subarray(30));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].command, 'initialize');
  });

  test('two messages in one chunk are both returned, in order', () => {
    const framer = new DapFramer();
    const messages = framer.push(Buffer.concat([
      framed({ seq: 1, type: 'event', event: 'output', body: { output: 'a' } }),
      framed({ seq: 2, type: 'event', event: 'output', body: { output: 'b' } }),
    ]));
    assert.deepEqual(messages.map(message => message.body.output), ['a', 'b']);
  });

  test('the length is bytes, not characters', () => {
    /*
     * A program printing "café" is enough to break this.
     *
     * The header says 4 bytes for a 3-character... no: "é" is two UTF-8 bytes, so a
     * length counted in characters is one short, and the next message begins one byte
     * into this one's closing brace. Everything after it is garbage.
     */
    const framer = new DapFramer();
    const packet = framed({ seq: 1, type: 'event', event: 'output', body: { output: 'café ☕' } });

    const messages = framer.push(Buffer.concat([packet, framed({ seq: 2, type: 'event', event: 'terminated' })]));
    assert.equal(messages.length, 2);
    assert.equal(messages[0].body.output, 'café ☕');
    assert.equal(messages[1].event, 'terminated');
  });

  test('the header is matched case-insensitively', () => {
    // The specification says `Content-Length`; implementations vary in case, and a
    // debugger that hangs over capitalisation is a debugger that hangs.
    const framer = new DapFramer();
    const body = Buffer.from('{"seq":1,"type":"event","event":"initialized"}', 'utf8');
    const messages = framer.push(Buffer.concat([
      Buffer.from(`content-length: ${body.length}\r\n\r\n`, 'ascii'),
      body,
    ]));
    assert.equal(messages[0].event, 'initialized');
  });

  test('a header without a length is skipped and the stream resyncs', () => {
    const framer = new DapFramer();
    const good = framed({ seq: 2, type: 'event', event: 'terminated' });
    const messages = framer.push(Buffer.concat([
      Buffer.from('X-Something: 1\r\n\r\n', 'ascii'),
      good,
    ]));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].event, 'terminated');
  });

  test('a message that is not JSON does not poison the messages after it', () => {
    // The length told us exactly where the bad message ended, so the stream is still
    // usable - which is the whole advantage of a length-prefixed envelope.
    const framer = new DapFramer();
    const bad = Buffer.from('not json', 'utf8');
    const messages = framer.push(Buffer.concat([
      Buffer.from(`Content-Length: ${bad.length}\r\n\r\n`, 'ascii'),
      bad,
      framed({ seq: 3, type: 'event', event: 'initialized' }),
    ]));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].event, 'initialized');
  });

  test('an absurd length is refused rather than buffered forever', () => {
    const framer = new DapFramer();
    const messages = framer.push(Buffer.concat([
      Buffer.from('Content-Length: 999999999999\r\n\r\n', 'ascii'),
      framed({ seq: 1, type: 'event', event: 'initialized' }),
    ]));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].event, 'initialized');
  });
});

// ── The connection ──────────────────────────────────────────────────────────

/** A connection wired to a pair of streams standing in for a child process. */
function connected() {
  const toAdapter = new PassThrough();
  const fromAdapter = new PassThrough();
  const connection = new DapConnection(toAdapter, fromAdapter);

  const sent = [];
  const framer = new DapFramer();
  toAdapter.on('data', chunk => sent.push(...framer.push(chunk)));

  return { connection, sent, reply: message => fromAdapter.write(framed(message)), fromAdapter };
}

/** Let the streams deliver. */
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('requests and responses', () => {
  test('a request is numbered and its response resolves it', async () => {
    const { connection, sent, reply } = connected();

    const pending = connection.request('initialize', { adapterID: 'coreclr' });
    await settle();

    assert.equal(sent.length, 1);
    assert.equal(sent[0].command, 'initialize');
    assert.equal(sent[0].type, 'request');
    assert.deepEqual(sent[0].arguments, { adapterID: 'coreclr' });

    reply({ seq: 10, type: 'response', request_seq: sent[0].seq, command: 'initialize', success: true, body: { supportsEvaluate: true } });
    const answer = await pending;
    assert.equal(answer.success, true);
    assert.equal(answer.body.supportsEvaluate, true);
  });

  test('responses arriving out of order still match their requests', async () => {
    // A debugger answers a slow request late; matching by arrival order would give
    // each caller the other's answer, which is worse than either failing.
    const { connection, sent, reply } = connected();

    const first = connection.request('stackTrace');
    const second = connection.request('scopes');
    await settle();

    reply({ seq: 11, type: 'response', request_seq: sent[1].seq, command: 'scopes', success: true, body: { which: 'second' } });
    reply({ seq: 12, type: 'response', request_seq: sent[0].seq, command: 'stackTrace', success: true, body: { which: 'first' } });

    assert.equal((await first).body.which, 'first');
    assert.equal((await second).body.which, 'second');
  });

  test('a failed request resolves rather than throwing', async () => {
    /*
     * A failure is an answer.
     *
     * "cannot evaluate that expression" is a normal outcome of a watch panel, and a
     * client that threw would need a try/catch around every call site - which is how
     * an unrelated bug ends up swallowed by one of them.
     */
    const { connection, sent, reply } = connected();
    const pending = connection.request('evaluate', { expression: 'nope' });
    await settle();

    reply({ seq: 13, type: 'response', request_seq: sent[0].seq, command: 'evaluate', success: false, message: 'error: no symbol "nope"' });
    const answer = await pending;
    assert.equal(answer.success, false);
    assert.match(answer.message, /no symbol/);
  });

  test('events go to listeners and never resolve a request', async () => {
    const { connection, sent, reply } = connected();

    const stops = [];
    connection.on('stopped', body => stops.push(body));

    const pending = connection.request('continue');
    await settle();

    // Arrives while the request is outstanding - the normal case, because continuing
    // is answered immediately and the stop comes whenever the program gets there.
    reply({ seq: 14, type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } });
    await settle();
    assert.deepEqual(stops, [{ reason: 'breakpoint', threadId: 1 }]);

    reply({ seq: 15, type: 'response', request_seq: sent[0].seq, command: 'continue', success: true });
    assert.equal((await pending).success, true);
  });

  test('a reverse request is answered rather than ignored', async () => {
    // `runInTerminal` is the one an adapter actually sends. Silence leaves it waiting
    // forever; "not supported" lets it fall back.
    const { connection, sent, reply } = connected();
    void connection;

    reply({ seq: 16, type: 'request', command: 'runInTerminal', arguments: { args: ['sh'] } });
    await settle();

    const response = sent.find(message => message.type === 'response');
    assert.ok(response, 'the reverse request was never answered');
    assert.equal(response.request_seq, 16);
    assert.equal(response.success, false);
  });

  test('a disconnect answers every request in flight instead of hanging', async () => {
    const { connection, fromAdapter } = connected();
    const pending = connection.request('stackTrace');
    await settle();

    fromAdapter.end();
    await settle();

    const answer = await pending;
    assert.equal(answer.success, false);
    assert.equal(connection.closed, true);
  });

  test('a request after the debugger is gone answers immediately', async () => {
    const { connection, fromAdapter } = connected();
    fromAdapter.end();
    await settle();

    const answer = await connection.request('evaluate', { expression: '1' });
    assert.equal(answer.success, false);
  });

  test('waitForEvent gives up rather than hanging the run', async () => {
    const { connection } = connected();
    assert.equal(await connection.waitForEvent('initialized', 20), null);
  });

  test('waitForEvent resolves with the event body', async () => {
    const { connection, reply } = connected();
    const waiting = connection.waitForEvent('initialized', 1000);
    reply({ seq: 17, type: 'event', event: 'initialized' });
    assert.deepEqual(await waiting, {});
  });
});
