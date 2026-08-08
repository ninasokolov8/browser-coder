/**
 * The instant half of live error checking: scan on every edit, publish immediately.
 *
 * Monaco squiggles TypeScript, JavaScript, CSS, HTML and JSON as you type because it
 * ships language services for them. Python, Java, PHP and C# had nothing until a run
 * finished, so the editor looked clean while the student typed `prnt(` and only
 * admitted otherwise after they pressed Run.
 *
 * This closes that gap without a server: `findSyntaxProblems` needs only the text.
 * The real compiler still has the last word - see the store's `preferAuthoritative`,
 * which hides anything from here on a line the compiler has already explained.
 *
 * ## Debounce
 *
 * Short, because the whole point is that it feels instant, and the work is a single
 * pass over one file. It is debounced at all only so a burst of keystrokes does not
 * rescan per character - not because the scan is expensive.
 *
 * ## Revisions
 *
 * Published against the revision that was scanned, so a result can never be applied to
 * text it did not come from. The staleness wiring already drops anything older, which
 * is what lets this and the server check coexist without either having to know about
 * the other.
 */

import {
  findSyntaxProblems,
  hasInstantSyntaxCheck,
} from '../languages/syntax-check.ts';
import type { Diagnostic, DiagnosticsStore } from './store.ts';
import type { WorkspaceService } from '../workspace/service.ts';
import type { Disposable } from '../workspace/types.ts';

/** Producer key. The store demotes exactly this one when a compiler disagrees. */
export const SYNTAX_SOURCE = 'syntax';

/**
 * Long enough that a fast typist is not rescanned per character, short enough to feel
 * like it happened as they typed.
 */
const DEBOUNCE_MS = 150;

/**
 * Above this, stop scanning.
 *
 * The scan is linear, but a student pasting a huge generated file should not pay for
 * it on every keystroke - and a file this size is not one somebody is typing into.
 */
const MAX_CHARS = 400_000;

export function connectSyntaxDiagnostics({
  store,
  service,
}: {
  store: DiagnosticsStore;
  service: WorkspaceService;
}): Disposable {
  const subscriptions = new Map<string, Disposable>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const scan = (documentId: string): void => {
    const document = service.getDocument(documentId);
    if (!document) return;

    if (!hasInstantSyntaxCheck(document.language)) {
      // Includes the case where a file was RENAMED into a language Monaco handles:
      // anything published earlier must go, or a stale squiggle outlives the reason
      // it was ever shown.
      store.clear(documentId, SYNTAX_SOURCE);
      return;
    }

    const content = document.getContent();
    const revision = document.revision;
    if (content.length > MAX_CHARS) {
      store.clear(documentId, SYNTAX_SOURCE);
      return;
    }

    const path = service.pathOf(documentId) ?? document.name;
    const diagnostics: Diagnostic[] = findSyntaxProblems(document.language, content).map(
      problem => ({
        documentId,
        path,
        line: problem.line,
        column: problem.column,
        severity: problem.severity,
        message: problem.message,
        // Named for the language, like every other producer's diagnostics, so the
        // Problems panel reads "python" rather than exposing our internal producer key.
        source: document.language,
      }),
    );

    // Published even when empty: an empty list is "I looked, and it is clean", which
    // is what clears the previous squiggle once the student fixes the bracket.
    store.set(documentId, SYNTAX_SOURCE, revision, diagnostics);
  };

  const schedule = (documentId: string): void => {
    const existing = timers.get(documentId);
    if (existing) clearTimeout(existing);
    timers.set(
      documentId,
      setTimeout(() => {
        timers.delete(documentId);
        scan(documentId);
      }, DEBOUNCE_MS),
    );
  };

  const reconcile = (): void => {
    const live = new Set<string>();

    for (const document of service.allDocuments()) {
      live.add(document.id);
      if (subscriptions.has(document.id)) continue;

      subscriptions.set(
        document.id,
        document.onDidChangeContent(() => schedule(document.id)),
      );
      // Scan once on open, so a file a student loads is checked before they touch it.
      scan(document.id);
    }

    for (const [id, subscription] of [...subscriptions]) {
      if (live.has(id)) continue;
      subscription.dispose();
      subscriptions.delete(id);

      const timer = timers.get(id);
      if (timer) clearTimeout(timer);
      timers.delete(id);
      // The staleness wiring clears a DELETED document, but a rename that changes the
      // language leaves the document alive, so this producer clears its own.
      store.clear(id, SYNTAX_SOURCE);
    }
  };

  // A rename can change a file's language, which changes whether it is scanned at all.
  const workspaceSubscription = service.onDidChangeWorkspace(() => {
    reconcile();
    for (const document of service.allDocuments()) scan(document.id);
  });
  reconcile();

  return {
    dispose: () => {
      workspaceSubscription.dispose();
      for (const subscription of subscriptions.values()) subscription.dispose();
      for (const timer of timers.values()) clearTimeout(timer);
      subscriptions.clear();
      timers.clear();
    },
  };
}
