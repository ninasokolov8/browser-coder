/**
 * The workspace boundary the debug adapters share.
 *
 * ## Why this file exists separately
 *
 * Three debug adapters translate between "the path the IDE names" and "the path on
 * disk", and each must refuse a path that leaves the job directory - a value that
 * arrived over a socket is not something to trust on someone else's word, even though
 * the server checked it first.
 *
 * The check used to live inside `languages/php/debug_adapter.mjs`, where it could only
 * be exercised end-to-end against real Xdebug. That turned out to prove nothing: PHP's
 * `open_basedir` is set to the same directory, so a traversal was refused by the
 * INTERPRETER whether or not the adapter checked. The contract test passed with the
 * check deleted - measured, not assumed. An adapter module also cannot be imported by
 * a unit test at all, because it opens a socket the moment it loads.
 *
 * Here the rule is the only thing standing in the way, on every machine, with no
 * language runtime installed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, sep } from 'node:path';

import { resolveInWorkspace, workspaceRelative } from '../../languages/shared/workspace-paths.mjs';

const root = resolve('/jobs/abc');

describe('resolving a path the IDE named', () => {
  test('a path inside the workspace resolves', () => {
    assert.equal(resolveInWorkspace(root, 'main.php'), join(root, 'main.php'));
    assert.equal(resolveInWorkspace(root, 'lib/helper.php'), join(root, 'lib', 'helper.php'));
  });

  test('forward slashes work on every platform', () => {
    // The IDE always sends `/`, including on Windows, so the separator in the answer
    // is the platform's but the input never is.
    assert.equal(resolveInWorkspace(root, 'a/b/c.cs'), join(root, 'a', 'b', 'c.cs'));
  });

  test('a traversal that lands back inside is allowed', () => {
    // `lib/../main.php` never leaves. Refusing it would break a legitimate path a
    // student's own `require` or `#include` can produce.
    assert.equal(resolveInWorkspace(root, 'lib/../main.php'), join(root, 'main.php'));
    assert.equal(resolveInWorkspace(root, './main.php'), join(root, 'main.php'));
  });

  test('a traversal that escapes is refused', () => {
    assert.equal(resolveInWorkspace(root, '../other/main.php'), null);
    assert.equal(resolveInWorkspace(root, '../../etc/passwd'), null);
    assert.equal(resolveInWorkspace(root, 'lib/../../escape.php'), null);
  });

  test('an absolute path outside the workspace is refused', () => {
    assert.equal(resolveInWorkspace(root, resolve('/etc/passwd')), null);
  });

  test('an absolute path inside the workspace is accepted', () => {
    // Not the normal shape, but a legitimate one, and refusing it would be a
    // surprise rather than a protection.
    assert.equal(resolveInWorkspace(root, join(root, 'main.php')), join(root, 'main.php'));
  });

  test('the workspace root itself resolves rather than being refused', () => {
    assert.equal(resolveInWorkspace(root, '.'), root);
  });

  test('empty and missing inputs are refused rather than resolving to the root', () => {
    // Without this, a missing filename silently becomes "the whole job directory",
    // which is the sort of thing that turns into a breakpoint on a directory.
    assert.equal(resolveInWorkspace(root, ''), null);
    assert.equal(resolveInWorkspace(root, undefined), null);
    assert.equal(resolveInWorkspace(root, null), null);
    assert.equal(resolveInWorkspace(root, 42), null);
    assert.equal(resolveInWorkspace('', 'main.php'), null);
    assert.equal(resolveInWorkspace(undefined, 'main.php'), null);
  });
});

describe('reporting a path back to the IDE', () => {
  test('an absolute path comes back as the relative one the IDE uses', () => {
    assert.equal(workspaceRelative(root, join(root, 'lib', 'helper.php')), 'lib/helper.php');
  });

  test('the answer always uses forward slashes', () => {
    // The IDE keys documents by `/`-separated paths, so a Windows separator here
    // would silently fail to match the file the student has open.
    const relative = workspaceRelative(root, join(root, 'a', 'b.cs'));
    assert.equal(relative, 'a/b.cs');
    assert.ok(!relative.includes(sep === '/' ? '\\' : '\\'));
  });

  test('a file outside the workspace has no relative form', () => {
    /*
     * Null is a real answer, not a failure.
     *
     * A frame inside the standard library is a frame in something the student did
     * not write and cannot open, and the adapters use exactly this to decide which
     * frames to show.
     */
    assert.equal(workspaceRelative(root, resolve('/usr/share/php/thing.php')), null);
    assert.equal(workspaceRelative(root, resolve('/usr/lib/dotnet/shared/System.Private.CoreLib.dll')), null);
  });

  test('the workspace root itself is the empty relative path', () => {
    assert.equal(workspaceRelative(root, root), '');
  });

  test('empty and missing inputs give null', () => {
    assert.equal(workspaceRelative(root, ''), null);
    assert.equal(workspaceRelative(root, undefined), null);
    assert.equal(workspaceRelative('', join(root, 'a.php')), null);
  });
});

describe('the sibling-prefix trap', () => {
  test('a directory whose name starts with the workspace name is not inside it', () => {
    /*
     * The bug this file exists to prevent.
     *
     * A bare `startsWith` says `/jobs/abc-2` is inside `/jobs/abc`, because the
     * string is a prefix. Job directories are generated names sharing a parent, so
     * this is not a hypothetical: it is one job reading another student's files.
     */
    assert.equal(resolveInWorkspace(root, `${root}-2/main.php`), null);
    assert.equal(workspaceRelative(root, `${root}-2/main.php`), null);
    assert.equal(workspaceRelative(root, `${root}x`), null);
  });

  test('the real sibling case, spelled out', () => {
    const jobA = resolve('/tmp/jobs/run-1');
    const jobB = resolve('/tmp/jobs/run-10');
    assert.equal(workspaceRelative(jobA, join(jobB, 'secret.cs')), null);
    assert.equal(resolveInWorkspace(jobA, join(jobB, 'secret.cs')), null);
  });
});
