/**
 * The picker's matching and ranking, and the breadcrumb symbol heuristic.
 *
 * Both are pure, and both are the parts where a subtle mistake is invisible in
 * the UI: a ranking that puts the wrong file first still looks like it works.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { score, scoreItem } from '../../src/features/picker.ts';
import { heuristicSpine } from '../../src/features/breadcrumb-symbols.ts';

describe('subsequence matching', () => {
  test('an empty query matches everything, at rank zero', () => {
    assert.equal(score('', 'anything'), 0);
  });

  test('initials find a multi-word command', () => {
    assert.equal(typeof score('nf', 'New file'), 'number');
    assert.equal(score('xyz', 'New file'), null);
  });

  test('matching is case-insensitive both ways', () => {
    assert.notEqual(score('NF', 'new file'), null);
    assert.notEqual(score('nf', 'NEW FILE'), null);
  });

  test('a tighter match ranks better than a scattered one', () => {
    // "run" contiguous beats "run" spread across "Rewrite Unused iNdex".
    const tight = score('run', 'Run')!;
    const loose = score('run', 'Rewrite Unused iNdex')!;
    assert.ok(tight < loose, `tight ${tight} should beat loose ${loose}`);
  });

  test('order matters - it is a subsequence, not a bag of letters', () => {
    assert.equal(score('fn', 'New file'), null);
  });
});

describe('ranking a name above a path', () => {
  test('a name match beats a detail match', () => {
    const byName = scoreItem('main', 'main.py', 'src')!;
    const byPath = scoreItem('main', 'helper.py', 'main')!;
    assert.ok(byName < byPath, `name ${byName} should beat path ${byPath}`);
  });

  test('a path match is still found when the name does not match', () => {
    assert.notEqual(scoreItem('utils', 'helper.py', 'src/utils'), null);
  });

  test('no match anywhere is null', () => {
    assert.equal(scoreItem('zzz', 'helper.py', 'src/utils'), null);
  });

  test('a missing detail is not treated as a match', () => {
    assert.equal(scoreItem('src', 'helper.py'), null);
  });

  test('every name match outranks every path match, with no interleaving', () => {
    // The penalty has to exceed any realistic gap count, or a badly-scattered name
    // match would sort below a tight path match.
    const worstName = scoreItem('ae', 'a-very-long-name-with-e-at-the-end')!;
    const bestPath = scoreItem('ae', 'zzz', 'ae')!;
    assert.ok(worstName < bestPath, `worst name ${worstName} should still beat best path ${bestPath}`);
  });
});

describe('breadcrumb symbol heuristic', () => {
  test('python: the enclosing class and method', () => {
    const lines = [
      'class Robot:',          // 1
      '    def move(self):',   // 2
      '        x = 1',         // 3
      '        return x',      // 4
    ];
    const spine = heuristicSpine('python', lines, 4);
    assert.deepEqual(spine.map(s => s.name), ['Robot', 'move']);
    assert.deepEqual(spine.map(s => s.line), [1, 2]);
  });

  test('python: a sibling method closes the previous one', () => {
    const lines = [
      'class Robot:',
      '    def move(self):',
      '        pass',
      '    def stop(self):',
      '        pass',
    ];
    assert.deepEqual(heuristicSpine('python', lines, 5).map(s => s.name), ['Robot', 'stop']);
  });

  test('python: a top-level function after a class is not nested inside it', () => {
    const lines = [
      'class Robot:',
      '    def move(self):',
      '        pass',
      'def main():',
      '    pass',
    ];
    assert.deepEqual(heuristicSpine('python', lines, 5).map(s => s.name), ['main']);
  });

  test('java: class and method', () => {
    const lines = [
      'public class Main {',
      '    public static void main(String[] args) {',
      '        int x = 1;',
      '    }',
      '}',
    ];
    const names = heuristicSpine('java', lines, 3).map(s => s.name);
    assert.ok(names.includes('Main'), `got ${names.join(', ')}`);
    assert.ok(names.includes('main'), `got ${names.join(', ')}`);
  });

  test('javascript: a function declaration', () => {
    const lines = ['function greet(name) {', '  return name;', '}'];
    assert.deepEqual(heuristicSpine('javascript', lines, 2).map(s => s.name), ['greet']);
  });

  test('javascript: an arrow function assigned to a const', () => {
    const lines = ['const greet = (name) => {', '  return name;', '}'];
    assert.deepEqual(heuristicSpine('javascript', lines, 2).map(s => s.name), ['greet']);
  });

  test('typescript: an interface', () => {
    const lines = ['interface Shape {', '  size: number;', '}'];
    assert.deepEqual(heuristicSpine('typescript', lines, 2).map(s => s.name), ['Shape']);
  });

  test('a language with no pattern returns nothing rather than guessing', () => {
    assert.deepEqual(heuristicSpine('json', ['{', '"a": 1', '}'], 2), []);
    assert.deepEqual(heuristicSpine('markdown', ['# Title', 'text'], 2), []);
  });

  test('the cursor on a declaration line reports that symbol', () => {
    // Being ON `class Robot:` shows Robot, matching what VS Code does - the
    // declaration line is part of the symbol. The opposite would make the
    // breadcrumb blink out as the cursor crossed each declaration.
    assert.deepEqual(
      heuristicSpine('python', ['class Robot:', '    pass'], 1).map(s => s.name),
      ['Robot'],
    );
  });

  test('an empty file is safe', () => {
    assert.deepEqual(heuristicSpine('python', [], 1), []);
  });

  test('a cursor line past the end of the file is safe', () => {
    assert.deepEqual(heuristicSpine('python', ['def f():'], 999).map(s => s.name), ['f']);
  });
});
