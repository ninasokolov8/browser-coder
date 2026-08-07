/**
 * Sharing a project, and opening one somebody shared.
 *
 * ## What this is
 *
 * A student stuck on something publishes their whole project and sends a link.
 * Whoever opens it sees exactly the files they had.
 *
 * ## What it is not, and why that is deliberate
 *
 * It is not live collaboration. No shared cursor, no presence, no simultaneous
 * editing; two people opening the same link are not connected to each other.
 *
 * Blueprint section 44 listed collaboration as a large piece of work that "should be a
 * deliberate decision rather than something that arrives by accident", and section 52
 * records the decision. The short version: real co-editing needs a CRDT or OT, a
 * stateful hub every replica can reach, and a conflict model - and the moment a student
 * trusts it with their homework, all three become load-bearing. Half of it is worse
 * than none, because "your edits are safe" is a promise you cannot partly keep.
 *
 * What a snapshot does cover is the case the blueprint actually described - a teacher
 * seeing what the student is looking at - and it covers it for a teacher who is asleep
 * when the message is sent, which a live session does not.
 */

import { runtime } from '../app/runtime';
import { setStatus } from '../components/output';
import { announce } from '../components/announce.ts';
import { collectWorkspaceSnapshot } from './workspace';
import { buildShareLink, requestedShareId as parseShareParam } from './share-link.ts';

export interface SharedProject {
  readonly version: number;
  readonly language?: string;
  readonly entryPoint?: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
    readonly language?: string;
    readonly version?: string;
  }>;
}

/**
 * Publish the current project and return the link, or null.
 *
 * The link is absolute and built from the page's own location, so it works from an
 * embedded IDE on somebody else's domain - where a relative path would resolve against
 * the host page rather than against this one.
 */
export async function shareProject(): Promise<string | null> {
  const files = await collectWorkspaceSnapshot();
  if (files.length === 0) {
    setStatus('There is nothing to share yet.');
    return null;
  }

  const activeTab = runtime.tabManager?.getActiveTab();

  try {
    const response = await fetch('/api/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files,
        language: activeTab?.file.language,
        entryPoint: activeTab ? runtime.workspace?.pathOf(activeTab.file.id) : undefined,
      }),
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      // The server's messages are written for a student - "this project is too large
      // to share" - so they are shown rather than replaced with a status code.
      setStatus(detail?.error || 'Could not create a share link.');
      return null;
    }

    const { id } = await response.json();
    return buildShareLink(window.location.href, id);
  } catch {
    setStatus('Could not reach the server to create a share link.');
    return null;
  }
}

/** The share id in THIS page's URL, if it has one. Parsing is in `share-link.ts`. */
export function requestedShareId(): string | null {
  return parseShareParam(window.location.search);
}

/** Fetch a shared project, or null with the reason already shown. */
export async function loadSharedProject(id: string): Promise<SharedProject | null> {
  try {
    const response = await fetch(`/api/shares/${encodeURIComponent(id)}`);
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      setStatus(detail?.error || 'This share link could not be opened.');
      announce(detail?.error || 'This share link could not be opened.');
      return null;
    }
    return await response.json();
  } catch {
    setStatus('Could not reach the server to open this share link.');
    return null;
  }
}
