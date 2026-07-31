/**
 * Formatting, wired into Monaco for every language the IDE offers.
 *
 * `Format document` was bound straight to Monaco's action. Monaco runs whatever
 * provider is registered for the model's language and, when there is none, does
 * nothing at all - no error, no message, no edit. Five of the ten languages had no
 * provider, so for half the IDE the command was a no-op that looked like "your
 * code is already formatted".
 *
 * Two things fix that, and both are needed:
 *
 *  - `format-core.ts` is registered as a real provider for those five, so the
 *    command genuinely formats them.
 *  - the outcome is reported. The local formatter deliberately declines to
 *    re-indent in cases where guessing could corrupt the program, and a student
 *    who is not told that has been misled in the same way as before - just more
 *    quietly.
 */

import * as monaco from 'monaco-editor';

import { canFormatLocally, formatSource, type FormatResult } from './format-core.ts';

/**
 * Monaco language ids this module provides formatting for.
 *
 * Keyed by Monaco's id, not the IDE's: `svg` documents use Monaco's `xml`, and
 * registration happens against what the model actually reports.
 */
const LOCAL_LANGUAGES = ['python', 'java', 'csharp', 'php', 'markdown', 'xml'] as const;

/** Languages Monaco formats itself, once its workers are wired (see monaco-config). */
const MONACO_LANGUAGES = ['typescript', 'javascript', 'css', 'html', 'json'] as const;

/**
 * The most recent local-format outcome, per model.
 *
 * Monaco's formatting action returns nothing useful - it applies edits and
 * resolves - so the provider records what it did and the command reads it back.
 */
const lastResult = new Map<string, FormatResult>();

export function takeLastFormatResult(model: monaco.editor.ITextModel): FormatResult | null {
  const key = model.uri.toString();
  const result = lastResult.get(key) ?? null;
  lastResult.delete(key);
  return result;
}

/** True when something will actually happen if the user formats this language. */
export function hasFormatter(monacoLanguageId: string): boolean {
  return (
    canFormatLocally(monacoLanguageId) ||
    (MONACO_LANGUAGES as readonly string[]).includes(monacoLanguageId)
  );
}

let registered = false;

/** Register the local formatter. Idempotent. */
export function initializeFormatting(): void {
  if (registered) return;
  registered = true;

  for (const languageId of LOCAL_LANGUAGES) {
    monaco.languages.registerDocumentFormattingEditProvider(languageId, {
      displayName: 'Browser Coder',
      provideDocumentFormattingEdits(model, options) {
        const original = model.getValue();
        const result = formatSource(languageId, original, {
          indentSize: options.tabSize,
          useTabs: !options.insertSpaces,
        });

        lastResult.set(model.uri.toString(), result);

        // No edit at all when nothing changed: returning a full-range replacement
        // that happens to be identical still moves the cursor and pushes an undo
        // entry, which makes a no-op look like a change.
        if (result.text === original) return [];

        return [
          {
            range: model.getFullModelRange(),
            text: result.text,
          },
        ];
      },
    });
  }
}

/**
 * A sentence describing what formatting did, for the status bar.
 *
 * `null` when there is nothing worth saying - Monaco's own formatters report
 * themselves by visibly changing the document.
 */
export function describeFormatResult(
  fileName: string,
  result: FormatResult | null,
): string {
  if (!result) return `Formatted ${fileName}`;
  if (result.reindented) return `Formatted ${fileName}`;
  if (result.declinedReason) return `Tidied ${fileName} — ${result.declinedReason}`;
  return `Formatted ${fileName}`;
}
