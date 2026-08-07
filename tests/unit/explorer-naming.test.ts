/**
 * Names and selection scope in the explorer.
 *
 * Both were inline in `operations.ts`, which imports Monaco and the DOM, so neither
 * could be reached by a test - and both were wrong in ways that only show up with real
 * data: an import silently destroyed every Hebrew file name, and a drag that included
 * a folder AND something inside it tore the inner item out of the folder.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { importSafeName, uniqueFileName } from '../../src/features/explorer/naming.ts';
import {
  descendantFolderIds,
  topLevelItems,
} from '../../src/features/explorer/selection-scope.ts';

describe('a name arriving from the student computer', () => {
  test('an ordinary name is untouched', () => {
    assert.equal(importSafeName('main.py'), 'main.py');
    assert.equal(importSafeName('my-notes_2.md'), 'my-notes_2.md');
  });

  test('Hebrew survives, because the workspace accepts it', () => {
    // The regression this file exists for: the old ASCII allowlist produced
    // "_____.png" and the student lost the name of every file they imported.
    assert.equal(importSafeName('תמונה.png'), 'תמונה.png');
    assert.equal(importSafeName('סקריפט.py'), 'סקריפט.py');
  });

  test('other scripts and emoji survive too', () => {
    assert.equal(importSafeName('résumé.pdf'), 'résumé.pdf');
    assert.equal(importSafeName('数据.json'), '数据.json');
  });

  test('a path separator is flattened, because an import is one flat name', () => {
    assert.equal(importSafeName('src/main.py'), 'src_main.py');
    assert.equal(importSafeName('..\\..\\etc\\passwd'), '.._.._etc_passwd');
  });

  test('a traversal cannot survive as a traversal', () => {
    // Flattening is what makes this safe: no result may still contain a separator.
    for (const hostile of ['../../secret.py', '/etc/passwd.py', 'a/../../b.py']) {
      const safe = importSafeName(hostile);
      assert.ok(!safe.includes('/'), safe);
      assert.ok(!safe.includes('\\'), safe);
    }
  });

  test('control characters are removed rather than substituted', () => {
    const withControl = `bad${String.fromCharCode(9)}name${String.fromCharCode(0)}.py`;
    const safe = importSafeName(withControl);
    assert.equal(safe, 'badname.py');
    for (const character of safe) {
      assert.ok((character.codePointAt(0) ?? 0) > 0x1f, `control character survived: ${safe}`);
    }
  });

  test('a trailing dot or space is trimmed, because Windows strips it silently', () => {
    assert.equal(importSafeName('report.'), 'report');
    assert.equal(importSafeName('report.txt '), 'report.txt');
  });

  test('a reserved device name is prefixed, not mangled', () => {
    assert.equal(importSafeName('con.txt'), 'file_con.txt');
    assert.equal(importSafeName('NUL'), 'file_NUL');
  });

  test('an over-long name is cut to the segment limit', () => {
    const long = `${'a'.repeat(400)}.py`;
    assert.ok(importSafeName(long).length <= 120);
  });

  test('a name that is nothing but separators still yields something storable', () => {
    assert.equal(importSafeName('///'), '___');
    assert.equal(importSafeName(''), 'imported-file');
    assert.equal(importSafeName('   '), 'imported-file');
  });
});

describe('making a name unique among its siblings', () => {
  test('a free name is returned as-is', () => {
    assert.equal(uniqueFileName('main.py', ['other.py']), 'main.py');
  });

  test('a taken name gets a counter before the extension', () => {
    assert.equal(uniqueFileName('main.py', ['main.py']), 'main_1.py');
    assert.equal(uniqueFileName('main.py', ['main.py', 'main_1.py']), 'main_2.py');
  });

  test('a name with no extension still works', () => {
    assert.equal(uniqueFileName('README', ['README']), 'README_1');
  });

  test('a dotfile is not treated as all-extension', () => {
    // `lastIndexOf('.') > 0` matters: for ".gitignore" the dot is at 0, so the whole
    // name is the base and the counter goes on the end.
    assert.equal(uniqueFileName('.gitignore', ['.gitignore']), '.gitignore_1');
  });
});

describe('reducing a selection to its top-level items', () => {
  const folders = new Map<string, string | null>([
    ['src', null],
    ['src/lib', 'src'],
    ['other', null],
  ]);

  test('a selection with no folders is returned unchanged', () => {
    const items = [{ id: 'a.py', parentId: 'src' }, { id: 'b.py', parentId: null }];
    assert.deepEqual(topLevelItems(items, new Set(), folders), items);
  });

  test('a file inside a selected folder is dropped', () => {
    // The defect: dragging `src` and `src/main.py` together moved the folder into the
    // target and then moved the file in beside it, emptying the folder.
    const items = [
      { id: 'src', parentId: null },
      { id: 'main.py', parentId: 'src' },
    ];
    assert.deepEqual(
      topLevelItems(items, new Set(['src']), folders).map(item => item.id),
      ['src'],
    );
  });

  test('a deeply nested descendant is dropped too', () => {
    const items = [
      { id: 'src', parentId: null },
      { id: 'src/lib', parentId: 'src' },
      { id: 'deep.py', parentId: 'src/lib' },
    ];
    assert.deepEqual(
      topLevelItems(items, new Set(['src', 'src/lib']), folders).map(item => item.id),
      ['src'],
    );
  });

  test('a sibling folder is kept', () => {
    const items = [
      { id: 'src', parentId: null },
      { id: 'other', parentId: null },
    ];
    assert.equal(topLevelItems(items, new Set(['src', 'other']), folders).length, 2);
  });

  test('a parent cycle in corrupt data terminates', () => {
    // Not reachable through the UI, but a hang here would freeze a drag.
    const cyclic = new Map<string, string | null>([['x', 'y'], ['y', 'x']]);
    const items = [{ id: 'file', parentId: 'x' }];
    assert.equal(topLevelItems(items, new Set(['z']), cyclic).length, 1);
  });
});

describe('the folders beneath a set of folders', () => {
  const folders = [
    { id: 'a', parentId: null },
    { id: 'a/b', parentId: 'a' },
    { id: 'a/b/c', parentId: 'a/b' },
    { id: 'other', parentId: null },
  ];

  test('an empty set stays empty', () => {
    assert.equal(descendantFolderIds(new Set(), folders).size, 0);
  });

  test('every level below is included, not only the first', () => {
    const found = descendantFolderIds(new Set(['a']), folders);
    assert.deepEqual([...found].sort(), ['a', 'a/b', 'a/b/c']);
  });

  test('an unrelated branch is not included', () => {
    assert.ok(!descendantFolderIds(new Set(['a']), folders).has('other'));
  });

  test('this is what makes a folder refuse its own descendant as a drop target', () => {
    // The set is used to suppress the drop-target highlight, so `a` itself must be in
    // it: dropping a folder onto itself and into itself are the same refusal.
    assert.ok(descendantFolderIds(new Set(['a']), folders).has('a'));
  });
});
