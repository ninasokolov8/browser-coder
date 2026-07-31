/**
 * DEFECT GATES - each test asserts the CORRECT behaviour and names the
 * blueprint finding it closes.
 *
 * Every test here is marked `todo` while the defect is open, so it reports as
 * TODO rather than as a pass or a failure. Phase B removes the marker one
 * finding at a time; a test that has lost its marker is a permanent gate.
 *
 * This is deliberately the inverse of freezing current behaviour. A golden test
 * that asserted "output-limit termination reports exit 0" would make the bug a
 * contract and block the fix.
 *
 * Baseline recorded 2026-07-30 against full_refactor @ d4b0cd6:
 *   21 gates failing, 2 skipped (no python3 on the authoring host), 1 already
 *   passing and therefore promoted to a permanent gate.
 *
 * After Phase A3/A4 (single execution pipeline over language adapters):
 *   10 further gates closed and promoted to permanent - V-06, V-26 (all four),
 *   N-11, N-12 (both), V-29, V-31 (both). They were fixed structurally rather
 *   than individually: one canonical path validator, one termination model, one
 *   streaming output decoder and per-job directories close a defect class each.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { runInteractive, startServer } from './support/server.mjs';
import { requires } from './support/toolchain.mjs';

let server;

before(async () => {
  server = await startServer();
});

after(async () => {
  await server?.stop();
});

/** Marks a defect gate as still open. Delete the call when the fix lands. */
const open = id => ({ todo: `${id} not yet fixed` });

/**
 * A defect gate that also needs a toolchain. Missing toolchain wins, so a host
 * without javac reports "not verified" rather than implying the fix is pending.
 */
const openIf = (languageId, id) => requires(languageId).skip ? requires(languageId) : open(id);

describe('V-01 turtle stdout path is a confused deputy', () => {
  it(
    'never opens a filesystem path named by user stdout',
    // Must be gated: without a working python3 the program never runs, never
    // prints the sentinel, and the test passes vacuously - a false green on the
    // most severe finding in the repository.
    requires('python'),
    async t => {
      // Needs a filesystem both sides can see, so a canary can be planted where
      // the server would read it if it still trusted a path from stdout. Against
      // a container there is no such shared path, so this skips rather than
      // passing vacuously; the container run covers the same fix through the
      // turtle-graphics tests.
      if (!server.sandboxRoot) {
        t.skip('needs a host-visible job root; not available against a remote server');
        return;
      }

      // A program that prints the turtle file sentinel must not cause the API
      // to read - or delete - the named path with its own privileges.
      const canary = `${server.sandboxRoot.replace(/\\/g, '/')}/canary.json`;
      const { default: fs } = await import('node:fs');
      fs.writeFileSync(canary, '{"shapes":[{"marker":"read-via-stdout"}]}');

      const { body } = await server.postJson('/api/run', {
        language: 'python',
        version: 'python3',
        code: `print("__TURTLE_FILE__:${canary}")`,
      });

      assert.equal(
        body.turtleData,
        null,
        'the server parsed a file whose path came from user stdout',
      );
      assert.ok(
        fs.existsSync(canary),
        'the server deleted a file whose path came from user stdout',
      );
    },
  );
});

describe('V-02 turtle marker bytes bypass the output limit', () => {
  it(
    'counts withheld sentinel bytes against a hard cap',
    requires('python'),
    async () => {
      // An unterminated sentinel must not accumulate without bound ahead of the
      // ordinary output budget.
      //
      // Uses print() rather than sys.stdout.write: `import sys` is refused by the
      // policy corpus, so the earlier version of this test was rejected before it
      // ran and reported zero events - passing for entirely the wrong reason.
      const result = await runInteractive(server, {
        language: 'python',
        code: [
          'print("__TURTLE_", end="")',
          'for _ in range(200000):',
          '    print("A" * 100, end="")',
        ].join('\n'),
      });

      const last = result.events.at(-1);
      assert.equal(last.type, 'exit');
      assert.ok(
        last.note === 'output-limit' || last.exitCode !== 0,
        'unbounded sentinel accumulation was not stopped by a limit',
      );
    },
  );
});

describe('V-03 / V-04 preview documents execute on the IDE origin', () => {
  it('sends a sandbox CSP directive on a directly navigated HTML asset', async () => {
      const publish = await server.postJson('/api/previews', {
        entryPath: 'index.html',
        files: [{ path: 'index.html', content: '<script>document.title=1</script>' }],
      });

      const direct = await server.get(`/preview/${publish.body.id}/index.html`);
      const csp = direct.headers.get('content-security-policy') || '';

      assert.match(
        csp,
        /sandbox/,
        'a directly navigated user document received no CSP sandbox directive, so its scripts run with IDE-origin authority',
      );
    },
  );

  it('does not let sandboxed preview content escape via popups', async () => {
      const publish = await server.postJson('/api/previews', {
        entryPath: 'index.html',
        files: [{ path: 'index.html', content: '<h1>x</h1>' }],
      });

      const shell = await server.get(`/preview/${publish.body.id}`);
      assert.doesNotMatch(
        shell.text,
        /allow-popups-to-escape-sandbox/,
        'the wrapper grants allow-popups-to-escape-sandbox, letting user code open a same-origin document unsandboxed',
      );
    },
  );

  it('serves a script-capable SVG without letting it execute as a document', async () => {
      const publish = await server.postJson('/api/previews', {
        entryPath: 'index.html',
        files: [
          { path: 'index.html', content: '<h1>x</h1>' },
          { path: 'evil.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>' },
        ],
      });

      const svg = await server.get(`/preview/${publish.body.id}/evil.svg`);
      const csp = svg.headers.get('content-security-policy') || '';
      const disposition = svg.headers.get('content-disposition') || '';

      assert.ok(
        /sandbox/.test(csp) || /attachment/.test(disposition),
        'a script-capable SVG is served inline with no sandbox and no download disposition',
      );
    },
  );
});

describe('V-06 C# multi-file can reach MSBuild', () => {
  it('rejects an MSBuild control file supplied as a project file', async () => {
      const { status, body } = await server.postJson('/api/run', {
        language: 'csharp',
        version: 'csharp12',
        files: [
          { path: 'Program.cs', content: 'System.Console.WriteLine("ok");', isMain: true },
          {
            path: 'Directory.Build.targets',
            content:
              '<Project><Target Name="Pwn" BeforeTargets="Build"><Exec Command="echo pwned" /></Target></Project>',
          },
        ],
        entryPoint: 'Program.cs',
      });

      assert.equal(
        status,
        400,
        'a user-supplied MSBuild control file was accepted into the build',
      );
      assert.match(body.error, /\.targets|project file|not allowed/i);
    },
  );
});

describe('V-20 signal and output-limit termination must not report success', () => {
  it('reports a nonzero exit code when output is truncated', async () => {
      const { body } = await server.postJson('/api/run', {
        language: 'javascript',
        version: 'es2022',
        code: 'for (let i = 0; i < 5_000_000; i++) console.log("flood-".repeat(10))',
      });

      assert.match(body.stdout, /output truncated/);
      assert.notEqual(
        body.exitCode,
        0,
        'a run killed for exceeding the output cap reported success',
      );
    },
  );

  // Already correct: the wall-clock path sets `killed` before signalling, so it
  // maps to -1. Promoted to a permanent gate so the output-cap fix cannot
  // regress it - the two paths share the same exit-code expression.
  it('reports a nonzero exit code when the wall-clock timeout fires', async () => {
      const { body } = await server.postJson('/api/run', {
        language: 'javascript',
        version: 'es2022',
        code: 'while (true) {}',
      });

      assert.notEqual(body.exitCode, 0, 'a timed-out run reported success');
    },
  );
});

describe('V-23 / V-24 job isolation', () => {
  it(
    'gives two concurrent same-class Java runs disjoint workspaces',
    requires('java'),
    async () => {
      const program = marker => `public class Main {
  public static void main(String[] a) { System.out.println("${marker}"); }
}`;

      const [first, second] = await Promise.all([
        server.postJson('/api/run', { language: 'java', version: 'java17', code: program('AAA') }),
        server.postJson('/api/run', { language: 'java', version: 'java17', code: program('BBB') }),
      ]);

      // Exact bytes: stdout is no longer trimmed, so println's newline is present.
      assert.equal(first.body.stdout, 'AAA\n', `got: ${first.body.stdout} / ${first.body.stderr}`);
      assert.equal(second.body.stdout, 'BBB\n', `got: ${second.body.stdout} / ${second.body.stderr}`);
    },
  );

  it('gives each concurrent run its own private directory', async () => {
    // The property under test is that two concurrent runs cannot see each
    // other's files. Previously every job shared one temp root and a single-file
    // JS run was granted --allow-fs-read over the whole of it.
    //
    // process.cwd() is not usable as a probe: the policy corpus blocks it, and
    // correctly so. import.meta.url is not blocked and reveals the directory the
    // program was loaded from, which is exactly the boundary in question.
    const probe = 'console.log(new URL(import.meta.url).pathname)';

    const [first, second] = await Promise.all([
      server.postJson('/api/run', { language: 'javascript', version: 'es2022', code: probe }),
      server.postJson('/api/run', { language: 'javascript', version: 'es2022', code: probe }),
    ]);

    assert.equal(first.body.exitCode, 0, `stderr: ${first.body.stderr}`);
    assert.equal(second.body.exitCode, 0, `stderr: ${second.body.stderr}`);

    const dirOf = out => out.trim().split('/').slice(0, -1).join('/');
    const a = dirOf(first.body.stdout);
    const b = dirOf(second.body.stdout);

    assert.ok(a.length > 0 && b.length > 0, 'could not determine the job directory');
    assert.notEqual(
      a,
      b,
      "two concurrent runs shared one directory, so each could read the other's source",
    );
    assert.match(a, /job-/, 'the run did not execute inside a per-job directory');
  });
});

describe('V-26 canonical path validation', () => {
  it('rejects duplicate paths in one project', async () => {
    const { status, body } = await server.postJson('/api/run', {
      language: 'python',
      version: 'python3',
      files: [
        { path: 'main.py', content: 'print(1)' },
        { path: 'main.py', content: 'print(2)' },
      ],
      entryPoint: 'main.py',
    });

    assert.equal(status, 400, 'duplicate project paths were silently accepted');
    assert.match(body.error, /duplicate/i);
  });

  it('rejects a NUL byte in a path', async () => {
    const { status } = await server.postJson('/api/run', {
      language: 'python',
      version: 'python3',
      files: [{ path: 'ma\u0000in.py', content: 'print(1)' }],
    });

    assert.equal(status, 400, 'a NUL byte in a path was accepted');
  });

  it('rejects a POSIX-absolute path instead of silently relativizing it', async () => {
    // Normalization strips the leading slash before the startsWith('/') check
    // runs, so the absolute-path rejection is unreachable and "/etc/passwd.py"
    // is quietly rewritten to "etc/passwd.py" and accepted.
    const { status } = await server.postJson('/api/run', {
      language: 'python',
      version: 'python3',
      files: [{ path: '/etc/passwd.py', content: 'print(1)' }],
    });

    assert.equal(status, 400, 'an absolute path was silently rewritten to a relative one');
  });

  it('rejects two paths that normalize to the same file', async () => {
    // Direct consequence of the above: "/main.py" and "main.py" both become
    // "main.py", so one file silently overwrites the other on disk.
    const { status } = await server.postJson('/api/run', {
      language: 'python',
      version: 'python3',
      files: [
        { path: '/main.py', content: 'print("first")' },
        { path: 'main.py', content: 'print("second")' },
      ],
      entryPoint: 'main.py',
    });

    assert.equal(status, 400, 'two paths collapsing to one file were accepted');
  });

  it('reports an unknown entryPoint distinctly from a missing one', async () => {
    const { body } = await server.postJson('/api/run', {
      language: 'python',
      version: 'python3',
      files: [{ path: 'main.py', content: 'print(1)' }],
      entryPoint: 'nope.py',
    });

    // The dedicated branch exists at server.mjs:3803 but is unreachable: when
    // the requested entry point is absent, find() returns undefined and the
    // earlier "No entry file was provided" branch answers first.
    assert.match(
      body.error,
      /entryPoint/,
      'an unknown entryPoint is reported as if no entry file was supplied at all',
    );
  });

  it('rejects a path that is both a file and a directory prefix', async () => {
    const { status } = await server.postJson('/api/run', {
      language: 'python',
      version: 'python3',
      files: [
        { path: 'pkg', content: 'print(1)' },
        { path: 'pkg/mod.py', content: 'print(2)' },
      ],
    });

    assert.equal(status, 400, 'a file/directory prefix collision was accepted');
  });
});

describe('V-29 health must separate liveness from saturation', () => {
  it('exposes /live and /ready as distinct endpoints', async () => {
    const live = await server.get('/live');
    const ready = await server.get('/ready');

    assert.equal(live.status, 200, '/live is missing');
    assert.equal(ready.status, 200, '/ready is missing');
  });
});

describe('V-31 output byte fidelity', () => {
  it('preserves leading and trailing whitespace in program output', async () => {
      const { body } = await server.postJson('/api/run', {
        language: 'javascript',
        version: 'es2022',
        code: 'process.stdout.write("  indented and padded  ")',
      });

      assert.equal(
        body.stdout,
        '  indented and padded  ',
        'output was trimmed, destroying whitespace the program actually wrote',
      );
    },
  );

  it('decodes multi-byte characters split across chunk boundaries', async () => {
      // Written in many separate bursts so the bytes genuinely cross pipe-chunk
      // boundaries. One large write can arrive as a single chunk, which would
      // let this pass without exercising the boundary it exists to check.
      const { body } = await server.postJson('/api/run', {
        language: 'javascript',
        version: 'es2022',
        code: [
          'const s = "\\u{1F600}\\u05D0\\u4E2D".repeat(48);',
          'for (let i = 0; i < 150; i++) process.stdout.write(s);',
        ].join('\n'),
      });

      assert.doesNotMatch(
        body.stdout,
        /�/,
        'output contains replacement characters - a multi-byte sequence was split across chunks',
      );
    },
  );
});

describe('V-32 requested version must be honoured or refused', () => {
  it('rejects an unknown version instead of silently ignoring it', open('V-32'), async () => {
    const { status, body } = await server.postJson('/api/run', {
      language: 'python',
      version: 'python-does-not-exist',
      code: 'print(1)',
    });

    assert.equal(
      status,
      400,
      'an unknown version was accepted and silently ignored',
    );
    assert.match(body.error, /version/i);
  });
});

describe('V-33 Java project entrypoints', () => {
  it(
    'launches a nested, packaged main class by its fully qualified name',
    requires('java'),
    async () => {
      const { body } = await server.postJson('/api/run', {
        language: 'java',
        version: 'java17',
        files: [
          {
            path: 'src/app/Main.java',
            content: 'package app;\npublic class Main { public static void main(String[] a){ System.out.println("nested-ok"); } }',
            isMain: true,
          },
        ],
        entryPoint: 'src/app/Main.java',
      });

      assert.equal(body.exitCode, 0, `stderr was: ${body.stderr}`);
      assert.equal(body.stdout, 'nested-ok\n');
    },
  );
});

describe('N-01 rate-limit identity must not be client-controlled', () => {
  it('does not exempt a caller who claims a private address in X-Forwarded-For', async () => {
      // The limiter exempts private source addresses, and Express is configured
      // to trust every hop, so a forged forwarded-for entry disables it.
      // Assert the exemption is not reachable from a request header.
      const probe = await server.get('/api/stats', {
        headers: { 'X-Forwarded-For': '10.0.0.1' },
      });

      assert.equal(probe.status, 200);
      assert.ok(
        probe.headers.has('x-ratelimit-remaining'),
        'a request claiming a private forwarded-for address bypassed the rate limiter entirely',
      );
    },
  );
});

describe('V-45 / N-08 the report plane must not be public', () => {
  it('refuses to start the security suite for an anonymous caller', async () => {
    const { status } = await server.postJson('/api/reports/run-tests', {});
    assert.ok(
      status === 401 || status === 403 || status === 404,
      `an anonymous request was allowed to start the security suite (status ${status})`,
    );
  });

  it('does not expose operational terminal output anonymously', async () => {
    const { status } = await server.get('/api/reports/output');
    assert.ok(
      status === 401 || status === 403 || status === 404,
      `operational terminal output is readable anonymously (status ${status})`,
    );
  });
});

describe('V-46 CORS must actually reject a disallowed origin', () => {
  it('does not echo a disallowed origin back with credentials', async () => {
    const probe = await server.get('/api/languages', {
      headers: { Origin: 'https://evil.example' },
    });

    const allowOrigin = probe.headers.get('access-control-allow-origin');
    assert.notEqual(
      allowOrigin,
      'https://evil.example',
      'a disallowed origin was echoed back in Access-Control-Allow-Origin',
    );
  });
});

describe('N-13 the starter route must not be a path traversal primitive', () => {
  // Found while extracting the route into server/http/routes/languages.mjs.
  //
  // Express matches `:language` against a single path SEGMENT of the raw URL and
  // then percent-decodes it, so `..%2Ffoo` contains no literal slash, matches as one
  // segment, and reaches the handler already decoded to `../foo`. The handler joined
  // that straight onto the languages directory.
  //
  // Exploitation needs a file at `<escaped path>/starters/<version>.<ext>`, and for
  // an unrecognised language the extension falls back to `.txt` - so the primitive is
  // constrained but real. Confirmed by removing the guard and reading a file from
  // outside the repository root over plain HTTP, unauthenticated.
  //
  // This test PLANTS such a file, because a probe aimed at a path that does not exist
  // returns 404 whether or not the guard is present, and would pass against the
  // vulnerable code.
  const baitDir = path.join(process.cwd(), 'tests', '.traversal-bait', 'starters');
  const baitFile = path.join(baitDir, 'leak.txt');

  before(() => {
    fs.mkdirSync(baitDir, { recursive: true });
    fs.writeFileSync(baitFile, 'SECRET-OUTSIDE-LANGUAGES', 'utf8');
  });

  after(() => {
    fs.rmSync(path.join(process.cwd(), 'tests', '.traversal-bait'), { recursive: true, force: true });
  });

  it('cannot read a real file outside the languages directory', async () => {
    // From <root>/languages, `../tests/.traversal-bait` resolves to a directory that
    // genuinely holds starters/leak.txt. Without the containment check this returns
    // 200 and the file's contents.
    const { status, body } = await server.get(
      '/api/starter/..%2Ftests%2F.traversal-bait/leak',
    );

    assert.equal(status, 404, `escaped the languages root: ${JSON.stringify(body).slice(0, 200)}`);
    assert.doesNotMatch(JSON.stringify(body ?? ''), /SECRET-OUTSIDE-LANGUAGES/);
  });

  it('refuses an encoded traversal in the version segment', async () => {
    const { status } = await server.get('/api/starter/python/..%2F..%2Fconfig');
    assert.equal(status, 404);
  });

  it('still serves a legitimate starter', async () => {
    // The guard must not be so blunt that it breaks the endpoint it protects.
    const { status, body } = await server.get('/api/starter/python/python3');
    assert.equal(status, 200);
    assert.equal(typeof body.code, 'string');
  });
});
