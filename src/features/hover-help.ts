/**
 * Teach on hover.
 *
 * The IDE already holds 189-305 curated explanations per language, each with a
 * plain-English description and a worked example, fully translated into Hebrew - and
 * the only way to reach any of it was to know to right-click. A student who does not
 * know what `range` means does not know to right-click it either.
 *
 * So the same data is now a Monaco hover provider. Hovering is what a learner does
 * naturally when they do not recognise something, and it costs them nothing.
 *
 * ## Why this is additive rather than a replacement
 *
 * Monaco merges every registered hover provider for a language. For TypeScript and
 * JavaScript its own provider already contributes type information, and this one adds
 * the teaching note beside it - strictly better than either alone. For Python, Java,
 * PHP and C# there is no other provider, so this is the only hover they have.
 *
 * ## Cost
 *
 * A hover provider runs only when the pointer rests on a word, so this adds nothing
 * per keystroke - which matters, because the outline pass and the breadcrumbs already
 * do per-edit work over the whole file.
 *
 * The rendering itself lives in `hover-content.ts`, which is pure and tested in node.
 */

import * as monaco from 'monaco-editor';

import { getKeywordExplanation, getLanguage, languagesThatCan } from '../languages';
import { getUILang } from './wrapped-i18n';
import { maskCommentsAndStrings, syntaxFor } from '../languages/syntax.ts';
import { renderHover } from './hover-content.ts';
import { hoverTargetAt } from './hover-symbols.ts';
import type { Disposable } from '../workspace/types.ts';

/**
 * Whether this position is inside real code.
 *
 * A hover explaining the keyword `for` because the student pointed at the word "for" in
 * `# wait for input` is noise. The shared lexer already knows where code is and
 * preserves offsets exactly, so the check is one character comparison.
 */
function isInCode(
  languageId: string,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): boolean {
  if (!syntaxFor(languageId)) return true;

  const line = model.getLineContent(position.lineNumber);
  const index = position.column - 1;
  if (index < 0 || index >= line.length) return true;

  const masked = maskCommentsAndStrings(languageId, line);
  // Masking replaces comment and string bodies with spaces while preserving length, so
  // a character that survived unchanged is code.
  return masked[index] === line[index];
}

let subscriptions: monaco.IDisposable[] = [];

/**
 * Every key a language explains, cached per language.
 *
 * Cached because this is asked on EVERY hover, and the answer only changes when the
 * bundle does - the keyword files are imported at build time.
 */
const keyCache = new Map<string, string[]>();

function keysFor(languageId: string): string[] {
  let keys = keyCache.get(languageId);
  if (!keys) {
    keys = Object.keys(getLanguage(languageId)?.keywords ?? {});
    keyCache.set(languageId, keys);
  }
  return keys;
}

/** Register the teaching hover for every language that has explanations. */
export function initializeHoverHelp(): Disposable {
  if (subscriptions.length > 0) return { dispose: () => {} };

  for (const languageId of languagesThatCan('taughtKeywords')) {
    subscriptions.push(
      monaco.languages.registerHoverProvider(languageId, {
        provideHover(model, position) {
          /*
           * A word if there is one, otherwise an OPERATOR.
           *
           * `getWordAtPosition` returns runs of identifier characters by definition, so
           * on its own it explains `total` - the student's own variable - and says
           * nothing about `//`, which is the thing they do not recognise. Blueprint
           * 40.5 recorded that as a gap.
           *
           * The candidate set is this language's own keys, so `//` is only offered
           * where the language defines it: integer division in Python, and nothing at
           * all in the C-family, where it starts a comment. `isInCode` below refuses
           * inside comments anyway, so there are two independent reasons the wrong
           * answer cannot be given.
           */
          const word = model.getWordAtPosition(position);
          const found = hoverTargetAt(
            model.getLineContent(position.lineNumber),
            position.column,
            word ? { text: word.word, startColumn: word.startColumn, endColumn: word.endColumn } : null,
            keysFor(languageId),
          );
          if (!found) return null;

          if (!isInCode(languageId, model, position)) return null;

          const entry = getKeywordExplanation(languageId, found.text, getUILang());
          if (!entry) return null;

          return {
            range: new monaco.Range(
              position.lineNumber,
              found.startColumn,
              position.lineNumber,
              found.endColumn,
            ),
            contents: [
              {
                value: renderHover(languageId, found.text, entry),
                // No HTML, and untrusted: the content is data from a JSON file, and
                // there is no reason for a teaching note to be able to render markup.
                isTrusted: false,
                supportHtml: false,
              },
            ],
          };
        },
      }),
    );
  }

  return {
    dispose: () => {
      for (const subscription of subscriptions) subscription.dispose();
      subscriptions = [];
    },
  };
}
