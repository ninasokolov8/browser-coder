import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findPrintSites, OutputTraceMapper } from '../../src/features/output-trace.ts';

describe('output to code tracing', () => {
  test('finds print APIs in all five debug languages', () => {
    const examples = {
      python: 'print(value)',
      javascript: 'console.log(value)',
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
});
