/**
 * Finding and replacing text in one file.
 *
 * ## Why this is a module of its own
 *
 * `search.ts` imports the DOM - the input boxes, the results panel, the toggle
 * buttons - so nothing in it can be reached from a node test. That is how three
 * versions of the same bug reached students: search and replace kept being written as
 * two scans of the same file, and kept disagreeing about what a match is.
 *
 *   1. Replace built its pattern without the language, so whole-word replace used
 *      JavaScript's `\b` while whole-word search used the language's own identifier
 *      characters. PHP's `$total` was found by neither and rewritten by one.
 *   2. With codeOnly on, replace ignored the comment/string mask entirely and rewrote
 *      matches the results list had deliberately not shown - destructively, and in a
 *      student's own file.
 *   3. Search ran the pattern once per line and replace ran it over the whole file, so
 *      with regex mode on `^print` listed three matches in a three-line file and then
 *      reported "Replaced 1 occurrence".
 *
 * Each was fixed by sharing a little more. This shares all of it: there is one scan,
 * `matchSpans`, and both halves of the feature are defined in terms of it. Options
 * arrive as an argument rather than as module state, which is what lets the rules be
 * asserted directly rather than through a browser.
 */

import { identifierPattern, maskCommentsAndStrings } from '../languages/syntax.ts';

export interface SearchOptions {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Skip matches inside comments and string literals. */
  codeOnly: boolean;
}

export interface MatchSpan {
  /** Offset into the original content. */
  start: number;
  end: number;
}

/** A match placed in the file, ready for the results list. */
export interface PositionedMatch extends MatchSpan {
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** The whole line the match starts on, from the ORIGINAL content. */
  text: string;
  /** Offsets within `text`, for highlighting. */
  matchStart: number;
  matchEnd: number;
}

export function buildSearchPattern(
  query: string,
  global: boolean,
  options: SearchOptions,
  language?: string,
): RegExp {
  /*
   * `m`, so `^` and `$` mean the start and end of a LINE.
   *
   * That is what someone typing `^print` into a search box means, and - now that one
   * scan serves both halves - it is the only reading under which the results list and
   * Replace All can agree. It has no effect on a non-regex query, where `^` and `$`
   * are escaped to literals.
   */
  const flags = `${global ? 'g' : ''}m${options.caseSensitive ? '' : 'i'}`;

  if (options.regex) return new RegExp(query, flags);

  let escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (options.wholeWord) {
    /*
     * `\b` is defined against JavaScript's idea of a word character, which is wrong for
     * several of the languages here: searching PHP for `$total` with whole-word on
     * found nothing, because `\b` sits between `$` and `t` rather than before the `$`.
     * Same for `my-class` in CSS, which `\b` splits into two words.
     *
     * Built from the language's own identifier characters instead. Falls back to the
     * plain `\b` when the language is unknown, which is what it always did.
     */
    const identifier = language ? identifierPattern(language) : null;
    escapedQuery = identifier
      ? `(?<!${identifier})${escapedQuery}(?!${identifier})`
      : `\\b${escapedQuery}\\b`;
  }

  return new RegExp(escapedQuery, flags);
}

/**
 * Every match in one file, as offsets into the ORIGINAL content.
 *
 * Matches are located on the MASKED text and reported against the original, which is
 * sound only because the lexer guarantees the two have identical length and identical
 * newline positions.
 */
export function matchSpans(
  content: string,
  query: string,
  language: string,
  options: SearchOptions,
): MatchSpan[] {
  if (!query) return [];

  let pattern: RegExp;
  try {
    pattern = buildSearchPattern(query, true, options, language);
  } catch {
    // An unfinished regex - a student is still typing `(foo` - is no matches, not an
    // error. Both callers depend on this.
    return [];
  }

  const searchable = options.codeOnly ? maskCommentsAndStrings(language, content) : content;

  const spans: MatchSpan[] = [];
  let match: RegExpExecArray | null;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(searchable)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
    // A zero-length match does not advance lastIndex, so nothing else would.
    if (match[0].length === 0) pattern.lastIndex += 1;
  }

  return spans;
}

/** Where each line starts, so a whole-file offset can be turned into a position. */
function lineStartsOf(lines: string[]): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    starts.push(cursor);
    cursor += line.length + 1; // the newline `split` consumed
  }
  return starts;
}

/** The 0-based index of the line containing `offset`. */
function lineAt(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The same matches, placed on their lines. */
export function findMatches(
  content: string,
  query: string,
  language: string,
  options: SearchOptions,
): PositionedMatch[] {
  const lines = content.split('\n');
  const lineStarts = lineStartsOf(lines);

  return matchSpans(content, query, language, options).map(span => {
    const index = lineAt(lineStarts, span.start);
    const matchStart = span.start - lineStarts[index];

    return {
      ...span,
      line: index + 1,
      column: matchStart + 1,
      // The ORIGINAL line, not the masked one: the offsets are shared, but the student
      // must see their own text in the results list.
      text: lines[index],
      matchStart,
      // Clamped, so a match spanning a newline highlights to the end of the line it
      // starts on rather than past it. The list shows one line per match.
      matchEnd: Math.min(span.end - lineStarts[index], lines[index].length),
    };
  });
}

/** Replace every match in one file. Returns the new text and how many were replaced. */
export function replaceInFile(
  content: string,
  query: string,
  language: string,
  replacement: string,
  options: SearchOptions,
): { text: string; count: number } {
  // Applied right-to-left, so an earlier splice cannot invalidate a later offset.
  const spans = matchSpans(content, query, language, options).reverse();

  let text = content;
  for (const span of spans) {
    text = text.slice(0, span.start) + replacement + text.slice(span.end);
  }

  return { text, count: spans.length };
}
