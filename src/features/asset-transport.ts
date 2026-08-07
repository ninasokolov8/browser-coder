/**
 * Sending a project's images once instead of on every Run.
 *
 * ## The cost this removes
 *
 * A binary asset is stored base64-encoded, so a 2 MiB image is 2.8 MB of the run
 * payload. Pressing Run thirty times while working on one exercise uploads 84 MB of the
 * same picture. Blueprint 44.6 asked for "a multipart upload for assets, so a project
 * with images is not re-uploaded in full on every Run".
 *
 * Multipart answers only the first half of that sentence: it removes base64's 33% and
 * nothing else, turning 84 MB into 63 MB, and it costs a hand-written streaming
 * boundary parser because there is no multipart dependency here. Content addressing
 * removes the REPETITION, which is what the sentence was actually about: 84 MB becomes
 * 2.8 MB and twenty-nine short requests.
 *
 * ## Why an asset can be named by its content
 *
 * Because an asset is immutable by construction: the Monaco model registry refuses to
 * open one for editing, so nothing in the IDE can change its bytes after import. A
 * digest computed once is therefore valid forever, and "the server already has this"
 * can never be a stale belief.
 *
 * Only assets. Source files change constantly and are small; hashing them would cost
 * more than it saved and would need invalidation on every keystroke.
 *
 * ## Every failure falls back to sending the bytes
 *
 * No `crypto.subtle` (it needs a secure context, and this is deployed over plain HTTP
 * today), no cache configured, a failed upload, a digest evicted between the check and
 * the run - all of them end the same way, with the asset inline, exactly as before this
 * existed. The optimisation is invisible when it cannot help.
 */

import { ASSET_LANGUAGE_ID, base64ToBytes } from '../workspace/assets.ts';
import { digestToken, supportsContentHash } from '../workspace/content-hash.ts';

interface RunFile {
  path: string;
  content?: string;
  digest?: string;
  language?: string;
  [key: string]: unknown;
}

/**
 * Digests this browser has computed, by the base64 content they were computed from.
 *
 * Hashing 2.8 MB costs a few milliseconds, which is nothing once and noticeable on
 * every Run. The key is the content itself rather than a file id, so two copies of the
 * same image share an entry and a re-import is free.
 */
const digestCache = new Map<string, string>();

/** Bounded, because a student importing many large assets would otherwise pin them all. */
const MAX_CACHE_ENTRIES = 200;

async function digestOf(base64: string): Promise<string | null> {
  const cached = digestCache.get(base64);
  if (cached) return cached;

  const token = await digestToken(base64ToBytes(base64));
  if (!token) return null;

  if (digestCache.size >= MAX_CACHE_ENTRIES) {
    // Oldest first. A Map iterates in insertion order, which is good enough here:
    // this is a memory bound, not an eviction policy anybody tunes.
    const oldest = digestCache.keys().next().value;
    if (oldest !== undefined) digestCache.delete(oldest);
  }
  digestCache.set(base64, token);
  return token;
}

/** Which of these digests does the server already have? */
async function askServer(digests: string[]): Promise<Set<string> | null> {
  try {
    const response = await fetch('/api/blobs/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ digests }),
    });
    if (!response.ok) return null;

    const body = await response.json();
    // `available: false` means the cache is not configured. Null, so the caller sends
    // everything inline rather than uploading into a void.
    if (!body?.available) return null;
    return new Set(Array.isArray(body.have) ? body.have : []);
  } catch {
    return null;
  }
}

async function upload(digest: string, base64: string): Promise<boolean> {
  try {
    const bytes = base64ToBytes(base64);
    const response = await fetch(`/api/blobs/${digest}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      // A Blob rather than the view itself: `BodyInit` does not accept a Uint8Array
      // whose backing buffer TypeScript cannot prove is a plain ArrayBuffer, and this
      // is the conversion that costs nothing rather than a copy of the bytes.
      body: new Blob([bytes.slice().buffer as ArrayBuffer]),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Replace asset content with digests wherever the server already has the bytes,
 * uploading the ones it does not.
 *
 * Returns the files to send. On any failure it returns them unchanged, which is always
 * correct - a payload with inline content is the shape that has always worked.
 */
export async function withCachedAssets(files: RunFile[]): Promise<RunFile[]> {
  if (!supportsContentHash()) return files;

  const assets = files.filter(
    file => file.language === ASSET_LANGUAGE_ID && typeof file.content === 'string',
  );
  if (assets.length === 0) return files;

  const digests = new Map<RunFile, string>();
  for (const asset of assets) {
    const token = await digestOf(asset.content as string);
    if (token) digests.set(asset, token);
  }
  if (digests.size === 0) return files;

  const have = await askServer([...new Set(digests.values())]);
  if (!have) return files;

  /*
   * Upload the misses BEFORE the run, not during it.
   *
   * The server would answer 409 with the missing list and the client could retry, and
   * that path exists as a backstop - but doing it here means the common case is one
   * check plus the run, and the cold case is one check, the uploads, and the run.
   * Discovering the miss from a failed run would put an extra full round trip in front
   * of every first Run of a session.
   */
  const uploaded = new Set(have);
  for (const [asset, token] of digests) {
    if (uploaded.has(token)) continue;
    if (await upload(token, asset.content as string)) uploaded.add(token);
  }

  return files.map(file => {
    const token = digests.get(file);
    if (!token || !uploaded.has(token)) return file;

    // `content` is REMOVED, which is the entire saving. The server puts it back from
    // the cache before anything downstream sees the payload.
    const { content, ...rest } = file;
    void content;
    return { ...rest, digest: token };
  });
}
