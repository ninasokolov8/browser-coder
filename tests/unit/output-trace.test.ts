import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findPrintSites, OutputTraceMapper } from '../../src/features/output-trace.ts';

describe('output to code tracing', () => {
  test('finds print APIs in all six debug languages', () => {
    const examples = {
      python: 'print(value)',
      javascript: 'console.log(value)',
      typescript: 'console.log(value)',
      php: 'echo $value;',
      java: 'System.out.println(value);',
      csharp: 'Console.WriteLine(value);',
    };
    for (const [language, source] of Object.entries(examples)) {
      assert.equal(findPrintSites(source, language)[0]?.line, 1, language);
    }
  });

  test('a dynamic print inside a loop owns repeated lines between literal anchors', () => {
    const mapper = new OutputTraceMapper(
      'print("Start")\nfor n in [1, 2]: print(n * 10)\nprint("Done")',
      'python',
      'main.py',
    );
    assert.equal(mapper.locationFor('Start')?.line, 1);
    assert.equal(mapper.locationFor('10')?.line, 2);
    assert.equal(mapper.locationFor('20')?.line, 2);
    assert.equal(mapper.locationFor('Done')?.line, 3);
  });

  test('a selected fragment keeps the original editor line numbers', () => {
    const mapper = new OutputTraceMapper('console.log("selected")', 'javascript', 'main.js', 7);
    assert.equal(mapper.locationFor('selected')?.line, 8);
  });

  test('stable prefixes distinguish consecutive formatted output statements', () => {
    const examples = [
      ['python', 'print(f"fib(10) = {fib(10)}")\nprint("Doubled:", doubled)'],
      ['javascript', 'console.log(`fib(10) = ${fib(10)}`);\nconsole.log("Doubled:", doubled);'],
      ['typescript', 'console.log(`fib(10) = ${fib(10)}`);\nconsole.log("Doubled:", doubled);'],
      ['php', 'echo "fib(10) = " . fib(10);\necho "Doubled: " . implode(", ", $doubled);'],
      ['java', 'System.out.println("fib(10) = " + fib(10));\nSystem.out.println("Doubled: " + doubled);'],
      ['csharp', 'Console.WriteLine($"fib(10) = {Fib(10)}");\nConsole.WriteLine($"Doubled: {doubled}");'],
    ];

    for (const [language, source] of examples) {
      const mapper = new OutputTraceMapper(source, language, `main.${language}`);
      assert.equal(mapper.locationFor('fib(10) = 55')?.line, 1, language);
      assert.equal(mapper.locationFor('Doubled: 2, 4, 6')?.line, 2, language);
    }
  });

  test('repeated formatted output in a loop stays on its print line', () => {
    const mapper = new OutputTraceMapper(
      'for (const item of items) console.log(`item: ${item}`);\nconsole.log(value);',
      'javascript',
      'main.js',
    );

    assert.equal(mapper.locationFor('item: one')?.line, 1);
    assert.equal(mapper.locationFor('item: two')?.line, 1);
    assert.equal(mapper.locationFor('item: three')?.line, 1);
  });
});
