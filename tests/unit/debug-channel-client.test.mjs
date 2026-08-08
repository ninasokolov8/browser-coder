import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';

import { createIdeDebugChannel } from '../../languages/shared/debug-channel.mjs';

async function withPeer(run) {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const connection = once(server, 'connection');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const channel = createIdeDebugChannel(address.port);
  const [peer] = await connection;

  try {
    await run(channel, peer);
  } finally {
    channel.close();
    peer.destroy();
    server.close();
    await once(server, 'close');
  }
}

describe('shared debugger IDE channel', () => {
  test('sends one JSON frame per line and closes idempotently', async () => {
    await withPeer(async (channel, peer) => {
      const received = once(peer, 'data');
      channel.send({ type: 'hello', language: 'test' });
      const [chunk] = await received;

      assert.deepEqual(
        JSON.parse(chunk.toString('utf8').trim()),
        { type: 'hello', language: 'test' },
      );
      channel.close();
      channel.close();
    });
  });

  test('waits for readiness, ignores malformed frames, and preserves command order', async () => {
    await withPeer(async (channel, peer) => {
      let markReady;
      const ready = new Promise(resolve => { markReady = resolve; });
      const handled = [];
      let finish;
      const complete = new Promise(resolve => { finish = resolve; });
      const errors = [];

      channel.handleCommands({
        ready,
        async handleCommand(command) {
          if (command.value === 1) await new Promise(resolve => setTimeout(resolve, 5));
          handled.push(command.value);
          if (handled.length === 2) finish();
        },
        reportError(error) {
          errors.push(error);
        },
      });

      peer.write('{"value":1}\nnot-json\n{"value":2}\n');
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.deepEqual(handled, []);

      markReady();
      await complete;
      assert.deepEqual(handled, [1, 2]);
      assert.deepEqual(errors, []);
    });
  });
});
