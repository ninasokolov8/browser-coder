/**
 * Discard diagnostics that describe a version of a file the student has moved past.
 *
 * `DiagnosticsStore.invalidate()` was written for this, documented as "called when a
 * document changes", and called by nothing. Every producer stamped its findings with a
 * revision, the store carefully kept the stamp, and no one ever compared it to anything.
 *
 * What that looked like: a student runs their Python, gets a NameError squiggled on line
 * 12 and an entry in the Problems panel. They see the mistake, insert three lines above
 * it, and fix it. The squiggle stays on line 12 - now a different statement - and the
 * Problems panel still lists an error that no longer exists. It survives every
 * subsequent edit, because the only thing that ever removed it was another run.
 *
 * Which is worse than showing nothing. A red underline on correct code, pointing at the
 * wrong line, teaches a student to distrust the one signal that tells them where they
 * went wrong.
 *
 * ## Why a module rather than a line in main.ts
 *
 * Documents come and go - opened, closed, deleted, replaced wholesale by loading a
 * project - so this is a subscription set that has to be reconciled, not a single
 * listener. Monaco's own diagnostics are invalidated too and simply republish within the
 * same tick; the ones this saves are the server's, which cannot.
 */

import type { DiagnosticsStore } from './store.ts';
import type { WorkspaceService } from '../workspace/service.ts';
import type { Disposable } from '../workspace/types.ts';

export function connectDiagnosticStaleness({
  store,
  service,
}: {
  store: DiagnosticsStore;
  service: WorkspaceService;
}): Disposable {
  const subscriptions = new Map<string, Disposable>();

  const reconcile = () => {
    const live = new Set<string>();

    for (const document of service.allDocuments()) {
      live.add(document.id);
      if (subscriptions.has(document.id)) continue;

      subscriptions.set(
        document.id,
        document.onDidChangeContent(event => {
          // Everything published about an OLDER revision goes. Producers that still
          // have an opinion re-publish against the new one; producers that cannot -
          // the compiler, which only speaks after a run - correctly fall silent.
          store.invalidate(event.document.id, event.revision);
        }),
      );
    }

    // A document that is gone takes its diagnostics with it. Without this, closing and
    // reopening a file would show the errors from before it was closed, and the
    // subscription would leak for the lifetime of the session.
    for (const [id, subscription] of [...subscriptions]) {
      if (live.has(id)) continue;
      subscription.dispose();
      subscriptions.delete(id);
      store.clear(id);
    }
  };

  const workspaceSubscription = service.onDidChangeWorkspace(reconcile);
  reconcile();

  return {
    dispose: () => {
      workspaceSubscription.dispose();
      for (const subscription of subscriptions.values()) subscription.dispose();
      subscriptions.clear();
    },
  };
}
