/**
 * Finding the operator under the cursor.
 *
 * The hover used to explain only words, because that is what `getWordAtPosition`
 * returns - so a beginner pointing at `total` got help and a beginner pointing at `//`
 * got nothing, which is backwards.
 *
 * Longest-match is the whole difficulty, and it is the thing most likely to regress:
 * pointing anywhere in `===` must give `===`, not `==`, and certainly not `=`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { hoverTargetAt, isOperatorKey, operatorAt } from '../../src/features/hover-symbols.ts';

const PYTHON = ['//', '%', '**', '==', '!=', '=', '+=', '<=', '>=', 'and', 'or', 'not', 'in', 'is'];
const JS = ['===', '!==', '==', '!=', '=>', '??', '?.', '&&', '||', '%', '**', '++', '+=', '=', '...'];

describe('telling an operator key from a word key', () => {
  test('symbols are operators', () => {
    for (const key of ['//', '%', '===', '=>', '??', '?.', '...', '+=']) {
      assert.equal(isOperatorKey(key), true, key);
    }
  });

  test('words are not, even when they ARE operators', () => {
    /*
     * `and`, `is`, `in` and `not` are Python operators, and they must NOT be searched
     * for as symbols: `in` would match the middle of `print`. `getWordAtPosition`
     * already finds them, correctly, with word boundaries.
     */
    for (const key of ['and', 'or', 'not', 'in', 'is', 'instanceof', 'range']) {
      assert.equal(isOperatorKey(key), false, key);
    }
  });

  test('an empty key is not an operator', () => {
    assert.equal(isOperatorKey(''), false);
  });
});

describe('finding the operator at a column', () => {
  test('a single-character operator', () => {
    // `7 % 2` - the % is at column 3.
    assert.deepEqual(operatorAt('7 % 2', 3, PYTHON), { text: '%', startColumn: 3, endColumn: 4 });
  });

  test('a two-character operator, from either character', () => {
    // `a // b` - the // spans columns 3-4, and both must find it.
    assert.deepEqual(operatorAt('a // b', 3, PYTHON), { text: '//', startColumn: 3, endColumn: 5 });
    assert.deepEqual(operatorAt('a // b', 4, PYTHON), { text: '//', startColumn: 3, endColumn: 5 });
  });

  test('longest match wins: === is never read as == or =', () => {
    /*
     * The regression this file exists for. `===` contains `==` which contains `=`, and
     * a naive scan finds the shortest. A student hovering `===` in JavaScript would
     * then be told about loose equality - the opposite of what they are looking at.
     */
    for (const column of [3, 4, 5]) {
      assert.deepEqual(
        operatorAt('a === b', column, JS),
        { text: '===', startColumn: 3, endColumn: 6 },
        `column ${column}`,
      );
    }
  });

  test('longest match wins for !== over != and =', () => {
    assert.equal(operatorAt('a !== b', 4, JS)?.text, '!==');
  });

  test('+= is found rather than the bare = inside it', () => {
    assert.equal(operatorAt('total += 5', 8, JS)?.text, '+=');
    assert.equal(operatorAt('total += 5', 7, JS)?.text, '+=');
  });

  test('a bare = is still found where it really is one', () => {
    assert.deepEqual(operatorAt('total = 5', 7, PYTHON), { text: '=', startColumn: 7, endColumn: 8 });
  });

  test('nothing is found where there is no operator', () => {
    assert.equal(operatorAt('total', 3, PYTHON), null);
    assert.equal(operatorAt('', 1, PYTHON), null);
    assert.equal(operatorAt('   ', 2, PYTHON), null);
  });

  test('an operator the language does not define is not found', () => {
    // `//` is integer division in Python and a comment in JavaScript, so it is in one
    // key set and not the other. Nothing here knows that - the data decides.
    assert.equal(operatorAt('a // b', 3, JS), null);
    assert.equal(operatorAt('a // b', 3, PYTHON)?.text, '//');
  });

  test('a column outside the line is refused rather than guessed', () => {
    assert.equal(operatorAt('a % b', 0, PYTHON), null);
    assert.equal(operatorAt('a % b', 99, PYTHON), null);
  });

  test('the caret just after an operator still points at it', () => {
    // Where the cursor lands the instant a student finishes typing one.
    assert.equal(operatorAt('a %', 4, PYTHON)?.text, '%');
  });

  test('an empty key set finds nothing rather than throwing', () => {
    assert.equal(operatorAt('a % b', 3, []), null);
  });

  test('three-character operators are found', () => {
    assert.equal(operatorAt('const both = [...a]', 16, JS)?.text, '...');
  });
});

describe('choosing what to explain', () => {
  const word = { text: 'total', startColumn: 1, endColumn: 6 };

  test('a word wins over any nearby operator', () => {
    /*
     * In `total % 2` a cursor on `total` must explain `total` - which the data has
     * nothing for, so nothing appears - rather than reaching sideways to the nearest
     * operator and explaining `%` while the student points at a variable.
     */
    assert.deepEqual(hoverTargetAt('total % 2', 3, word, PYTHON), word);
  });

  test('with no word, the operator is used', () => {
    assert.deepEqual(
      hoverTargetAt('total % 2', 7, null, PYTHON),
      { text: '%', startColumn: 7, endColumn: 8 },
    );
  });

  test('with neither, nothing', () => {
    assert.equal(hoverTargetAt('   ', 2, null, PYTHON), null);
  });
});

describe('the shipped operator data', () => {
  test('every language that teaches keywords explains its own operators', async () => {
    // Read from the real files: a test that restates the data cannot catch the data
    // being wrong.
    const { readFileSync, existsSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const root = resolve(import.meta.dirname, '../../languages');

    const EXPECTED: Record<string, string[]> = {
      python: ['//', '%', '**', '=='],
      javascript: ['===', '=>', '??', '&&'],
      typescript: ['===', '?:', '!'],
      java: ['==', '%', '++', '&&'],
      csharp: ['==', '??', '?.', '=>'],
      php: ['.', '.=', '===', '->'],
    };

    for (const [language, operators] of Object.entries(EXPECTED)) {
      for (const file of ['keywords.json', 'keywords_he.json']) {
        const path = join(root, language, file);
        assert.ok(existsSync(path), `${path} is missing`);
        const data = JSON.parse(readFileSync(path, 'utf8'));

        for (const operator of operators) {
          const entry = data[operator];
          assert.ok(entry, `${language}/${file} does not explain ${operator}`);
          assert.equal(entry.type, 'operator');
          assert.ok(entry.explanation?.length > 10, `${language} ${operator}: no real explanation`);
          assert.ok(entry.example?.length > 0, `${language} ${operator}: no example`);
        }
      }
    }
  });

  test('the Hebrew explanation is actually Hebrew, not a copy of the English', async () => {
    // The failure mode of a bilingual data set: a new entry added to one file and
    // pasted into the other, so half the students silently get the wrong language.
    const { readFileSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const root = resolve(import.meta.dirname, '../../languages');

    for (const language of ['python', 'javascript', 'java', 'csharp', 'php', 'typescript']) {
      const english = JSON.parse(readFileSync(join(root, language, 'keywords.json'), 'utf8'));
      const hebrew = JSON.parse(readFileSync(join(root, language, 'keywords_he.json'), 'utf8'));

      for (const [key, entry] of Object.entries<{ type?: string; explanation?: string }>(english)) {
        if (entry.type !== 'operator') continue;
        const translated = hebrew[key];
        assert.ok(translated, `${language}: ${key} has no Hebrew entry`);
        assert.notEqual(
          translated.explanation,
          entry.explanation,
          `${language}: ${key} has the English text in the Hebrew file`,
        );
        assert.match(
          translated.explanation ?? '',
          /[֐-׿]/,
          `${language}: ${key} has no Hebrew characters`,
        );
      }
    }
  });
});
