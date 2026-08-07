/**
 * A minimal Java Debug Wire Protocol client.
 *
 * ## Why this exists at all
 *
 * Every other language here got its debugger from something already in the box: Python
 * has `bdb` in its standard library, and JavaScript has V8's inspector. Java has
 * neither - the JVM speaks JDWP, a binary protocol, and the only clients are JDI (a
 * Java library, unusable from Node) or a full debug adapter that is not in the image
 * and would be a large dependency for the handful of commands this IDE surfaces.
 *
 * So this is written from the wire format. It is deliberately small: enough to set a
 * line breakpoint, stop, read locals and the stack, step, and terminate.
 *
 * ## The wire format, as verified against a real JVM
 *
 * The connection opens with the ASCII string `JDWP-Handshake` in each direction, with
 * no framing at all. Every packet after that is:
 *
 *     length   uint32  including this header
 *     id       uint32  echoed in the reply, so replies can be matched out of order
 *     flags    uint8   0x80 means this is a REPLY
 *     ── command packet ──        ── reply packet ──
 *     set      uint8               errorCode  uint16
 *     command  uint8
 *     ...data                      ...data
 *
 * All integers are big-endian. Object, method, field, reference-type and frame ids are
 * variable width, and their widths must be read from `VirtualMachine.IDSizes` BEFORE
 * any packet containing one can be parsed - every JVM this was tried on answered 8 for
 * all five, but the sizes are read rather than assumed because the protocol allows 4.
 *
 * ## The ordering that actually matters
 *
 * The JVM is launched with `suspend=y`, so it is stopped before it has loaded anything.
 * A breakpoint cannot be set on a class that does not exist yet, so the sequence is:
 * ask for a CLASS_PREPARE event, resume, and set the real breakpoints when the class
 * arrives. Setting them at VM_START silently arms nothing.
 */

import net from 'node:net';

const HANDSHAKE = 'JDWP-Handshake';

/** Command sets, named so a call site reads as the protocol does. */
export const SET = {
  VIRTUAL_MACHINE: 1,
  REFERENCE_TYPE: 2,
  CLASS_TYPE: 3,
  METHOD: 6,
  OBJECT_REFERENCE: 9,
  STRING_REFERENCE: 10,
  THREAD_REFERENCE: 11,
  ARRAY_REFERENCE: 13,
  EVENT_REQUEST: 15,
  STACK_FRAME: 16,
  EVENT: 64,
};

export const EVENT_KIND = {
  SINGLE_STEP: 1,
  BREAKPOINT: 2,
  EXCEPTION: 4,
  CLASS_PREPARE: 8,
  VM_START: 90,
  VM_DEATH: 99,
};

export const SUSPEND_POLICY = { NONE: 0, EVENT_THREAD: 1, ALL: 2 };

export const STEP_DEPTH = { INTO: 0, OVER: 1, OUT: 2 };
/** LINE, not MIN: stepping by bytecode would stop many times per source line. */
export const STEP_SIZE_LINE = 1;

/** JDWP tags for the values a student's program actually holds. */
const TAG = {
  ARRAY: 91,
  BYTE: 66,
  CHAR: 67,
  OBJECT: 76,
  FLOAT: 70,
  DOUBLE: 68,
  INT: 73,
  LONG: 74,
  SHORT: 83,
  VOID: 86,
  BOOLEAN: 90,
  STRING: 115,
  THREAD: 116,
  CLASS_OBJECT: 99,
};

/** Reads primitives out of a reply, tracking its own offset. */
export class Reader {
  constructor(buffer, sizes) {
    this.buffer = buffer;
    this.at = 0;
    this.sizes = sizes;
  }

  byte() {
    return this.buffer.readUInt8(this.at++);
  }

  boolean() {
    return this.byte() !== 0;
  }

  int() {
    const value = this.buffer.readInt32BE(this.at);
    this.at += 4;
    return value;
  }

  long() {
    const value = this.buffer.readBigInt64BE(this.at);
    this.at += 8;
    return value;
  }

  /** A variable-width id, as a BigInt so a 64-bit one is not silently truncated. */
  id(width) {
    let value = 0n;
    for (let index = 0; index < width; index++) {
      value = (value << 8n) | BigInt(this.buffer.readUInt8(this.at + index));
    }
    this.at += width;
    return value;
  }

  objectId() { return this.id(this.sizes.objectId); }
  referenceTypeId() { return this.id(this.sizes.referenceTypeId); }
  methodId() { return this.id(this.sizes.methodId); }
  fieldId() { return this.id(this.sizes.fieldId); }
  frameId() { return this.id(this.sizes.frameId); }

  string() {
    const length = this.buffer.readUInt32BE(this.at);
    this.at += 4;
    const text = this.buffer.toString('utf8', this.at, this.at + length);
    this.at += length;
    return text;
  }

  location() {
    return {
      typeTag: this.byte(),
      classId: this.referenceTypeId(),
      methodId: this.methodId(),
      index: this.long(),
    };
  }

  get remaining() {
    return this.buffer.length - this.at;
  }
}

/** Builds command payloads. */
export class Writer {
  constructor(sizes) {
    this.parts = [];
    this.sizes = sizes;
  }

  byte(value) {
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value, 0);
    this.parts.push(buffer);
    return this;
  }

  int(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(value, 0);
    this.parts.push(buffer);
    return this;
  }

  long(value) {
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64BE(BigInt(value), 0);
    this.parts.push(buffer);
    return this;
  }

  id(value, width) {
    const buffer = Buffer.alloc(width);
    let remaining = BigInt(value);
    for (let index = width - 1; index >= 0; index--) {
      buffer.writeUInt8(Number(remaining & 0xffn), index);
      remaining >>= 8n;
    }
    this.parts.push(buffer);
    return this;
  }

  objectId(value) { return this.id(value, this.sizes.objectId); }
  referenceTypeId(value) { return this.id(value, this.sizes.referenceTypeId); }
  methodId(value) { return this.id(value, this.sizes.methodId); }
  fieldId(value) { return this.id(value, this.sizes.fieldId); }
  frameId(value) { return this.id(value, this.sizes.frameId); }

  string(text) {
    const encoded = Buffer.from(text, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(encoded.length, 0);
    this.parts.push(length, encoded);
    return this;
  }

  location(location) {
    return this.byte(location.typeTag)
      .referenceTypeId(location.classId)
      .methodId(location.methodId)
      .long(location.index);
  }

  build() {
    return Buffer.concat(this.parts);
  }
}

/**
 * A live JDWP connection.
 *
 * Commands are promises matched by packet id; events arrive on a callback. That split
 * is the whole reason this is usable from Node at all - the JVM interleaves them freely
 * on one socket, and a request/response abstraction that ignored events would deadlock
 * the first time a breakpoint was hit while a command was in flight.
 */
export class JdwpConnection {
  #socket;
  #buffer = Buffer.alloc(0);
  #pending = new Map();
  #nextId = 1;
  #onEvent;
  #closed = false;

  constructor(socket, { onEvent }) {
    this.#socket = socket;
    this.#onEvent = onEvent;
    /** Filled by `handshake()`. Nothing containing an id can be parsed before then. */
    this.sizes = null;

    /*
     * The packet listener is attached by `handshake()`, NOT here.
     *
     * The handshake is fourteen raw bytes with no framing, and it has to be read by a
     * one-shot listener. With a persistent listener already attached, both saw the same
     * chunk: the greeting went into the packet buffer AND was handled as a greeting, so
     * the buffer began with the ASCII "JDWP-Handshake" - whose first four bytes read as
     * a packet length of about 1.2 billion. The parser then waited for a packet that
     * would never arrive and the connection hung with no error at all.
     */
    socket.on('close', () => {
      this.#closed = true;
      for (const resolve of this.#pending.values()) resolve({ errorCode: -1, data: Buffer.alloc(0) });
      this.#pending.clear();
    });
    socket.on('error', () => { this.#closed = true; });
  }

  static async connect(port, host = '127.0.0.1', { onEvent } = {}) {
    const socket = net.connect(port, host);
    socket.setNoDelay(true);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    return new JdwpConnection(socket, { onEvent });
  }

  get closed() {
    return this.#closed;
  }

  /**
   * Exchange the handshake and read the id sizes.
   *
   * The handshake is raw: fourteen ASCII bytes each way with no length prefix, so it
   * must be consumed before the packet parser is allowed near the stream.
   */
  async handshake() {
    const reply = await new Promise((resolve, reject) => {
      const onData = chunk => {
        this.#socket.off('error', reject);
        resolve(chunk);
      };
      this.#socket.once('data', onData);
      this.#socket.once('error', reject);
      this.#socket.write(HANDSHAKE);
    });

    if (reply.toString('latin1', 0, HANDSHAKE.length) !== HANDSHAKE) {
      throw new Error('not a JDWP peer');
    }

    // Anything the JVM sent in the same TCP segment after the handshake is a real
    // packet and must not be dropped.
    if (reply.length > HANDSHAKE.length) {
      this.#buffer = Buffer.concat([this.#buffer, reply.subarray(HANDSHAKE.length)]);
    }

    // Only now is every byte on the wire a packet.
    this.#socket.on('data', chunk => this.#consume(chunk));

    // Widths first, with a provisional all-8 guess: IDSizes itself contains no ids,
    // so it is the one command that can be parsed without knowing them.
    this.sizes = { fieldId: 8, methodId: 8, objectId: 8, referenceTypeId: 8, frameId: 8 };
    const { data } = await this.command(SET.VIRTUAL_MACHINE, 7);
    this.sizes = {
      fieldId: data.readUInt32BE(0),
      methodId: data.readUInt32BE(4),
      objectId: data.readUInt32BE(8),
      referenceTypeId: data.readUInt32BE(12),
      frameId: data.readUInt32BE(16),
    };

    // Only now can the parser make sense of a packet, so events start flowing here.
    this.#drain();
    return this.sizes;
  }

  #consume(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    this.#drain();
  }

  #drain() {
    if (!this.sizes) return;

    while (this.#buffer.length >= 11) {
      const length = this.#buffer.readUInt32BE(0);
      if (length < 11 || this.#buffer.length < length) break;

      const packet = this.#buffer.subarray(0, length);
      this.#buffer = this.#buffer.subarray(length);

      const id = packet.readUInt32BE(4);
      const flags = packet.readUInt8(8);

      if (flags & 0x80) {
        const resolve = this.#pending.get(id);
        this.#pending.delete(id);
        resolve?.({ errorCode: packet.readUInt16BE(9), data: packet.subarray(11) });
        continue;
      }

      // A command FROM the VM. In practice only Event.Composite (64/100).
      if (packet.readUInt8(9) === SET.EVENT && packet.readUInt8(10) === 100) {
        try {
          this.#onEvent?.(this.#parseComposite(packet.subarray(11)));
        } catch {
          // A malformed event must not kill the session.
        }
      }
    }
  }

  /**
   * One Event.Composite packet: a suspend policy and a list of events.
   *
   * Only the kinds this debugger asked for are decoded; anything else is reported with
   * its kind so a caller can see it arrived rather than having it silently dropped.
   */
  #parseComposite(payload) {
    const reader = new Reader(payload, this.sizes);
    const suspendPolicy = reader.byte();
    const count = reader.int();
    const events = [];

    for (let index = 0; index < count; index++) {
      const kind = reader.byte();
      const requestId = reader.int();

      if (kind === EVENT_KIND.BREAKPOINT || kind === EVENT_KIND.SINGLE_STEP) {
        events.push({ kind, requestId, thread: reader.objectId(), location: reader.location() });
        continue;
      }
      if (kind === EVENT_KIND.CLASS_PREPARE) {
        events.push({
          kind,
          requestId,
          thread: reader.objectId(),
          refTypeTag: reader.byte(),
          typeId: reader.referenceTypeId(),
          signature: reader.string(),
          status: reader.int(),
        });
        continue;
      }
      if (kind === EVENT_KIND.EXCEPTION) {
        events.push({
          kind,
          requestId,
          thread: reader.objectId(),
          location: reader.location(),
          exception: { tag: reader.byte(), objectId: reader.objectId() },
          catchLocation: reader.location(),
        });
        continue;
      }
      if (kind === EVENT_KIND.VM_START) {
        events.push({ kind, requestId, thread: reader.objectId() });
        continue;
      }
      if (kind === EVENT_KIND.VM_DEATH) {
        events.push({ kind, requestId });
        continue;
      }

      // Unknown kind: the rest of the packet cannot be parsed, because event bodies
      // are variable length and there is no way to skip one safely.
      events.push({ kind, requestId, undecodable: true });
      break;
    }

    return { suspendPolicy, events };
  }

  /** Send a command and wait for its reply. */
  command(set, commandId, data = Buffer.alloc(0)) {
    if (this.#closed) return Promise.resolve({ errorCode: -1, data: Buffer.alloc(0) });

    const id = this.#nextId++;
    const header = Buffer.alloc(11);
    header.writeUInt32BE(11 + data.length, 0);
    header.writeUInt32BE(id, 4);
    header.writeUInt8(0, 8);
    header.writeUInt8(set, 9);
    header.writeUInt8(commandId, 10);

    return new Promise(resolve => {
      this.#pending.set(id, resolve);
      try {
        this.#socket.write(Buffer.concat([header, data]));
      } catch {
        this.#pending.delete(id);
        resolve({ errorCode: -1, data: Buffer.alloc(0) });
      }
    });
  }

  writer() {
    return new Writer(this.sizes);
  }

  reader(data) {
    return new Reader(data, this.sizes);
  }

  close() {
    this.#closed = true;
    try {
      this.#socket.destroy();
    } catch {
      /* already gone */
    }
  }
}

export { TAG };
