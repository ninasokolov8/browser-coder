/**
 * "Try this": turning a hover's example into a program that runs.
 *
 * The part worth testing is the wrapping. Every example in the content files is written
 * as a SNIPPET - `pen.forward(100)`, `Console.WriteLine(1)` - because that is what reads
 * well in a tooltip. Python, JavaScript, TypeScript and PHP will run a snippet as
 * written; Java and C# will not execute a statement that is not inside a method inside a
 * type, so for them "try this" means producing a whole program.
 *
 * Getting that wrong is not a cosmetic failure: the student clicks Try this, the file
 * does not compile, and the IDE has taught them that its own documentation is broken.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { asRunnableProgram, scratchFileName, tryExampleLink } from '../../src/features/try-example-format.ts';

describe('languages that run a snippet as written', () => {
  test('python keeps the example and adds a comment in its own syntax', () => {
    const out = asRunnableProgram('python', 'pen.forward(100)', 'try-it');
    assert.match(out, /^# Try it/, 'a Python comment, not //');
    assert.match(out, /pen\.forward\(100\)/);
    assert.doesNotMatch(out, /class |void main/);
  });

  test('javascript and typescript use //', () => {
    for (const language of ['javascript', 'typescript']) {
      const out = asRunnableProgram(language, 'console.log(1)', 'try-it');
      assert.match(out, /^\/\/ Try it/, language);
      assert.match(out, /console\.log\(1\)/, language);
    }
  });

  test('php gets its opening tag, because a file without one is text', () => {
    const out = asRunnableProgram('php', 'echo 1;', 'try-it');
    assert.match(out, /^<\?php/);
    assert.match(out, /echo 1;/);
  });

  test('an example that already opens php is not given a second tag', () => {
    const out = asRunnableProgram('php', '<?php\n$x = 1;', 'try-it');
    assert.equal(out.match(/<\?php/g)?.length, 1);
  });
});

describe('languages that need a whole program', () => {
  test('java wraps the example in a class with a main', () => {
    const out = asRunnableProgram('java', 'System.out.println("hi");', 'TryIt');
    assert.match(out, /public class TryIt \{/);
    assert.match(out, /public static void main\(String\[\] args\)/);
    assert.match(out, /System\.out\.println\("hi"\);/);
  });

  test('and the class is named for the file, which javac requires', () => {
    // `public class X` must live in X.java. A mismatch is a compile error before the
    // student's example has even been looked at.
    const name = scratchFileName('java', 'java');
    const out = asRunnableProgram('java', 'int x = 1;', name.split('.')[0]);
    assert.equal(name, 'TryIt.java');
    assert.match(out, /public class TryIt/);
  });

  test('csharp wraps it too, and brings in System', () => {
    const out = asRunnableProgram('csharp', 'Console.WriteLine(1);', 'TryIt');
    assert.match(out, /using System;/);
    assert.match(out, /class TryIt \{/);
    assert.match(out, /static void Main\(\)/);
    assert.match(out, /Console\.WriteLine\(1\);/);
  });

  test('a multi-line example keeps its shape inside the wrapper', () => {
    const out = asRunnableProgram('java', 'int a = 1;\nint b = 2;\nSystem.out.println(a + b);', 'TryIt');
    // Every line of the example is indented into the method, none of them lost.
    for (const fragment of ['int a = 1;', 'int b = 2;', 'System.out.println(a + b);']) {
      assert.ok(out.includes(fragment), fragment);
    }
    assert.ok(out.indexOf('int a = 1;') < out.indexOf('int b = 2;'), 'order preserved');
  });
});

describe('the scratch file', () => {
  test('one per language, reused rather than accumulating', () => {
    assert.equal(scratchFileName('python', 'py'), 'try-it.py');
    assert.equal(scratchFileName('javascript', 'js'), 'try-it.js');
    assert.equal(scratchFileName('php', 'php'), 'try-it.php');
  });

  test('java and csharp are named for their class', () => {
    assert.equal(scratchFileName('java', 'java'), 'TryIt.java');
    assert.equal(scratchFileName('csharp', 'cs'), 'TryIt.cs');
  });
});

describe('the hover link', () => {
  test('carries only the language and the word', () => {
    // Not the example text. The note itself stays isTrusted:false, and this link is the
    // one trusted string in the hover - so nothing from a content file may reach it.
    const link = tryExampleLink('python', 'forward', 'Try this');
    assert.match(link, /^\[\$\(play\) Try this\]\(command:browserCoder\.tryExample\?/);

    const encoded = link.slice(link.indexOf('?') + 1, -1);
    assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), ['python', 'forward']);
  });

  test('a word with markdown characters cannot break out of the link', () => {
    const link = tryExampleLink('javascript', '](evil)[', 'Try this');
    const encoded = link.slice(link.indexOf('?') + 1, -1);
    // URI-encoded, so the brackets are inert inside the target.
    assert.doesNotMatch(encoded, /[[\]()]/);
    assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), ['javascript', '](evil)[']);
  });
});
