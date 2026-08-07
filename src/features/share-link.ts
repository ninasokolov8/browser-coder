/**
 * Reading and writing a share link's URL. Pure.
 *
 * Split from `share.ts`, which imports the runtime, the workspace and the output panel
 * and therefore cannot be loaded by node. Everything here is string handling, and it is
 * the half most worth testing: an id that the client parses differently from the server
 * is a link that one of them serves and the other refuses.
 *
 * Same split, and the same reason, as `hover-symbols` / `hover-help`,
 * `format-core` / `formatting`, and `languages/java/condition.mjs`.
 */

/** The query parameter a share link carries. */
export const SHARE_PARAM = 'share';

/**
 * What a share id looks like: 16 random bytes as base64url.
 *
 * Must agree with `SHARE_ID_PATTERN` in `server/shares/store.mjs`. The two cannot import
 * each other - one ships to a browser, the other runs in node - so `tests/unit/
 * shares.test.mjs` asserts they accept exactly the same strings.
 */
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * The share id in a query string, or null.
 *
 * Validated on the client as well as the server because this value is interpolated into
 * a URL the browser then fetches, and a client that will fetch whatever it is told to
 * is a step away from being useful to somebody else.
 */
export function requestedShareId(search: string): string | null {
  const id = new URLSearchParams(search).get(SHARE_PARAM);
  return id && SHARE_ID_PATTERN.test(id) ? id : null;
}

/**
 * The link to hand somebody, given the page's current URL.
 *
 * Only the share parameter survives. Carrying `readonly`, `mode`, `uilang` or a stale
 * `lang` over from the publisher's own session would impose their embed settings on
 * whoever opens it - so a teacher who happened to be in a read-only frame would send
 * links nobody could edit.
 */
export function buildShareLink(currentHref: string, id: string): string {
  const link = new URL(currentHref);
  link.search = `?${SHARE_PARAM}=${encodeURIComponent(id)}`;
  link.hash = '';
  return link.toString();
}
