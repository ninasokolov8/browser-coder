/**
 * Content digests, in the browser.
 *
 * The other half of `server/blobs/digest.mjs`, and the two must agree exactly: the
 * client names the bytes, the server verifies the name against the bytes it received,
 * and a disagreement means every upload is rejected as a mismatch.
 *
 * Pure apart from `crypto.subtle`, so it is testable under node - which is where the
 * agreement with the server's implementation is actually asserted.
 */

const ALGORITHM = 'sha256';

/**
 * Is hashing available?
 *
 * `crypto.subtle` needs a secure context: HTTPS, or localhost. An IDE served over
 * plain HTTP to a routable IP - which is how this is deployed today, per Step-Up's own
 * V-47 note - therefore has no `subtle` at all.
 *
 * That is the whole reason this returns a boolean rather than throwing. Without the
 * cache, every run sends its assets inline exactly as before; with a thrown error, the
 * Run button would stop working on the deployment that most needs to keep working.
 */
export function supportsContentHash(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** `sha256-<hex>` for these bytes, matching the server's token exactly. */
export async function digestToken(bytes: Uint8Array): Promise<string | null> {
  if (!supportsContentHash()) return null;
  try {
    // A fresh copy: `crypto.subtle.digest` will not accept a view whose buffer is a
    // SharedArrayBuffer, and some callers hand over a subarray of a larger read.
    const hashed = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
    return `${ALGORITHM}-${toHex(hashed)}`;
  } catch {
    // Any failure means "no digest", which means "send the bytes". Never fatal.
    return null;
  }
}
