/**
 * FROZEN CONTRACT - the interactive stdin session protocol.
 *
 * The output stream is the response body of the same request that starts the
 * program. Event names and the stdin/close routes are consumed by
 * src/components/interactive-console.ts and must not change shape.
 *
 * Frozen v1 event names: session, stdout, stderr, waiting, ping, exit.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runInteractive, startServer } from './support/server.mjs';
import { requires } from './support/toolchain.mjs';

let server;

before(async () => {
  server = await startServer();
});

after(async () => {
  await server?.stop();
});

describe('POST /api/run/interactive', () => {
  it('rejects a missing language with 400', async () => {
    const { status } = await server.postJson('/api/run/interactive', { code: 'x' });
    assert.equal(status, 400);
  });

  it('rejects an unsupported language with 400', async () => {
    const { status, body } = await server.postJson('/api/run/interactive', {
      language: 'ruby',
      code: 'puts 1',
    });
    assert.equal(status, 400);
    assert.match(body.error, /Unsupported language/);
  });

  it('applies the same security validation as /api/run', async () => {
    const { status, body } = await server.postJson('/api/run/interactive', {
      language: 'javascript',
      code: 'require("child_process").execSync("id")',
    });
    assert.equal(status, 403);
    assert.equal(body.blocked, true);
  });

  it('answers a compile error as JSON, never as a live session', async () => {
    const result = await runInteractive(server, {
      language: 'typescript',
      code: 'const x: number = ;',
    });

    assert.ok(result.compile, 'expected a { compile } JSON body');
    assert.equal(result.compile.phase, 'compile');
    assert.notEqual(result.compile.exitCode, 0);
    assert.equal(result.events.length, 0, 'a compile failure must not open a session');
  });

  it('streams NDJSON starting with a session event and ending with exit', requires('python'), async () => {
    const result = await runInteractive(server, {
      language: 'python',
      code: 'print("first")\nprint("second")',
    });

    assert.equal(result.events[0].type, 'session');
    assert.match(result.sessionId, /^[0-9a-f]{32}$/);

    const last = result.events.at(-1);
    assert.equal(last.type, 'exit');
    assert.equal(last.exitCode, 0);
    assert.equal(typeof last.durationMs, 'number');

    const stdout = result.events
      .filter(event => event.type === 'stdout')
      .map(event => event.data)
      .join('');
    assert.match(stdout, /first/);
    assert.match(stdout, /second/);
  });

  it('only emits the frozen v1 event names', requires('python'), async () => {
    const result = await runInteractive(server, {
      language: 'python',
      code: 'print("x")',
    });

    const allowed = new Set(['session', 'stdout', 'stderr', 'waiting', 'ping', 'exit']);
    for (const event of result.events) {
      assert.ok(allowed.has(event.type), `unexpected event type "${event.type}"`);
    }
  });

  it('delivers stdin and lets the program consume it', requires('python'), async () => {
    const result = await runInteractive(
      server,
      {
        language: 'python',
        code: 'name = input("Name: ")\nprint(f"Hello {name}")',
      },
      {
        async onEvent(event, sessionId) {
          // "waiting" means the program has gone quiet and may be blocked on a
          // read. Answering it is exactly what the console UI does.
          if (event.type === 'waiting' && sessionId) {
            const reply = await server.postJson(
              `/api/run/interactive/${sessionId}/stdin`,
              { data: 'Ada' },
            );
            assert.equal(reply.status, 200);
            assert.equal(reply.body.ok, true);
          }
        },
      },
    );

    const stdout = result.events
      .filter(event => event.type === 'stdout')
      .map(event => event.data)
      .join('');

    assert.match(stdout, /Name:/);
    assert.match(stdout, /Hello Ada/);
    assert.equal(result.events.at(-1).exitCode, 0);
  });

  it('runs a multi-file project interactively', requires('python'), async () => {
    const result = await runInteractive(
      server,
      {
        language: 'python',
        files: [
          { path: 'main.py', content: 'from ask import ask\nprint(ask())', isMain: true },
          { path: 'ask.py', content: 'def ask():\n    return "got:" + input("q? ")' },
        ],
        entryPoint: 'main.py',
      },
      {
        async onEvent(event, sessionId) {
          if (event.type === 'waiting' && sessionId) {
            await server.postJson(`/api/run/interactive/${sessionId}/stdin`, { data: 'yes' });
          }
        },
      },
    );

    const stdout = result.events
      .filter(event => event.type === 'stdout')
      .map(event => event.data)
      .join('');
    assert.match(stdout, /got:yes/);
  });

  it('answers stdin for an unknown session with 410', async () => {
    const { status, body } = await server.postJson(
      '/api/run/interactive/ffffffffffffffffffffffffffffffff/stdin',
      { data: 'x' },
    );
    assert.equal(status, 410);
    assert.match(body.error, /not running/i);
  });

  it('answers close for an unknown session with ok', async () => {
    // Close is deliberately idempotent and forgiving: the client calls it on
    // teardown and must not see an error for an already-finished session.
    const { status, body } = await server.postJson(
      '/api/run/interactive/ffffffffffffffffffffffffffffffff/close',
      {},
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it('terminates a running program on close', requires('python'), async () => {
    const result = await runInteractive(
      server,
      {
        language: 'python',
        code: 'x = input("waiting: ")\nprint("should not reach here")',
      },
      {
        async onEvent(event, sessionId) {
          if (event.type === 'waiting' && sessionId) {
            await server.postJson(`/api/run/interactive/${sessionId}/close`, {});
          }
        },
      },
    );

    const last = result.events.at(-1);
    assert.equal(last.type, 'exit');

    const stdout = result.events
      .filter(event => event.type === 'stdout')
      .map(event => event.data)
      .join('');
    assert.doesNotMatch(stdout, /should not reach here/);
  });
});
