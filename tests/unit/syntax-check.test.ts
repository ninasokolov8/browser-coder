/**
 * The instant syntax check, and above all its silence on correct code.
 *
 * The dangerous failure for this feature is not a missed error - the compiler catches
 * those a moment later - it is a red underline on code that is fine. A student cannot
 * tell our false alarm from their real mistake, so one wrong squiggle costs more than
 * ten missed ones. Most of the tests below are therefore "this is valid, say nothing",
 * written from the idioms a student actually types.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  findSyntaxProblems,
  hasInstantSyntaxCheck,
} from '../../src/languages/syntax-check.ts';

/** Assert a snippet is reported as clean. */
function clean(language: string, code: string, why = ''): void {
  const problems = findSyntaxProblems(language, code);
  assert.deepEqual(
    problems,
    [],
    `${why || 'expected no problems'} - got: ${problems.map(p => `${p.line}:${p.column} ${p.message}`).join(' | ')}`,
  );
}

describe('scope', () => {
  test('only the languages Monaco cannot check live', () => {
    for (const language of ['python', 'java', 'php', 'csharp']) {
      assert.equal(hasInstantSyntaxCheck(language), true, language);
    }
    // Monaco has real language services for these; a second opinion from a scanner
    // could only contradict a real parser.
    for (const language of ['typescript', 'javascript', 'css', 'html', 'json']) {
      assert.equal(hasInstantSyntaxCheck(language), false, language);
      assert.deepEqual(findSyntaxProblems(language, 'function ('), []);
    }
  });

  test('an unknown language is silent rather than guessed at', () => {
    assert.deepEqual(findSyntaxProblems('brainfuck', '((('), []);
  });
});

describe('brackets', () => {
  test('an unclosed bracket is reported where it was opened', () => {
    const [problem] = findSyntaxProblems('python', 'print("hi"\n');
    assert.equal(problem.line, 1);
    assert.equal(problem.column, 6, 'the ( itself, not the end of the file');
    assert.match(problem.message, /never closed/);
  });

  test('a closing bracket with no opener', () => {
    const [problem] = findSyntaxProblems('python', 'x = 1)\n');
    assert.equal(problem.line, 1);
    assert.match(problem.message, /no matching \(/);
  });

  test('a mismatched pair names both ends', () => {
    const [problem] = findSyntaxProblems('java', 'int[] a = new int[3);\n');
    assert.match(problem.message, /Expected \]/);
  });

  test('brackets inside strings and comments are not counted', () => {
    clean('python', 'print("a ) b (")\n# ) ( {\n', 'a bracket in a string is text');
    clean('java', 'String s = "a { b"; // }\n');
    clean('csharp', '/* ) ( */ int x = 1;\n');
  });

  test('nesting across many lines is fine', () => {
    clean('python', 'result = fn(\n    [1, 2, 3],\n    {"k": (1, 2)},\n)\n');
  });
});

describe('strings', () => {
  test('a single-line string not closed before the newline', () => {
    const [problem] = findSyntaxProblems('python', 'name = "Alice\nprint(name)\n');
    assert.equal(problem.line, 1);
    assert.match(problem.message, /never closed/);
  });

  test("a python docstring that is never closed", () => {
    const [problem] = findSyntaxProblems('python', '"""notes\nmore\n');
    assert.equal(problem.line, 1);
    assert.match(problem.message, /never closed/);
  });

  test('a closed docstring is fine, and its contents are not code', () => {
    clean('python', '"""\nif x\n  ( [ {\n"""\nx = 1\n', 'a docstring is text');
  });

  test('an escaped quote does not end the string', () => {
    clean('python', 'x = "she said \\"hi\\""\n');
    clean('java', 'String s = "a\\"b";\n');
  });

  test("apostrophes inside a double-quoted string are fine", () => {
    clean('python', 'print("it\'s fine")\n');
  });

  test('a java text block', () => {
    clean('java', 'String s = """\n  hello ( [ {\n  """;\n');
  });
});

describe('python colons', () => {
  test('a header with no colon', () => {
    const [problem] = findSyntaxProblems('python', 'if x > 1\n    print(x)\n');
    assert.equal(problem.line, 1);
    assert.match(problem.message, /needs a : /);
  });

  test('every compound keyword is covered', () => {
    for (const header of [
      'if x', 'elif x', 'else', 'for i in y', 'while x',
      'def f()', 'class C', 'try', 'except E', 'finally', 'with open("f") as f',
    ]) {
      const problems = findSyntaxProblems('python', `${header}\n    pass\n`);
      assert.equal(problems.length, 1, `${header} should want a colon`);
    }
  });

  test('a correct header says nothing', () => {
    clean('python', 'for i in range(3):\n    print(i)\n');
    clean('python', 'def greet(name: str) -> str:\n    return name\n');
  });

  test('a header whose condition spans lines is not judged early', () => {
    // The colon is on the closing line. Judging line 1 alone would be a false alarm.
    clean('python', 'if (\n    x > 1\n):\n    pass\n');
    clean('python', 'if x > 1 and \\\n   y < 2:\n    pass\n');
  });

  test('a trailing comment after the colon is fine', () => {
    clean('python', 'if x:  # check it\n    pass\n');
  });

  test('a missing colon is still found with a trailing comment', () => {
    const problems = findSyntaxProblems('python', 'if x  # check it\n    pass\n');
    assert.equal(problems.length, 1);
  });

  test('a variable that merely starts with a keyword is untouched', () => {
    clean('python', 'iffy = 1\nformat = 2\nclassroom = 3\nwhilst = 4\n');
  });

  test('a colon is not demanded from other languages', () => {
    clean('java', 'if (x > 1) {\n  y();\n}\n');
    clean('csharp', 'if (x > 1) { y(); }\n');
  });
});

describe('php only checks php', () => {
  test('markup outside the tags is not code', () => {
    clean('php', '<div class="a">it\'s here</div>\n<?php echo 1; ?>\n');
  });

  test('a file with no open tag is treated as all php', () => {
    const problems = findSyntaxProblems('php', '$x = [1, 2;\n');
    assert.equal(problems.length, 1);
  });

  test('an error inside the tags is still found', () => {
    const problems = findSyntaxProblems('php', '<p>hi</p>\n<?php $x = fn(1; ?>\n');
    assert.equal(problems.length, 1);
    assert.equal(problems[0].line, 2);
  });
});

describe('real programs a student would write are silent', () => {
  test('python', () => {
    clean('python', [
      'import turtle',
      '',
      '# draw a square',
      'pen = turtle.Turtle()',
      'for _ in range(4):',
      '    pen.forward(50)',
      '    pen.left(90)',
      '',
      'def area(w, h):',
      '    """Return w * h."""',
      '    return w * h',
      '',
      'print(f"area = {area(3, 4)}")',
      'data = {"a": [1, 2], "b": (3, 4)}',
      'names = [n.strip() for n in ["a ", " b"]]',
      '',
    ].join('\n'));
  });

  test('java', () => {
    clean('java', [
      'public class Main {',
      '    public static void main(String[] args) {',
      '        int[] numbers = {1, 2, 3};',
      '        for (int n : numbers) {',
      '            System.out.println("n = " + n);',
      '        }',
      '    }',
      '}',
      '',
    ].join('\n'));
  });

  test('csharp', () => {
    clean('csharp', [
      'using System;',
      '',
      'class Program {',
      '    static void Main() {',
      '        var xs = new[] { 1, 2, 3 };',
      '        foreach (var x in xs) Console.WriteLine($"x = {x}");',
      '    }',
      '}',
      '',
    ].join('\n'));
  });

  test('php', () => {
    clean('php', [
      '<?php',
      '$items = ["a" => 1, "b" => 2];',
      'foreach ($items as $key => $value) {',
      '    echo "$key is $value\\n";',
      '}',
      'function add(int $a, int $b): int { return $a + $b; }',
      '',
    ].join('\n'));
  });

  test('an empty file and a blank one', () => {
    for (const language of ['python', 'java', 'php', 'csharp']) {
      clean(language, '');
      clean(language, '\n\n   \n');
    }
  });
});

describe('half-typed code does not panic', () => {
  /*
   * Everything here is a real intermediate state: the student is mid-keystroke. These
   * SHOULD report, because the bracket genuinely is unclosed - but exactly once, at a
   * useful place, and without cascading into a wall of red.
   */
  test('one unclosed bracket is one problem', () => {
    const problems = findSyntaxProblems('python', 'print(\n');
    assert.equal(problems.length, 1);
  });

  test('an unterminated string stops the scan rather than cascading', () => {
    // Without the early return, every bracket in the rest of the file would be read
    // as code inside the string and reported too.
    const problems = findSyntaxProblems('python', 'x = "oops\nprint(1)\nfor i in y:\n    pass\n');
    assert.equal(problems.length, 1);
    assert.equal(problems[0].line, 1);
  });
});
