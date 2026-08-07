/**
 * What a multi-file import will create, decided before anything is written.
 *
 * A dragged folder, a picked folder and a ZIP all reduce to a set of relative paths,
 * and the paths in a ZIP come from a file the student did not necessarily make. So the
 * rule is the same one the server uses (`server/domain/paths.mjs`): reject, never
 * repair - a repaired traversal is still a caller asking for something we would not
 * give them, and writing it somewhere else quietly is exactly the defect that rule
 * exists to prevent.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { archiveFolderName, planImport } from '../../src/features/explorer/import-plan.ts';

const LIMITS = { existingFileCount: 0, maxFiles: 300, maxBytesPerFile: 8 * 1024 * 1024 };

const paths = (input: readonly string[]) => input.map(path => ({ path }));

describe('the folders an import needs', () => {
  test('a flat set needs none', () => {
    const plan = planImport(paths(['a.py', 'b.py']), LIMITS);
    assert.deepEqual(plan.directories, []);
    assert.deepEqual(plan.files.map(file => file.name), ['a.py', 'b.py']);
  });

  test('every ancestor is listed, outermost first', () => {
    const plan = planImport(paths(['src/util/math.py']), LIMITS);
    assert.deepEqual(plan.directories, ['src', 'src/util']);
    // Outermost first matters: the caller creates them in order and must always find
    // the parent already there.
    assert.deepEqual(plan.files[0].directories, ['src', 'src/util']);
  });

  test('shared ancestors are created once', () => {
    const plan = planImport(paths(['src/a.py', 'src/b.py', 'src/deep/c.py']), LIMITS);
    assert.deepEqual(plan.directories, ['src', 'src/deep']);
  });

  test('deeper folders come after their parents even when discovered first', () => {
    const plan = planImport(paths(['a/b/c/deep.py', 'a/shallow.py']), LIMITS);
    assert.deepEqual(plan.directories, ['a', 'a/b', 'a/b/c']);
  });
});

describe('paths that must never be created', () => {
  test('a traversal is refused, not rewritten', () => {
    const plan = planImport(paths(['../escape.py', 'a/../../escape.py']), LIMITS);
    assert.deepEqual(plan.files, []);
    assert.equal(plan.skipped.length, 2);
    for (const reason of plan.skipped) assert.match(reason, /\.\./);
  });

  test('an absolute path is refused', () => {
    const plan = planImport(paths(['/etc/passwd.py']), LIMITS);
    assert.deepEqual(plan.files, []);
    assert.match(plan.skipped[0], /absolute/i);
  });

  test('a Windows drive letter is refused', () => {
    const plan = planImport(paths(['C:/Users/student/secret.py']), LIMITS);
    assert.deepEqual(plan.files, []);
    assert.match(plan.skipped[0], /drive letter/i);
  });

  test('a backslash is a separator, not part of a name', () => {
    // A ZIP written on Windows can carry these; treating them as name characters
    // would produce one file called "src\main.py" instead of a folder.
    const plan = planImport(paths(['src\\main.py']), LIMITS);
    assert.equal(plan.files[0].path, 'src/main.py');
    assert.deepEqual(plan.directories, ['src']);
  });

  test('a reserved device name is refused', () => {
    const plan = planImport(paths(['con.txt']), LIMITS);
    assert.deepEqual(plan.files, []);
    assert.match(plan.skipped[0], /reserved device/i);
  });

  test('a generated-output directory is refused', () => {
    const plan = planImport(paths(['bin/app.dll', 'obj/thing.o']), LIMITS);
    assert.deepEqual(plan.files, []);
    assert.equal(plan.skipped.length, 2);
  });
});

describe('what an archive carries that is not the project', () => {
  test("macOS' shadow copies are dropped silently", () => {
    // Not "skipped": reporting them would make a normal Mac export look half-failed.
    const plan = planImport(paths(['__MACOSX/._main.py', 'main.py', '.DS_Store']), LIMITS);
    assert.deepEqual(plan.files.map(file => file.path), ['main.py']);
    assert.deepEqual(plan.skipped, []);
  });

  test('directory entries are dropped, because the tree comes from the file paths', () => {
    const plan = planImport(paths(['src/', 'src/main.py']), LIMITS);
    assert.deepEqual(plan.files.map(file => file.path), ['src/main.py']);
    assert.deepEqual(plan.skipped, []);
  });

  test('a repository or dependency directory is not imported', () => {
    const plan = planImport(paths(['.git/config', 'node_modules/x/index.js', 'main.py']), LIMITS);
    assert.deepEqual(plan.files.map(file => file.path), ['main.py']);
  });
});

describe('the limits', () => {
  test('the workspace file cap counts files that are already there', () => {
    const plan = planImport(paths(['a.py', 'b.py', 'c.py']), {
      ...LIMITS,
      existingFileCount: 298,
    });
    assert.deepEqual(plan.files.map(file => file.name), ['a.py', 'b.py']);
    assert.match(plan.skipped[0], /file limit \(300\)/);
  });

  test('an over-large file is refused with its size named', () => {
    const plan = planImport(
      [{ path: 'huge.py', size: 9 * 1024 * 1024 }, { path: 'small.py', size: 10 }],
      LIMITS,
    );
    assert.deepEqual(plan.files.map(file => file.name), ['small.py']);
    assert.match(plan.skipped[0], /larger than 8 MB/);
  });

  test('a file of unknown size is not refused for its size', () => {
    // A ZIP entry has no reliable size until it is read; the cap is applied then.
    const plan = planImport(paths(['unknown.py']), LIMITS);
    assert.equal(plan.files.length, 1);
  });

  test('the same path twice is imported once and reported', () => {
    const plan = planImport(paths(['a.py', 'a.py']), LIMITS);
    assert.equal(plan.files.length, 1);
    assert.match(plan.skipped[0], /twice/);
  });
});

describe('where an archive unpacks', () => {
  test('into a folder named after itself', () => {
    // Not into the drop target: a hundred files scattered through a student project
    // leaves nothing to undo, and one folder can be deleted in one action.
    assert.equal(archiveFolderName('project-2026-07-31.zip'), 'project-2026-07-31');
    assert.equal(archiveFolderName('Homework.ZIP'), 'Homework');
  });

  test('a name that is only an extension still yields a folder', () => {
    assert.equal(archiveFolderName('.zip'), 'archive');
    assert.equal(archiveFolderName('   .zip'), 'archive');
  });

  test('a trailing dot or space is trimmed, because Windows drops it', () => {
    assert.equal(archiveFolderName('notes .zip'), 'notes');
  });
});
