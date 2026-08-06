/**
 * Reordering files in the explorer.
 *
 * The storage layer has always maintained an `order` field and the tree has always
 * thrown it away and sorted by name. The trap in "just sort by order" is that `order`
 * is assigned by creation sequence, so switching would silently reshuffle every
 * existing project - which is why a parent stays name-sorted until the student actually
 * reorders something inside it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  denseOrder,
  dropPositionFor,
  placeRelativeTo,
  sortSiblings,
} from '../../src/features/explorer/ordering.ts';

const node = (id: string, name: string, order: number, type: 'file' | 'folder' = 'file') =>
  ({ id, name, type, order });

describe('what a parent shows', () => {
  const siblings = [
    node('1', 'zebra.py', 0),
    node('2', 'apple.py', 1),
    node('3', 'src', 2, 'folder'),
  ];

  test('name order until the student has reordered anything', () => {
    // The whole reason for the flag: `order` here is creation sequence, and honouring
    // it would reshuffle a project nobody touched.
    assert.deepEqual(
      sortSiblings(siblings, false).map(n => n.name),
      ['src', 'apple.py', 'zebra.py'],
    );
  });

  test('the student arrangement once they have made one', () => {
    assert.deepEqual(
      sortSiblings(siblings, true).map(n => n.name),
      ['src', 'zebra.py', 'apple.py'],
    );
  });

  test('folders come first either way, because that is what a tree looks like', () => {
    const withLateFolder = [node('a', 'aaa.py', 0), node('b', 'zzz', 1, 'folder')];
    assert.equal(sortSiblings(withLateFolder, true)[0].name, 'zzz');
    assert.equal(sortSiblings(withLateFolder, false)[0].name, 'zzz');
  });

  test('equal orders fall back to name, so the result is stable', () => {
    const tied = [node('1', 'b.py', 5), node('2', 'a.py', 5)];
    assert.deepEqual(sortSiblings(tied, true).map(n => n.name), ['a.py', 'b.py']);
  });

  test('sorting does not mutate the input', () => {
    const original = [...siblings];
    sortSiblings(siblings, true);
    assert.deepEqual(siblings, original);
  });
});

describe('where a drop lands', () => {
  test('the top edge of a folder means before it', () => {
    assert.equal(dropPositionFor(2, 24, 'folder'), 'before');
  });

  test('the middle of a folder means into it', () => {
    // Dropping INTO a folder must stay the easy default - it is the common gesture.
    assert.equal(dropPositionFor(12, 24, 'folder'), 'into');
  });

  test('the bottom edge of a folder means after it', () => {
    assert.equal(dropPositionFor(23, 24, 'folder'), 'after');
  });

  test('a file has no inside, so its halves are before and after', () => {
    assert.equal(dropPositionFor(5, 24, 'file'), 'before');
    assert.equal(dropPositionFor(20, 24, 'file'), 'after');
    // Never 'into' for a file, at any position.
    for (let y = 0; y <= 24; y++) {
      assert.notEqual(dropPositionFor(y, 24, 'file'), 'into');
    }
  });

  test('a zero-height row does not divide by zero', () => {
    assert.equal(dropPositionFor(0, 0, 'folder'), 'into');
    assert.equal(dropPositionFor(0, 0, 'file'), 'before');
  });

  test('a pointer outside the row is clamped rather than extrapolated', () => {
    assert.equal(dropPositionFor(-10, 24, 'folder'), 'before');
    assert.equal(dropPositionFor(999, 24, 'folder'), 'after');
  });
});

describe('moving one item within its siblings', () => {
  const ids = ['a', 'b', 'c', 'd'];

  test('before another item', () => {
    assert.deepEqual(placeRelativeTo(ids, 'd', 'b', 'before'), ['a', 'd', 'b', 'c']);
  });

  test('after another item', () => {
    assert.deepEqual(placeRelativeTo(ids, 'a', 'c', 'after'), ['b', 'c', 'a', 'd']);
  });

  test('to the very start', () => {
    assert.deepEqual(placeRelativeTo(ids, 'c', 'a', 'before'), ['c', 'a', 'b', 'd']);
  });

  test('to the very end', () => {
    assert.deepEqual(placeRelativeTo(ids, 'a', 'd', 'after'), ['b', 'c', 'd', 'a']);
  });

  test('dropping an item just below itself is a no-op, not an off-by-one', () => {
    // The classic bug in every hand-written reorder: the moved item is still in the
    // list when the insertion index is computed, so it lands one place further than
    // intended. Removing it first is what prevents that.
    assert.deepEqual(placeRelativeTo(ids, 'b', 'b', 'after'), ids);
    assert.deepEqual(placeRelativeTo(ids, 'b', 'c', 'before'), ids);
  });

  test('an unknown target leaves the order alone', () => {
    assert.deepEqual(placeRelativeTo(ids, 'a', 'nope', 'before'), ids);
  });

  test('the result is always a permutation of the input', () => {
    for (const target of ids) {
      for (const position of ['before', 'after'] as const) {
        const moved = placeRelativeTo(ids, 'a', target, position);
        assert.deepEqual([...moved].sort(), [...ids].sort(), `${target}/${position}`);
      }
    }
  });
});

describe('the numbers written back', () => {
  test('are dense and zero-based, so they cannot drift', () => {
    // Gaps accumulate with every move; renumbering the whole parent is cheap because a
    // folder holds tens of items.
    assert.deepEqual([...denseOrder(['x', 'y', 'z'])], [['x', 0], ['y', 1], ['z', 2]]);
  });

  test('an empty parent produces nothing', () => {
    assert.equal(denseOrder([]).size, 0);
  });
});
