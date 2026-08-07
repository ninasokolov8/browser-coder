/**
 * A Debug Adapter Protocol client, over a child process's stdio.
 *
 * DAP is what `netcoredbg --interpreter=vscode` speaks, and it is the friendliest of
 * the three protocols this project implements: JSON messages in an LSP-style envelope,
 *
 *     Content-Length: 217\r\n\r\n{"seq":3,"type":"response", ...}
 *
 * with no binary framing, no id widths and no XML. What it does have, which the other
 * two do not, is THREE message types on one stream - `request`, `response` and `event`
 * - travelling in both directions, and a debugger that ignores the ones it did not ask
 * for will hang: the program's own stdout arrives as `output` events, and the moment
 * the program stops arrives as a `stopped` event, neither of them the answer to
 * anything.
 *
 * So this is a correlator: responses are matched to their request by sequence number
 * and resolve a promise; events go to listeners. It is deliberately generic and knows
 * nothing about C#.
 */

import { EventEmitter } from 'node:events';

/** Nothing a debugger legitimately sends approaches this; a bigger claim is a bug. */
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

/**
 * Split a DAP stream into messages.
 *
 * Kept separate from the connection so it can be tested against a byte stream chopped
 * in the places that break naive implementations - inside the header, inside the JSON,
 * and two messages arriving in one chunk.
 */
export class DapFramer {
  #buffer = Buffer.alloc(0);

  /** Feed bytes; returns the messages that are now complete. */
  push(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const messages = [];

    for (;;) {
      const headerEnd = this.#buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return messages;

      const header = this.#buffer.subarray(0, headerEnd).toString('ascii');
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        // No length, no way to find the end. Dropping the header and resyncing on
        // the next one is the only option that does not read JSON as garbage.
        this.#buffer = this.#buffer.subarray(headerEnd + 4);
        continue;
      }

      const length = Number(match[1]);
      if (!Number.isFinite(length) || length < 0 || length > MAX_MESSAGE_BYTES) {
        this.#buffer = this.#buffer.subarray(headerEnd + 4);
        continue;
      }

      // The length is in BYTES, not characters: a message containing one non-ASCII
      // character is one byte longer than its string length, and slicing by
      // characters leaves the next header starting mid-message.
      const bodyStart = headerEnd + 4;
      if (this.#buffer.length < bodyStart + length) return messages;

      const body = this.#buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.#buffer = this.#buffer.subarray(bodyStart + length);

      try {
        messages.push(JSON.parse(body));
      } catch {
        // A message that is not JSON is not recoverable, but the stream after it
        // still is - the length told us exactly where it ended.
      }
    }
  }
}

/** Encode one message with its header. */
export function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
    body,
  ]);
}

/**
 * A DAP session with one debug adapter process.
 *
 * Emits every event by name (`stopped`, `output`, `terminated`, ...) plus `'*'` for
 * anything a caller wants to see generically.
 */
export class DapConnection extends EventEmitter {
  #stdin;
  #framer = new DapFramer();
  #pending = new Map();
  #nextSeq = 1;
  #closed = false;

  constructor(stdin, stdout) {
    super();
    this.#stdin = stdin;
    stdout.on('data', chunk => this.#consume(chunk));
    stdout.on('close', () => this.#fail());
    stdin.on('error', () => this.#fail());
  }

  get closed() {
    return this.#closed;
  }

  #fail() {
    if (this.#closed) return;
    this.#closed = true;
    // Anything still waiting would otherwise wait forever.
    for (const resolve of this.#pending.values()) {
      resolve({ success: false, message: 'the debugger disconnected' });
    }
    this.#pending.clear();
    this.emit('closed');
  }

  #consume(chunk) {
    for (const message of this.#framer.push(chunk)) {
      if (message.type === 'response') {
        const resolve = this.#pending.get(message.request_seq);
        this.#pending.delete(message.request_seq);
        resolve?.(message);
        continue;
      }

      if (message.type === 'event') {
        this.emit('*', message);
        this.emit(message.event, message.body ?? {});
        continue;
      }

      // A request FROM the adapter - `runInTerminal` is the only one in practice,
      // and this project never launches a terminal. Answering "not supported" is
      // better than silence, which leaves the adapter waiting.
      if (message.type === 'request') {
        this.#write({
          seq: this.#nextSeq++,
          type: 'response',
          request_seq: message.seq,
          command: message.command,
          success: false,
          message: 'not supported',
        });
      }
    }
  }

  #write(message) {
    if (this.#closed) return;
    try {
      this.#stdin.write(encodeMessage(message));
    } catch {
      this.#fail();
    }
  }

  /**
   * Send a request and wait for its response.
   *
   * Resolves with the whole response, including `success: false` ones - a failed
   * request is an answer, not an exception. A debugger that threw on every "cannot
   * evaluate that" would need a try/catch around every call site.
   */
  request(command, args = undefined) {
    if (this.#closed) {
      return Promise.resolve({ success: false, message: 'the debugger is not running' });
    }

    const seq = this.#nextSeq++;
    const answer = new Promise(resolve => this.#pending.set(seq, resolve));
    this.#write({ seq, type: 'request', command, ...(args === undefined ? {} : { arguments: args }) });
    return answer;
  }

  /** Wait for one event, with a bound so a missing one does not hang the run. */
  waitForEvent(name, timeoutMs = 15000) {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.off(name, onEvent);
        resolve(null);
      }, timeoutMs);

      const onEvent = body => {
        clearTimeout(timer);
        resolve(body);
      };
      this.once(name, onEvent);
    });
  }
}
