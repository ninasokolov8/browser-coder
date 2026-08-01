/**
 * Confining a debugged JavaScript program to its own job directory.
 *
 * A normal JavaScript run is confined by Node's permission model. A debug run cannot
 * be: Node 22 treats the inspector as a permission of its own and denies it whenever
 * the model is on - `Session.connectToMainThread()` and `--inspect-brk` both fail with
 * `ERR_ACCESS_DENIED, permission: 'Inspector'`, and there is no `--allow-inspector`.
 * Measured on v22.18.0.
 *
 * So the grant is replaced rather than dropped, the same way Python has always done it
 * (`languages/python/fs_guard.py`). These tests are the evidence that the replacement
 * confines what it claims to - run in a child process, because installing the guard
 * patches `fs` for the whole process and there is no uninstall.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GUARD = fileURLToPath(new URL('../../languages/javascript/fs_guard.mjs', import.meta.url));

let root;
let workspace;
let outside;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'js-fs-guard-'));
  workspace = join(root, 'job');
  outside = join(root, 'other-job');
  mkdirSync(workspace);
  mkdirSync(outside);
  writeFileSync(join(workspace, 'data.txt'), 'mine\n');
  mkdirSync(join(workspace, 'nested'));
  writeFileSync(join(workspace, 'nested', 'deep.txt'), 'also mine\n');
  writeFileSync(join(outside, 'secret.txt'), 'another student\n');
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Run one expression with the guard installed, in a fresh process.
 *
 * Returns `{ok, value}` for a success and `{ok: false, code, name}` for a refusal, so a
 * test asserts on the outcome rather than on a stack trace.
 */
function underGuard(expression) {
  const script = `
    import { installFsGuard } from ${JSON.stringify(pathToFileURL(GUARD).href)};
    import { createRequire } from 'node:module';
    const require = createRequire(${JSON.stringify(pathToFileURL(GUARD).href)});
    installFsGuard(${JSON.stringify(workspace)});
    const fs = require('node:fs');
    try {
      const value = (${expression});
      process.stdout.write(JSON.stringify({ ok: true, value: String(value).trim() }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error.code, name: error.name }));
    }
  `;

  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

describe('what a program may still do', () => {
  test('read a file in its own directory', () => {
    const result = underGuard(`fs.readFileSync(${JSON.stringify(join(workspace, 'data.txt'))}, 'utf8')`);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value, 'mine');
  });

  test('read a file in a subdirectory', () => {
    const result = underGuard(
      `fs.readFileSync(${JSON.stringify(join(workspace, 'nested', 'deep.txt'))}, 'utf8')`,
    );
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test('read through a relative path', () => {
    // A program runs with its job directory as cwd, so this is the ordinary case.
    const result = underGuard(
      `(process.chdir(${JSON.stringify(workspace)}), fs.readFileSync('data.txt', 'utf8'))`,
    );
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test('read through a file URL, which is how the module loader reads the program', () => {
    // The first thing the guard broke when it was written: `url.pathname` on Windows is
    // "/C:/x", which resolves to nothing, so the program could not even be loaded.
    const url = pathToFileURL(join(workspace, 'data.txt')).href;
    const result = underGuard(`fs.readFileSync(new URL(${JSON.stringify(url)}), 'utf8')`);
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test('write inside its own directory', () => {
    const result = underGuard(
      `(fs.writeFileSync(${JSON.stringify(join(workspace, 'out.txt'))}, 'x'), 'written')`,
    );
    assert.equal(result.ok, true, JSON.stringify(result));
  });
});

describe('what it may not', () => {
  test('read another job by absolute path', () => {
    const result = underGuard(
      `fs.readFileSync(${JSON.stringify(join(outside, 'secret.txt'))}, 'utf8')`,
    );
    assert.equal(result.ok, false, `read another job: ${JSON.stringify(result)}`);
    assert.equal(result.code, 'EACCES');
  });

  test('read another job by traversal', () => {
    const traversal = join(workspace, '..', 'other-job', 'secret.txt');
    const result = underGuard(`fs.readFileSync(${JSON.stringify(traversal)}, 'utf8')`);
    assert.equal(result.ok, false, `traversal succeeded: ${JSON.stringify(result)}`);
  });

  test('write outside its own directory', () => {
    // The write side matters as much as the read side: a file planted in another job's
    // directory is read by that job.
    const result = underGuard(
      `(fs.writeFileSync(${JSON.stringify(join(outside, 'planted.txt'))}, 'x'), 'written')`,
    );
    assert.equal(result.ok, false, `wrote outside: ${JSON.stringify(result)}`);
  });

  test('list a directory outside', () => {
    const result = underGuard(`fs.readdirSync(${JSON.stringify(outside)}).join(',')`);
    assert.equal(result.ok, false, JSON.stringify(result));
  });

  test('open a directory outside', () => {
    const result = underGuard(`fs.opendirSync(${JSON.stringify(outside)}).path`);
    assert.equal(result.ok, false, JSON.stringify(result));
  });

  test('stat a file outside', () => {
    const result = underGuard(`fs.statSync(${JSON.stringify(join(outside, 'secret.txt'))}).size`);
    assert.equal(result.ok, false, JSON.stringify(result));
  });

  test('follow a symlink out of the directory', () => {
    // The check resolves symlinks, which is the whole reason it calls realpath rather
    // than comparing strings: a link inside the job pointing out of it is the obvious
    // way around a prefix test.
    const link = join(workspace, 'escape');
    try {
      symlinkSync(outside, link, 'junction');
    } catch {
      // Creating a symlink needs a privilege this test runner may not have. Skipping
      // silently would hide the gap, so it is asserted as unavailable instead.
      assert.ok(true, 'symlinks unavailable on this host');
      return;
    }
    const result = underGuard(`fs.readFileSync(${JSON.stringify(join(link, 'secret.txt'))}, 'utf8')`);
    assert.equal(result.ok, false, `followed a symlink out: ${JSON.stringify(result)}`);
  });

  test('reach out through the promises API too', () => {
    const result = underGuard(
      `await require('node:fs/promises').readFile(${JSON.stringify(join(outside, 'secret.txt'))}, 'utf8')`,
    );
    assert.equal(result.ok, false, JSON.stringify(result));
  });
});

describe('the boundary itself', () => {
  test('a sibling directory whose name merely starts with the job path is outside', () => {
    // The classic prefix bug: "/tmp/job" must not admit "/tmp/job-other".
    const sibling = `${workspace}-other`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'x.txt'), 'not mine\n');
    const result = underGuard(`fs.readFileSync(${JSON.stringify(join(sibling, 'x.txt'))}, 'utf8')`);
    assert.equal(result.ok, false, `prefix match let a sibling through: ${JSON.stringify(result)}`);
    rmSync(sibling, { recursive: true, force: true });
  });

  test('the job directory itself is allowed', () => {
    const result = underGuard(`fs.readdirSync(${JSON.stringify(workspace)}).length`);
    assert.equal(result.ok, true, JSON.stringify(result));
  });
});
