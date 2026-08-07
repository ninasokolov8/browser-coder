/**
 * The JDWP wire format, without a JVM.
 *
 * `tests/contract/java-debug.test.mjs` proves the debugger works against a real JVM,
 * but it skips wherever a JDK is not installed - which is most contributors' laptops
 * and can be CI. These tests need nothing but Node, so the parts of the protocol that
 * are pure encoding are covered everywhere, always.
 *
 * They also pin the two things that are easy to get subtly wrong and hard to see in an
 * end-to-end failure: variable-width ids, and packet framing across chunk boundaries.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { EVENT_KIND, JdwpConnection, Reader, SET, Writer } from '../../languages/java/jdwp.mjs';

/** What a modern 64-bit JVM reports from VirtualMachine.IDSizes. */
const WIDE = { fieldId: 8, methodId: 8, objectId: 8, referenceTypeId: 8, frameId: 8 };
/** What a 32-bit or compressed-oops JVM can report instead. Both must work. */
const NARROW = { fieldId: 4, methodId: 4, objectId: 4, referenceTypeId: 4, frameId: 4 };

describe('reading and writing primitives', () => {
  test('integers round-trip, including negative ones', () => {
    const payload = new Writer(WIDE).int(0).int(-1).int(2147483647).int(-2147483648).build();
    const reader = new Reader(payload, WIDE);
    assert.equal(reader.int(), 0);
    assert.equal(reader.int(), -1);
    assert.equal(reader.int(), 2147483647);
    assert.equal(reader.int(), -2147483648);
    assert.equal(reader.remaining, 0);
  });

  test('strings are length-prefixed in bytes, not characters', () => {
    // "é" is two UTF-8 bytes. A length in characters would leave the reader one byte
    // short and every following field would be garbage.
    const payload = new Writer(WIDE).string('café').string('').build();
    assert.equal(payload.readUInt32BE(0), 5);

    const reader = new Reader(payload, WIDE);
    assert.equal(reader.string(), 'café');
    assert.equal(reader.string(), '');
    assert.equal(reader.remaining, 0);
  });

  test('a 64-bit id survives as a BigInt rather than losing its low bits', () => {
    // Beyond Number.MAX_SAFE_INTEGER. A Number here would come back wrong, and the
    // symptom would be a thread id that matches nothing.
    const id = 0x7fffffffffffff01n;
    const payload = new Writer(WIDE).objectId(id).build();
    assert.equal(payload.length, 8);
    assert.equal(new Reader(payload, WIDE).objectId(), id);
  });
});

describe('variable-width ids', () => {
  test('the same value is written narrower when the VM says so', () => {
    assert.equal(new Writer(WIDE).objectId(7n).build().length, 8);
    assert.equal(new Writer(NARROW).objectId(7n).build().length, 4);
  });

  test('every id kind uses its own declared width', () => {
    // A JVM may report different widths per kind, and assuming they match is the
    // classic way to read a whole reply at the wrong offset.
    const mixed = { fieldId: 2, methodId: 4, objectId: 8, referenceTypeId: 4, frameId: 8 };
    const payload = new Writer(mixed)
      .fieldId(1n).methodId(2n).objectId(3n).referenceTypeId(4n).frameId(5n)
      .build();
    assert.equal(payload.length, 2 + 4 + 8 + 4 + 8);

    const reader = new Reader(payload, mixed);
    assert.equal(reader.fieldId(), 1n);
    assert.equal(reader.methodId(), 2n);
    assert.equal(reader.objectId(), 3n);
    assert.equal(reader.referenceTypeId(), 4n);
    assert.equal(reader.frameId(), 5n);
    assert.equal(reader.remaining, 0);
  });

  test('a location round-trips through its five fields', () => {
    const location = { typeTag: 1, classId: 11n, methodId: 22n, index: 33n };
    const payload = new Writer(NARROW).location(location).build();
    assert.deepEqual(new Reader(payload, NARROW).location(), location);
  });
});

// ── Framing ─────────────────────────────────────────────────────────────────

/** A socket that records what was written and can be fed arbitrary chunks. */
class FakeSocket extends EventEmitter {
  written = [];
  destroyed = false;

  setNoDelay() {}
  write(chunk) { this.written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'latin1')); return true; }
  end() { this.destroyed = true; }
  destroy() { this.destroyed = true; }

  feed(buffer) { this.emit('data', buffer); }
}

/** Encode a reply packet the way a JVM would. */
function reply(id, data, errorCode = 0) {
  const packet = Buffer.alloc(11 + data.length);
  packet.writeUInt32BE(packet.length, 0);
  packet.writeUInt32BE(id, 4);
  packet.writeUInt8(0x80, 8);
  packet.writeUInt16BE(errorCode, 9);
  data.copy(packet, 11);
  return packet;
}

/** Encode an Event.Composite command packet the way a JVM would. */
function composite(data) {
  const packet = Buffer.alloc(11 + data.length);
  packet.writeUInt32BE(packet.length, 0);
  packet.writeUInt32BE(0, 4);
  packet.writeUInt8(0, 8);
  packet.writeUInt8(SET.EVENT, 9);
  packet.writeUInt8(100, 10);
  data.copy(packet, 11);
  return packet;
}

/** IDSizes reply body: five 4-byte widths. */
function idSizes(width = 8) {
  const data = Buffer.alloc(20);
  for (let index = 0; index < 5; index++) data.writeUInt32BE(width, index * 4);
  return data;
}

/**
 * A connection past its handshake, with the fake socket that drives it.
 *
 * The handshake is the part that has to be done for real: it is where the raw
 * fourteen-byte greeting is separated from the framed stream, and getting that wrong
 * is exactly the bug this whole file exists to prevent recurring.
 */
async function handshaken({ onEvent } = {}, trailing = Buffer.alloc(0)) {
  const socket = new FakeSocket();
  const connection = new JdwpConnection(socket, { onEvent });
  const done = connection.handshake();

  // The JVM answers the greeting - here in the same TCP segment as whatever follows.
  await Promise.resolve();
  socket.feed(Buffer.concat([Buffer.from('JDWP-Handshake', 'latin1'), trailing]));

  // Then it answers the IDSizes command the handshake sends.
  await Promise.resolve();
  socket.feed(reply(1, idSizes(8)));

  await done;
  return { connection, socket };
}

describe('the handshake', () => {
  test('it reads the greeting and then the id widths', async () => {
    const { connection, socket } = await handshaken();
    assert.deepEqual(connection.sizes, WIDE);
    assert.equal(socket.written[0].toString('latin1'), 'JDWP-Handshake');
  });

  test('it refuses a peer that is not a JVM', async () => {
    const socket = new FakeSocket();
    const connection = new JdwpConnection(socket, {});
    const done = connection.handshake();
    await Promise.resolve();
    socket.feed(Buffer.from('HTTP/1.1 400 B', 'latin1'));
    await assert.rejects(done, /not a JDWP peer/);
  });

  test('a packet arriving in the same segment as the greeting is not lost', async () => {
    /*
     * The bug this pins.
     *
     * The greeting is unframed, so it needs a one-shot listener; whatever the JVM put
     * after it in the same TCP segment is a real packet and belongs to the framed
     * parser. Handling the segment twice made the parser read the length of the first
     * packet out of the ASCII "JDWP-Handshake" - about 1.2 billion - and wait forever.
     */
    const events = [];
    const start = Buffer.alloc(6);
    start.writeUInt8(EVENT_KIND.VM_START, 0);
    const body = Buffer.concat([Buffer.from([2, 0, 0, 0, 1]), start, Buffer.alloc(8)]);

    const { connection } = await handshaken({ onEvent: e => events.push(e) }, composite(body));
    assert.ok(connection.sizes);
    assert.equal(events.length, 1);
    assert.equal(events[0].events[0].kind, EVENT_KIND.VM_START);
  });
});

describe('packet framing', () => {
  test('a reply split across three chunks is reassembled', async () => {
    const { connection, socket } = await handshaken();

    const pending = connection.command(SET.VIRTUAL_MACHINE, 1);
    const packet = reply(2, Buffer.from([0, 0, 0, 42]));
    // Byte by byte in three pieces, including a split inside the length prefix.
    socket.feed(packet.subarray(0, 2));
    socket.feed(packet.subarray(2, 9));
    socket.feed(packet.subarray(9));

    const answer = await pending;
    assert.equal(answer.errorCode, 0);
    assert.equal(answer.data.readInt32BE(0), 42);
  });

  test('two replies in one chunk both resolve, and out of order', async () => {
    const { connection, socket } = await handshaken();

    const first = connection.command(SET.VIRTUAL_MACHINE, 1);
    const second = connection.command(SET.VIRTUAL_MACHINE, 2);
    // The JVM is free to answer the second command first.
    socket.feed(Buffer.concat([
      reply(3, Buffer.from([2])),
      reply(2, Buffer.from([1])),
    ]));

    assert.equal((await first).data[0], 1);
    assert.equal((await second).data[0], 2);
  });

  test('an event interleaved with a command in flight reaches the callback', async () => {
    // The reason commands and events are separate paths at all: a breakpoint can fire
    // while a command is outstanding, and a plain request/response client deadlocks.
    const events = [];
    const { connection, socket } = await handshaken({ onEvent: e => events.push(e) });

    const pending = connection.command(SET.VIRTUAL_MACHINE, 1);

    const death = Buffer.concat([Buffer.from([2, 0, 0, 0, 1]), Buffer.from([EVENT_KIND.VM_DEATH]), Buffer.alloc(4)]);
    socket.feed(composite(death));
    assert.equal(events.length, 1);
    assert.equal(events[0].events[0].kind, EVENT_KIND.VM_DEATH);

    socket.feed(reply(2, Buffer.alloc(0)));
    assert.equal((await pending).errorCode, 0);
  });

  test('an error reply resolves with its code rather than hanging', async () => {
    const { connection, socket } = await handshaken();
    const pending = connection.command(SET.METHOD, 1);
    // 101 is ABSENT_INFORMATION - a class compiled without -g:lines.
    socket.feed(reply(2, Buffer.alloc(0), 101));
    assert.equal((await pending).errorCode, 101);
  });

  test('a closed socket fails every command in flight instead of hanging', async () => {
    const { connection, socket } = await handshaken();
    const pending = connection.command(SET.VIRTUAL_MACHINE, 1);
    socket.emit('close');
    assert.equal((await pending).errorCode, -1);
    assert.equal(connection.closed, true);
  });
});

describe('event decoding', () => {
  test('a breakpoint event carries its thread and location', async () => {
    const events = [];
    const { socket } = await handshaken({ onEvent: e => events.push(e) });

    const writer = new Writer(WIDE);
    writer.byte(2).int(1);
    writer.byte(EVENT_KIND.BREAKPOINT).int(9);
    writer.objectId(1234n);
    writer.location({ typeTag: 1, classId: 5n, methodId: 6n, index: 7n });
    socket.feed(composite(writer.build()));

    assert.equal(events.length, 1);
    assert.equal(events[0].suspendPolicy, 2);
    const [event] = events[0].events;
    assert.equal(event.kind, EVENT_KIND.BREAKPOINT);
    assert.equal(event.requestId, 9);
    assert.equal(event.thread, 1234n);
    assert.equal(event.location.index, 7n);
  });

  test('a class-prepare event carries the signature the class was loaded under', async () => {
    const events = [];
    const { socket } = await handshaken({ onEvent: e => events.push(e) });

    const writer = new Writer(WIDE);
    writer.byte(2).int(1);
    writer.byte(EVENT_KIND.CLASS_PREPARE).int(3);
    writer.objectId(1n).byte(1).referenceTypeId(99n).string('Lapp/Main$Node;').int(7);
    socket.feed(composite(writer.build()));

    const [event] = events[0].events;
    assert.equal(event.signature, 'Lapp/Main$Node;');
    assert.equal(event.typeId, 99n);
  });

  test('several events in one composite are all decoded', async () => {
    // The JVM batches: a resume that trips two requests delivers one packet, and
    // handling only the first loses a breakpoint.
    const events = [];
    const { socket } = await handshaken({ onEvent: e => events.push(e) });

    const writer = new Writer(WIDE);
    writer.byte(2).int(2);
    writer.byte(EVENT_KIND.BREAKPOINT).int(1).objectId(1n)
      .location({ typeTag: 1, classId: 1n, methodId: 1n, index: 0n });
    writer.byte(EVENT_KIND.SINGLE_STEP).int(2).objectId(1n)
      .location({ typeTag: 1, classId: 1n, methodId: 1n, index: 4n });
    socket.feed(composite(writer.build()));

    assert.deepEqual(
      events[0].events.map(event => event.kind),
      [EVENT_KIND.BREAKPOINT, EVENT_KIND.SINGLE_STEP],
    );
  });

  test('an unknown event kind is reported, not silently dropped', async () => {
    // Event bodies are variable length with no way to skip one, so the rest of the
    // packet is unreadable - but the caller must still learn something arrived.
    const events = [];
    const { socket } = await handshaken({ onEvent: e => events.push(e) });

    const writer = new Writer(WIDE);
    writer.byte(1).int(1).byte(42).int(5);
    socket.feed(composite(writer.build()));

    assert.equal(events[0].events[0].undecodable, true);
    assert.equal(events[0].events[0].kind, 42);
  });
});
