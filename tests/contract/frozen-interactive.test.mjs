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
    // Opaque and URL-safe. The format is deliberately NOT pinned: it now carries
    // the owning replica so stdin can be forwarded there (V-08), and a client only
    // ever echoes it back in a path segment.
    assert.match(result.sessionId, /^[A-Za-z0-9_.-]{16,200}$/);

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

describe('the waiting hint distinguishes a prompt from slow work', () => {
  // Every run streams now, not only the ones a regex thought would read input.
  // That makes the hint's accuracy matter: announcing "ready for input" whenever a
  // program goes quiet would fire for anything that computes for a moment, and a
  // prompt the student learns to ignore is worse than no prompt.
  //
  // The signal is the trailing newline. A prompt is written WITHOUT one, because
  // the caret belongs on the same line; ordinary output ends with one.

  it('does not announce input for a program that prints a line and then works', async () => {
    const result = await runInteractive(server, {
      language: 'javascript',
      version: 'es2022',
      // Ends with a newline, then computes for ~1s. Under a flat timer this
      // reported "waiting for input" after 250ms.
      code: 'console.log("starting");\nsetTimeout(() => console.log("done"), 1000);',
    });

    const waiting = result.events.filter(event => event.type === 'waiting');
    assert.equal(
      waiting.length,
      0,
      'a program that is merely computing must not be announced as waiting for input',
    );
    assert.equal(result.events.at(-1).exitCode, 0);
  });

  it('does announce input for output left mid-line', async () => {
    let answered = false;
    const result = await runInteractive(
      server,
      {
        language: 'javascript',
        version: 'es2022',
        // No trailing newline: the shape of every real prompt.
        code: [
          'process.stdout.write("Name: ");',
          'process.stdin.once("data", d => {',
          '  console.log("hi " + String(d).trim());',
          '  process.stdin.pause();',
          '});',
        ].join('\n'),
      },
      {
        async onEvent(event, sessionId) {
          if (event.type === 'waiting' && sessionId && !answered) {
            answered = true;
            await server.postJson(`/api/run/interactive/${sessionId}/stdin`, { data: 'Ada' });
            // Then end input, the way Ctrl+D does. Node keeps the event loop
            // alive while stdin is open, so without EOF this program would run
            // until the idle timeout even though it has nothing left to do -
            // which is exactly the situation the console's new End-input control
            // exists for.
            await server.postJson(`/api/run/interactive/${sessionId}/eof`, {});
          }
        },
      },
    );

    assert.ok(
      result.events.some(event => event.type === 'waiting'),
      'a prompt left mid-line must be announced so the caret appears',
    );
    const stdout = result.events
      .filter(event => event.type === 'stdout')
      .map(event => event.data)
      .join('');
    assert.match(stdout, /hi Ada/);
  });
});
