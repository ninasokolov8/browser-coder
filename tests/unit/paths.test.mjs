/**
 * Unit tests for the canonical path rules.
 *
 * Pure and fast: no server, no toolchain, no filesystem. These are the tests
 * that make the path validator safe to share between the server and the browser
 * workspace later.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PATH_LIMITS,
  PathError,
  normalizeWorkspacePath,
  pathCollisionKey,
  resolveEntryPoint,
  validateFileSet,
} from '../../server/domain/paths.mjs';

const ok = value => {
  assert.equal(value.ok, true, `expected ok, got ${value.code}: ${value.message}`);
  return value;
};
const rejects = (value, code) => {
  assert.equal(value.ok, false, 'expected a rejection');
  assert.equal(value.code, code, `expected ${code}, got ${value.code}`);
  return value;
};

describe('normalizeWorkspacePath - accepted', () => {
  it('accepts a simple relative path', () => {
    assert.equal(ok(normalizeWorkspacePath('main.py')).path, 'main.py');
  });

  it('accepts a nested path', () => {
    assert.equal(ok(normalizeWorkspacePath('src/app/Main.java')).path, 'src/app/Main.java');
  });

  it('converts Windows separators to POSIX', () => {
    assert.equal(ok(normalizeWorkspacePath('src\\app\\Main.java')).path, 'src/app/Main.java');
  });

  it('accepts a leading-dot filename', () => {
    assert.equal(ok(normalizeWorkspacePath('.gitignore')).path, '.gitignore');
  });

  it('accepts non-ASCII filenames', () => {
    assert.equal(ok(normalizeWorkspacePath('סקריפט.py')).path, 'סקריפט.py');
  });

  it('accepts a file literally named like a build directory', () => {
    // "bin" as a leaf is a harmless filename; only "bin/..." is build output.
    assert.equal(ok(normalizeWorkspacePath('bin')).path, 'bin');
  });

  it('returns the segments alongside the path', () => {
    assert.deepEqual(ok(normalizeWorkspacePath('a/b/c.txt')).segments, ['a', 'b', 'c.txt']);
  });
});

describe('normalizeWorkspacePath - rejected', () => {
  it('rejects a non-string', () => {
    rejects(normalizeWorkspacePath(42), PathError.NOT_A_STRING);
    rejects(normalizeWorkspacePath(undefined), PathError.NOT_A_STRING);
    rejects(normalizeWorkspacePath(null), PathError.NOT_A_STRING);
  });

  it('rejects an empty path', () => {
    rejects(normalizeWorkspacePath(''), PathError.EMPTY);
  });

  it('rejects a POSIX-absolute path instead of relativizing it', () => {
    // Blueprint N-12. The old code stripped the leading slash first, so this
    // was silently accepted as "etc/passwd.py".
    rejects(normalizeWorkspacePath('/etc/passwd.py'), PathError.ABSOLUTE);
    rejects(normalizeWorkspacePath('//main.py'), PathError.ABSOLUTE);
  });

  it('rejects a Windows-absolute path after separator conversion', () => {
    // "\\server\share" becomes "//server/share", which must still be absolute.
    rejects(normalizeWorkspacePath('\\main.py'), PathError.ABSOLUTE);
    rejects(normalizeWorkspacePath('\\\\server\\share\\x.py'), PathError.ABSOLUTE);
  });

  it('rejects a drive letter', () => {
    rejects(normalizeWorkspacePath('C:\\Windows\\evil.py'), PathError.DRIVE_LETTER);
    rejects(normalizeWorkspacePath('c:/x.py'), PathError.DRIVE_LETTER);
  });

  it('rejects traversal in any position', () => {
    rejects(normalizeWorkspacePath('../escape.py'), PathError.TRAVERSAL);
    rejects(normalizeWorkspacePath('a/../../escape.py'), PathError.TRAVERSAL);
    rejects(normalizeWorkspacePath('a/b/..'), PathError.TRAVERSAL);
  });

  it('rejects a bare dot segment', () => {
    rejects(normalizeWorkspacePath('./main.py'), PathError.DOT_SEGMENT);
    rejects(normalizeWorkspacePath('a/./b.py'), PathError.DOT_SEGMENT);
  });

  it('rejects an empty segment', () => {
    rejects(normalizeWorkspacePath('a//b.py'), PathError.EMPTY_SEGMENT);
    rejects(normalizeWorkspacePath('a/'), PathError.EMPTY_SEGMENT);
  });

  it('rejects a NUL byte', () => {
    rejects(normalizeWorkspacePath('ma\u0000in.py'), PathError.NUL_BYTE);
  });

  it('rejects control characters', () => {
    rejects(normalizeWorkspacePath('a\u0001b.py'), PathError.CONTROL_CHARACTER);
    rejects(normalizeWorkspacePath('a\tb.py'), PathError.CONTROL_CHARACTER);
    rejects(normalizeWorkspacePath('a\u007fb.py'), PathError.CONTROL_CHARACTER);
  });

  it('rejects an over-long path', () => {
    const long = `${'a'.repeat(DEFAULT_PATH_LIMITS.maxPathChars)}.py`;
    rejects(normalizeWorkspacePath(long), PathError.TOO_LONG);
  });

  it('rejects an over-long single segment', () => {
    const segment = 'b'.repeat(DEFAULT_PATH_LIMITS.maxSegmentChars + 1);
    rejects(normalizeWorkspacePath(`a/${segment}`), PathError.SEGMENT_TOO_LONG);
  });

  it('rejects an over-deep path', () => {
    const deep = Array.from({ length: DEFAULT_PATH_LIMITS.maxDepth + 1 }, (_, i) => `d${i}`).join('/');
    rejects(normalizeWorkspacePath(deep), PathError.TOO_DEEP);
  });

  it('rejects Windows reserved device names, bare or with an extension', () => {
    rejects(normalizeWorkspacePath('NUL'), PathError.RESERVED_DEVICE_NAME);
    rejects(normalizeWorkspacePath('con.txt'), PathError.RESERVED_DEVICE_NAME);
    rejects(normalizeWorkspacePath('src/COM1.java'), PathError.RESERVED_DEVICE_NAME);
    rejects(normalizeWorkspacePath('lpt9/x.py'), PathError.RESERVED_DEVICE_NAME);
  });

  it('rejects a trailing dot or space in a segment', () => {
    // Windows strips both, so "a." and "a" would land on the same file.
    rejects(normalizeWorkspacePath('main.py '), PathError.TRAILING_DOT_OR_SPACE);
    rejects(normalizeWorkspacePath('main.'), PathError.TRAILING_DOT_OR_SPACE);
    rejects(normalizeWorkspacePath('dir./x.py'), PathError.TRAILING_DOT_OR_SPACE);
  });

  it('rejects the internal preview manifest name', () => {
    rejects(normalizeWorkspacePath('.browser-coder-preview.json'), PathError.RESERVED_NAME);
  });

  it('rejects build-output directories as source', () => {
    rejects(normalizeWorkspacePath('bin/app.dll'), PathError.RESERVED_DIRECTORY);
    rejects(normalizeWorkspacePath('obj/Debug/x.cs'), PathError.RESERVED_DIRECTORY);
    rejects(normalizeWorkspacePath('node_modules/pkg/index.js'), PathError.RESERVED_DIRECTORY);
    rejects(normalizeWorkspacePath('__pycache__/m.pyc'), PathError.RESERVED_DIRECTORY);
  });
});

describe('pathCollisionKey', () => {
  it('treats case-different paths as colliding', () => {
    assert.equal(pathCollisionKey('Main.java'), pathCollisionKey('main.java'));
  });

  it('treats different Unicode normal forms as colliding', () => {
    // NFC "é" versus NFD "e" + combining acute: one filesystem shows one file,
    // another shows two.
    assert.equal(pathCollisionKey('caf\u00e9.py'), pathCollisionKey('cafe\u0301.py'));
  });

  it('does not treat genuinely different paths as colliding', () => {
    assert.notEqual(pathCollisionKey('a.py'), pathCollisionKey('b.py'));
  });
});

describe('validateFileSet', () => {
  const file = (path, content = '') => ({ path, content });

  it('accepts a well-formed set', () => {
    const result = ok(validateFileSet([file('main.py', 'x'), file('lib/helper.py', 'yy')]));
    assert.deepEqual(result.files.map(f => f.name), ['main.py', 'lib/helper.py']);
    assert.equal(result.totalContentChars, 3);
  });

  it('rejects an empty or non-array set', () => {
    rejects(validateFileSet([]), 'files_empty');
    rejects(validateFileSet(null), 'files_empty');
  });

  it('rejects exact duplicate paths', () => {
    rejects(validateFileSet([file('main.py'), file('main.py')]), PathError.DUPLICATE);
  });

  it('rejects paths that collapse onto one file', () => {
    // Blueprint N-12: "/main.py" used to be rewritten to "main.py", so this pair
    // silently became one file with the second overwriting the first. Now the
    // absolute path is refused outright.
    rejects(validateFileSet([file('/main.py'), file('main.py')]), PathError.ABSOLUTE);
  });

  it('rejects case-only collisions', () => {
    rejects(validateFileSet([file('Main.java'), file('main.java')]), PathError.CASE_COLLISION);
  });

  it('rejects a path used as both a file and a directory', () => {
    rejects(
      validateFileSet([file('pkg'), file('pkg/mod.py')]),
      PathError.FILE_DIRECTORY_CONFLICT,
    );
  });

  it('detects a file/directory conflict regardless of supplied order', () => {
    rejects(
      validateFileSet([file('pkg/mod.py'), file('pkg')]),
      PathError.FILE_DIRECTORY_CONFLICT,
    );
  });

  it('enforces the file-count cap before per-file work', () => {
    const many = Array.from({ length: 5 }, (_, i) => file(`f${i}.py`));
    rejects(validateFileSet(many, { maxFiles: 4 }), 'files_too_many');
  });

  it('enforces the aggregate content cap', () => {
    rejects(
      validateFileSet([file('a.py', 'x'.repeat(10)), file('b.py', 'y'.repeat(10))], {
        maxTotalContentChars: 15,
      }),
      'files_too_large',
    );
  });

  it('accepts { name } as well as { path }', () => {
    const result = ok(validateFileSet([{ name: 'main.py', content: 'x' }]));
    assert.equal(result.files[0].name, 'main.py');
  });

  it('coerces a non-string content to an empty string', () => {
    const result = ok(validateFileSet([{ path: 'main.py', content: { not: 'a string' } }]));
    assert.equal(result.files[0].content, '');
  });

  it('normalizes isMain to a boolean', () => {
    const result = ok(validateFileSet([{ path: 'a.py', isMain: 'yes' }, { path: 'b.py' }]));
    // Only a strict true counts, so a truthy string cannot silently elect an
    // entry point.
    assert.equal(result.files[0].isMain, false);
    assert.equal(result.files[1].isMain, false);
  });
});

describe('resolveEntryPoint', () => {
  const set = paths => paths.map(p => ({ name: p, isMain: false }));

  it('honours an explicit entry point', () => {
    const result = ok(resolveEntryPoint(set(['a.py', 'b.py']), 'b.py'));
    assert.equal(result.entryPoint, 'b.py');
  });

  it('normalizes an explicit entry point before matching', () => {
    const result = ok(resolveEntryPoint(set(['src/a.py']), 'src\\a.py'));
    assert.equal(result.entryPoint, 'src/a.py');
  });

  it('reports an absent entry point distinctly from a missing one', () => {
    // Blueprint N-11: the dedicated branch existed but was unreachable, so a
    // typo reported "No entry file was provided".
    const result = rejects(resolveEntryPoint(set(['a.py']), 'nope.py'), 'entry_point_not_found');
    assert.match(result.message, /entryPoint "nope\.py"/);
  });

  it('rejects an invalid entry point path', () => {
    rejects(resolveEntryPoint(set(['a.py']), '../a.py'), 'entry_point_invalid');
  });

  it('falls back to the isMain flag', () => {
    const files = [
      { name: 'a.py', isMain: false },
      { name: 'b.py', isMain: true },
    ];
    assert.equal(ok(resolveEntryPoint(files, undefined)).entryPoint, 'b.py');
  });

  it('falls back to the first file, preserving the legacy rule', () => {
    assert.equal(ok(resolveEntryPoint(set(['first.py', 'second.py']), '')).entryPoint, 'first.py');
    assert.equal(ok(resolveEntryPoint(set(['first.py']), null)).entryPoint, 'first.py');
  });

  it('reports a missing entry point for an empty set', () => {
    rejects(resolveEntryPoint([], undefined), 'entry_point_missing');
  });
});
