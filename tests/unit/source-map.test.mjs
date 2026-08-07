/**
 * The source map that makes TypeScript debuggable.
 *
 * TypeScript is compiled before it runs, so a breakpoint on a `.ts` line has to be
 * armed against the `.js` line it became, and a stop in that `.js` reported back as the
 * `.ts` line the student is looking at. Without both directions a breakpoint either
 * never fires or fires somewhere they did not click.
 *
 * The maps here are produced by the REAL TypeScript compiler that ships in this repo,
 * not written by hand: a decoder tested against its own idea of the format is a decoder
 * that agrees with itself.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { loadSourceMap, parseMappings } from '../../languages/javascript/source-map.mjs';

const require = createRequire(import.meta.url);

let root;
let jsPath;

const SOURCE = [
  'const greeting: string = "hello";',   // 1
  '',                                    // 2
  '// a comment, which emits nothing',   // 3
  'function twice(n: number): number {', // 4
  '  const doubled = n * 2;',            // 5
  '  return doubled;',                   // 6
  '}',                                   // 7
  '',                                    // 8
  'console.log(greeting, twice(4));',    // 9
].join('\n');

before(() => {
  const ts = require('typescript');
  root = mkdtempSync(join(tmpdir(), 'source-map-'));

  const tsPath = join(root, 'main.ts');
  jsPath = join(root, 'main.js');
  writeFileSync(tsPath, SOURCE);

  const emitted = ts.transpileModule(SOURCE, {
    compilerOptions: { sourceMap: true, target: ts.ScriptTarget.ES2022 },
    fileName: 'main.ts',
  });

  writeFileSync(jsPath, emitted.outputText);
  writeFileSync(`${jsPath}.map`, emitted.sourceMapText);
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('decoding the mappings', () => {
  test('a real map produces real records', () => {
    const map = JSON.parse(readFileSync(`${jsPath}.map`, 'utf8'));
    const records = parseMappings(map);

    assert.ok(records.length > 0, 'nothing decoded from a real map');
    for (const record of records) {
      assert.ok(record.generatedLine >= 1, JSON.stringify(record));
      assert.ok(record.originalLine >= 1, JSON.stringify(record));
      assert.ok(record.generatedColumn >= 0, JSON.stringify(record));
    }
  });

  test('negative deltas are decoded, which is where the sign bit is easy to invert', () => {
    // Columns go backwards between lines constantly, so a real map exercises this. If
    // the sign bit were read wrong every column would be plausible and wrong.
    const map = JSON.parse(readFileSync(`${jsPath}.map`, 'utf8'));
    const records = parseMappings(map);
    const wentBackwards = records.some((record, index) =>
      index > 0 && record.generatedColumn < records[index - 1].generatedColumn);

    assert.ok(wentBackwards, 'no backwards column delta in the sample - test is not exercising it');
  });

  test('a map with no mappings decodes to nothing rather than throwing', () => {
    assert.deepEqual(parseMappings({ sources: ['a.ts'], mappings: '' }), []);
    assert.deepEqual(parseMappings({}), []);
    assert.deepEqual(parseMappings(null), []);
  });
});

describe('a .ts line to the .js line it became', () => {
  test('a statement maps to a real generated line', () => {
    const map = loadSourceMap(jsPath);
    assert.ok(map, 'no map loaded');

    // Line 5 is `const doubled = n * 2;` inside the function.
    const generated = map.toGenerated('main.ts', 5);
    assert.ok(generated !== null, 'line 5 did not map');

    const js = readFileSync(jsPath, 'utf8').split('\n');
    assert.match(js[generated - 1], /doubled/, `mapped to: ${js[generated - 1]}`);
  });

  test('a line that emits nothing maps forwards, never backwards', () => {
    // A breakpoint on a blank line or a comment must not arm ABOVE where the student
    // clicked - landing on an earlier statement would stop before the code they were
    // asking about. Mapping forwards is the half this owns; V8 then binds the
    // generated line to the next statement that actually emits code, which is why the
    // assertion is about direction rather than about landing on a specific line.
    const map = loadSourceMap(jsPath);

    for (const emptyLine of [2, 3]) {
      const generated = map.toGenerated('main.ts', emptyLine);
      assert.ok(generated !== null, `line ${emptyLine} mapped to nothing`);

      const original = map.toOriginal(generated);
      assert.ok(
        original !== null && original.line >= emptyLine,
        `line ${emptyLine} mapped backwards to ${original?.line}`,
      );
    }
  });

  test('a line past the end of the file maps to nothing', () => {
    const map = loadSourceMap(jsPath);
    assert.equal(map.toGenerated('main.ts', 9999), null);
  });

  test('a source that is not in the map maps to nothing', () => {
    const map = loadSourceMap(jsPath);
    assert.equal(map.toGenerated('other.ts', 1), null);
  });
});

describe('a .js line back to the .ts the student wrote', () => {
  test('a generated line reports its original', () => {
    const map = loadSourceMap(jsPath);
    const generated = map.toGenerated('main.ts', 6);
    const original = map.toOriginal(generated);

    assert.ok(original, 'no original for a line we just mapped to');
    assert.equal(original.line, 6);
    assert.match(original.source, /main\.ts$/);
  });

  test('the round trip is stable for every statement line', () => {
    // The property that actually matters: a breakpoint the student sets must be
    // reported back at the line they set it on.
    const map = loadSourceMap(jsPath);
    for (const line of [1, 5, 6, 9]) {
      const generated = map.toGenerated('main.ts', line);
      assert.ok(generated !== null, `line ${line} did not map`);
      assert.equal(map.toOriginal(generated)?.line, line, `line ${line} did not round-trip`);
    }
  });

  test('a generated line with no mapping reports nothing rather than guessing', () => {
    const map = loadSourceMap(jsPath);
    assert.equal(map.toOriginal(99999), null);
  });

  test('the source is resolved next to the generated file, not left relative', () => {
    // The debugger compares it against workspace paths, so a bare "main.ts" would
    // match nothing.
    const map = loadSourceMap(jsPath);
    const original = map.toOriginal(map.toGenerated('main.ts', 1));
    assert.ok(original.source.includes(root), original.source);
  });
});

describe('when there is no map', () => {
  test('a plain .js file loads nothing, and that is not an error', () => {
    // An uncompiled JavaScript file is the normal case; the debugger must carry on
    // treating it as its own source.
    const plain = join(root, 'plain.js');
    writeFileSync(plain, 'console.log(1);\n');
    assert.equal(loadSourceMap(plain), null);
  });

  test('a corrupt map is ignored rather than crashing the debugger', () => {
    const broken = join(root, 'broken.js');
    writeFileSync(broken, 'console.log(1);\n');
    writeFileSync(`${broken}.map`, 'not json at all');
    assert.equal(loadSourceMap(broken), null);
  });
});
