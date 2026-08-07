/**
 * Monaco's ITextModel as a WorkingCopyBuffer.
 *
 * This is the whole reason the domain was written against a port: the adapter is
 * fifteen lines, and everything difficult - revisions, dirty tracking, write
 * queues - stays in code that runs under `node --test`.
 *
 * `getVersionId()` maps to `getRevision()` exactly. It increases on every edit and
 * never decreases, including on undo, which is precisely the guarantee a race
 * guard needs. (`getAlternativeVersionId()` returns to a previous value when the
 * user undoes back to it - useful for a dirty indicator, unusable for deciding
 * whether an in-flight write is still current.)
 */

import type * as monaco from 'monaco-editor';

import type { WorkingCopyBuffer } from '../buffer.ts';
import type { Disposable } from '../types.ts';

export class MonacoBuffer implements WorkingCopyBuffer {
  readonly model: monaco.editor.ITextModel;

  constructor(model: monaco.editor.ITextModel) {
    this.model = model;
  }

  getValue(): string {
    return this.model.getValue();
  }

  setValue(value: string): void {
    if (this.model.isDisposed()) return;
    if (this.model.getValue() === value) return;

    // `pushEditOperations` rather than `setValue`, so replacing content is an
    // undoable edit and the cursor is not thrown to the top of the file. Loading a
    // starter template is something a user may well want to undo.
    const fullRange = this.model.getFullModelRange();
    this.model.pushEditOperations(
      null,
      [{ range: fullRange, text: value, forceMoveMarkers: true }],
      () => null,
    );
  }

  getRevision(): number {
    return this.model.getVersionId();
  }

  onDidChangeContent(listener: () => void): Disposable {
    return this.model.onDidChangeContent(() => listener());
  }
}
