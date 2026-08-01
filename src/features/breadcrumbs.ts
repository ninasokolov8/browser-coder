/**
 * The breadcrumb bar above the editor.
 *
 * Monaco has no breadcrumbs - that is a VS Code feature built on top of it - so
 * this is a real component rather than an option to switch on.
 *
 * It answers two questions the tab bar cannot. A tab shows `helper.py`; the
 * breadcrumb shows `src / utils / helper.py`, which matters as soon as two folders
 * contain a file of the same name. And the trailing segment tracks the symbol the
 * cursor is inside, so a student scrolled deep into a long function can see which
 * one without scrolling back.
 *
 * Every segment is clickable: folders reveal in the explorer, the symbol jumps to
 * its definition line.
 *
 * Symbols come from the indentation heuristic in `breadcrumb-symbols.ts`, for every
 * language, including the ones Monaco has a language service for. See the note at
 * the symbol lookup below for why Monaco's own providers are not used.
 */

import * as monaco from 'monaco-editor';

import { runtime } from '../app/runtime';
import { heuristicSpine } from './breadcrumb-symbols.ts';
import type { Disposable } from '../workspace/types.ts';

const BAR_ID = 'breadcrumbs';

interface Segment {
  readonly text: string;
  readonly kind: 'folder' | 'file' | 'symbol';
  readonly line?: number;
  readonly documentId?: string;
}

export function initializeBreadcrumbs(editor: monaco.editor.IStandaloneCodeEditor): Disposable {
  const bar = document.getElementById(BAR_ID);
  if (!bar) return { dispose: () => {} };

  let generation = 0;

  const render = (segments: readonly Segment[]): void => {
    bar.textContent = '';
    bar.hidden = segments.length === 0;

    segments.forEach((segment, index) => {
      if (index > 0) {
        const separator = document.createElement('span');
        separator.className = 'breadcrumb-separator';
        separator.textContent = '›';
        separator.setAttribute('aria-hidden', 'true');
        bar.appendChild(separator);
      }

      const clickable = segment.kind !== 'folder' || segment.documentId !== undefined;
      const node = document.createElement(clickable ? 'button' : 'span');
      node.className = `breadcrumb-segment breadcrumb-${segment.kind}`;
      node.textContent = segment.text;

      if (node instanceof HTMLButtonElement) {
        node.type = 'button';
        node.addEventListener('click', () => {
          if (segment.line !== undefined) {
            editor.revealLineInCenter(segment.line);
            editor.setPosition({ lineNumber: segment.line, column: 1 });
            editor.focus();
          }
        });
      }

      bar.appendChild(node);
    });
  };

  const update = async (): Promise<void> => {
    const mine = ++generation;

    const model = editor.getModel();
    const workspace = runtime.workspace;
    const activeId = runtime.tabManager?.getActiveTab()?.file.id;

    if (!model || !workspace || !activeId) {
      render([]);
      return;
    }

    const path = workspace.pathOf(activeId) ?? model.uri.path.split('/').pop() ?? '';
    const parts = path.split('/').filter(Boolean);

    const segments: Segment[] = parts.map((part, index) => ({
      text: part,
      kind: index === parts.length - 1 ? 'file' : 'folder',
    }));

    const line = editor.getPosition()?.lineNumber ?? 1;

    // The symbol spine comes from the heuristic for every language.
    //
    // Monaco's standalone build registers document-symbol providers internally but
    // exposes no public API to EXECUTE them - `executeDocumentSymbolProvider` is a
    // VS Code command, not part of monaco-editor - so reaching the TypeScript
    // worker's symbols would mean depending on private internals that change
    // between releases. The heuristic covers the six code languages uniformly
    // instead, which also means the breadcrumb behaves the same everywhere rather
    // than being richer in two languages and absent in four.
    const named = heuristicSpine(model.getLanguageId(), model.getLinesContent(), line);

    // A late result must not overwrite a newer one.
    if (mine !== generation) return;

    for (const symbol of named) {
      segments.push({ text: symbol.name, kind: 'symbol', line: symbol.line });
    }

    render(segments);
  };

  /**
   * Coalesce to one pass per animation frame, and skip the pass entirely when
   * nothing it reads has changed.
   *
   * This ran synchronously on every keystroke AND every cursor movement, and each
   * run called `getLinesContent()` - which allocates an array holding every line in
   * the file - then executed a regex against every line above the cursor. In a
   * 1000-line file with the cursor near the bottom that is a thousand regex
   * executions and a thousand-element allocation per arrow-key press, for a bar
   * whose contents usually did not change. Holding an arrow key was doing more work
   * than the edit itself.
   *
   * The key is (model, content version, line): those are exactly the three inputs,
   * so an unchanged key means an identical result.
   */
  let frame = 0;
  let lastKey = '';

  const schedule = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const model = editor.getModel();
      const key = model
        ? `${model.uri.toString()}:${model.getVersionId()}:${editor.getPosition()?.lineNumber ?? 1}`
        : '';
      if (key === lastKey) return;
      lastKey = key;
      void update();
    });
  };

  const subscriptions = [
    editor.onDidChangeCursorPosition(schedule),
    editor.onDidChangeModel(schedule),
    editor.onDidChangeModelContent(schedule),
  ];

  schedule();

  return {
    dispose: () => {
      for (const subscription of subscriptions) subscription.dispose();
      // A frame already queued would run against a disposed editor.
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      bar.textContent = '';
    },
  };
}
