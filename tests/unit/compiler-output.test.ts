/**
 * Compiler-output parsing.
 *
 * Every fixture here is REAL output, captured from the production image by running
 * broken programs through /api/run. That matters more than usual: a parser written
 * against a remembered or documented format silently matches nothing, and a
 * diagnostics pipeline that produces no diagnostics looks exactly like a working
 * one that found no problems.
 *
 * Captured 2026-07-31 from bc-ops:test (Python 3, JDK 17, .NET 8, PHP 8, Node 20).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseCompilerOutput } from '../../src/diagnostics/compiler-output.ts';

describe('python', () => {
  test('a runtime NameError', () => {
    const output = [
      '  File "main.py", line 2',
      '    print(y)',
      '          ^',
      "NameError: name 'y' is not defined",
    ].join('\n');

    const [diagnostic] = parseCompilerOutput('python', output);
    assert.equal(diagnostic.file, 'main.py');
    assert.equal(diagnostic.line, 2);
    assert.equal(diagnostic.severity, 'error');
    assert.match(diagnostic.message, /NameError: name 'y' is not defined/);
  });

  test('a SyntaxError', () => {
    const output = [
      '  File "main.py", line 1',
      '    def f(:',
      '          ^',
      'SyntaxError: invalid syntax',
    ].join('\n');

    const [diagnostic] = parseCompilerOutput('python', output);
    assert.equal(diagnostic.line, 1);
    assert.match(diagnostic.message, /SyntaxError/);
  });

  test('the deepest frame wins, because that is where the error happened', () => {
    // A traceback lists frames outermost-first. Reporting the first would point at
    // the call site instead of the fault.
    const output = [
      'Traceback (most recent call last):',
      '  File "main.py", line 5, in <module>',
      '    helper()',
      '  File "lib/util.py", line 12, in helper',
      '    return 1 / 0',
      'ZeroDivisionError: division by zero',
    ].join('\n');

    const [diagnostic] = parseCompilerOutput('python', output);
    assert.equal(diagnostic.file, 'lib/util.py');
    assert.equal(diagnostic.line, 12);
    assert.match(diagnostic.message, /ZeroDivisionError/);
  });

  test('the caret gives a column relative to the source line', () => {
    const output = ['  File "main.py", line 2', '    print(y)', '          ^', 'NameError: x'].join('\n');
    const [diagnostic] = parseCompilerOutput('python', output);
    // `print(y)` starts at indent 4; the caret sits at offset 10, so column 7 - the
    // `y`. An off-by-one here underlines the wrong character.
    assert.equal(diagnostic.column, 7);
  });
});

describe('java', () => {
  test('a javac error', () => {
    const output = [
      'Main.java:1: error: illegal start of expression',
      'public class Main { public static void main(String[] a){ int x = ; } }',
      '                                                                 ^',
      '1 error',
    ].join('\n');

    const [diagnostic] = parseCompilerOutput('java', output);
    assert.equal(diagnostic.file, 'Main.java');
    assert.equal(diagnostic.line, 1);
    assert.equal(diagnostic.severity, 'error');
    assert.equal(diagnostic.message, 'illegal start of expression');
  });

  test('several errors are all reported', () => {
    const output = [
      'Main.java:3: error: \';\' expected',
      'Main.java:7: error: cannot find symbol',
      '2 errors',
    ].join('\n');

    assert.equal(parseCompilerOutput('java', output).length, 2);
  });

  test('a warning is not an error', () => {
    const output = 'Main.java:4: warning: [deprecation] foo() is deprecated';
    const [diagnostic] = parseCompilerOutput('java', output);
    assert.equal(diagnostic.severity, 'warning');
  });
});

describe('csharp', () => {
  test('a build error with line and column', () => {
    const output = [
      "Program.cs(1,9): error CS1525: Invalid expression term ';'",
      'The build failed. Fix the build errors and run again.',
    ].join('\n');

    const [diagnostic] = parseCompilerOutput('csharp', output);
    assert.equal(diagnostic.file, 'Program.cs');
    assert.equal(diagnostic.line, 1);
    assert.equal(diagnostic.column, 9);
    // The code stays in the message: students search for "CS1525".
    assert.match(diagnostic.message, /CS1525/);
  });

  test('the build-failed summary is not itself a diagnostic', () => {
    const output = [
      "Program.cs(1,9): error CS1525: Invalid expression term ';'",
      'The build failed. Fix the build errors and run again.',
    ].join('\n');

    assert.equal(parseCompilerOutput('csharp', output).length, 1);
  });
});

describe('php', () => {
  test('a parse error', () => {
    // Captured after fixing the adapter, which used to discard this entire line
    // and report the bare string "Errors parsing main.php".
    const output =
      'PHP Parse error:  syntax error, unexpected token "echo", expecting "," or ";" in main.php on line 3';

    const [diagnostic] = parseCompilerOutput('php', output);
    assert.equal(diagnostic.file, 'main.php');
    assert.equal(diagnostic.line, 3);
    assert.equal(diagnostic.severity, 'error');
    assert.match(diagnostic.message, /unexpected token/);
  });

  test('a warning is not an error', () => {
    const output = 'PHP Warning:  Undefined variable $x in main.php on line 2';
    const [diagnostic] = parseCompilerOutput('php', output);
    assert.equal(diagnostic.severity, 'warning');
  });
});

describe('javascript', () => {
  test('a runtime ReferenceError', () => {
    const output = [
      'file://main.mjs:2',
      'nope();',
      '^',
      '',
      'ReferenceError: nope is not defined',
      '    at file://main.mjs:2:1',
      '    at ModuleJob.run (node:internal/modules/esm/module_job:325:25)',
      '    at async ModuleLoader.import (node:internal/modules/esm/loader:606:24)',
      '',
      'Node.js v20.20.0',
    ].join('\n');

    const [diagnostic] = parseCompilerOutput('javascript', output);
    assert.equal(diagnostic.file, 'main.mjs');
    assert.equal(diagnostic.line, 2);
    assert.equal(diagnostic.column, 1);
    assert.match(diagnostic.message, /ReferenceError: nope is not defined/);
  });

  test("node's own frames are never blamed", () => {
    // Reporting node:internal/... would point the student at a file they cannot
    // open and did not write.
    const output = [
      'ReferenceError: boom',
      '    at ModuleJob.run (node:internal/modules/esm/module_job:325:25)',
    ].join('\n');

    assert.deepEqual(parseCompilerOutput('javascript', output), []);
  });
});

describe('typescript', () => {
  test('a type error', () => {
    const output = "main.ts:1:7 - error TS2322: Type 'string' is not assignable to type 'number'.";

    const [diagnostic] = parseCompilerOutput('typescript', output);
    assert.equal(diagnostic.file, 'main.ts');
    assert.equal(diagnostic.line, 1);
    assert.equal(diagnostic.column, 7);
    assert.match(diagnostic.message, /TS2322/);
  });
});

describe('refusing to guess', () => {
  test('unparseable output produces nothing rather than a wrong line', () => {
    // A marker on the wrong line sends the student to correct code, which is worse
    // than no marker at all.
    for (const [language, text] of [
      ['python', 'something went wrong'],
      ['java', 'Error occurred during initialization of VM'],
      ['csharp', 'MSBuild version 17.8.3'],
      ['php', 'PHP Fatal error: unknown'],
      ['javascript', 'killed'],
      ['typescript', 'tsc: command not found'],
    ] as const) {
      assert.deepEqual(parseCompilerOutput(language, text), [], `${language} guessed`);
    }
  });

  test('empty and unknown-language input is safe', () => {
    assert.deepEqual(parseCompilerOutput('python', ''), []);
    assert.deepEqual(parseCompilerOutput('python', '   \n  '), []);
    assert.deepEqual(parseCompilerOutput('cobol', 'anything'), []);
  });

  test('a line number of zero is rejected', () => {
    assert.deepEqual(parseCompilerOutput('java', 'Main.java:0: error: nope'), []);
  });
});
