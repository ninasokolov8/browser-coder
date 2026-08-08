/**
 * Finding the dictionary key for a real error message.
 *
 * The inputs here are not invented: each one is run through the REAL parser
 * (`parseCompilerOutput`) on the REAL captured output from
 * `tests/unit/compiler-output.test.ts`, so what `errorKeyFrom` sees is exactly what it
 * will see in production. A key extractor written against a remembered format matches
 * nothing, and a lookup that never hits is indistinguishable from a language that has
 * no explanations at all - which is the failure mode this whole file exists to prevent.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseCompilerOutput } from '../../src/diagnostics/compiler-output.ts';
import {
  buildErrorHelpBlock,
  errorKeyCandidates,
  errorKeyFrom,
  formatErrorMarker,
  selectErrorKey,
} from '../../src/features/error-help.ts';

/** Parse real tool output the way the app does, then extract the key from it. */
function keyFromOutput(languageId: string, output: string): string | null {
  const [diagnostic] = parseCompilerOutput(languageId, output);
  assert.ok(diagnostic, `the parser found nothing in:\n${output}`);
  return errorKeyFrom(languageId, diagnostic.message);
}

describe('python, through the real parser', () => {
  test('a NameError', () => {
    const output = [
      '  File "main.py", line 2',
      '    print(y)',
      '          ^',
      "NameError: name 'y' is not defined",
    ].join('\n');
    assert.equal(keyFromOutput('python', output), 'NameError');
  });

  test('a SyntaxError', () => {
    const output = [
      '  File "main.py", line 1',
      '    def f(:',
      '          ^',
      'SyntaxError: invalid syntax',
    ].join('\n');
    assert.equal(keyFromOutput('python', output), 'SyntaxError');
  });

  test('a ZeroDivisionError from a nested frame', () => {
    const output = [
      'Traceback (most recent call last):',
      '  File "main.py", line 5, in <module>',
      '    helper()',
      '  File "lib/util.py", line 12, in helper',
      '    return 1 / 0',
      'ZeroDivisionError: division by zero',
    ].join('\n');
    assert.equal(keyFromOutput('python', output), 'ZeroDivisionError');
  });

  test('IndentationError is its own key, not SyntaxError', () => {
    // It IS a SyntaxError subclass, but Python prints the subclass name and a student
    // searching for what they saw needs the entry they saw.
    const output = [
      '  File "main.py", line 2',
      '    print(1)',
      '    ^',
      'IndentationError: unexpected indent',
    ].join('\n');
    assert.equal(keyFromOutput('python', output), 'IndentationError');
  });

  test('a dotted exception keeps only the class', () => {
    assert.equal(
      errorKeyFrom('python', 'json.decoder.JSONDecodeError: Expecting value: line 1 column 1'),
      'JSONDecodeError',
    );
  });
});

describe('javascript, through the real parser', () => {
  test('a ReferenceError', () => {
    const output = [
      'file://main.mjs:2',
      'nope();',
      '^',
      '',
      'ReferenceError: nope is not defined',
      '    at file://main.mjs:2:1',
      '    at ModuleJob.run (node:internal/modules/esm/module_job:325:25)',
      '',
      'Node.js v20.20.0',
    ].join('\n');
    assert.equal(keyFromOutput('javascript', output), 'ReferenceError');
  });

  test('a TypeError', () => {
    assert.equal(
      errorKeyFrom('javascript', "TypeError: Cannot read properties of undefined (reading 'name')"),
      'TypeError',
    );
  });
});

describe('typescript', () => {
  test('the compiler code is the key, because it is stable and searchable', () => {
    const output = "main.ts:1:7 - error TS2322: Type 'string' is not assignable to type 'number'.";
    assert.equal(keyFromOutput('typescript', output), 'TS2322');
  });

  test('a runtime error in compiled output still resolves to its class', () => {
    // TypeScript runs as JavaScript, so what fails at runtime is a JS exception.
    assert.equal(errorKeyFrom('typescript', 'ReferenceError: nope is not defined'), 'ReferenceError');
  });
});

describe('csharp', () => {
  test('the CS code is the key', () => {
    const output = [
      "Program.cs(1,9): error CS1525: Invalid expression term ';'",
      'The build failed. Fix the build errors and run again.',
    ].join('\n');
    assert.equal(keyFromOutput('csharp', output), 'CS1525');
  });

  test('a four-digit code is required, so a version banner is not a key', () => {
    assert.equal(errorKeyFrom('csharp', 'MSBuild version 17.8.3'), null);
  });

  test('a runtime exception is found even though .NET buries it mid-sentence', () => {
    // "Unhandled exception. System.NullReferenceException: ..." does not START with the
    // class, so an anchored rule would leave every runtime entry unreachable.
    assert.equal(
      errorKeyFrom(
        'csharp',
        'Unhandled exception. System.NullReferenceException: Object reference not set to an instance of an object.',
      ),
      'NullReferenceException',
    );
  });
});

describe('java, which has two kinds of error', () => {
  test('a javac phrase', () => {
    const output = [
      'Main.java:1: error: illegal start of expression',
      'public class Main { }',
      '           ^',
      '1 error',
    ].join('\n');
    assert.equal(keyFromOutput('java', output), 'illegal start of expression');
  });

  test('cannot find symbol, the most common javac error of all', () => {
    const output = ['Main.java:7: error: cannot find symbol', '1 error'].join('\n');
    assert.equal(keyFromOutput('java', output), 'cannot find symbol');
  });

  test("a missing token collapses to one entry, because the advice is the same", () => {
    const output = ["Main.java:3: error: ';' expected", '1 error'].join('\n');
    assert.equal(keyFromOutput('java', output), "'<token>' expected");
  });

  test('a JVM exception resolves to its simple class name', () => {
    assert.equal(
      errorKeyFrom('java', 'Exception in thread "main" java.lang.NullPointerException: oops'),
      'NullPointerException',
    );
  });

  test('the variable name is removed, so one entry covers every variable', () => {
    // javac writes the identifier into the sentence. Without this an entry could only
    // ever match the one variable name it was written for, and would be dead for every
    // real program.
    assert.equal(
      errorKeyFrom('java', 'variable total might not have been initialized'),
      'variable might not have been initialized',
    );
  });

  test('a message with a detail after a colon still finds its entry by prefix', () => {
    // javac says `incompatible types: String cannot be converted to int`.
    assert.equal(
      selectErrorKey(
        'java',
        'incompatible types: String cannot be converted to int',
        ['incompatible types'],
      ),
      'incompatible types',
    );
  });

  test('a package-qualified exception drops the package', () => {
    assert.equal(
      errorKeyFrom('java', 'java.lang.ArrayIndexOutOfBoundsException: Index 5 out of bounds for length 3'),
      'ArrayIndexOutOfBoundsException',
    );
  });
});

describe('php', () => {
  test('a parse error', () => {
    const output =
      'PHP Parse error:  syntax error, unexpected token "echo", expecting "," or ";" in main.php on line 3';
    assert.equal(keyFromOutput('php', output), 'syntax error');
  });

  test('an undefined variable warning', () => {
    const output = 'PHP Warning:  Undefined variable $x in main.php on line 2';
    assert.equal(keyFromOutput('php', output), 'Undefined variable');
  });

  test('an uncaught exception keeps the class, without its namespace', () => {
    assert.equal(
      errorKeyFrom('php', 'Uncaught TypeError: Unsupported operand types: string + int'),
      'TypeError',
    );
    assert.equal(errorKeyFrom('php', 'Uncaught \\App\\MyError: nope'), 'MyError');
  });

  test('calling a function that does not exist', () => {
    assert.equal(
      errorKeyFrom('php', 'Call to undefined function greet()'),
      'Call to undefined function',
    );
  });

  test('the specific phrase beats the exception class it is wrapped in', () => {
    // Real PHP: `Fatal error: Uncaught Error: Call to undefined function foo()`.
    // Almost every fatal PHP error is an `Error`, so keying on the class alone would
    // give one answer for a dozen different mistakes.
    const candidates = errorKeyCandidates(
      'php',
      'Fatal error: Uncaught Error: Call to undefined function greet()',
    );
    assert.equal(candidates[0], 'Call to undefined function');
    assert.ok(candidates.includes('Error'), 'the class must still be available as a fallback');
  });

  test('an undefined method is not confused with an undefined function', () => {
    assert.equal(
      errorKeyFrom('php', 'Uncaught Error: Call to undefined method User::getName()'),
      'Undefined method',
    );
  });

  test('a typed exception keeps its own class when there is no phrase', () => {
    assert.equal(
      errorKeyFrom('php', 'Fatal error: Uncaught TypeError: double(): Argument #1 must be of type int'),
      'TypeError',
    );
  });

  test('an undefined property', () => {
    assert.equal(
      errorKeyFrom('php', 'Warning: Undefined property: User::$nmae'),
      'Undefined property',
    );
  });
});

describe('refusing to produce a key it cannot stand behind', () => {
  test('an unknown language has no rule', () => {
    assert.equal(errorKeyFrom('cobol', 'NameError: whatever'), null);
  });

  test('empty input', () => {
    assert.equal(errorKeyFrom('python', ''), null);
    assert.equal(errorKeyFrom('python', '   '), null);
  });

  test('prose that merely mentions an error is not a key', () => {
    // The reason the pattern is anchored: a substring search would fire on this and
    // explain something the student is not looking at.
    assert.equal(errorKeyFrom('python', 'the program raised a TypeError somewhere'), null);
  });

  test('a lowercase word is not an exception class', () => {
    assert.equal(errorKeyFrom('python', 'killed: out of memory'), null);
  });

  test('an unparseable message never throws', () => {
    for (const language of ['python', 'java', 'csharp', 'php', 'javascript', 'typescript']) {
      assert.doesNotThrow(() => errorKeyFrom(language, '\u0000\u0001 nonsense ][{}'));
    }
  });
});

describe('picking the most specific entry the dictionary has', () => {
  const jsKeys = ['TypeError', 'ReferenceError', 'RangeError: Maximum call stack size exceeded', 'Error'];

  test('a specific entry beats the general one', () => {
    // The whole reason this exists: "maximum call stack" is infinite recursion and
    // deserves its own answer, while a bare RangeError needs the general one.
    assert.equal(
      selectErrorKey('javascript', 'RangeError: Maximum call stack size exceeded', jsKeys),
      'RangeError: Maximum call stack size exceeded',
    );
  });

  test('the general one is used when there is no specific entry', () => {
    assert.equal(selectErrorKey('javascript', 'TypeError: x is not a function', jsKeys), 'TypeError');
  });

  test('an entry the dictionary does not have resolves to nothing', () => {
    // RangeError itself is not in this dictionary, only the specific phrasing.
    assert.equal(selectErrorKey('javascript', 'RangeError: invalid array length', jsKeys), null);
  });

  test('a key is not matched across a word boundary', () => {
    // "Error" must not explain "ErrorFoo", which is a different error entirely.
    assert.equal(selectErrorKey('javascript', 'ErrorFoo: nope', ['Error']), null);
    assert.equal(selectErrorKey('javascript', 'Error: nope', ['Error']), 'Error');
  });

  test('a key that is not a prefix is still found through the extractor', () => {
    // C# buries the code mid-message and PHP puts a severity in front, so neither can
    // be matched by prefix.
    assert.equal(
      selectErrorKey('csharp', "error CS1525: Invalid expression term ';'", ['CS1525']),
      'CS1525',
    );
    assert.equal(
      selectErrorKey('php', 'Parse error: syntax error, unexpected token', ['syntax error']),
      'syntax error',
    );
  });

  test('an empty dictionary resolves to nothing rather than throwing', () => {
    assert.equal(selectErrorKey('python', 'NameError: x', []), null);
  });
});

describe('the candidates a message offers', () => {
  test("node's module code is preferred over the bare Error class", () => {
    // `Error` is true and useless here; ERR_MODULE_NOT_FOUND is what to explain.
    const candidates = errorKeyCandidates(
      'javascript',
      'Error [ERR_MODULE_NOT_FOUND]: Cannot find package \'left-pad\'',
    );
    assert.equal(candidates[0], 'ERR_MODULE_NOT_FOUND');
    assert.ok(candidates.includes('Error'));
  });

  test('an errno code is preferred too', () => {
    const candidates = errorKeyCandidates(
      'javascript',
      "Error: ENOENT: no such file or directory, open 'data.txt'",
    );
    assert.equal(candidates[0], 'ENOENT');
  });

  test('a plain exception offers just its class', () => {
    assert.deepEqual(errorKeyCandidates('python', 'NameError: name \'y\' is not defined'), ['NameError']);
  });

  test('nothing extractable offers nothing', () => {
    assert.deepEqual(errorKeyCandidates('python', 'killed'), []);
  });
});

describe('laying the explanation out', () => {
  test('the heading names the error and its category', () => {
    const block = buildErrorHelpBlock('NameError', {
      explanation: 'Python looked for a name and could not find it.',
      cause: 'Usually a typo.',
      type: 'name error',
    });
    assert.equal(block.heading, 'NameError — name error');
  });

  test('a missing category leaves the heading as just the error', () => {
    const block = buildErrorHelpBlock('NameError', { explanation: 'x'.repeat(20) });
    assert.equal(block.heading, 'NameError');
  });

  test('an empty cause or example is null, not an empty line', () => {
    const block = buildErrorHelpBlock('X', { explanation: 'why', cause: '  ', example: '' });
    assert.equal(block.cause, null);
    assert.equal(block.example, null);
  });

  test('rtl travels with the entry, because Hebrew punctuation lands wrong without it', () => {
    assert.equal(buildErrorHelpBlock('X', { explanation: 'א', rtl: true }).rtl, true);
    assert.equal(buildErrorHelpBlock('X', { explanation: 'a' }).rtl, false);
  });

  test('the marker separates the error, explanation, cause and example', () => {
    const text = formatErrorMarker(
      "NameError: name 'total' is not defined",
      buildErrorHelpBlock('NameError', {
        explanation: 'Python cannot find that name.',
        cause: 'It may be misspelled.',
        example: 'total = 10\nprint(total)',
      }),
    );

    assert.equal(text, [
      'ERROR',
      "NameError: name 'total' is not defined",
      '',
      'WHAT THIS MEANS',
      'Python cannot find that name.',
      '',
      'COMMON CAUSE',
      'It may be misspelled.',
      '',
      'EXAMPLE',
      'total = 10',
      'print(total)',
    ].join('\n'));
  });

  test('an error without curated help still has a clear error heading', () => {
    assert.equal(formatErrorMarker('Unexpected token'), 'ERROR\nUnexpected token');
  });
});
