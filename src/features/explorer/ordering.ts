/**
 * Where a dragged row lands, and what order siblings are shown in.
 *
 * ## Why the tree is not simply sorted by `order`
 *
 * The storage layer has always maintained an `order` field, and the tree has always
 * thrown it away and sorted by name. Switching to `order` outright looks like a
 * one-line fix and is not: `order` is assigned by creation sequence, so every existing
 * project would silently reshuffle from alphabetical to whatever sequence its files
 * happened to be made in. Nobody asked for that, and it would look like corruption.
 *
 * So a parent is sorted by NAME until the student reorders something inside it. The
 * first drag renumbers that parent's children densely, in the order they were already
 * displayed, and records the parent as manually ordered - from then on the student's
 * arrangement is authoritative and nothing else changes.
 *
 * Pure: no DOM, no storage. The explorer half is in `tree.ts` and `operations.ts`.
 */

/** Where a drop lands relative to the row under the pointer. */
export type DropPosition = 'before' | 'after' | 'into';

export interface SortableNode {
  readonly id: string;
  readonly name: string;
  readonly type: 'file' | 'folder';
  readonly order: number;
}

/**
 * The fraction of a row's height at each edge that means "between rows" rather than
 * "onto this row".
 *
 * A quarter each: small enough that dropping INTO a folder stays the easy, default
 * gesture, and large enough to hit at a normal drag speed. Anything under about a fifth
 * makes reordering feel like it does not work.
 */
const EDGE_FRACTION = 0.25;

/**
 * Decide where a drop lands from the pointer's position within a row.
 *
 * A FILE has no inside, so its middle counts as the nearer edge - dropping on the lower
 * half of a file means "after it", which is what a student intends and what every other
 * file tree does.
 */
export function dropPositionFor(
  offsetY: number,
  height: number,
  type: 'file' | 'folder',
): DropPosition {
  if (height <= 0) return type === 'folder' ? 'into' : 'before';

  const ratio = Math.min(1, Math.max(0, offsetY / height));

  if (type === 'file') return ratio < 0.5 ? 'before' : 'after';
  if (ratio < EDGE_FRACTION) return 'before';
  if (ratio > 1 - EDGE_FRACTION) return 'after';
  return 'into';
}

/**
 * The sibling order to display.
 *
 * Folders always come before files - that is a convention students expect and
 * reordering does not change it. Within each group: the student's arrangement when they
 * have made one, and name otherwise.
 *
 * `order` ties break by name so the result is stable; two siblings with the same order
 * can only come from data written before this existed.
 */
export function sortSiblings<T extends SortableNode>(nodes: readonly T[], manual: boolean): T[] {
  return [...nodes].sort((left, right) => {
    if (left.type !== right.type) return left.type === 'folder' ? -1 : 1;
    if (manual && left.order !== right.order) return left.order - right.order;
    return left.name.localeCompare(right.name);
  });
}

/**
 * Move one id to a new place in a list, given the row it was dropped against.
 *
 * Returns the ids in their new order. The moved id is removed first, so dropping an
 * item just below itself is a no-op rather than an off-by-one - the classic bug in
 * every hand-written reorder.
 */
export function placeRelativeTo(
  ids: readonly string[],
  movedId: string,
  targetId: string,
  position: 'before' | 'after',
): string[] {
  if (movedId === targetId) return [...ids];

  const without = ids.filter(id => id !== movedId);
  const at = without.indexOf(targetId);
  if (at === -1) return [...ids];

  const insertAt = position === 'before' ? at : at + 1;
  return [...without.slice(0, insertAt), movedId, ...without.slice(insertAt)];
}

/**
 * The dense `order` values to write for a list of ids.
 *
 * Dense and zero-based on purpose: gaps accumulate with every move, and an order that
 * drifts towards huge numbers is the thing that eventually collides. Renumbering the
 * whole parent is cheap - a folder holds tens of items, not millions.
 */
export function denseOrder(ids: readonly string[]): Map<string, number> {
  const orders = new Map<string, number>();
  ids.forEach((id, index) => orders.set(id, index));
  return orders;
}
