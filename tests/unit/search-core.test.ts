/**
 * Search and Replace All, and the requirement that they agree.
 *
 * The rule these tests exist to hold: for any query, any options and any file, the
 * number of matches the results list shows is the number Replace All rewrites. Three
 * separate bugs broke it - a pattern built without the language, a mask applied on one
 * side only, and anchors meaning different things in a per-line scan than in a
 * whole-file one - and each was found by a student, not by a test, because the code
 * lived in a module that imports the DOM.
 *
 * So the agreement is asserted directly, on every option combination, below.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  findMatches,
  matchSpans,
  replaceInFile,
  type SearchOptions,
} from '../../src/features/search-core.ts';

const PLAIN: SearchOptions = {
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  codeOnly: false,
};

const options = (overrides: Partial<SearchOptions> = {}): SearchOptions => ({
  ...PLAIN,
  ...overrides,
});

describe('finding matches', () => {
  test('a plain query, with its line and column', () => {
    const found = findMatches('a = 1\nb = total\nc = 3', 'total', 'python', PLAIN);

    assert.equal(found.length, 1);
    assert.equal(found[0].line, 2);
    assert.equal(found[0].column, 5);
    assert.equal(found[0].text, 'b = total');
    assert.equal(found[0].matchStart, 4);
    assert.equal(found[0].matchEnd, 9);
  });

  test('several on one line, and on the last line with no trailing newline', () => {
    const found = findMatches('x x\ny x', 'x', 'python', PLAIN);
    assert.deepEqual(
      found.map(match => [match.line, match.column]),
      [[1, 1], [1, 3], [2, 3]],
    );
  });

  test('case-insensitive by default, exact when asked', () => {
    assert.equal(findMatches('Total total', 'total', 'python', PLAIN).length, 2);
    assert.equal(
      findMatches('Total total', 'total', 'python', options({ caseSensitive: true })).length,
      1,
    );
  });

  test("a query with regex metacharacters is a literal unless regex mode is on", () => {
    // A student searching for `a.b` must not match `axb`.
    assert.equal(findMatches('axb a.b', 'a.b', 'python', PLAIN).length, 1);
    assert.equal(findMatches('axb a.b', 'a.b', 'python', options({ regex: true })).length, 2);
  });

  test('an unfinished regex is no matches rather than a crash', () => {
    // A student mid-type. This must not throw: the search box runs on every keystroke.
    assert.deepEqual(findMatches('anything', '(foo', 'python', options({ regex: true })), []);
    assert.deepEqual(replaceInFile('anything', '(foo', 'python', 'x', options({ regex: true })), {
      text: 'anything',
      count: 0,
    });
  });

  test('an empty query matches nothing rather than everything', () => {
    assert.deepEqual(matchSpans('abc', '', 'python', PLAIN), []);
  });

  test('a zero-width regex terminates', () => {
    // `\b` matches without consuming; without the lastIndex nudge this hangs the tab.
    const found = findMatches('ab cd', '\\b', 'python', options({ regex: true }));
    assert.ok(found.length > 0 && found.length < 20);
  });
});

describe('anchors mean the same thing to both halves', () => {
  const FILE = 'print(1)\nprint(2)\nprint(3)';

  test('^ anchors to each line, in search AND in replace', () => {
    const regex = options({ regex: true });

    // The exact case that shipped broken: three shown, one replaced.
    assert.equal(findMatches(FILE, '^print', 'python', regex).length, 3);
    assert.equal(replaceInFile(FILE, '^print', 'python', 'show', regex).count, 3);
    assert.equal(
      replaceInFile(FILE, '^print', 'python', 'show', regex).text,
      'show(1)\nshow(2)\nshow(3)',
    );
  });

  test('$ likewise', () => {
    const regex = options({ regex: true });
    assert.equal(findMatches(FILE, '\\)$', 'python', regex).length, 3);
    assert.equal(replaceInFile(FILE, '\\)$', 'python', ');', regex).count, 3);
  });

  test('a match spanning a newline is placed on the line it starts on', () => {
    const found = findMatches('a\nb', 'a\\nb', 'python', options({ regex: true }));
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 1);
    // Clamped to the line, so highlighting cannot run past the end of it.
    assert.equal(found[0].matchEnd, 1);
  });
});

describe('whole word uses the language, not JavaScript', () => {
  test("PHP's $total is one word", () => {
    // `\b` sits between `$` and `t`, so the JavaScript rule found nothing here - and
    // replace, which used that rule, rewrote it anyway.
    const php = '$total = 1; $totals = 2;';
    const found = findMatches(php, '$total', 'php', options({ wholeWord: true }));
    assert.equal(found.length, 1, 'the variable, not the plural');
    assert.equal(replaceInFile(php, '$total', 'php', '$sum', options({ wholeWord: true })).count, 1);
  });

  test('a CSS class with a hyphen is one word', () => {
    const css = '.my-class { color: red }';
    assert.equal(findMatches(css, 'my-class', 'css', options({ wholeWord: true })).length, 1);
  });
});

describe('code-only skips comments and strings, on both sides', () => {
  const SOURCE = [
    'total = 1        # total goes here',
    'label = "total"',
    'print(total)',
  ].join('\n');

  test('search skips them', () => {
    const found = findMatches(SOURCE, 'total', 'python', options({ codeOnly: true }));
    assert.deepEqual(found.map(match => match.line), [1, 3]);
  });

  test('replace skips exactly the same ones', () => {
    // The destructive version of the disagreement: the list showed two and replace
    // rewrote four, including the student's comment and their string literal.
    const { text, count } = replaceInFile(
      SOURCE, 'total', 'python', 'sum', options({ codeOnly: true }),
    );
    assert.equal(count, 2);
    assert.match(text, /# total goes here/, 'the comment is untouched');
    assert.match(text, /"total"/, 'and the string');
    assert.match(text, /^sum = 1/, 'the code is not');
  });
});

describe('the invariant, across every combination', () => {
  const SOURCE = [
    'total = 1  # total here',
    'totals = "total"',
    'print(total, totals)',
    'total = total + 1',
  ].join('\n');

  const QUERIES = ['total', 'tot.l', '^total', 'total$', '\\btotal\\b'];

  for (const regex of [false, true]) {
    for (const caseSensitive of [false, true]) {
      for (const wholeWord of [false, true]) {
        for (const codeOnly of [false, true]) {
          const opts = options({ regex, caseSensitive, wholeWord, codeOnly });
          const label = `regex=${regex} case=${caseSensitive} word=${wholeWord} code=${codeOnly}`;

          test(`what is listed is what is replaced (${label})`, () => {
            for (const query of QUERIES) {
              const listed = findMatches(SOURCE, query, 'python', opts).length;
              const replaced = replaceInFile(SOURCE, query, 'python', 'X', opts).count;
              assert.equal(
                replaced,
                listed,
                `"${query}": the list showed ${listed} and replace rewrote ${replaced}`,
              );
            }
          });
        }
      }
    }
  }
});

describe('replacing', () => {
  test('later matches do not shift earlier ones', () => {
    // Applied right-to-left; a left-to-right splice with a longer replacement walks off
    // the end of the string and corrupts the tail.
    const { text, count } = replaceInFile('a a a', 'a', 'python', 'bbbb', PLAIN);
    assert.equal(count, 3);
    assert.equal(text, 'bbbb bbbb bbbb');
  });

  test('a replacement containing the query does not recurse', () => {
    const { text, count } = replaceInFile('cat', 'cat', 'python', 'cats', PLAIN);
    assert.equal(count, 1);
    assert.equal(text, 'cats');
  });

  test('$& in the replacement is a literal, not a backreference', () => {
    // The replacement is spliced in, never passed to String.replace, so a student
    // replacing with `$&` gets the two characters they typed.
    const { text } = replaceInFile('a', 'a', 'python', '$&', PLAIN);
    assert.equal(text, '$&');
  });
});
