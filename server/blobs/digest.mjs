/**
 * Content digests, for the asset cache.
 *
 * A student's project can contain images. They are immutable by construction - the
 * Monaco model registry refuses to open an asset for editing, so nothing can change one
 * after import - which means a digest computed once is valid for the life of the file.
 *
 * That is the property the whole cache rests on: if the bytes cannot change, the name
 * derived from the bytes cannot go stale, and "the server already has this" is a safe
 * thing to believe.
 *
 * Pure: no filesystem, no express. The route and the store both parse tokens with the
 * functions here, so the two cannot end up disagreeing about what a valid one is - and
 * a disagreement there is a path traversal, because the token becomes a filename.
 */

import crypto from 'node:crypto';

/**
 * `sha256-<64 lowercase hex>`.
 *
 * Anchored at both ends and case-sensitive. This string is used to build a path on
 * disk, so anything it accepts must be safe as a filename: no dots, no slashes, no
 * uppercase to collide on a case-insensitive filesystem, and a fixed length.
 */
export const DIGEST_PATTERN = /^sha256-[0-9a-f]{64}$/;

export const DIGEST_ALGORITHM = 'sha256';

/** The token for a buffer. */
export function digestOfBuffer(buffer) {
  return `${DIGEST_ALGORITHM}-${crypto.createHash(DIGEST_ALGORITHM).update(buffer).digest('hex')}`;
}

/** A token, validated, or null. Never throws: it is parsing untrusted input. */
export function parseDigest(value) {
  if (typeof value !== 'string') return null;
  return DIGEST_PATTERN.test(value) ? value : null;
}

/**
 * Where a digest lives, relative to the cache root.
 *
 * Fanned out two levels. A flat directory holding a hundred thousand entries is slow to
 * list and, on some filesystems, slow to open a single file in - and a cache is exactly
 * the thing that ends up with a hundred thousand entries.
 *
 * Returns null for a token that does not parse, so a caller cannot accidentally build a
 * path out of something it did not check.
 */
export function relativePathFor(digest) {
  const token = parseDigest(digest);
  if (!token) return null;

  const hex = token.slice(DIGEST_ALGORITHM.length + 1);
  return [hex.slice(0, 2), hex.slice(2, 4), token];
}

/**
 * A hash that can be fed a stream, and asked for the token at the end.
 *
 * Used by the upload route to verify what it ACTUALLY received rather than what the
 * client claimed. Trusting the claim would let anyone store arbitrary bytes under a
 * digest of their choosing - which is how a content-addressed cache becomes a way to
 * hand one student's file to another.
 */
export function createDigestSink() {
  const hash = crypto.createHash(DIGEST_ALGORITHM);
  let bytes = 0;

  return {
    update(chunk) {
      hash.update(chunk);
      bytes += chunk.length;
    },
    get bytes() {
      return bytes;
    },
    digest() {
      return `${DIGEST_ALGORITHM}-${hash.digest('hex')}`;
    },
  };
}
