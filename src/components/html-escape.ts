/**
 * One HTML escaper.
 *
 * There were four, with three different behaviours:
 *
 *   src/features/execution.ts:37       & < >              (no quotes)
 *   src/features/run-panel.ts:48       & < > "
 *   src/features/search.ts:410         & < > "
 *   src/features/explorer/tree.ts:176  & < > " '
 *
 * The `execution.ts` copy was the weakest, and it is used to build markup for the
 * output panel. Every one of its call sites happens to interpolate into ELEMENT
 * CONTENT rather than into an attribute - checked, all ten - so the missing quote
 * escaping was not exploitable there. It was a hazard rather than a hole: the next
 * person to interpolate one of those values into `title="..."` would have had no
 * way to know the local helper was the weak one.
 *
 * All five characters are escaped, in one function, because over-escaping is safe in
 * both positions. `&quot;` inside element content renders as `"`, so there is no
 * reason to offer a weaker variant and no way to pick the wrong one.
 *
 * Pure, so it is tested in node.
 */

/**
 * Escape a string for interpolation into HTML, in either element content or a
 * quoted attribute value.
 *
 * Not safe for unquoted attributes, `<script>` bodies, `<style>` bodies, or URL
 * positions - none of which this codebase builds by interpolation, and all of which
 * need a different escaping rule rather than a stronger version of this one.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
