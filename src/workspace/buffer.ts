/**
 * The working-copy buffer port.
 *
 * The workspace domain must be testable without a browser, and the races it
 * exists to prevent are timing races - which are miserable to test through a
 * real editor. So the domain depends on this narrow interface, Monaco satisfies
 * it through a five-line adapter, and the unit tests drive `MemoryBuffer`.
 *
 * `getRevision()` is the whole mechanism. It is a monotonically increasing
 * counter that advances on every mutation, so a writer can capture the revision
 * it is about to persist and afterwards ask "is this still what the user has?"
 * Monaco's `getVersionId()` has exactly these semantics, which is why this
 * interface is shaped around it rather than around content hashing.
 */

import type { Disposable } from './types.ts';

export interface WorkingCopyBuffer {
  getValue(): string;

  setValue(value: string): void;

  /**
   * Monotonically increasing. Advances on every mutation and NEVER decreases,
   * including on undo.
   *
   * The non-decreasing guarantee is what makes it usable as a race guard: a
   * write that captured revision 7 can be compared against the current revision
   * with a single `!==` and no ambiguity about whether time moved forward. A
   * content hash cannot do this - undoing back to previously-saved text would
   * make a stale write look current.
   */
  getRevision(): number;

  onDidChangeContent(listener: () => void): Disposable;
}

/**
 * In-memory buffer used by tests and by documents that have no editor attached
 * yet (a file present in the explorer but never opened).
 *
 * A document must be usable before the user clicks it, or "open the file" would
 * have to be an async, failure-prone step in the middle of every command.
 */
export class MemoryBuffer implements WorkingCopyBuffer {
  #value: string;
  #revision = 1;
  #listeners = new Set<() => void>();

  constructor(initialValue = '') {
    this.#value = initialValue;
  }

  getValue(): string {
    return this.#value;
  }

  setValue(value: string): void {
    // A no-op assignment must not advance the revision, or every idle metadata
    // refresh would mark the document dirty and trigger a pointless write.
    if (value === this.#value) return;
    this.#value = value;
    this.#revision += 1;
    this.#emit();
  }

  getRevision(): number {
    return this.#revision;
  }

  onDidChangeContent(listener: () => void): Disposable {
    this.#listeners.add(listener);
    return {
      dispose: () => {
        this.#listeners.delete(listener);
      },
    };
  }

  #emit(): void {
    // Snapshot first: a listener is allowed to remove itself, and mutating the
    // set mid-iteration would skip a sibling.
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error) {
        // One broken observer must not stop the others from learning about the
        // change, and must never propagate into the edit that caused it.
        console.error('[workspace] buffer listener threw', error);
      }
    }
  }
}
