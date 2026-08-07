/**
 * Fixtures for the workspace domain tests.
 *
 * The point of a controllable store and a fake clock is that the defects being
 * tested are timing defects. "Type while a save is in flight" has to be an exact
 * sequence, not a sleep and a hope, or the test that proves the fix will also
 * pass against the bug on a fast enough machine.
 */

import { MemoryBuffer } from '../../../src/workspace/buffer.ts';
import { WorkspaceDocument } from '../../../src/workspace/document.ts';
import { MemoryWorkspaceStore } from '../../../src/workspace/store.ts';
import type { DocumentMetadata, PersistedDocument } from '../../../src/workspace/types.ts';

export function metadata(overrides: Partial<DocumentMetadata> = {}): DocumentMetadata {
  return {
    id: 'doc-1',
    name: 'main.py',
    parentId: null,
    language: 'python',
    version: 'python3',
    order: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    isUserModified: false,
    ...overrides,
  };
}

export function persisted(
  overrides: Partial<PersistedDocument> = {},
): PersistedDocument {
  return { ...metadata(overrides), content: '', ...overrides };
}

export function makeDocument(
  content = '',
  overrides: Partial<DocumentMetadata> = {},
): WorkspaceDocument {
  return new WorkspaceDocument({
    metadata: metadata(overrides),
    buffer: new MemoryBuffer(content),
  });
}

/**
 * A store whose writes block until the test lets them through.
 *
 * `whenNextWriteStarts()` resolves once a write has entered the store but before
 * it commits - the exact window in which the old autosave lost keystrokes.
 */
export class GatedStore extends MemoryWorkspaceStore {
  writeCount = 0;

  #gated = true;
  #waitingWrites: Array<() => void> = [];
  #startWatchers: Array<() => void> = [];

  async writeDocumentContent(id: string, content: string, updatedAt: number): Promise<void> {
    this.writeCount += 1;
    for (const watcher of this.#startWatchers.splice(0)) watcher();

    if (this.#gated) {
      await new Promise<void>(resolve => this.#waitingWrites.push(resolve));
    }

    await super.writeDocumentContent(id, content, updatedAt);
  }

  whenNextWriteStarts(): Promise<void> {
    return new Promise(resolve => this.#startWatchers.push(resolve));
  }

  /** Let every blocked write through, and stop gating subsequent ones. */
  openGate(): void {
    this.#gated = false;
    for (const resolve of this.#waitingWrites.splice(0)) resolve();
  }
}

/** Deterministic replacement for setTimeout/clearTimeout. */
export class FakeClock {
  now = 0;

  #tasks = new Map<number, { at: number; run: () => void }>();
  #nextHandle = 1;

  setTimer = (run: () => void, delayMs: number): unknown => {
    const handle = this.#nextHandle++;
    this.#tasks.set(handle, { at: this.now + delayMs, run });
    return handle;
  };

  clearTimer = (handle: unknown): void => {
    this.#tasks.delete(handle as number);
  };

  get pendingCount(): number {
    return this.#tasks.size;
  }

  /** Advance time and run everything now due, in scheduled order. */
  async advance(ms: number): Promise<void> {
    this.now += ms;
    const due = [...this.#tasks.entries()]
      .filter(([, task]) => task.at <= this.now)
      .sort((a, b) => a[1].at - b[1].at);

    for (const [handle, task] of due) {
      this.#tasks.delete(handle);
      task.run();
    }

    // Let any microtask chains the callbacks started settle before returning, so
    // a test can assert on state the callback produced.
    await new Promise(resolve => setImmediate(resolve));
  }
}

/** Wait for all pending microtasks and immediates to settle. */
export function settle(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
