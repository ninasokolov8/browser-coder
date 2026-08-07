/**
 * What the IDE says out loud when a run finishes.
 *
 * The output panel is deliberately NOT a live region - a program that prints two
 * hundred lines would read all two hundred aloud, which is worse than silence - so this
 * one sentence is the only thing a screen-reader user hears about a run. Its wording is
 * the whole feature, which is why it is a pure function with tests rather than a string
 * built inline where nobody can check it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { describeRunOutcome } from '../../src/components/announce.ts';

describe('a run that worked', () => {
  test('says so, and says nothing else', () => {
    assert.equal(describeRunOutcome({ exitCode: 0 }), 'Run finished successfully.');
  });

  test('an error summary is not read out for a successful run', () => {
    // The caller passes null on success; if it ever passed one anyway, appending it
    // would announce an error to someone whose program worked.
    const said = describeRunOutcome({ exitCode: 0, errorSummary: null, problemCount: 0 });
    assert.equal(said, 'Run finished successfully.');
  });
});

describe('a run that failed', () => {
  test('names the exit code', () => {
    assert.match(describeRunOutcome({ exitCode: 1 }), /exit code 1/);
  });

  test('and the error, with where it happened', () => {
    const said = describeRunOutcome({
      exitCode: 1,
      errorSummary: "NameError: name 'y' is not defined on line 2 of main.py.",
    });
    assert.match(said, /NameError/);
    assert.match(said, /line 2 of main\.py/);
  });

  test('a kill is described as a stop, not as exit code -1', () => {
    // Negative is the pipeline's signal for a timeout, an output cap or Stop.
    // "Exit code -1" would mean nothing to a student.
    const said = describeRunOutcome({ exitCode: -1 });
    assert.match(said, /stopped before it finished/i);
    assert.doesNotMatch(said, /-1/);
  });
});

describe('the problem count', () => {
  test('is announced, because the Problems panel is off screen', () => {
    assert.match(describeRunOutcome({ exitCode: 1, problemCount: 3 }), /3 problems/);
  });

  test('reads naturally when there is exactly one', () => {
    const said = describeRunOutcome({ exitCode: 1, problemCount: 1 });
    assert.match(said, /1 problem in/);
    assert.doesNotMatch(said, /1 problems/);
  });

  test('is omitted when there are none', () => {
    assert.doesNotMatch(describeRunOutcome({ exitCode: 0, problemCount: 0 }), /problem/);
  });
});

describe('the sentence itself', () => {
  test('reads as sentences, not as a field dump', () => {
    const said = describeRunOutcome({
      exitCode: 1,
      errorSummary: 'ReferenceError: nope is not defined on line 2 of main.mjs.',
      problemCount: 2,
    });
    // Three sentences, each ending in a full stop, separated by single spaces - which
    // is what makes a screen reader pause between them instead of running them together.
    assert.equal(said.split('. ').length, 3, said);
    assert.ok(said.endsWith('.'), said);
    assert.ok(!said.includes('  '), 'double space');
  });
});
