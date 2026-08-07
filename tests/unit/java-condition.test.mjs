/**
 * Parsing Java breakpoint conditions.
 *
 * Java is the only language here whose debugger cannot evaluate a condition itself -
 * JDWP has no expression modifier - so the adapter stops, decides and resumes. The
 * decision has two halves: what shape the text is (pure, here) and what the values are
 * (needs a live JVM, covered by tests/contract/java-debug.test.mjs).
 *
 * The half that matters most for a student is the REFUSAL. A condition the adapter
 * cannot evaluate is reported and the breakpoint arms unconditionally, so it stops too
 * often. Getting `conditionIsSupported` wrong in the other direction - claiming to
 * understand something it does not - produces a breakpoint that silently never fires,
 * which is indistinguishable from a broken debugger.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  compareValues,
  conditionIsSupported,
  FIELD_PATH,
  parseCondition,
  parseLiteral,
} from '../../languages/java/condition.mjs';

describe('literals', () => {
  test('integers, with and without Java width suffixes', () => {
    assert.equal(parseLiteral('5'), 5);
    assert.equal(parseLiteral('-3'), -3);
    assert.equal(parseLiteral('+7'), 7);
    // `100L` is a long; the suffix is Java's, not part of the number.
    assert.equal(parseLiteral('100L'), 100);
    assert.equal(parseLiteral('100l'), 100);
  });

  test('floating point, with and without suffixes', () => {
    assert.equal(parseLiteral('1.5'), 1.5);
    assert.equal(parseLiteral('-0.25'), -0.25);
    assert.equal(parseLiteral('.5'), 0.5);
    assert.equal(parseLiteral('2.0f'), 2);
    assert.equal(parseLiteral('3d'), 3);
  });

  test('booleans and null', () => {
    assert.equal(parseLiteral('true'), true);
    assert.equal(parseLiteral('false'), false);
    assert.equal(parseLiteral('null'), null);
  });

  test('strings, including escapes', () => {
    assert.equal(parseLiteral('"bob"'), 'bob');
    assert.equal(parseLiteral('""'), '');
    assert.equal(parseLiteral('"a\\nb"'), 'a\nb');
    assert.equal(parseLiteral('"say \\"hi\\""'), 'say "hi"');
  });

  test('chars compare as one-character strings', () => {
    assert.equal(parseLiteral("'x'"), 'x');
    assert.equal(parseLiteral("'\\n'"), '\n');
    assert.equal(parseLiteral("'\\\\'"), '\\');
  });

  test('anything that is not a literal is undefined, not null or false', () => {
    /*
     * The distinction every caller depends on.
     *
     * `0`, `false` and `null` are all literals AND all falsy, so "did this parse" can
     * only be asked as `!== undefined`. A truthiness check here would treat a
     * condition of `count == 0` as unparseable.
     */
    assert.equal(parseLiteral('total'), undefined);
    assert.equal(parseLiteral('foo()'), undefined);
    assert.equal(parseLiteral('"unterminated'), undefined);
    assert.equal(parseLiteral(''), undefined);
    assert.equal(parseLiteral(undefined), undefined);

    assert.notEqual(parseLiteral('0'), undefined);
    assert.notEqual(parseLiteral('false'), undefined);
    assert.notEqual(parseLiteral('null'), undefined);
  });
});

describe('field paths', () => {
  test('a name and a dotted path are both paths', () => {
    assert.ok(FIELD_PATH.test('total'));
    assert.ok(FIELD_PATH.test('node.next.value'));
    assert.ok(FIELD_PATH.test('_private$thing'));
    assert.ok(FIELD_PATH.test('args.length'));
  });

  test('anything with a call, an index or an operator is not', () => {
    assert.ok(!FIELD_PATH.test('list.size()'));
    assert.ok(!FIELD_PATH.test('items[0]'));
    assert.ok(!FIELD_PATH.test('a + b'));
    assert.ok(!FIELD_PATH.test('1total'));
  });
});

describe('parsing a condition', () => {
  test('a bare path is a truthiness test', () => {
    assert.deepEqual(parseCondition('done'), { kind: 'truthy', path: 'done' });
    assert.deepEqual(parseCondition('  flag  '), { kind: 'truthy', path: 'flag' });
  });

  test('a path compared with a literal', () => {
    assert.deepEqual(parseCondition('i == 5'), {
      kind: 'compare', left: 'i', operator: '==', literal: 5,
    });
    assert.deepEqual(parseCondition('name != "bob"'), {
      kind: 'compare', left: 'name', operator: '!=', literal: 'bob',
    });
    assert.deepEqual(parseCondition('node.next == null'), {
      kind: 'compare', left: 'node.next', operator: '==', literal: null,
    });
  });

  test('a path compared with another path', () => {
    assert.deepEqual(parseCondition('a.x <= b.y'), {
      kind: 'compare', left: 'a.x', operator: '<=', right: 'b.y',
    });
  });

  test('two-character operators are not split', () => {
    // The classic: `<=` read as `<` leaves a leading `=` on the right operand, which
    // then parses as nothing and the whole condition is silently refused.
    assert.equal(parseCondition('i <= 5').operator, '<=');
    assert.equal(parseCondition('i >= 5').operator, '>=');
    assert.equal(parseCondition('i != 5').operator, '!=');
    assert.equal(parseCondition('i == 5').operator, '==');
    assert.equal(parseCondition('i < 5').operator, '<');
    assert.equal(parseCondition('i > 5').operator, '>');
  });

  test('whitespace around the operator is optional', () => {
    assert.deepEqual(parseCondition('i==5'), {
      kind: 'compare', left: 'i', operator: '==', literal: 5,
    });
  });

  test('a negative literal is a literal, not a subtraction', () => {
    assert.deepEqual(parseCondition('balance < -100'), {
      kind: 'compare', left: 'balance', operator: '<', literal: -100,
    });
  });

  test('shapes it cannot evaluate are refused, not guessed at', () => {
    /*
     * Every one of these is refused so the adapter can SAY so. Arming them and
     * quietly ignoring the condition would give a breakpoint that stops every time
     * with no explanation; treating them as false would give one that never fires.
     */
    assert.equal(parseCondition('list.size() > 0'), null, 'method call');
    assert.equal(parseCondition('i + 1 == 5'), null, 'arithmetic on the left');
    assert.equal(parseCondition('i == j + 1'), null, 'arithmetic on the right');
    assert.equal(parseCondition('a && b'), null, 'boolean operator');
    assert.equal(parseCondition('items[2] == 3'), null, 'indexing');
    assert.equal(parseCondition('!done'), null, 'negation');
    assert.equal(parseCondition(''), null, 'empty');
    assert.equal(parseCondition('   '), null, 'blank');
    assert.equal(parseCondition(null), null, 'missing');
  });

  test('conditionIsSupported agrees with parseCondition, always', () => {
    // Two answers to one question is how a breakpoint gets armed with a condition
    // nothing can evaluate.
    for (const text of [
      'i == 5', 'done', 'a.b != null', 'x >= 1.5', 'name == "z"', "c == 'q'",
      'list.size() > 0', 'i + 1 == 2', '', 'a && b', '!x', 'items[0] == 1',
    ]) {
      assert.equal(
        conditionIsSupported(text),
        parseCondition(text) !== null,
        `disagreed about ${JSON.stringify(text)}`,
      );
    }
  });
});

describe('comparing', () => {
  test('the six operators', () => {
    assert.equal(compareValues(5, '==', 5), true);
    assert.equal(compareValues(5, '!=', 5), false);
    assert.equal(compareValues(4, '<', 5), true);
    assert.equal(compareValues(5, '<=', 5), true);
    assert.equal(compareValues(6, '>', 5), true);
    assert.equal(compareValues(5, '>=', 6), false);
  });

  test('equality is strict, so a type mistake is false rather than coerced', () => {
    // A student writing `count == "5"` has made a mistake. Coercing it to true would
    // hide it behind a breakpoint that fires as though the code were right.
    assert.equal(compareValues(5, '==', '5'), false);
    assert.equal(compareValues(0, '==', false), false);
    assert.equal(compareValues(null, '==', 0), false);
  });

  test('null compares equal only to null', () => {
    assert.equal(compareValues(null, '==', null), true);
    assert.equal(compareValues(null, '!=', 'x'), true);
  });

  test('strings compare', () => {
    assert.equal(compareValues('bob', '==', 'bob'), true);
    assert.equal(compareValues('a', '<', 'b'), true);
  });

  test('an unknown operator is null, not a silent false', () => {
    // Null means "no answer", and the adapter turns that into a stop. A `false` here
    // would suppress the breakpoint instead.
    assert.equal(compareValues(1, '~=', 1), null);
  });
});
