import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { safeFixFor } from '../../src/features/error-first-aid.ts';

describe('safe error first-aid', () => {
  test('adds the one missing colon to a Python header', () => {
    assert.deepEqual(safeFixFor('python', 'if score > 50\n    print(score)', 1, "SyntaxError: expected ':'"), {
      id: 'python-add-colon', title: 'Add the missing :', line: 1,
      startColumn: 14, endColumn: 14, text: ':',
    });
  });

  test('does not offer another colon when one is already there', () => {
    assert.equal(safeFixFor('python', 'if ready:', 1, "SyntaxError: expected ':'"), null);
  });

  test('repairs only the exact beginner typo prnt', () => {
    const fix = safeFixFor('python', 'prnt(total)', 1, "NameError: name 'prnt' is not defined");
    assert.equal(fix?.text, 'print');
    assert.equal(fix?.startColumn, 1);
  });

  test('closes one unambiguous delimiter before a semicolon', () => {
    const fix = safeFixFor('java', 'System.out.println(total;', 1, "')' expected");
    assert.equal(fix?.text, ')');
    assert.equal(fix?.startColumn, 25);
  });

  test('refuses ambiguous multiple unclosed delimiters', () => {
    assert.equal(safeFixFor('python', 'print((value', 1, "'(' was never closed"), null);
  });
});
