/**
 * Turning "the lines the student highlighted" into a program that can run.
 *
 * Pure and Monaco-free so node can test it: the editor half is
 * `editor-context-menu.ts`. Three decisions live here, and each of them was silently
 * wrong before.
 *
 * ## The selection is not the lines
 *
 * Triple-clicking a line, or clicking it in the line-number gutter, gives
 * `Selection(1,1,2,1)` - Monaco's line select ends at column 1 of the *next* line.
 * Expanding that to whole lines ran one line more than the student highlighted, so
 * triple-clicking `print("a")` printed `a` and `b`. Every line-based action in Monaco
 * normalises this; this one did not.
 *
 * ## An indented block is not a program
 *
 * Selecting the body of a function and running it sent the leading spaces verbatim,
 * and CPython answered `IndentationError: unexpected indent` - for code that is
 * perfectly correct where it sits. The common indentation is removed, which is what
 * `textwrap.dedent` does and what a student means by "run these lines".
 *
 * ## Not every language can run a fragment
 *
 * For HTML, CSS and Markdown, Run renders the whole document and the selection is
 * discarded; for JSON it validates the fragment as a standalone document, so selecting
 * part of a valid file reports that the file is invalid. Offering the menu item there
 * promises something that cannot happen.
 */

/** A Monaco selection, restated so this module imports nothing. */
export interface SelectionLike {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

export interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * The lines a selection really covers.
 *
 * A selection that ends at column 1 of a later line does not include that line: the
 * caret sits before its first character.
 */
export function selectedLineRange(selection: SelectionLike): LineRange {
  const ordered = inDocumentOrder(selection);
  const endLine = ordered.endColumn === 1 && ordered.endLine > ordered.startLine
    ? ordered.endLine - 1
    : ordered.endLine;
  return { startLine: ordered.startLine, endLine };
}

/**
 * The selection with its ends the right way round.
 *
 * Dragging upwards, or extending a selection with Shift+Up, yields a selection whose
 * start is after its end; every rule below reads "first" and "last", not "anchor".
 */
function inDocumentOrder(selection: SelectionLike): {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
} {
  const forwards =
    selection.startLineNumber < selection.endLineNumber ||
    (selection.startLineNumber === selection.endLineNumber &&
      selection.startColumn <= selection.endColumn);

  return forwards
    ? {
        startLine: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLine: selection.endLineNumber,
        endColumn: selection.endColumn,
      }
    : {
        startLine: selection.endLineNumber,
        startColumn: selection.endColumn,
        endLine: selection.startLineNumber,
        endColumn: selection.startColumn,
      };
}

/**
 * Whether a selection covers enough to be worth running.
 *
 * One whole line or more. A partial in-line selection (a variable name) is not a
 * statement, and offering to run it would be noise on every double-click.
 */
export function coversWholeLines(
  selection: SelectionLike,
  lineMaxColumn: (line: number) => number,
): boolean {
  const ordered = inDocumentOrder(selection);
  if (ordered.startLine === ordered.endLine && ordered.startColumn === ordered.endColumn) {
    return false;
  }

  const { startLine, endLine } = selectedLineRange(selection);
  if (endLine > startLine) return true;

  // One line. It counts when the line is covered end to end, which happens two ways:
  // Home then Shift+End (ending at the line's last column), and a triple-click or
  // gutter click (ending at column 1 of the NEXT line, which the range above trimmed
  // back to this one).
  if (ordered.startColumn !== 1) return false;
  return ordered.endLine > startLine || ordered.endColumn === lineMaxColumn(startLine);
}

/**
 * Remove the indentation the whole block shares.
 *
 * Blank lines are ignored when measuring, and left blank in the output: a line of
 * trailing spaces in the middle of a function would otherwise force the common prefix
 * to zero and dedent nothing.
 *
 * A block mixing tabs and spaces at the same depth has no common prefix to remove, so
 * it is returned untouched rather than guessing a tab width - guessing wrong changes
 * what the code means in Python.
 */
export function dedent(code: string): string {
  const lines = code.split('\n');
  const meaningful = lines.filter(line => line.trim().length > 0);
  if (meaningful.length === 0) return code;

  let common: string | null = null;
  for (const line of meaningful) {
    const indent = line.slice(0, line.length - line.trimStart().length);
    if (common === null) {
      common = indent;
      continue;
    }
    let shared = 0;
    while (shared < common.length && shared < indent.length && common[shared] === indent[shared]) {
      shared++;
    }
    common = common.slice(0, shared);
    if (common.length === 0) break;
  }

  if (!common) return code;
  return lines.map(line => (line.startsWith(common) ? line.slice(common.length) : line)).join('\n');
}

/**
 * Languages where running a selection means anything.
 *
 * Explicit rather than "everything except the previewed ones", so a language added
 * later has to be considered rather than silently inheriting a promise.
 *
 * Java is excluded on purpose: the adapter requires a file declaring a class with
 * `main`, and a selection of statements can never compile. Offering it would produce
 * "class, interface, or enum expected" for a gesture that looks reasonable.
 */
export const SELECTION_RUNNABLE_LANGUAGES: ReadonlySet<string> = new Set([
  'python',
  'javascript',
  'typescript',
  'php',
  'csharp',
]);

export function canRunSelection(languageId: string | undefined | null): boolean {
  return !!languageId && SELECTION_RUNNABLE_LANGUAGES.has(languageId);
}
