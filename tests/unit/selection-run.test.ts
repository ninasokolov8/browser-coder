/**
 * Running part of a file.
 *
 * The three ways this was silently wrong all live in one pure module now, so they can
 * be pinned: which lines a selection covers, what to send when the block is indented,
 * and which languages can run a fragment at all.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  canRunSelection,
  coversWholeLines,
  dedent,
  selectedLineRange,
} from '../../src/features/selection-run.ts';

describe('which lines a selection covers', () => {
  test('an ordinary multi-line selection covers both ends', () => {
    assert.deepEqual(
      selectedLineRange({ startLineNumber: 2, startColumn: 3, endLineNumber: 5, endColumn: 7 }),
      { startLine: 2, endLine: 5 },
    );
  });

  test('a triple-click does NOT include the next line', () => {
    // The defect this file exists for. Monaco's line select ends at column 1 of the
    // following line, so triple-clicking `print("a")` used to run `print("b")` too.
    assert.deepEqual(
      selectedLineRange({ startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 1 }),
      { startLine: 1, endLine: 1 },
    );
  });

  test('a gutter drag over three lines runs three lines, not four', () => {
    assert.deepEqual(
      selectedLineRange({ startLineNumber: 1, startColumn: 1, endLineNumber: 4, endColumn: 1 }),
      { startLine: 1, endLine: 3 },
    );
  });

  test('a selection genuinely ending at the start of a line still keeps that line when it is the only one', () => {
    // Single-line selection: there is nothing to trim to, so the line stands.
    assert.deepEqual(
      selectedLineRange({ startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 }),
      { startLine: 3, endLine: 3 },
    );
  });

  test('a backwards selection is normalised', () => {
    // Dragging upwards gives start > end in some Monaco paths.
    assert.deepEqual(
      selectedLineRange({ startLineNumber: 6, startColumn: 4, endLineNumber: 2, endColumn: 1 }),
      { startLine: 2, endLine: 6 },
    );
  });
});

describe('when the menu item is offered', () => {
  const lineMax = () => 12; // every line is 11 characters

  test('an empty selection is not runnable', () => {
    assert.equal(
      coversWholeLines({ startLineNumber: 1, startColumn: 4, endLineNumber: 1, endColumn: 4 }, lineMax),
      false,
    );
  });

  test('part of one line is not runnable', () => {
    assert.equal(
      coversWholeLines({ startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 8 }, lineMax),
      false,
    );
  });

  test('one whole line is runnable', () => {
    assert.equal(
      coversWholeLines({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 }, lineMax),
      true,
    );
  });

  test('a triple-click is runnable, and covers exactly one line', () => {
    const selection = { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 1 };
    assert.equal(coversWholeLines(selection, lineMax), true);
    assert.deepEqual(selectedLineRange(selection), { startLine: 1, endLine: 1 });
  });

  test('a multi-line selection is runnable even when it starts mid-line', () => {
    assert.equal(
      coversWholeLines({ startLineNumber: 1, startColumn: 5, endLineNumber: 3, endColumn: 4 }, lineMax),
      true,
    );
  });
});

describe('dedenting the block', () => {
  test('an indented function body becomes a program', () => {
    // Verbatim, CPython answers "IndentationError: unexpected indent" for code that
    // is perfectly correct where it sits.
    const body = ['    total = 0', '    for item in items:', '        total += item'].join('\n');
    assert.equal(
      dedent(body),
      ['total = 0', 'for item in items:', '    total += item'].join('\n'),
    );
  });

  test('unindented code is untouched', () => {
    const code = 'print("a")\nprint("b")';
    assert.equal(dedent(code), code);
  });

  test('a blank line does not defeat the measurement', () => {
    const body = ['    a = 1', '', '    b = 2'].join('\n');
    assert.equal(dedent(body), ['a = 1', '', 'b = 2'].join('\n'));
  });

  test('a whitespace-only line does not defeat it either', () => {
    const body = ['    a = 1', '   ', '    b = 2'].join('\n');
    assert.equal(dedent(body).split('\n')[0], 'a = 1');
  });

  test('tabs are dedented as tabs', () => {
    assert.equal(dedent('\tx = 1\n\ty = 2'), 'x = 1\ny = 2');
  });

  test('mixed tabs and spaces at the same depth are left alone', () => {
    // Guessing a tab width changes what the code means in Python, so the honest
    // answer is to change nothing.
    const mixed = '\tx = 1\n    y = 2';
    assert.equal(dedent(mixed), mixed);
  });

  test('only the shared prefix is removed, so relative structure survives', () => {
    const nested = ['  if x:', '      y = 1'].join('\n');
    assert.equal(dedent(nested), ['if x:', '    y = 1'].join('\n'));
  });

  test('an empty selection is returned unchanged', () => {
    assert.equal(dedent(''), '');
    assert.equal(dedent('\n\n'), '\n\n');
  });
});

describe('which languages can run a fragment', () => {
  test('the executed languages can', () => {
    for (const language of ['python', 'javascript', 'typescript', 'php', 'csharp']) {
      assert.equal(canRunSelection(language), true, language);
    }
  });

  test('Java cannot, because a fragment can never compile', () => {
    // The adapter requires a file declaring a class with `main`. Offering the item
    // would produce "class, interface, or enum expected" for a reasonable gesture.
    assert.equal(canRunSelection('java'), false);
  });

  test('the rendered and validated languages cannot', () => {
    // For these, Run ignores the argument entirely (html/css/markdown render the whole
    // document; svg shows an image) or reports the fragment as an invalid document
    // (json). Offering the item promises something that cannot happen.
    for (const language of ['html', 'css', 'markdown', 'json', 'svg']) {
      assert.equal(canRunSelection(language), false, language);
    }
  });

  test('an unknown or missing language is refused', () => {
    assert.equal(canRunSelection(undefined), false);
    assert.equal(canRunSelection(''), false);
    assert.equal(canRunSelection('brainfuck'), false);
  });
});
