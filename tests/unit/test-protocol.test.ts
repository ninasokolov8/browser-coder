/**
 * The check-my-work protocol and harness discovery.
 *
 * Both pure, so both tested here rather than through a browser. The parser is the
 * riskier half: it reads text a teacher wrote by hand, and its failure mode is telling
 * a student they passed when they did not.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTestReport,
  stripReportLines,
  summariseReport,
} from '../../src/features/tests/protocol.ts';
import { findHarness, isHarnessFile } from '../../src/features/tests/harness.ts';

describe('parsing a report', () => {
  test('a complete run', () => {
    const report = parseTestReport([
      'BCTEST plan 3',
      'BCTEST case adds two numbers pass',
      'BCTEST case handles zero fail expected 0 but got 1',
      'BCTEST case negatives skip not written yet',
      'BCTEST done',
    ].join('\n'));

    assert.equal(report.present, true);
    assert.equal(report.plan, 3);
    assert.equal(report.done, true);
    assert.deepEqual(report.cases.map(entry => entry.name),
      ['adds two numbers', 'handles zero', 'negatives']);
    assert.deepEqual(report.cases.map(entry => entry.status), ['pass', 'fail', 'skip']);
    assert.equal(report.cases[1].detail, 'expected 0 but got 1');
    assert.equal(report.passed, 1);
    assert.equal(report.failed, 1);
    assert.equal(report.skipped, 1);
  });

  test('a case name may contain spaces, and a detail may contain a status word', () => {
    /*
     * The reason the status is found by scanning forward rather than by position.
     * `case handles zero fail expected fail` has a two-word name AND the word "fail"
     * in its detail; taking the second word as the status, or the last, gets it wrong.
     */
    const report = parseTestReport('BCTEST case handles zero fail did not fail as expected');
    assert.equal(report.cases[0].name, 'handles zero');
    assert.equal(report.cases[0].status, 'fail');
    assert.equal(report.cases[0].detail, 'did not fail as expected');
  });

  test('a case with no detail is fine', () => {
    const report = parseTestReport('BCTEST case works pass');
    assert.equal(report.cases[0].detail, '');
  });

  test('output with no BCTEST lines is reported as absent, not as zero passes', () => {
    // The difference between "the harness ran and nothing passed" and "the harness
    // never ran", which is what a student needs to know first.
    const report = parseTestReport('Traceback (most recent call last):\n  SyntaxError');
    assert.equal(report.present, false);
    assert.equal(report.cases.length, 0);
  });

  test('the marker must be a whole word', () => {
    // `BCTESTING` is a student's variable, not a directive.
    const report = parseTestReport('BCTESTING = 3\nBCTESTcase x pass');
    assert.equal(report.present, false);
  });

  test('a line it cannot understand is skipped, not fatal', () => {
    /*
     * A harness is hand-written, so it will contain typos. Refusing the whole report
     * over one bad line would hide the cases that DID parse - which is strictly less
     * than the student had before.
     */
    const report = parseTestReport([
      'BCTEST case good pass',
      'BCTEST wibble',
      'BCTEST case',
      'BCTEST case missingstatus',
      'BCTEST case also good pass',
    ].join('\n'));

    assert.equal(report.cases.length, 2);
    assert.deepEqual(report.cases.map(entry => entry.name), ['good', 'also good']);
  });

  test('a harness that dies partway is not done', () => {
    // And the summary must not claim the remaining cases failed - they never ran.
    const report = parseTestReport('BCTEST plan 5\nBCTEST case one pass');
    assert.equal(report.done, false);
    assert.equal(report.plan, 5);
    assert.match(summariseReport(report), /stopped early/);
  });

  test('status words are matched case-insensitively', () => {
    const report = parseTestReport('BCTEST case x PASS\nBCTEST case y Fail nope');
    assert.deepEqual(report.cases.map(entry => entry.status), ['pass', 'fail']);
  });

  test('leading whitespace is allowed, because harness code is indented', () => {
    const report = parseTestReport('    BCTEST case indented pass');
    assert.equal(report.cases[0].name, 'indented');
  });

  test('a runaway harness is capped but still counted honestly', () => {
    // A loop can print thousands. The panel shows the first few hundred; the total
    // must still be true, or "12 of 4000" becomes "12 of 500".
    const lines = Array.from({ length: 900 }, (_, index) => `BCTEST case case${index} pass`);
    const report = parseTestReport(lines.join('\n'));

    assert.equal(report.truncated, true);
    assert.ok(report.cases.length < 900);
    assert.ok(report.cases.length > 0);
  });

  test('an absurd name or detail is clamped rather than rendered whole', () => {
    const report = parseTestReport(`BCTEST case ${'n'.repeat(500)} fail ${'d'.repeat(2000)}`);
    assert.ok(report.cases[0].name.length <= 201);
    assert.ok(report.cases[0].detail.length <= 501);
  });

  test('empty and missing input do not throw', () => {
    for (const input of ['', undefined, null]) {
      const report = parseTestReport(input as unknown as string);
      assert.equal(report.present, false);
    }
  });
});

describe("keeping the student's own output", () => {
  test('protocol lines are removed and everything else stays', () => {
    const stdout = [
      'calculating...',
      'BCTEST case one pass',
      'done calculating',
      'BCTEST done',
    ].join('\n');

    assert.equal(stripReportLines(stdout), 'calculating...\ndone calculating');
  });

  test('a line that only looks like a marker is kept', () => {
    assert.equal(stripReportLines('BCTESTING = 3'), 'BCTESTING = 3');
  });
});

describe('the summary sentence', () => {
  test('leads with the count, because that is the motivating number', () => {
    const report = parseTestReport([
      'BCTEST case a pass', 'BCTEST case b pass', 'BCTEST case c pass',
      'BCTEST case d fail off by one', 'BCTEST done',
    ].join('\n'));

    const summary = summariseReport(report);
    assert.match(summary, /^3 of 4 checks passed/);
    assert.match(summary, /first failure: d — off by one/);
  });

  test('says plainly when the harness produced nothing', () => {
    assert.match(summariseReport(parseTestReport('boom')), /no results/);
  });

  test('mentions skips only when there are some', () => {
    const clean = summariseReport(parseTestReport('BCTEST case a pass\nBCTEST done'));
    assert.doesNotMatch(clean, /skipped/);

    const skipped = summariseReport(parseTestReport('BCTEST case a skip\nBCTEST done'));
    assert.match(skipped, /1 skipped/);
  });
});

describe('finding the harness', () => {
  const python = (path: string) => ({ path, languageId: 'python' });

  test('a hidden test file is the harness', () => {
    assert.equal(isHarnessFile('X_HIDDEN_tests.py'), true);
    assert.equal(isHarnessFile('X_HIDDEN_marking/test_all.py'), true);
  });

  test('a visible file is never the harness, whatever it is called', () => {
    // Otherwise a student could write their own `tests.py` and mark themselves.
    assert.equal(isHarnessFile('tests.py'), false);
    assert.equal(isHarnessFile('my_test.py'), false);
  });

  test('a hidden file that is not a test is not the harness', () => {
    // Teachers hide solutions and fixtures too; running one of those would be wrong.
    assert.equal(isHarnessFile('X_HIDDEN_solution.py'), false);
    assert.equal(isHarnessFile('X_HIDDEN_data.csv'), false);
  });

  test('exactly one harness is found', () => {
    const result = findHarness([python('main.py'), python('X_HIDDEN_tests.py')], 'python');
    assert.deepEqual(result, { kind: 'found', path: 'X_HIDDEN_tests.py' });
  });

  test('no harness is not an error', () => {
    // Most tasks have none. "Check my work" is simply not offered.
    assert.deepEqual(findHarness([python('main.py')], 'python'), { kind: 'none' });
  });

  test('two harnesses are refused, and both are named', () => {
    /*
     * Picking the first would mark the student against something the teacher did not
     * intend - silently, and differently depending on file order. Naming both is what
     * lets whoever wrote the task fix it.
     */
    const result = findHarness(
      [python('X_HIDDEN_tests.py'), python('X_HIDDEN_more_tests.py')],
      'python',
    );
    assert.deepEqual(result, {
      kind: 'ambiguous',
      paths: ['X_HIDDEN_more_tests.py', 'X_HIDDEN_tests.py'],
    });
  });

  test("another language's harness is not used", () => {
    const result = findHarness(
      [python('main.py'), { path: 'X_HIDDEN_tests.js', languageId: 'javascript' }],
      'python',
    );
    assert.deepEqual(result, { kind: 'none' });
  });
});
