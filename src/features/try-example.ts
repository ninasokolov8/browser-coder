/**
 * "Try this" — run the example from a hover, instead of reading it.
 *
 * ## Why
 *
 * Hover explains 1,568 words across six languages and every single entry carries a
 * short runnable example. Until now that example was text to look at. Reading
 * `pen.circle(50)` teaches almost nothing; watching a circle appear two seconds later
 * teaches the whole idea, and then the student can change the 50 - which is the moment
 * they actually learn it.
 *
 * It is the cheapest teaching feature available here because all three pieces already
 * exist: the curated content, the run pipeline, and the workspace.
 *
 * ## The scratch file
 *
 * One per language, reused. `try-it.py`, `try-it.java` and so on, with a header saying
 * what it is and that it is safe to change.
 *
 * Reused rather than newly created each time, because a student who tries six hovers
 * during one lesson should not end up with six files to tidy. It is a real workspace
 * document - editable, runnable, savable - not a modal preview, so experimenting with
 * the example is the obvious next step rather than a dead end.
 *
 * ## Java is a special case
 *
 * Its entry point must be a class whose name matches the file, so an example that is a
 * bare statement cannot run on its own. It is wrapped in the smallest class that
 * compiles. The same is true of C#, where a bare statement needs a Main.
 */

import { getKeywordExplanation, getLanguage } from '../languages';
import { runtime, requireTabManager } from '../app/runtime';
import { setStatus } from '../components/output';
import { getUILang } from './wrapped-i18n';
import {
  asRunnableProgram,
  scratchFileName,
  TRY_EXAMPLE_COMMAND,
} from './try-example-format.ts';

/**
 * Open the example for one word in its scratch file and run it.
 *
 * Looks the entry up again rather than receiving its text: the hover link carries only
 * a language and a word, so nothing from the content files is ever interpolated into
 * markdown. That is what lets the note itself stay `isTrusted: false`.
 */
export async function tryExample(languageId: string, word: string): Promise<void> {
  const language = getLanguage(languageId);
  const entry = getKeywordExplanation(languageId, word, getUILang());

  if (!language || !entry?.example) {
    setStatus(`There is no example for ${word} to try.`);
    return;
  }

  const workspace = runtime.workspace;
  const tabManager = requireTabManager();
  if (!workspace) return;

  const name = scratchFileName(languageId, language.extension);
  const source = asRunnableProgram(languageId, entry.example, name.split('.')[0]);

  const existing = workspace.allDocuments().find(document => document.name === name);
  let documentId: string;

  if (existing) {
    // Reused: a student trying six hovers in a lesson should not collect six files.
    existing.setContent(source);
    await workspace.flush(existing.id);
    documentId = existing.id;
  } else {
    const created = await workspace.createDocument({
      name,
      content: source,
      language: languageId,
      version: language.versions.find(item => item.default)?.id ?? language.versions[0]?.id,
    });
    documentId = created.id;
  }

  await tabManager.switchToTab(documentId);
  setStatus(`Trying ${word} — press Run, then change it and run it again.`);

  // Run it for them. Seeing the result is the entire point; making them find Run first
  // puts a step between the question and the answer.
  await runtime.commands?.execute('workspace.run', { source: 'api' });
}

/**
 * Register the command the hover link invokes.
 *
 * Monaco resolves `command:` links in trusted markdown through its command service, so
 * this must exist before any hover is shown.
 */
export function initializeTryExample(monaco: typeof import('monaco-editor')): void {
  monaco.editor.registerCommand(TRY_EXAMPLE_COMMAND, (_accessor, ...args: unknown[]) => {
    const [languageId, word] = (args[0] as [string, string]) ?? [];
    if (typeof languageId === 'string' && typeof word === 'string') {
      void tryExample(languageId, word);
    }
  });
}

