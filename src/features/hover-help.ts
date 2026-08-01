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

import { getKeywordExplanation } from '../languages';
import { getUILang } from './wrapped-i18n';
import { maskCommentsAndStrings, syntaxFor } from '../languages/syntax.ts';
import { renderHover } from './hover-content.ts';
import type { Disposable } from '../workspace/types.ts';

/**
 * Languages with curated explanations.
 *
 * Explicit rather than derived from "does keywords.json exist", so a provider can never
 * be registered for a language with no data - an empty hover that appears and says
 * nothing teaches the student the feature is unreliable.
 */
const TAUGHT_LANGUAGES = ['python', 'javascript', 'typescript', 'java', 'php', 'csharp'] as const;

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

/** Register the teaching hover for every language that has explanations. */
export function initializeHoverHelp(): Disposable {
  if (subscriptions.length > 0) return { dispose: () => {} };

  for (const languageId of TAUGHT_LANGUAGES) {
    subscriptions.push(
      monaco.languages.registerHoverProvider(languageId, {
        provideHover(model, position) {
          const found = model.getWordAtPosition(position);
          if (!found) return null;

          if (!isInCode(languageId, model, position)) return null;

          const entry = getKeywordExplanation(languageId, found.word, getUILang());
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
                value: renderHover(languageId, found.word, entry),
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
