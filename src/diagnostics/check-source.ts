/**
 * The compiler half of live error checking: ask the real toolchain, on a pause.
 *
 * The scanner in `syntax-source.ts` runs on every keystroke and finds what is knowable
 * from the text. This finds everything else - undefined names, type errors, a method
 * that does not exist, an import that does not resolve - because it is javac, dotnet,
 * php -l and the Python preflight, invoked through `POST /api/check` without running
 * anything.
 *
 * Together they are what makes the editor behave like an IDE for the four languages
 * Monaco has no service for.
 *
 * ## Which languages
 *
 * Exactly the four the scanner covers: python, java, php, csharp. TypeScript,
 * JavaScript, CSS, HTML and JSON already have live Monaco language services, which are
 * real parsers running locally with no round trip - asking a server to second-guess
 * them would be slower and worse. (The endpoint still serves those languages; the RUN
 * path uses it. The client just has nothing to gain.)
 *
 * ## Pacing
 *
 * Per language, because the cost is not remotely uniform: the Python preflight is
 * milliseconds, `dotnet build` is seconds. A single debounce would either spam the
 * server for C# or make Python feel broken.
 *
 * ## Cancellation
 *
 * One check in flight per workspace. A newer edit aborts the older request rather than
 * letting both land, because the answer to a question about code the student has
 * already changed is worthless - and because two responses racing would publish in
 * whichever order they happened to arrive.
 */

import {
  CHECK_SOURCE,
  publishCompilerDiagnostics,
} from './server-source.ts';
import type { DiagnosticsStore } from './store.ts';
import { hasInstantSyntaxCheck } from '../languages/syntax-check.ts';
import type { WorkspaceService } from '../workspace/service.ts';
import type { Disposable } from '../workspace/types.ts';

/**
 * How long after the last keystroke to ask, per language.
 *
 * Chosen from what the toolchain actually costs, measured through /api/check: the
 * Python preflight and `php -l` return in tens of milliseconds, javac takes a second
 * or two on a warm JVM, and `dotnet build` is the slowest thing in the system.
 */
const DEBOUNCE_MS: Record<string, number> = {
  python: 400,
  php: 400,
  java: 1200,
  csharp: 1800,
};

const DEFAULT_DEBOUNCE_MS = 800;

export function connectCheckDiagnostics({
  store,
  service,
  activeDocumentId,
}: {
  store: DiagnosticsStore;
  service: WorkspaceService;
  /**
   * The file the student is looking at.
   *
   * Injected rather than read from the tab manager so this module depends only on the
   * workspace. It decides the ENTRY POINT of the check, which is what makes a
   * multi-file Python project work: the preflight checks the entry file, so naming the
   * file being edited is what gets that file checked. The compiled languages see every
   * file regardless, so one rule serves all four.
   */
  activeDocumentId: () => string | null;
}): Disposable {
  const subscriptions = new Map<string, Disposable>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  let disposed = false;

  const run = async (): Promise<void> => {
    if (disposed) return;

    const documentId = activeDocumentId();
    if (!documentId) return;

    const document = service.getDocument(documentId);
    if (!document || !hasInstantSyntaxCheck(document.language)) return;

    const files = service.snapshotForExecution().map(file => ({
      path: file.path,
      content: file.content,
      language: file.language,
    }));
    if (files.length === 0) return;

    const entryPoint = service.pathOf(documentId) ?? document.name;

    /*
     * The revisions being compiled, captured BEFORE the request goes out.
     *
     * The student keeps typing while this is in flight, so publishing against
     * whatever revision they have when it returns would stamp a stale answer as
     * current. These are what the result is bound to, and the store drops anything
     * older on its own.
     */
    const revisions = new Map<string, number>();
    for (const item of service.allDocuments()) revisions.set(item.id, item.revision);

    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    let payload: { ok: boolean; output: string } | null = null;
    try {
      const response = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: document.language,
          version: document.version,
          files,
          entryPoint,
        }),
        signal: controller.signal,
      });

      // 429 (too many checks) and any refusal mean "no answer this time". The
      // scanner's findings stay on screen and the next pause asks again. A student
      // must never see a message about our capacity because they typed.
      if (!response.ok) return;
      payload = await response.json();
    } catch {
      // Aborted, offline, or the server went away. Silent for the same reason.
      return;
    } finally {
      if (inFlight === controller) inFlight = null;
    }

    if (disposed || controller.signal.aborted || !payload) return;

    /*
     * Superseded while in flight: drop it rather than publish.
     *
     * The store would reject a stale result anyway, but `publishCompilerDiagnostics`
     * CLEARS the producer before setting - so publishing a stale answer would remove
     * the previous squiggles and then fail to add the new ones, and the editor would
     * flicker clean for a moment on every keystroke.
     */
    const current = service.getDocument(documentId);
    if (!current || current.revision !== revisions.get(documentId)) return;

    publishCompilerDiagnostics({
      store,
      service,
      languageId: document.language,
      // Empty on success, which publishes an empty list and clears the last result.
      output: payload.ok ? '' : payload.output,
      entryDocumentId: documentId,
      documentCount: files.length,
      producer: CHECK_SOURCE,
      revisionOf: id => revisions.get(id),
    });
  };

  const schedule = (): void => {
    const documentId = activeDocumentId();
    const language = documentId ? service.getDocument(documentId)?.language : undefined;
    if (!language || !hasInstantSyntaxCheck(language)) return;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, DEBOUNCE_MS[language] ?? DEFAULT_DEBOUNCE_MS);
  };

  const reconcile = (): void => {
    const live = new Set<string>();

    for (const document of service.allDocuments()) {
      live.add(document.id);
      if (subscriptions.has(document.id)) continue;
      subscriptions.set(document.id, document.onDidChangeContent(() => schedule()));
    }

    for (const [id, subscription] of [...subscriptions]) {
      if (live.has(id)) continue;
      subscription.dispose();
      subscriptions.delete(id);
      store.clear(id, CHECK_SOURCE);
    }
  };

  const workspaceSubscription = service.onDidChangeWorkspace(() => {
    reconcile();
    // Switching file, renaming, or adding one changes what should be checked.
    schedule();
  });
  reconcile();
  schedule();

  return {
    dispose: () => {
      disposed = true;
      workspaceSubscription.dispose();
      for (const subscription of subscriptions.values()) subscription.dispose();
      subscriptions.clear();
      if (timer) clearTimeout(timer);
      inFlight?.abort();
    },
  };
}
