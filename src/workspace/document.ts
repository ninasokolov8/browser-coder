/**
 * WorkspaceDocument - the one authoritative working copy of one file.
 *
 * This type replaces the `Tab.file` shape, and the difference is the point of
 * Phase C. `Tab.file` was a `StoredFile`: a snapshot of the database row that
 * also happened to hold the text the user was editing. Anything that refreshed
 * metadata from storage therefore refreshed content too, and every such refresh
 * was a chance to revert unsaved work.
 *
 * Here, content lives in exactly one place - the buffer - and `dirty` is
 * *derived* by comparing revisions rather than stored as a flag. A boolean that
 * is assigned can be assigned wrongly; a comparison cannot. That single change
 * is what closes V-09: the old autosave set `isDirty = false` after its await,
 * discarding the fact that newer keystrokes had arrived in the meantime.
 */

import { Emitter } from './emitter.ts';
import type { WorkingCopyBuffer } from './buffer.ts';
import type { Disposable, DocumentId, DocumentMetadata, DocumentMetadataPatch } from './types.ts';

export interface DocumentChangeEvent {
  readonly document: WorkspaceDocument;
  readonly revision: number;
}

export interface DocumentMetadataChangeEvent {
  readonly document: WorkspaceDocument;
  readonly previous: DocumentMetadata;
  readonly current: DocumentMetadata;
}

export class WorkspaceDocument {
  readonly id: DocumentId;

  #metadata: DocumentMetadata;
  #buffer: WorkingCopyBuffer;
  #bufferSubscription: Disposable;

  /**
   * The revision whose exact content is known to be in storage.
   *
   * Starts at the buffer's initial revision because a document constructed from
   * a persisted record is, by definition, already saved. A freshly created
   * document is constructed and persisted in the same command, so the same
   * assumption holds - and if that write fails, the failure marks it dirty
   * rather than the constructor pretending it might be.
   */
  #savedRevision: number;

  #onDidChangeContent = new Emitter<DocumentChangeEvent>();
  #onDidChangeMetadata = new Emitter<DocumentMetadataChangeEvent>();
  #onDidChangeDirty = new Emitter<WorkspaceDocument>();

  #lastDirty = false;
  #disposed = false;

  constructor(options: { metadata: DocumentMetadata; buffer: WorkingCopyBuffer }) {
    this.id = options.metadata.id;
    this.#metadata = options.metadata;
    this.#buffer = options.buffer;
    this.#savedRevision = options.buffer.getRevision();

    this.#bufferSubscription = this.#buffer.onDidChangeContent(() => {
      this.#onDidChangeContent.fire({ document: this, revision: this.#buffer.getRevision() });
      this.#notifyDirtyIfChanged();
    });
  }

  readonly onDidChangeContent = (listener: (event: DocumentChangeEvent) => void): Disposable =>
    this.#onDidChangeContent.event(listener);

  readonly onDidChangeMetadata = (
    listener: (event: DocumentMetadataChangeEvent) => void,
  ): Disposable => this.#onDidChangeMetadata.event(listener);

  readonly onDidChangeDirty = (listener: (document: WorkspaceDocument) => void): Disposable =>
    this.#onDidChangeDirty.event(listener);

  get metadata(): DocumentMetadata {
    return this.#metadata;
  }

  get name(): string {
    return this.#metadata.name;
  }

  get parentId(): string | null {
    return this.#metadata.parentId;
  }

  get language(): string {
    return this.#metadata.language;
  }

  get version(): string {
    return this.#metadata.version;
  }

  get buffer(): WorkingCopyBuffer {
    return this.#buffer;
  }

  getContent(): string {
    return this.#buffer.getValue();
  }

  get revision(): number {
    return this.#buffer.getRevision();
  }

  get savedRevision(): number {
    return this.#savedRevision;
  }

  /**
   * Derived, never assigned.
   *
   * Undo-back-to-saved-text still reports dirty, because the revision counter
   * has moved on. That is deliberate: it costs one redundant write, whereas the
   * alternative - tracking content identity so undo can clear the flag - risks
   * treating a stale write as current. A redundant save is invisible; a skipped
   * save loses a student's work.
   */
  get isDirty(): boolean {
    return this.#buffer.getRevision() !== this.#savedRevision;
  }

  get isDisposed(): boolean {
    return this.#disposed;
  }

  /**
   * Replace the working copy's text deliberately.
   *
   * Used by the version selector loading a starter template and by host project
   * replacement - both cases where discarding the current text IS the intent.
   * Autosave must never call this; it is the operation that V-09 performed by
   * accident.
   */
  setContent(value: string): void {
    this.#buffer.setValue(value);
  }

  /**
   * Swap in a different buffer implementation for the same document.
   *
   * Needed exactly once per document, when a file that has only ever been listed
   * in the explorer is opened in the editor and its `MemoryBuffer` is replaced
   * by a Monaco model. Dirty state is carried across explicitly rather than
   * inferred, so an unsaved file that gets opened does not silently become clean.
   */
  attachBuffer(buffer: WorkingCopyBuffer, options: { dirty: boolean }): void {
    const previousContent = this.#buffer.getValue();
    this.#bufferSubscription.dispose();

    this.#buffer = buffer;
    if (buffer.getValue() !== previousContent) {
      buffer.setValue(previousContent);
    }

    // A revision counter is only comparable against itself. The new buffer
    // starts its own sequence, so `savedRevision` has to be re-anchored in that
    // sequence rather than carried over from the old one - carrying it over is
    // how a document would end up permanently dirty or permanently clean.
    this.#savedRevision = options.dirty ? buffer.getRevision() - 1 : buffer.getRevision();

    this.#bufferSubscription = buffer.onDidChangeContent(() => {
      this.#onDidChangeContent.fire({ document: this, revision: buffer.getRevision() });
      this.#notifyDirtyIfChanged();
    });

    this.#notifyDirtyIfChanged();
  }

  /**
   * Record that `revision`'s exact content reached storage.
   *
   * Called only by the persistence coordinator, with the revision that was
   * captured *before* the write began. If the user typed during the write, the
   * buffer's revision is now higher, `isDirty` stays true, and the next write
   * picks up the newer text. Nothing is assigned over the working copy, which is
   * the structural difference from the code this replaces.
   */
  markSaved(revision: number): void {
    // Writes can complete out of order under a slow storage backend. Only ever
    // advance, or a late-landing older write would mark newer text as saved.
    if (revision <= this.#savedRevision) return;
    this.#savedRevision = revision;
    this.#notifyDirtyIfChanged();
  }

  /** Force the document to be considered unsaved, e.g. after a failed write. */
  markDirty(): void {
    if (!this.isDirty) {
      this.#savedRevision = this.#buffer.getRevision() - 1;
      this.#notifyDirtyIfChanged();
    }
  }

  /**
   * Apply a metadata change. Cannot touch content - `DocumentMetadataPatch` has
   * no content field, by design (V-10).
   */
  applyMetadata(patch: DocumentMetadataPatch, options: { updatedAt?: number } = {}): void {
    const previous = this.#metadata;
    const next: DocumentMetadata = {
      ...previous,
      ...patch,
      updatedAt: options.updatedAt ?? previous.updatedAt,
    };

    const unchanged =
      next.name === previous.name &&
      next.parentId === previous.parentId &&
      next.language === previous.language &&
      next.version === previous.version &&
      next.order === previous.order &&
      next.isUserModified === previous.isUserModified;
    if (unchanged) return;

    this.#metadata = next;
    this.#onDidChangeMetadata.fire({ document: this, previous, current: next });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#bufferSubscription.dispose();
    this.#onDidChangeContent.dispose();
    this.#onDidChangeMetadata.dispose();
    this.#onDidChangeDirty.dispose();
  }

  #notifyDirtyIfChanged(): void {
    const dirty = this.isDirty;
    if (dirty === this.#lastDirty) return;
    this.#lastDirty = dirty;
    this.#onDidChangeDirty.fire(this);
  }
}
