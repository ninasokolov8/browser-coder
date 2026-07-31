/**
 * Monaco models keyed by document, addressed by their real workspace path.
 *
 * The code this replaces built a URI from a sanitized file name plus a global
 * counter:
 *
 *     const uri = monaco.Uri.parse(
 *       `file:///${tab.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}_${++counter}.${ext}`
 *     );
 *
 * so `src/utils/math.py` became `file:///math_7.py` (V-18). Three consequences:
 * a rename never remapped the URI, so it drifted permanently; two files in
 * different folders were indistinguishable to anything reading the URI; and the
 * TypeScript worker - which resolves `import './utils'` by path - was given a
 * directory structure that did not exist, so cross-file resolution in a
 * multi-file TS or JS project could not work even in principle.
 *
 * Here the URI is `file:///workspace/<canonical path>`, and the workspace tree
 * guarantees those are unique (a path collision is rejected before it can be
 * created). The models therefore form a real project, which is what makes
 * multi-file resolution, go-to-definition and cross-file diagnostics coherent.
 *
 * **Rename recreates the model.** Monaco URIs are immutable, so a path change
 * means disposing and recreating - which loses that file's undo history. That is a
 * deliberate trade: renaming is a rare, deliberate act, while correct cross-file
 * resolution is continuous. The previous behaviour kept undo intact and left the
 * URI permanently wrong.
 */

import * as monaco from 'monaco-editor';

import { MonacoBuffer } from './buffer.ts';
import type { WorkspaceDocument } from '../document.ts';
import type { WorkspaceService } from '../service.ts';
import type { DocumentId } from '../types.ts';
import { ASSET_LANGUAGE_ID, assetTypeFor } from '../assets.ts';

/** Root prefix, so workspace files never collide with Monaco's own lib URIs. */
const WORKSPACE_ROOT = 'file:///workspace';

export interface LanguageLookup {
  /** Monaco language id for a workspace language id, e.g. python -> python. */
  monacoLanguageFor(languageId: string): string;
}

interface Entry {
  model: monaco.editor.ITextModel;
  path: string;
  monacoLanguage: string;
}

export class MonacoModelRegistry {
  #service: WorkspaceService;
  #languages: LanguageLookup;
  #entries = new Map<DocumentId, Entry>();

  constructor(service: WorkspaceService, languages: LanguageLookup) {
    this.#service = service;
    this.#languages = languages;
  }

  uriFor(path: string): monaco.Uri {
    // Each segment is encoded separately so a space or a non-ASCII character
    // survives without the separators being escaped.
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return monaco.Uri.parse(`${WORKSPACE_ROOT}/${encoded}`);
  }

  /**
   * The model for a document, created on first use.
   *
   * Creating the model also makes it the document's authoritative buffer, so from
   * this point the editor and the workspace share one copy of the text rather
   * than two that need reconciling.
   */
  acquire(document: WorkspaceDocument): monaco.editor.ITextModel {
    if (!MonacoModelRegistry.canHaveModel(document)) {
      // Loud rather than silent: a caller that reaches here has routed a binary
      // asset into the text editor, and returning some empty model would hide the
      // mistake until the file was saved back over itself.
      throw new Error(
        `${document.name} is a binary asset and cannot be opened in the text editor.`,
      );
    }

    const existing = this.#entries.get(document.id);
    if (existing && !existing.model.isDisposed()) {
      this.#reconcile(document, existing);
      return this.#entries.get(document.id)!.model;
    }

    return this.#create(document).model;
  }

  peek(id: DocumentId): monaco.editor.ITextModel | null {
    const entry = this.#entries.get(id);
    if (!entry || entry.model.isDisposed()) return null;
    return entry.model;
  }

  /** Re-point a model at its current path and language after a metadata change. */
  sync(document: WorkspaceDocument): void {
    const entry = this.#entries.get(document.id);
    if (!entry || entry.model.isDisposed()) return;
    this.#reconcile(document, entry);
  }

  release(id: DocumentId): void {
    const entry = this.#entries.get(id);
    this.#entries.delete(id);
    if (entry && !entry.model.isDisposed()) entry.model.dispose();
  }

  releaseAll(): void {
    for (const id of [...this.#entries.keys()]) this.release(id);
  }

  /**
   * Whether a document may have a Monaco model at all.
   *
   * A binary asset must never get one. Its content is base64, and a text editor would
   * let the student type into it, mark the document dirty, and let autosave persist a
   * corrupted image over the original. The asset viewer takes the editor's place
   * instead - see src/features/asset-viewer.ts.
   *
   * Enforced here rather than at the call sites because there are several routes into
   * a document (a tab, quick-open, go-to-definition, the Problems panel, the eager
   * project sync) and one that forgot to check would be the one that corrupts a file.
   */
  static canHaveModel(document: WorkspaceDocument): boolean {
    return document.language !== ASSET_LANGUAGE_ID && assetTypeFor(document.name) === null;
  }

  /**
   * Make sure every document in `languageIds` has a model.
   *
   * Monaco's TypeScript worker only sees files that have models, so a project
   * whose `./utils` module has never been opened cannot resolve the import - the
   * editor reports "Cannot find module" for code the server compiles happily.
   * Creating models eagerly for the compiled languages is what makes multi-file
   * completion, cross-file diagnostics and go-to-definition work at all.
   *
   * Restricted to the languages that have a language service. Creating a model per
   * file for every language would cost memory for no benefit, since Python, Java,
   * PHP and C# get their diagnostics from the server.
   */
  ensureModelsFor(languageIds: readonly string[]): void {
    const wanted = new Set(languageIds);
    for (const document of this.#service.allDocuments()) {
      if (!wanted.has(document.language)) continue;
      if (!MonacoModelRegistry.canHaveModel(document)) continue;
      if (this.peek(document.id)) continue;
      try {
        this.acquire(document);
      } catch (error) {
        // One unrepresentable path must not stop the rest of the project from
        // being resolvable.
        console.error(`[workspace] could not create a model for ${document.name}`, error);
      }
    }
  }

  /** Every live model, for features that need the whole project (search, TS libs). */
  all(): Array<{ id: DocumentId; path: string; model: monaco.editor.ITextModel }> {
    const result: Array<{ id: DocumentId; path: string; model: monaco.editor.ITextModel }> = [];
    for (const [id, entry] of this.#entries) {
      if (!entry.model.isDisposed()) result.push({ id, path: entry.path, model: entry.model });
    }
    return result;
  }

  #create(document: WorkspaceDocument): Entry {
    const path = this.#service.pathOf(document.id) ?? document.name;
    const monacoLanguage = this.#languages.monacoLanguageFor(document.language);
    const uri = this.uriFor(path);

    // A model at this URI can survive a disposed registry entry (Monaco owns the
    // model list, not us). Reusing it is correct and avoids a hard failure.
    const model =
      monaco.editor.getModel(uri) ??
      monaco.editor.createModel(document.getContent(), monacoLanguage, uri);

    const wasDirty = document.isDirty;
    document.attachBuffer(new MonacoBuffer(model), { dirty: wasDirty });

    const entry: Entry = { model, path, monacoLanguage };
    this.#entries.set(document.id, entry);
    return entry;
  }

  #reconcile(document: WorkspaceDocument, entry: Entry): void {
    const path = this.#service.pathOf(document.id) ?? document.name;
    const monacoLanguage = this.#languages.monacoLanguageFor(document.language);

    if (entry.path === path) {
      if (entry.monacoLanguage !== monacoLanguage) {
        monaco.editor.setModelLanguage(entry.model, monacoLanguage);
        entry.monacoLanguage = monacoLanguage;
      }
      return;
    }

    // The path changed, so the URI must. Monaco cannot rename a model, so the text
    // is carried across to a new one.
    //
    // Order matters and is not obvious: the replacement must be attached BEFORE
    // the old model is disposed. `attachBuffer` reads the outgoing buffer to carry
    // its content over, so disposing first makes that read throw "Model is
    // disposed!" - which is exactly what the browser smoke test caught, and what
    // the node tests could not, since `MemoryBuffer` has no disposed state.
    const content = entry.model.getValue();
    const wasDirty = document.isDirty;

    const uri = this.uriFor(path);
    const replacement =
      monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, monacoLanguage, uri);
    if (replacement.getValue() !== content) replacement.setValue(content);

    document.attachBuffer(new MonacoBuffer(replacement), { dirty: wasDirty });

    const outgoing = entry.model;
    this.#entries.set(document.id, { model: replacement, path, monacoLanguage });
    if (outgoing !== replacement) outgoing.dispose();
  }
}
