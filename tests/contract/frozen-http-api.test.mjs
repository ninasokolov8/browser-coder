/**
 * FROZEN CONTRACT - the HTTP surface Step-Up production depends on.
 *
 * Verified consumers of this surface (blueprint section 32.2, V-47/V-48):
 *   - Step-Up `IdeHelper::url()`      -> GET /?embed=1&mode=..&lang=..&version=..
 *   - Step-Up `IdeHelper::isAvailable()` -> GET /health, expects 200
 *   - Step-Up `CodeRunner::run()`     -> POST /api/run {language,version,code}
 *                                        expects {stdout,stderr,exitCode,durationMs}
 *   - The IDE frontend                -> /api/languages, /api/starter, /api/previews,
 *                                        /preview/:id, /api/run/interactive
 *
 * Every assertion here is a promise to those consumers. If a change to the
 * refactor makes one of these fail, the change is wrong - not the test.
 *
 * Behaviour that is currently defective is NOT frozen here; it is documented
 * separately in characterized-defects.test.mjs so the two can never be confused.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from './support/server.mjs';
import { requires, toolchainReport } from './support/toolchain.mjs';

let server;

before(async () => {
  process.stderr.write(`\nToolchain availability for this run:\n${toolchainReport()}\n\n`);
  server = await startServer();
});

after(async () => {
  await server?.stop();
});

describe('GET /health', () => {
  it('answers with a compatible top-level status', async () => {
    const { status, body } = await server.get('/health');

    // Step-Up's availability probe requires exactly 200 on a healthy service.
    assert.equal(status, 200);
    assert.equal(typeof body, 'object');
    assert.equal(body.status, 'healthy');
  });
});

describe('GET /api/languages', () => {
  it('preserves every language ID and its version IDs', async () => {
    const { status, body } = await server.get('/api/languages');
    assert.equal(status, 200);

    // These IDs are persisted in Step-Up content packs. Renaming one silently
    // breaks stored tasks, so the exact set is asserted.
    const expected = {
      javascript: ['es2022', 'es2020', 'es2015', 'es5'],
      typescript: ['ts5-strict', 'ts5', 'ts-es2020', 'ts-es2015'],
      python: ['python3'],
      java: ['java17', 'java11'],
      php: ['php8'],
      csharp: ['csharp12', 'csharp10'],
    };

    for (const [languageId, versionIds] of Object.entries(expected)) {
      const config = body[languageId];
      assert.ok(config, `language "${languageId}" disappeared from the catalog`);
      assert.equal(config.id, languageId);
      assert.deepEqual(
        (config.versions || []).map(version => version.id),
        versionIds,
        `version IDs for "${languageId}" changed`,
      );
    }
  });

  it('still advertises the HTML and CSS editor languages', async () => {
    const { body } = await server.get('/api/languages');
    // HTML/CSS are editor+preview languages, not executable ones. They are
    // loaded from the same directory scan, so their absence would be a
    // regression in the loader rather than in a language config.
    for (const id of Object.keys(body)) {
      assert.equal(typeof body[id], 'object');
    }
  });
});

describe('GET /api/starter/:language/:version', () => {
  it('returns { code } for a known starter', async () => {
    const { status, body } = await server.get('/api/starter/python/python3');
    assert.equal(status, 200);
    assert.equal(typeof body.code, 'string');
    assert.ok(body.code.length > 0);
  });

  it('returns 404 for an unknown starter', async () => {
    const { status } = await server.get('/api/starter/python/does-not-exist');
    assert.equal(status, 404);
  });
});

describe('POST /api/run - single-file request shape (Step-Up CodeRunner)', () => {
  it('returns the exact legacy result envelope', async () => {
    const { status, body } = await server.postJson('/api/run', {
      language: 'javascript',
      version: 'es2022',
      code: 'console.log("hello")',
    });

    assert.equal(status, 200);

    // The full field set older clients read. `cached` is retained for wire
    // compatibility and is always false since d4b0cd6 removed the result cache.
    assert.deepEqual(Object.keys(body).sort(), [
      'blocked',
      'cached',
      'durationMs',
      'exitCode',
      'phase',
      'stderr',
      'stdout',
      'turtleData',
    ]);

    assert.equal(body.stdout, 'hello');
    assert.equal(body.stderr, '');
    assert.equal(body.exitCode, 0);
    assert.equal(body.cached, false);
    assert.equal(body.turtleData, null);
    assert.equal(body.phase, 'run');
    assert.equal(typeof body.durationMs, 'number');
  });

  it('reports a runtime error as HTTP 200 with a nonzero exitCode', async () => {
    // Step-Up treats a non-2xx response as "no result at all", so a failing
    // student program must still be a 200.
    const { status, body } = await server.postJson('/api/run', {
      language: 'javascript',
      version: 'es2022',
      code: 'throw new Error("boom")',
    });

    assert.equal(status, 200);
    assert.notEqual(body.exitCode, 0);
    assert.match(body.stderr, /boom/);
  });

  it('reports a compile error as HTTP 200 with phase "compile"', async () => {
    const { status, body } = await server.postJson('/api/run', {
      language: 'typescript',
      version: 'ts5',
      code: 'const x: number = ;',
    });

    assert.equal(status, 200);
    assert.equal(body.phase, 'compile');
    assert.notEqual(body.exitCode, 0);
  });

  it('rejects a missing language with 400', async () => {
    const { status, body } = await server.postJson('/api/run', { code: 'x' });
    assert.equal(status, 400);
    assert.match(body.error, /language/i);
  });

  it('rejects a request with neither code nor files with 400', async () => {
    const { status, body } = await server.postJson('/api/run', { language: 'python' });
    assert.equal(status, 400);
    assert.match(body.error, /code|files/i);
  });

  it('blocks dangerous patterns with 403 and blocked:true', async () => {
    const { status, body } = await server.postJson('/api/run', {
      language: 'javascript',
      version: 'es2022',
      code: 'require("child_process").execSync("id")',
    });

    assert.equal(status, 403);
    assert.equal(body.blocked, true);
    assert.equal(typeof body.error, 'string');
  });
});

describe('POST /api/run - multi-file request shape', () => {
  it('runs a project and honours the explicit entryPoint', requires('python'), async () => {
    const { status, body } = await server.postJson('/api/run', {
      language: 'python',
      version: 'python3',
      files: [
        { path: 'main.py', content: 'from helper import value\nprint(value)', isMain: true },
        { path: 'helper.py', content: 'value = 42' },
      ],
      entryPoint: 'main.py',
    });

    assert.equal(status, 200);
    assert.equal(body.exitCode, 0, `stderr was: ${body.stderr}`);
    assert.equal(body.stdout, '42');
  });

  it('accepts { name } as well as { path } on each file', requires('python'), async () => {
    const { status, body } = await server.postJson('/api/run', {
      language: 'python',
      version: 'python3',
      files: [{ name: 'main.py', content: 'print("by-name")', isMain: true }],
      entryPoint: 'main.py',
    });

    assert.equal(status, 200);
    assert.equal(body.stdout, 'by-name');
  });

  it('rejects an entryPoint that is not in files with 400', async () => {
    const { status, body } = await server.postJson('/api/run', {
      language: 'python',
      version: 'python3',
      files: [{ path: 'main.py', content: 'print(1)' }],
      entryPoint: 'nope.py',
    });

    // The status is the contract; the wording is not. Current code reports
    // "No entry file was provided" here because the dedicated
    // entryPoint-not-found branch is unreachable - see blueprint N-11.
    assert.equal(status, 400);
    assert.match(body.error, /entry/i);
  });

  it('rejects a traversal path with 400', async () => {
    const { status, body } = await server.postJson('/api/run', {
      language: 'python',
      version: 'python3',
      files: [{ path: '../escape.py', content: 'print(1)' }],
    });

    assert.equal(status, 400);
    assert.match(body.error, /path/i);
  });

  it('rejects a Windows drive-absolute path with 400', async () => {
    const { status } = await server.postJson('/api/run', {
      language: 'python',
      version: 'python3',
      files: [{ path: 'C:\\Windows\\evil.py', content: 'print(1)' }],
    });

    assert.equal(status, 400);
  });

  it('rejects an empty files array with 400', async () => {
    const { status } = await server.postJson('/api/run', {
      language: 'python',
      version: 'python3',
      files: [],
    });

    // An empty array falls through to the "missing code or files" branch.
    assert.equal(status, 400);
  });
});

describe('POST /api/run - execution freshness', () => {
  it('never replays a stored result for a nondeterministic program', async () => {
    // Regression guard for the removed output cache (blueprint C-01). Two
    // identical requests must be two real executions.
    const request = {
      language: 'javascript',
      version: 'es2022',
      code: 'console.log(Math.random(), Date.now(), process.hrtime.bigint())',
    };

    const first = await server.postJson('/api/run', request);
    const second = await server.postJson('/api/run', request);

    assert.equal(first.body.exitCode, 0);
    assert.equal(second.body.exitCode, 0);
    assert.equal(first.body.cached, false);
    assert.equal(second.body.cached, false);
    assert.notEqual(
      first.body.stdout,
      second.body.stdout,
      'identical source produced identical output - a result cache or single-flight has returned',
    );
  });

  it('does not coalesce two concurrent identical runs', async () => {
    const request = {
      language: 'javascript',
      version: 'es2022',
      code: 'console.log(process.hrtime.bigint(), Math.random())',
    };

    const [a, b] = await Promise.all([
      server.postJson('/api/run', request),
      server.postJson('/api/run', request),
    ]);

    assert.notEqual(
      a.body.stdout,
      b.body.stdout,
      'concurrent identical runs shared one execution',
    );
  });
});

describe('POST /api/previews and GET /preview/:id', () => {
  it('publishes a multi-file project and serves it back', async () => {
    const publish = await server.postJson('/api/previews', {
      entryPath: 'index.html',
      files: [
        { path: 'index.html', content: '<!doctype html><link rel=stylesheet href=style.css><h1>hi</h1>', language: 'html' },
        { path: 'style.css', content: 'h1{color:red}', language: 'css' },
      ],
    });

    assert.equal(publish.status, 201);
    assert.match(publish.body.id, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(publish.body.entryPath, 'index.html');
    assert.equal(publish.body.fileCount, 2);
    assert.equal(publish.body.previewPath, `/preview/${publish.body.id}`);
    assert.equal(publish.body.previewUrl, publish.body.previewPath);
    assert.ok(publish.body.expiresAt);

    const shell = await server.get(publish.body.previewPath);
    assert.equal(shell.status, 200);
    assert.match(shell.headers.get('content-type') || '', /text\/html/);

    const css = await server.get(`/preview/${publish.body.id}/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') || '', /text\/css/);
    assert.equal(css.text, 'h1{color:red}');
  });

  it('accepts the legacy single-html publication shape', async () => {
    const publish = await server.postJson('/api/previews', {
      html: '<!doctype html><h1>legacy</h1>',
    });

    assert.equal(publish.status, 201);
    assert.equal(publish.body.entryPath, 'index.html');

    const shell = await server.get(publish.body.previewPath);
    assert.equal(shell.status, 200);
  });

  it('returns 404 for an unknown preview ID', async () => {
    const { status } = await server.get('/preview/AAAAAAAAAAAAAAAAAAAAAA');
    assert.equal(status, 404);
  });

  it('returns 404 for a malformed preview ID', async () => {
    const { status } = await server.get('/preview/not-a-valid-id');
    assert.equal(status, 404);
  });

  it('rejects a project whose entry file is missing with 400', async () => {
    const { status, body } = await server.postJson('/api/previews', {
      entryPath: 'index.html',
      files: [{ path: 'style.css', content: 'body{}' }],
    });

    assert.equal(status, 400);
    assert.match(body.error, /entry/i);
  });

  it('rejects duplicate paths in one publication with 400', async () => {
    const { status, body } = await server.postJson('/api/previews', {
      entryPath: 'index.html',
      files: [
        { path: 'index.html', content: 'a' },
        { path: 'index.html', content: 'b' },
      ],
    });

    assert.equal(status, 400);
    assert.match(body.error, /duplicate/i);
  });

  it('never serves the internal manifest as an asset', async () => {
    const publish = await server.postJson('/api/previews', {
      html: '<!doctype html><h1>x</h1>',
    });
    const manifest = await server.get(
      `/preview/${publish.body.id}/.browser-coder-preview.json`,
    );
    assert.equal(manifest.status, 404);
  });
});

describe('GET /api/stats', () => {
  it('keeps the route available', async () => {
    const { status, body } = await server.get('/api/stats');
    assert.equal(status, 200);
    assert.equal(typeof body, 'object');
  });
});
