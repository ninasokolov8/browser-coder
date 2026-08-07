/**
 * Tell the student when their work is NOT being saved.
 *
 * `PersistenceCoordinator` does the hard part correctly: a failed write keeps the
 * document dirty, records the error, and fires `onDidSave` with `{ status: 'failed' }`.
 * Nothing subscribed. `onDidSave`, `lastErrorFor` and `hasPendingWrites` were all
 * written, all tested, and read by no one - so the one thing the student needed to know
 * was the one thing the machinery went to the trouble of computing and then discarded.
 *
 * It is not a rare case. IndexedDB refuses writes when the origin is over quota, when
 * the browser is in a private window that has run out of its smaller allowance, and
 * whenever a student has the same IDE open in two tabs and one holds a blocked upgrade.
 * In every one of those the IDE looked like it was autosaving and was not, and the work
 * was gone at the next reload.
 *
 * ## Why a status line rather than a toast
 *
 * A toast is for something that happened. This is a CONDITION - it stays true until a
 * write succeeds - and it must not scroll away while the student keeps typing into a
 * file that is not being stored. It is also announced, because a student using a screen
 * reader has no other way to notice.
 */

import type { WorkspaceService } from '../workspace/service.ts';
import type { Disposable } from '../workspace/types.ts';

/**
 * How to reach the student.
 *
 * Injected rather than imported so this module has no dependency on the DOM and the
 * rule it encodes - what is said, and how often - can be asserted from a node test.
 * The same reason the run console takes `resolveImage` rather than importing it.
 */
export interface SaveStatusReporter {
  status(message: string): void;
  announce(message: string): void;
}

/** The page events, so a test can fire them without a browser. */
interface HostEvents {
  isHidden(): boolean;
  addEventListener(type: string, handler: () => void): void;
  removeEventListener(type: string, handler: () => void): void;
}

function browserHost(): HostEvents | null {
  const page = (globalThis as { document?: unknown }).document as
    | (Document & { visibilityState: string })
    | undefined;
  const frame = (globalThis as { window?: unknown }).window as Window | undefined;
  if (!page || !frame) return null;

  return {
    isHidden: () => page.visibilityState === 'hidden',
    addEventListener: (type, handler) => {
      if (type === 'pagehide') frame.addEventListener(type, handler);
      else page.addEventListener(type, handler);
    },
    removeEventListener: (type, handler) => {
      if (type === 'pagehide') frame.removeEventListener(type, handler);
      else page.removeEventListener(type, handler);
    },
  };
}

/**
 * Flush before the page goes away.
 *
 * Autosave is debounced by a second, so a student who types and immediately closes the
 * tab loses whatever was still sitting in that timer. Nothing flushed on unload.
 *
 * `visibilitychange` to hidden rather than `beforeunload`: it is the event that
 * actually fires on mobile and when a tab is discarded, and it fires EARLY enough that
 * an async IndexedDB write has time to land. `pagehide` is the backstop for the desktop
 * close-the-tab case. Both are idempotent - a flush with nothing pending does nothing.
 */
function flushOnHide(service: WorkspaceService, host: HostEvents | null): Disposable {
  if (!host) return { dispose: () => {} };

  const flush = () => {
    // Deliberately not awaited: there is no way to hold the page open, and the write
    // is already in flight by the time this returns.
    void service.flushAll().catch(() => {
      /* The page is going away; there is nobody left to tell. */
    });
  };

  const onVisibility = () => {
    if (host.isHidden()) flush();
  };

  host.addEventListener('visibilitychange', onVisibility);
  host.addEventListener('pagehide', flush);

  return {
    dispose: () => {
      host.removeEventListener('visibilitychange', onVisibility);
      host.removeEventListener('pagehide', flush);
    },
  };
}

export function connectSaveStatus(
  service: WorkspaceService,
  reporter: SaveStatusReporter,
  host: HostEvents | null = browserHost(),
): Disposable {
  let failing = false;

  const subscription = service.persistence.onDidSave(event => {
    if (event.outcome.status === 'failed') {
      // Announced once per outage, not once per failed write. A debounced autosave
      // retries on every keystroke, and repeating the message on each one would make
      // the live region unusable and bury everything else the IDE says.
      if (failing) return;
      failing = true;

      const detail = service.persistence.lastErrorFor(event.documentId)?.message;
      const message = detail
        ? `Your work could not be saved to this browser: ${detail}. Copy anything important somewhere else.`
        : 'Your work could not be saved to this browser. Copy anything important somewhere else.';

      reporter.status(message);
      reporter.announce(message);
      return;
    }

    if (event.outcome.status === 'saved' && failing) {
      failing = false;
      const message = 'Saving is working again. Your work is being stored.';
      reporter.status(message);
      reporter.announce(message);
    }
  });

  const unload = flushOnHide(service, host);

  return {
    dispose: () => {
      subscription.dispose();
      unload.dispose();
    },
  };
}
