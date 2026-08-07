/**
 * Turning a run payload's digests back into content.
 *
 * A file in a run may carry `content` (the shape that has always existed) or `digest`
 * (new, and only ever used for assets, which are immutable). Everything downstream -
 * the pipeline, the job directory, every language adapter - sees `content` either way,
 * so nothing below this line knows the cache exists.
 *
 * Kept out of the route so it can be tested without express, and out of the store so
 * the store stays a filesystem cache with no opinion about run payloads.
 */

import { parseDigest } from './digest.mjs';

/**
 * Replace every `digest` with the bytes it names.
 *
 * Returns `{ files }` when everything resolved, or `{ missing }` listing the digests
 * the cache does not have. The caller answers 409 with that list and the client uploads
 * them and retries - which costs one extra round trip on a cold cache and saves the
 * entire asset on every warm one.
 *
 * A file with BOTH is not an error: `content` wins, and the digest is ignored. That is
 * the direction to be lenient in, because it means a client that is unsure can always
 * send the bytes and be right.
 */
export function resolveBlobFiles(files, store) {
  if (!Array.isArray(files)) return { files };

  const missing = [];
  const resolved = [];

  for (const file of files) {
    if (!file || typeof file !== 'object') {
      resolved.push(file);
      continue;
    }

    if (typeof file.content === 'string' || file.digest === undefined) {
      // Untouched, and `digest` deliberately not stripped: it is inert downstream, and
      // removing it would mean rebuilding every file object for no benefit.
      resolved.push(file);
      continue;
    }

    const digest = parseDigest(file.digest);
    if (!digest) {
      // A malformed token is treated as absent rather than refused. The client will be
      // asked for the bytes, which is the correct outcome and needs no error path.
      missing.push(String(file.digest).slice(0, 100));
      continue;
    }

    const buffer = store?.isReady ? store.read(digest) : null;
    if (!buffer) {
      missing.push(digest);
      continue;
    }

    /*
     * Base64, because that is what an asset's `content` has always been.
     *
     * Blueprint 39.2 chose base64 in the workspace to avoid reopening six correct
     * seams, and this is the other end of the same decision: the wire saves the
     * repetition, and the representation the pipeline receives is unchanged. Anything
     * else would make this a change to how assets are written to a job directory,
     * which is not what a transport optimisation should be.
     */
    resolved.push({ ...file, content: buffer.toString('base64') });
  }

  if (missing.length > 0) return { missing: [...new Set(missing)] };
  return { files: resolved };
}

/** Every digest a payload refers to, for the client's pre-flight check. */
export function digestsIn(files) {
  if (!Array.isArray(files)) return [];
  const seen = new Set();
  for (const file of files) {
    const digest = parseDigest(file?.digest);
    if (digest) seen.add(digest);
  }
  return [...seen];
}
