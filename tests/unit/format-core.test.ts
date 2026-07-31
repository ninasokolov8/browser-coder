/**
 * The local formatter.
 *
 * The assertions that matter most are the ones about DECLINING. A formatter that
 * corrupts a program is far worse than one that does less than expected, so every
 * construct the scanner cannot model exactly must leave indentation untouched -
 * and each of those cases is asserted here rather than assumed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { formatSource, tidyWhitespace, canFormatLocally } from '../../src/features/format-core.ts';

describe('which languages it claims', () => {
  test('it claims exactly the ones Monaco does not format', () => {
    for (const language of ['python', 'java', 'csharp', 'php', 'markdown', 'svg', 'xml']) {
      assert.equal(canFormatLocally(language), true, language);
    }
    // Monaco owns these; claiming them would mean two formatters fighting.
    for (const language of ['typescript', 'javascript', 'css', 'html', 'json']) {
      assert.equal(canFormatLocally(language), false, language);
    }
  });
});

describe('whitespace, in every language', () => {
  const options = { indentSize: 4, useTabs: false, maxBlankLines: 2 };

  test('trailing whitespace goes', () => {
    assert.equal(tidyWhitespace('a   \nb\t\n', options), 'a\nb\n');
  });

  test('runs of blank lines collapse to the maximum', () => {
    assert.equal(tidyWhitespace('a\n\n\n\n\nb', options), 'a\n\n\nb\n');
  });

  test('leading and trailing blank lines go entirely', () => {
    assert.equal(tidyWhitespace('\n\n\na\n\n\n', options), 'a\n');
  });

  test('the file ends with exactly one newline', () => {
    assert.equal(tidyWhitespace('a', options), 'a\n');
    assert.equal(tidyWhitespace('a\n\n\n', options), 'a\n');
  });

  test('CRLF becomes LF', () => {
    assert.equal(tidyWhitespace('a\r\nb\r\n', options), 'a\nb\n');
  });

  test('an empty file stays empty rather than becoming a newline', () => {
    assert.equal(tidyWhitespace('', options), '');
    assert.equal(tidyWhitespace('\n\n\n', options), '');
  });
});

describe('brace languages get real indentation', () => {
  test('java', () => {
    const source = [
      'public class Main {',
      'public static void main(String[] args) {',
      'if (true) {',
      'System.out.println("hi");',
      '}',
      '}',
      '}',
    ].join('\n');

    const result = formatSource('java', source);
    assert.equal(result.reindented, true);
    assert.equal(
      result.text,
      [
        'public class Main {',
        '    public static void main(String[] args) {',
        '        if (true) {',
        '            System.out.println("hi");',
        '        }',
        '    }',
        '}',
        '',
      ].join('\n'),
    );
  });

  test('over-indented code is pulled back, not just under-indented pushed out', () => {
    const source = ['class A {', '                    int x = 1;', '}'].join('\n');
    const result = formatSource('java', source);
    assert.equal(result.text, 'class A {\n    int x = 1;\n}\n');
  });

  test('a closing brace dedents its own line', () => {
    const result = formatSource('csharp', 'if (a) {\nb();\n}\n');
    assert.equal(result.text, 'if (a) {\n    b();\n}\n');
  });

  test('brackets other than braces count too', () => {
    const result = formatSource('java', 'foo(\nbar,\nbaz\n);\n');
    assert.equal(result.text, 'foo(\n    bar,\n    baz\n);\n');
  });

  test('braces inside a string are not counted', () => {
    // The classic corruption: "{" in a literal shifting everything after it.
    const source = ['class A {', 'String s = "a { b";', 'int x = 1;', '}'].join('\n');
    const result = formatSource('java', source);
    assert.equal(result.reindented, true);
    assert.equal(
      result.text,
      'class A {\n    String s = "a { b";\n    int x = 1;\n}\n',
    );
  });

  test('braces inside a line comment are not counted', () => {
    const source = ['class A {', 'int x = 1; // what about { this', '}'].join('\n');
    assert.equal(formatSource('java', source).text, 'class A {\n    int x = 1; // what about { this\n}\n');
  });

  test('braces inside a block comment are not counted', () => {
    const source = ['class A {', '/* { { { */', 'int x = 1;', '}'].join('\n');
    const result = formatSource('java', source);
    assert.equal(result.reindented, true);
    assert.match(result.text, /^class A \{\n {4}\/\* \{ \{ \{ \*\/\n {4}int x = 1;\n\}\n$/);
  });

  test('an escaped quote does not end the string', () => {
    const source = ['class A {', 'String s = "he said \\" { ";', 'int x = 1;', '}'].join('\n');
    const result = formatSource('java', source);
    assert.equal(result.reindented, true);
    assert.match(result.text, /\n {4}int x = 1;\n\}/);
  });

  test('a php line comment with # is respected', () => {
    const source = ['function f() {', '$x = 1; # a { comment', '}'].join('\n');
    assert.equal(formatSource('php', source).reindented, true);
  });

  test('the body of a multi-line comment keeps its own layout', () => {
    const source = [
      'class A {',
      '/*',
      '     deliberately aligned',
      '        diagram',
      '*/',
      'int x = 1;',
      '}',
    ].join('\n');
    const result = formatSource('java', source);
    assert.match(result.text, /\n {5}deliberately aligned\n {8}diagram/);
  });
});

describe('it declines rather than guessing', () => {
  test('unbalanced braces leave indentation alone', () => {
    const source = 'class A {\n  int x = 1;\n';
    const result = formatSource('java', source);
    assert.equal(result.reindented, false);
    assert.match(result.declinedReason!, /unbalanced/);
    // The whitespace pass still ran, so the call was not wasted.
    assert.equal(result.text, 'class A {\n  int x = 1;\n');
  });

  test('a stray closing brace leaves indentation alone', () => {
    const result = formatSource('java', 'int x = 1;\n}\n');
    assert.equal(result.reindented, false);
  });

  test('a php heredoc leaves indentation alone', () => {
    // A heredoc body is arbitrary text that can contain unbalanced braces.
    const source = ['function f() {', '$s = <<<EOT', '  } { }', 'EOT;', '}'].join('\n');
    const result = formatSource('php', source);
    assert.equal(result.reindented, false);
    assert.match(result.declinedReason!, /heredoc|cannot be scanned/);
  });

  test('a C# verbatim string leaves indentation alone', () => {
    // @"..." escapes a quote by doubling it, so the backslash rule is wrong here.
    const source = ['class A {', 'string s = @"a "" { b";', '}'].join('\n');
    assert.equal(formatSource('csharp', source).reindented, false);
  });

  test('an unterminated block comment leaves indentation alone', () => {
    assert.equal(formatSource('java', 'class A {\n/* never closed\n}\n').reindented, false);
  });

  test('an unterminated string leaves indentation alone', () => {
    assert.equal(formatSource('java', 'class A {\nString s = "oops;\n}\n').reindented, false);
  });

  test('declining still returns usable text, never empty', () => {
    const source = 'class A {\n  int x = 1;   \n';
    const result = formatSource('java', source);
    assert.ok(result.text.length > 0);
    assert.doesNotMatch(result.text, /[ \t]+\n/);
  });
});

describe('python indentation is never rewritten', () => {
  test('a correctly indented file is left structurally alone', () => {
    const source = 'def f():\n    if True:\n        return 1\n';
    const result = formatSource('python', source);
    assert.equal(result.text, source);
    assert.equal(result.reindented, false);
  });

  test('badly indented python is NOT "fixed", because that would change meaning', () => {
    // Moving this line changes which block it belongs to. A formatter that
    // "corrected" it would be choosing the program's behaviour for the student.
    const source = 'def f():\n    if True:\n        a = 1\n    b = 2\n';
    assert.equal(formatSource('python', source).text, source);
  });

  test('consistent tab indentation is converted to spaces', () => {
    const source = 'def f():\n\tif True:\n\t\treturn 1\n';
    assert.equal(formatSource('python', source).text, 'def f():\n    if True:\n        return 1\n');
  });

  test('mixed tabs and spaces are left completely alone', () => {
    // The file may already mean something unintended; picking an interpretation
    // silently is the worst available option.
    const source = 'def f():\n\tif True:\n        return 1\n';
    assert.equal(formatSource('python', source).text, source);
  });

  test('trailing whitespace is still removed', () => {
    assert.equal(formatSource('python', 'x = 1   \ny = 2\t\n').text, 'x = 1\ny = 2\n');
  });

  test('two blank lines between definitions survive, as PEP 8 wants', () => {
    const source = 'def a():\n    pass\n\n\ndef b():\n    pass\n';
    assert.equal(formatSource('python', source).text, source);
  });

  test('the reason for declining is stated, not silent', () => {
    assert.match(formatSource('python', 'x = 1\n').declinedReason!, /indentation is part of the syntax/);
  });
});

describe('markdown, svg and xml', () => {
  test('whitespace only - indentation carries meaning in all three', () => {
    const source = '- one\n  - nested\n\n\n\n# heading   \n';
    assert.equal(formatSource('markdown', source).text, '- one\n  - nested\n\n\n# heading\n');
  });

  test('svg keeps its structure', () => {
    const source = '<svg>\n  <rect />   \n</svg>\n';
    assert.equal(formatSource('svg', source).text, '<svg>\n  <rect />\n</svg>\n');
  });
});

describe('languages Monaco owns are refused', () => {
  test('the source comes back untouched', () => {
    const source = 'const   x=1\n\n\n\n\n';
    const result = formatSource('typescript', source);
    assert.equal(result.text, source);
    assert.match(result.declinedReason!, /unsupported/);
  });
});

describe('formatting is stable', () => {
  test('formatting twice changes nothing the second time', () => {
    const cases: Array<[string, string]> = [
      ['java', 'class A {\nint x = 1;\n\n\n\n\nvoid f() {\ng();\n}\n}'],
      ['python', 'def f():\n\tx = 1   \n\n\n\n'],
      ['php', 'function f() {\n$x = 1;\nif ($x) {\necho $x;\n}\n}'],
      ['markdown', '# Title   \n\n\n\ntext'],
    ];

    for (const [language, source] of cases) {
      const once = formatSource(language, source).text;
      const twice = formatSource(language, once).text;
      assert.equal(twice, once, `${language} is not idempotent`);
    }
  });
});
