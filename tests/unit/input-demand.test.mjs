import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { executableText, programMayRequestInput } from '../../server/execution/input-demand.mjs';

describe('terminal input demand', () => {
  test('recognises the input APIs in every supported debug language', () => {
    const examples = {
      python: 'name = input("Name: ")',
      javascript: 'process.stdin.on("data", answer => console.log(answer))',
      typescript: 'const source = process.stdin;',
      php: '$answer = trim(fgets(STDIN));',
      java: 'var scanner = new Scanner(System.in);',
      csharp: 'var answer = Console.ReadLine();',
    };

    for (const [language, code] of Object.entries(examples)) {
      assert.equal(programMayRequestInput({ language, code }), true, language);
    }
  });

  test('quiet computation and debugger pauses do not imply input', () => {
    assert.equal(programMayRequestInput({
      language: 'javascript',
      code: 'setTimeout(() => console.log("done"), 5000);',
    }), false);
  });

  test('comments and help text cannot create a false input box', () => {
    const code = [
      '# Try input("Name: ") later',
      'message = "Console.ReadLine() is a C# example"',
      'print(message)',
    ].join('\n');
    assert.equal(programMayRequestInput({ language: 'python', code }), false);
  });

  test('input in an imported project file is detected', () => {
    assert.equal(programMayRequestInput({
      language: 'python',
      code: 'from helper import ask',
      files: [{ path: 'helper.py', content: 'def ask():\n    return input()' }],
    }), true);
  });

  test('the source sanitizer keeps line breaks and executable identifiers', () => {
    const source = 'print("input()")\n# input()\nanswer = input()';
    const cleaned = executableText(source, 'python');
    assert.equal(cleaned.split('\n').length, 3);
    assert.match(cleaned, /answer\s*=\s*input\s*\(\)/);
    assert.equal((cleaned.match(/input/g) ?? []).length, 1);
  });
});
