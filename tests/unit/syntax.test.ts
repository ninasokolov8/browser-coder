/**
 * The shared language lexer.
 *
 * The Python docstring case is the reason this module exists, so it is asserted
 * first and most thoroughly: two independent copies of this lexer both got it
 * wrong, and the visible symptom was the Run panel listing a function that does
 * not exist.
 *
 * The length/newline invariant is asserted for every language, because every caller
 * masks, runs a regex, and then reports the position it found - so a mask that
 * shifts offsets reports the wrong line.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  SYNTAX,
  maskCommentsAndStrings as mask,
  syntaxFor,
  isKnownLanguage,
  identifierPattern,
  type KnownLanguageId,
} from '../../src/languages/syntax.ts';

const ALL = Object.keys(SYNTAX) as KnownLanguageId[];

describe('the table covers every registered language', () => {
  test('all eleven ids are described', () => {
    // If loader.ts gains a language and this table does not, the Record type stops
    // the build - but only if the union is kept in step, so the count is asserted.
    assert.equal(ALL.length, 11);
    for (const id of [
      'javascript', 'typescript', 'python', 'java', 'csharp', 'php',
      'html', 'css', 'json', 'markdown', 'svg',
    ]) {
      assert.ok(isKnownLanguage(id), `${id} is missing from SYNTAX`);
    }
  });

  test('an unknown id is reported as unknown, not defaulted', () => {
    assert.equal(syntaxFor('cobol'), null);
    assert.equal(isKnownLanguage('cobol'), false);
  });
});

describe('the invariant every caller depends on', () => {
  const samples: Record<string, string> = {
    javascript: 'const a = "x"; // c\n/* b */ let d = `t${1}`;\n',
    typescript: 'const a: string = "x"; // c\n',
    python: 'x = 1  # c\ns = """\nbody\n"""\n',
    java: 'String s = "x"; // c\n/* b */\n',
    csharp: 'var s = @"C:\\path"; // c\n',
    php: '$x = "y"; # c\n// d\n',
    html: '<!-- c -->\n<p class="x">t</p>\n',
    css: '/* c */\n.a { content: "x"; }\n',
    json: '{"a": "b"}\n',
    markdown: '# Heading\n<!-- c -->\ntext\n',
    svg: '<!-- c -->\n<rect fill="red" />\n',
  };

  for (const language of ALL) {
    test(`${language}: length and newline positions are preserved`, () => {
      const source = samples[language];
      const masked = mask(language, source);

      assert.equal(masked.length, source.length, 'length changed');

      const newlinesIn = [...source].map((c, i) => (c === '\n' ? i : -1)).filter(i => i >= 0);
      const newlinesOut = [...masked].map((c, i) => (c === '\n' ? i : -1)).filter(i => i >= 0);
      assert.deepEqual(newlinesOut, newlinesIn, 'newline positions moved');
    });
  }
});

describe('python, the case that was broken in both old copies', () => {
  test('a triple-quoted docstring body is masked', () => {
    const code = 'def real():\n    pass\ntext = """\ndef inside_a_docstring():\n"""\n';
    const masked = mask('python', code);

    assert.match(masked, /def real/);
    // This is the bug: `def inside_a_docstring` used to survive masking and be
    // reported as a real function by the Run panel.
    assert.doesNotMatch(masked, /def inside_a_docstring/);
  });

  test("single-quoted ''' docstrings too", () => {
    const masked = mask('python', "s = '''\ndef hidden():\n'''\n");
    assert.doesNotMatch(masked, /def hidden/);
  });

  test('the triple form is tried before the single form', () => {
    // Reversed ordering scans `"""x"""` as "" then bare x then "", leaking the body.
    assert.doesNotMatch(mask('python', 's = """secret"""'), /secret/);
  });

  test('a # comment is masked', () => {
    assert.doesNotMatch(mask('python', 'x = 1  # def sneaky():'), /def sneaky/);
  });

  test('a # inside a string is NOT a comment', () => {
    // The colour `"#fff"` must not blank the rest of the line.
    const masked = mask('python', 'colour = "#fff"\nreal = 2\n');
    assert.match(masked, /real = 2/);
  });

  test('a quote inside a comment does not open a string', () => {
    // `# don't` has an unbalanced apostrophe; treating it as a string start would
    // swallow every following line.
    const masked = mask('python', "# don't do this\ndef real():\n    pass\n");
    assert.match(masked, /def real/);
  });

  test('an empty docstring is handled', () => {
    assert.equal(mask('python', 's = """"""').length, 's = """"""'.length);
  });
});

describe('C-like languages', () => {
  test('line and block comments are masked', () => {
    const masked = mask('javascript', '// function hidden() {}\nfunction real() {}\n');
    assert.doesNotMatch(masked, /hidden/);
    assert.match(masked, /function real/);
  });

  test('a block comment spanning lines keeps the lines', () => {
    const source = '/*\nfunction hidden() {}\n*/\nfunction real() {}\n';
    const masked = mask('javascript', source);
    assert.doesNotMatch(masked, /hidden/);
    assert.match(masked, /function real/);
    assert.equal(masked.split('\n').length, source.split('\n').length);
  });

  test('template literals are masked and may span lines', () => {
    const masked = mask('javascript', 'const t = `\nfunction hidden() {}\n`;\nfunction real() {}\n');
    assert.doesNotMatch(masked, /hidden/);
    assert.match(masked, /function real/);
  });

  test('an escaped quote does not end the string', () => {
    const masked = mask('javascript', 'const s = "he said \\" function hidden() {}";\nfunction real(){}\n');
    assert.doesNotMatch(masked, /hidden/);
    assert.match(masked, /function real/);
  });

  test('a // inside a string is not a comment', () => {
    const masked = mask('javascript', 'const url = "http://x";\nfunction real() {}\n');
    assert.match(masked, /function real/);
  });

  test('an unterminated single-line string stops at the newline', () => {
    // Otherwise one stray quote hides every symbol in the rest of the file.
    const masked = mask('javascript', 'const s = "oops;\nfunction real() {}\n');
    assert.match(masked, /function real/);
  });

  test('java text blocks are masked', () => {
    const masked = mask('java', 'String s = """\nclass Hidden {}\n""";\nclass Real {}\n');
    assert.doesNotMatch(masked, /Hidden/);
    assert.match(masked, /class Real/);
  });
});

describe('csharp verbatim strings', () => {
  test('a backslash does NOT escape inside @"..."', () => {
    // `@"C:\path\"` ends at the quote; if the backslash were honoured as an escape
    // the string would run on and swallow the following code.
    const masked = mask('csharp', 'var p = @"C:\\path\\";\nclass Real {}\n');
    assert.match(masked, /class Real/);
  });

  test('a verbatim string body is masked', () => {
    assert.doesNotMatch(mask('csharp', 'var s = @"class Hidden {}";'), /Hidden/);
  });
});

describe('php has two line-comment forms', () => {
  test('both // and # are masked', () => {
    assert.doesNotMatch(mask('php', '// function a() {}'), /function a/);
    assert.doesNotMatch(mask('php', '# function b() {}'), /function b/);
  });

  test('$ is part of an identifier', () => {
    assert.match(identifierPattern('php'), /\$/);
  });
});

describe('languages where a naive default would be wrong', () => {
  test('markdown: # is a heading, not a comment', () => {
    // Treating # as a comment would blank every heading in the document.
    assert.match(mask('markdown', '# My Heading\ntext\n'), /# My Heading/);
  });

  test('markdown: an HTML comment is still hidden', () => {
    assert.doesNotMatch(mask('markdown', '<!-- hidden -->\nvisible\n'), /hidden/);
  });

  test('json: no comment syntax is claimed', () => {
    // Strict JSON, matching what the editor tells the student.
    assert.deepEqual(SYNTAX.json.lineComments, []);
    assert.deepEqual(SYNTAX.json.blockComments, []);
    assert.match(mask('json', '{"a": 1} // not a comment'), /\/\/ not a comment/);
  });

  test('html and svg use <!-- -->, not //', () => {
    assert.match(mask('html', '<p>http://example.com</p>'), /http:\/\/example\.com/);
    assert.doesNotMatch(mask('svg', '<!-- <rect hidden /> -->'), /hidden/);
  });

  test('an unknown language is returned unchanged rather than C-masked', () => {
    const source = "# this is not a comment in some language\nx";
    assert.equal(mask('cobol', source), source);
  });
});

describe('identifier patterns', () => {
  test('css includes the hyphen, so my-class is one word', () => {
    assert.match(identifierPattern('css'), /-/);
  });

  test('javascript includes the dollar', () => {
    assert.match(identifierPattern('javascript'), /\$/);
  });

  test('the pattern is a valid character class', () => {
    for (const language of ALL) {
      const pattern = identifierPattern(language);
      assert.doesNotThrow(() => new RegExp(pattern), `${language}: ${pattern}`);
      assert.ok(new RegExp(pattern).test('a'), `${language} should match a letter`);
    }
  });

  test('an unknown language still yields a usable pattern', () => {
    assert.doesNotThrow(() => new RegExp(identifierPattern('cobol')));
  });
});

/**
 * The properties search-and-replace depends on.
 *
 * search.ts imports Monaco so it cannot be loaded here, but the logic that decides
 * WHICH offsets match is entirely in this module. These reproduce what search does
 * with it, including the two bugs the language-aware version fixed.
 */
describe('what search-and-replace relies on', () => {
  const findMatches = (
    content: string,
    query: string,
    language: string,
    options: { wholeWord?: boolean; codeOnly?: boolean } = {},
  ): number[] => {
    const searchable = options.codeOnly ? mask(language, content) : content;

    let escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (options.wholeWord) {
      const identifier = identifierPattern(language);
      escaped = `(?<!${identifier})${escaped}(?!${identifier})`;
    }

    const pattern = new RegExp(escaped, 'g');
    const offsets: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(searchable)) !== null) {
      offsets.push(match.index);
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
    return offsets;
  };

  test('a PHP variable can be whole-word searched at all', () => {
    const php = '$total = 1;\n$subtotal = 2;\necho $total;';

    // The bug: `\b` sits BETWEEN `$` and `t`, so `\b\$total\b` matched nothing.
    // Whole-word search for a PHP variable silently found zero results.
    assert.equal((php.match(/\b\$total\b/g) || []).length, 0);

    assert.equal(findMatches(php, '$total', 'php', { wholeWord: true }).length, 2);
  });

  test('a hyphenated CSS class is one word, not two', () => {
    const css = '.my-class { color: red; }\n.my-class-extra { color: blue; }';

    // The bug in the other direction: `\b` treats the hyphen as a boundary, so
    // whole-word `my-class` also matched `my-class-extra`.
    assert.equal((css.match(/\bmy-class\b/g) || []).length, 2);

    assert.equal(findMatches(css, 'my-class', 'css', { wholeWord: true }).length, 1);
  });

  test('codeOnly skips comments and strings but keeps real code', () => {
    const python = 'total = 1  # total in a comment\nmsg = "total in a string"\nprint(total)';
    assert.equal(findMatches(python, 'total', 'python').length, 4);
    assert.equal(findMatches(python, 'total', 'python', { codeOnly: true }).length, 2);
  });

  test('codeOnly skips docstrings', () => {
    const python = 'x = 1\n"""\nx in a docstring\n"""\nprint(x)';
    assert.equal(findMatches(python, 'x', 'python', { codeOnly: true }).length, 2);
  });

  test('an offset found in the masked text is valid in the original', () => {
    // This is what makes it safe to search the mask and splice the original, which
    // is how replace-all honours codeOnly without rewriting the wrong bytes.
    const python = 'total = 1  # total\nprint(total)';
    for (const offset of findMatches(python, 'total', 'python', { codeOnly: true })) {
      assert.equal(python.slice(offset, offset + 5), 'total');
    }
  });
});

describe('degenerate input', () => {
  test('empty and whitespace-only sources are safe in every language', () => {
    for (const language of ALL) {
      assert.equal(mask(language, ''), '');
      assert.equal(mask(language, '\n\n'), '\n\n');
    }
  });

  test('a lone delimiter character does not hang or throw', () => {
    for (const language of ALL) {
      for (const source of ['"', "'", '`', '/', '*', '#', '<', '@', '\\']) {
        assert.doesNotThrow(() => mask(language, source), `${language} on ${source}`);
        assert.equal(mask(language, source).length, source.length);
      }
    }
  });
});
