/**
 * Warnings for references the refactorer cannot rewrite.
 *
 * The bug: `svg`, `json` and `markdown` have no rewriter in import-refactor.ts, and
 * the `default:` branch returned zero replacements with NO warning. A student who
 * moved `maze.svg` was told "Renamed file; updated 3 imports" and left with a broken
 * `![maze](maze.svg)` in their notes. Silence read as success.
 *
 * The two properties that matter pull in opposite directions, so both are tested:
 * it must speak when a reference really is at risk, and it must stay quiet
 * otherwise - a warning shown on every move is one a student learns to ignore.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  movedBasenames,
  warningsForUnhandledFile,
} from '../../src/features/explorer/reference-warnings.ts';

describe('which names count as moved', () => {
  test('a renamed file contributes its old basename', () => {
    const moved = movedBasenames([{ oldPath: 'assets/maze.svg', newPath: 'assets/labyrinth.svg' }]);
    assert.deepEqual([...moved], ['maze.svg']);
  });

  test('a file that did not move contributes nothing', () => {
    assert.equal(movedBasenames([{ oldPath: 'a/b.py', newPath: 'a/b.py' }]).size, 0);
  });

  test('a move between folders still counts, under its old basename', () => {
    const moved = movedBasenames([{ oldPath: 'old/data.json', newPath: 'new/data.json' }]);
    assert.deepEqual([...moved], ['data.json']);
  });

  test('a one-character name is ignored as too common to match usefully', () => {
    // Matching "a" would fire on nearly every file in the workspace.
    assert.equal(movedBasenames([{ oldPath: 'a', newPath: 'b' }]).size, 0);
  });

  test('several moves are all collected', () => {
    const moved = movedBasenames([
      { oldPath: 'maze.svg', newPath: 'labyrinth.svg' },
      { oldPath: 'data.json', newPath: 'config.json' },
      { oldPath: 'same.md', newPath: 'same.md' },
    ]);
    assert.deepEqual([...moved].sort(), ['data.json', 'maze.svg']);
  });
});

describe('it speaks when a reference is at risk', () => {
  const moved = new Set(['maze.svg']);

  test('a markdown image reference is reported', () => {
    const warnings = warningsForUnhandledFile(
      'notes.md',
      '# Notes\n\n![the maze](maze.svg)\n',
      'markdown',
      moved,
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /notes\.md/);
    assert.match(warnings[0], /maze\.svg/);
    assert.match(warnings[0], /markdown/);
    assert.match(warnings[0], /by hand/);
  });

  test('an svg href reference is reported', () => {
    const warnings = warningsForUnhandledFile(
      'diagram.svg',
      '<svg><image href="maze.svg" /></svg>',
      'svg',
      moved,
    );
    assert.equal(warnings.length, 1);
  });

  test('a json config value is reported', () => {
    const warnings = warningsForUnhandledFile(
      'config.json',
      '{"background": "assets/maze.svg"}',
      'json',
      moved,
    );
    assert.equal(warnings.length, 1);
  });

  test('one warning per moved name mentioned', () => {
    const warnings = warningsForUnhandledFile(
      'notes.md',
      '![a](maze.svg) and [b](data.json)',
      'markdown',
      new Set(['maze.svg', 'data.json']),
    );
    assert.equal(warnings.length, 2);
  });

  test('the message names the file, the reference and the language', () => {
    // A warning the student cannot act on is barely better than silence.
    const [warning] = warningsForUnhandledFile('a/notes.md', 'see maze.svg', 'markdown', moved);
    assert.match(warning, /a\/notes\.md/);
    assert.match(warning, /"maze\.svg"/);
    assert.match(warning, /markdown/);
  });
});

describe('it stays quiet otherwise', () => {
  const moved = new Set(['maze.svg']);

  test('a file that mentions nothing that moved is silent', () => {
    assert.deepEqual(warningsForUnhandledFile('notes.md', '# Just prose\n', 'markdown', moved), []);
  });

  test('nothing moved means nothing to say', () => {
    assert.deepEqual(
      warningsForUnhandledFile('notes.md', 'mentions maze.svg', 'markdown', new Set()),
      [],
    );
  });

  test('the moved file itself is not warned about', () => {
    // maze.svg being renamed is not maze.svg holding a stale reference to itself.
    assert.deepEqual(warningsForUnhandledFile('maze.svg', '<svg/>', 'svg', moved), []);
  });

  test('the moved file in a folder is not warned about either', () => {
    assert.deepEqual(warningsForUnhandledFile('assets/maze.svg', '<svg/>', 'svg', moved), []);
  });

  test('an empty file is silent', () => {
    assert.deepEqual(warningsForUnhandledFile('notes.md', '', 'markdown', moved), []);
  });

  test('a missing language label still produces a usable sentence', () => {
    const [warning] = warningsForUnhandledFile('x.txt', 'maze.svg', 'this file type', moved);
    assert.match(warning, /this file type/);
  });
});
