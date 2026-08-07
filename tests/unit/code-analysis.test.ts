/**
 * The Run panel's function outline.
 *
 * This module had NO tests, which is how a real bug survived in it: for Python,
 * `parseFunctions` never masked the source at all, so a `def` written inside a
 * triple-quoted docstring was reported as a real function. The Run panel listed it,
 * and "run this function in isolation" would synthesise a call to something that
 * does not exist.
 *
 * Confirmed against the bug before fixing it - the docstring case below returned two
 * functions instead of one.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseFunctions, extractDefinitionsOnly } from '../../src/components/code-analysis.ts';

const names = (code: string, language: string): string[] =>
  parseFunctions(code, language).map(entry => entry.name);

describe('python', () => {
  test('finds functions, methods and classes', () => {
    const code = [
      'class Robot:',
      '    def move(self, distance):',
      '        pass',
      '',
      'def main():',
      '    pass',
    ].join('\n');

    const parsed = parseFunctions(code, 'python');
    assert.deepEqual(parsed.map(entry => entry.name), ['Robot', 'move', 'main']);
    assert.deepEqual(parsed.map(entry => entry.type), ['class', 'method', 'function']);
    assert.equal(parsed[1].params, 'self, distance');
  });

  test('a def inside a docstring is NOT a function', () => {
    // The bug. Before masking was applied, this returned inside_a_docstring too.
    const code = [
      'def real():',
      '    pass',
      'text = """',
      'def inside_a_docstring():',
      '"""',
      'def also_real():',
      '    pass',
    ].join('\n');

    assert.deepEqual(names(code, 'python'), ['real', 'also_real']);
  });

  test("a def inside a ''' docstring is not a function either", () => {
    const code = "s = '''\ndef hidden():\n'''\ndef real():\n    pass\n";
    assert.deepEqual(names(code, 'python'), ['real']);
  });

  test('a def inside a comment is not a function', () => {
    assert.deepEqual(names('# def hidden():\ndef real():\n    pass\n', 'python'), ['real']);
  });

  test('line numbers survive masking', () => {
    // Masking must preserve positions, or the Run panel scrolls to the wrong line.
    const code = 'text = """\nfiller\n"""\ndef real():\n    pass\n';
    const parsed = parseFunctions(code, 'python');
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].line, 4);
  });

  test('a hash inside a string does not blank the rest of the line', () => {
    const code = 'colour = "#fff"\ndef real():\n    pass\n';
    assert.deepEqual(names(code, 'python'), ['real']);
  });

  test('an apostrophe in a comment does not swallow the file', () => {
    const code = "# don't do this\ndef real():\n    pass\n";
    assert.deepEqual(names(code, 'python'), ['real']);
  });

  test('async def is found', () => {
    assert.deepEqual(names('async def fetch():\n    pass\n', 'python'), ['fetch']);
  });

  test('a method after a dedent is not still inside the class', () => {
    const code = 'class A:\n    def inside(self):\n        pass\n\ndef outside():\n    pass\n';
    const parsed = parseFunctions(code, 'python');
    assert.equal(parsed.find(entry => entry.name === 'inside')!.type, 'method');
    assert.equal(parsed.find(entry => entry.name === 'outside')!.type, 'function');
  });
});

describe('javascript and typescript', () => {
  test('function declarations, classes and arrow functions', () => {
    const code = [
      'class Widget {}',
      'function build(a, b) {}',
      'const render = (x) => x;',
    ].join('\n');
    assert.deepEqual(names(code, 'javascript'), ['Widget', 'build', 'render']);
  });

  test('a function inside a comment is ignored', () => {
    assert.deepEqual(names('// function hidden() {}\nfunction real() {}\n', 'javascript'), ['real']);
  });

  test('a function inside a template literal is ignored', () => {
    const code = 'const t = `\nfunction hidden() {}\n`;\nfunction real() {}\n';
    assert.deepEqual(names(code, 'javascript'), ['real']);
  });

  test('control keywords are not mistaken for functions', () => {
    const code = 'if (x) {\n}\nwhile (y) {\n}\nfunction real() {}\n';
    assert.deepEqual(names(code, 'javascript'), ['real']);
  });

  test('typescript is parsed with the javascript rules', () => {
    assert.deepEqual(names('function typed(a: number): void {}\n', 'typescript'), ['typed']);
  });
});

describe('java, php and csharp', () => {
  test('java class and method', () => {
    const code = 'public class Main {\n    public static void main(String[] a) {}\n}\n';
    assert.deepEqual(names(code, 'java'), ['Main', 'main']);
  });

  test('java: a method inside a text block is ignored', () => {
    const code = 'class A {\n  String s = """\n  void hidden() {}\n  """;\n  void real() {}\n}\n';
    const found = names(code, 'java');
    assert.ok(!found.includes('hidden'), `found ${found.join(', ')}`);
    assert.ok(found.includes('real'), `found ${found.join(', ')}`);
  });

  test('php function, with both comment styles ignored', () => {
    const code = '// function a() {}\n# function b() {}\nfunction real() {}\n';
    assert.deepEqual(names(code, 'php'), ['real']);
  });

  test('csharp: a verbatim string does not swallow the following code', () => {
    // @"C:\path\" ends at the quote. If the backslash were honoured as an escape,
    // the string would run on and every method below would vanish.
    const code = 'class A {\n  string p = @"C:\\path\\";\n  void Real() {}\n}\n';
    const found = names(code, 'csharp');
    assert.ok(found.includes('Real'), `found ${found.join(', ')}`);
  });
});

describe('unsupported languages', () => {
  test('return nothing rather than guessing', () => {
    for (const language of ['html', 'css', 'json', 'markdown', 'svg', 'cobol']) {
      assert.deepEqual(parseFunctions('anything at all', language), [], language);
    }
  });

  test('empty input is safe in every language', () => {
    for (const language of ['python', 'javascript', 'java', 'php', 'csharp']) {
      assert.deepEqual(parseFunctions('', language), [], language);
    }
  });
});

describe('extractDefinitionsOnly', () => {
  test('python: keeps definitions, drops top-level statements', () => {
    const code = [
      'def helper():',
      '    return 1',
      '',
      'print("this runs immediately")',
      'result = helper()',
    ].join('\n');

    const extracted = extractDefinitionsOnly(code, 'python');
    assert.match(extracted, /def helper/);
    assert.doesNotMatch(extracted, /this runs immediately/);
  });

  test('java: keeps the class shell', () => {
    const code = 'public class Main {\n  static int f() { return 1; }\n}\n';
    const extracted = extractDefinitionsOnly(code, 'java');
    assert.match(extracted, /class Main/);
  });

  test('an unsupported language returns something usable rather than throwing', () => {
    assert.doesNotThrow(() => extractDefinitionsOnly('{}', 'json'));
  });
});
