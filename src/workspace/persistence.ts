/**
 * PersistenceCoordinator - revision-guarded autosave with a per-document queue.
 *
 * Replaces this, from the code it supersedes:
 *
 *     private autoSaveTimer: number | null = null;      // ONE timer, all tabs
 *
 *     private scheduleAutoSave(tab: Tab): void {
 *       if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
 *       this.autoSaveTimer = window.setTimeout(() => this.saveTab(tab), 1000);
 *     }
 *
 *     async saveTab(tab: Tab): Promise<void> {
 *       const updated = await storage.updateFile(tab.file.id, {...});
 *       if (updated) {
 *         tab.file = updated;        // <- overwrites text typed during the await
 *         tab.isDirty = false;       // <- and claims those edits are saved
 *       }
 *     }
 *
 * Three separate defects in nine lines:
 *
 * - **N-04** One timer shared by every tab. Typing in file B cancelled file A's
 *   pending save. A's edits then survived only if some unrelated code path
 *   happened to save it later. Fixed by one timer per document.
 *
 * - **V-09 (first half)** `tab.file = updated` replaced the live working copy
 *   with the row that was just written. Any keystroke that landed during the
 *   await was discarded. Fixed structurally: this class never assigns to the
 *   buffer at all, and `writeDocumentContent` returns nothing it could assign.
 *
 * - **V-09 (second half)** `isDirty = false` after the await asserted that the
 *   document matched storage, when it might have changed twice since. Fixed by
 *   `markSaved(capturedRevision)`: the document compares that revision against
 *   its current one and stays dirty when newer edits exist.
 *
 * The invariant, stated once: **a write persists the content of one specific
 * revision, and may only ever mark that revision saved.**
 */

import { Emitter } from './emitter.ts';
import type { WorkspaceDocument } from './document.ts';
import type { WorkspaceStore } from './store.ts';
import type { Disposable, DocumentId, SaveOutcome } from './types.ts';

/** Passes a flush is willing to make while the user keeps typing into it. */
const MAX_FLUSH_PASSES = 5;

export interface PersistenceOptions {
  store: WorkspaceStore;
  /** Debounce window. Matches the previous 1s behaviour. */
  autoSaveDelayMs?: number;
  now?: () => number;
  setTimer?: (handler: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface SaveEvent {
  readonly documentId: DocumentId;
  readonly outcome: SaveOutcome;
}

export class PersistenceCoordinator {
  #store: WorkspaceStore;
  #delayMs: number;
  #now: () => number;
  #setTimer: (handler: () => void, delayMs: number) => unknown;
  #clearTimer: (handle: unknown) => void;

  #timers = new Map<DocumentId, unknown>();
  #draining = new Map<DocumentId, Promise<{ ok: boolean; error?: Error }>>();
  #documents = new Map<DocumentId, WorkspaceDocument>();
  #subscriptions = new Map<DocumentId, Disposable>();
  #lastError = new Map<DocumentId, Error>();
  #suspended = false;

  #onDidSave = new Emitter<SaveEvent>();
  #onDidChangePending = new Emitter<void>();

  constructor(options: PersistenceOptions) {
    this.#store = options.store;
    this.#delayMs = options.autoSaveDelayMs ?? 1000;
    this.#now = options.now ?? (() => Date.now());
    // Injectable so tests can drive the debounce without real time, and so the
    // domain never touches `window`.
    this.#setTimer = options.setTimer ?? ((handler, delay) => setTimeout(handler, delay));
    this.#clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as never));
  }

  readonly onDidSave = (listener: (event: SaveEvent) => void): Disposable =>
    this.#onDidSave.event(listener);

  readonly onDidChangePending = (listener: () => void): Disposable =>
    this.#onDidChangePending.event(listener);

  /** True while any document has a queued or in-flight write. */
  get hasPendingWrites(): boolean {
    return this.#timers.size > 0 || this.#draining.size > 0;
  }

  lastErrorFor(id: DocumentId): Error | undefined {
    return this.#lastError.get(id);
  }

  /**
   * Start autosaving a document. Idempotent, so re-registering on reopen is safe.
   */
  register(document: WorkspaceDocument): void {
    if (this.#documents.has(document.id)) return;
    this.#documents.set(document.id, document);
    this.#subscriptions.set(
      document.id,
      document.onDidChangeContent(() => this.schedule(document.id)),
    );
  }

  unregister(id: DocumentId): void {
    this.#subscriptions.get(id)?.dispose();
    this.#subscriptions.delete(id);
    this.#documents.delete(id);
    this.#cancelTimer(id);
    this.#lastError.delete(id);
  }

  /**
   * Stop accepting new work without discarding what is already durable.
   *
   * Clear Cache needs this: a debounced save that fires after the database has
   * been emptied would recreate a file the user just deleted. The previous code
   * had the same hazard and handled it by reaching into the tab manager to clear
   * its single timer - which only worked because there was exactly one.
   */
  suspend(): void {
    this.#suspended = true;
    for (const id of [...this.#timers.keys()]) this.#cancelTimer(id);
  }

  resume(): void {
    this.#suspended = false;
  }

  /** Debounced save. One timer per document (N-04). */
  schedule(id: DocumentId): void {
    if (this.#suspended) return;
    const document = this.#documents.get(id);
    if (!document || document.isDisposed) return;

    this.#cancelTimer(id);
    const handle = this.#setTimer(() => {
      this.#timers.delete(id);
      void this.#ensureDraining(document);
    }, this.#delayMs);
    this.#timers.set(id, handle);
    this.#onDidChangePending.fire();
  }

  /**
   * Persist a document's current content and resolve only once it is durable.
   *
   * Callers are the operations that must not proceed against stale storage:
   * running the program, closing a tab, replacing the project, exporting a ZIP.
   */
  async flush(id: DocumentId): Promise<SaveOutcome> {
    const document = this.#documents.get(id);
    if (!document || document.isDisposed) return { status: 'unchanged' };

    this.#cancelTimer(id);

    for (let pass = 0; pass < MAX_FLUSH_PASSES; pass++) {
      if (!document.isDirty) {
        return { status: 'saved', revision: document.savedRevision };
      }

      const result = await this.#ensureDraining(document);
      if (!result.ok) {
        return { status: 'failed', error: result.error ?? new Error('Save failed') };
      }
    }

    // Reached only if content keeps changing faster than it can be written. The
    // document is still dirty, so reporting success would be a lie.
    return {
      status: 'superseded',
      revision: document.revision,
    };
  }

  /** Flush every registered document. Used before a run and before unload. */
  async flushAll(): Promise<SaveOutcome[]> {
    // Snapshot the ids: flushing may unregister a document.
    const ids = [...this.#documents.keys()];
    const outcomes: SaveOutcome[] = [];
    for (const id of ids) {
      outcomes.push(await this.flush(id));
    }
    return outcomes;
  }

  /** Drop queued work for a document without writing it. */
  cancel(id: DocumentId): void {
    this.#cancelTimer(id);
  }

  dispose(): void {
    this.suspend();
    for (const subscription of this.#subscriptions.values()) subscription.dispose();
    this.#subscriptions.clear();
    this.#documents.clear();
    this.#onDidSave.dispose();
    this.#onDidChangePending.dispose();
  }

  #cancelTimer(id: DocumentId): void {
    const handle = this.#timers.get(id);
    if (handle === undefined) return;
    this.#clearTimer(handle);
    this.#timers.delete(id);
    this.#onDidChangePending.fire();
  }

  /**
   * Guarantee at most one write loop per document.
   *
   * Concurrent writes for one document are the other half of the lost-update
   * problem: two in-flight saves can land in either order, so the older content
   * can win. Serialising per document removes the possibility rather than making
   * it unlikely.
   */
  #ensureDraining(document: WorkspaceDocument): Promise<{ ok: boolean; error?: Error }> {
    const existing = this.#draining.get(document.id);
    if (existing) return existing;

    const running = this.#drain(document).finally(() => {
      this.#draining.delete(document.id);
      this.#onDidChangePending.fire();
    });
    this.#draining.set(document.id, running);
    this.#onDidChangePending.fire();
    return running;
  }

  async #drain(document: WorkspaceDocument): Promise<{ ok: boolean; error?: Error }> {
    while (document.isDirty && !document.isDisposed && !this.#suspended) {
      // Captured together, synchronously. No await separates these two reads, so
      // the content and the revision describe the same instant - which is the
      // precondition for the guard below meaning anything.
      const revision = document.revision;
      const content = document.getContent();

      try {
        await this.#store.writeDocumentContent(document.id, content, this.#now());
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.#lastError.set(document.id, failure);
        // Deliberately does NOT mark saved, so the document stays dirty and the
        // next trigger retries. Returning instead of looping avoids turning a
        // persistent failure (a storage quota, say) into a spin.
        this.#onDidSave.fire({
          documentId: document.id,
          outcome: { status: 'failed', error: failure },
        });
        return { ok: false, error: failure };
      }

      this.#lastError.delete(document.id);

      // The guard. If the user typed during the write, the buffer's revision has
      // moved past `revision`, `markSaved` leaves the document dirty, and the
      // `while` condition sends us round again with the newer text.
      document.markSaved(revision);

      this.#onDidSave.fire({
        documentId: document.id,
        outcome: document.isDirty
          ? { status: 'superseded', revision }
          : { status: 'saved', revision },
      });
    }

    return { ok: true };
  }
}
