/**
 * Finding the OPERATOR under the cursor.
 *
 * ## Why this exists at all
 *
 * The teaching hover looks up whatever is under the pointer and explains it. It found
 * that word with Monaco's `getWordAtPosition`, which - by definition - returns words:
 * runs of identifier characters. So a beginner pointing at `total` got an explanation
 * and a beginner pointing at `//` got nothing, which is backwards. `//` is the thing
 * they do not recognise. `total` is their own variable.
 *
 * Blueprint 40.5 recorded the gap; this closes it.
 *
 * ## Pure, deliberately
 *
 * No Monaco import, so node can test it. `hover-help.ts` is the half that talks to the
 * editor, exactly as `hover-content` / `hover-help` and `format-core` / `formatting`
 * are already split. The signature takes a line of text and a column rather than a
 * model and a position for the same reason.
 *
 * ## The ambiguity that has to be got right
 *
 * `//` is integer division in Python and the start of a comment in every C-family
 * language. Nothing here needs to know that: the candidate set is the language's own
 * keyword file, so `//` is only ever offered where the language's data defines it, and
 * the caller has already refused to hover inside a comment. Two independent reasons
 * the wrong answer cannot be given.
 */

/** Where an operator sits on a line. Columns are 1-based, like Monaco's. */
export interface SymbolSpan {
  readonly text: string;
  readonly startColumn: number;
  /** Exclusive, matching Monaco's `IWordAtPosition.endColumn`. */
  readonly endColumn: number;
}

/**
 * Is this key an operator rather than a word?
 *
 * Word-shaped operators - Python's `and`, `is`, `not`, `in`, PHP's `instanceof` - are
 * already found by `getWordAtPosition` and must NOT be searched for as symbols, or
 * `in` would match the middle of `print`.
 */
export function isOperatorKey(key: string): boolean {
  return key.length > 0 && !/[\p{L}\p{N}_$]/u.test(key);
}

/**
 * The operator at a column, or null.
 *
 * Longest match wins, which is the whole difficulty. Pointing at either character of
 * `===` must give `===`, not `==` and certainly not `=`; pointing at the `=` in `+=`
 * must give `+=`. So every candidate is tried longest-first, and a shorter one is only
 * accepted when no longer one covers the column.
 */
export function operatorAt(
  lineText: string,
  column: number,
  keys: Iterable<string>,
): SymbolSpan | null {
  if (column < 1 || column > lineText.length + 1) return null;

  const operators = [...keys].filter(isOperatorKey);
  if (operators.length === 0) return null;

  // Longest first, so `===` is considered before `==` before `=`.
  operators.sort((left, right) => right.length - left.length);

  // A cursor sitting just past the end of an operator still points at it - that is
  // where the caret lands after typing one, and Monaco treats a word the same way.
  const index = column - 1;

  for (const operator of operators) {
    // `index - length`, not `index - length + 1`: the caret one character PAST an
    // operator still points at it, which is where it sits the instant the student
    // finishes typing one. The upper bound below is what keeps it to one.
    const earliest = Math.max(0, index - operator.length);
    for (let start = earliest; start <= index; start++) {
      if (!lineText.startsWith(operator, start)) continue;
      // Inside, or immediately after: `start <= index <= start + length`.
      if (index > start + operator.length) continue;
      return {
        text: operator,
        startColumn: start + 1,
        endColumn: start + operator.length + 1,
      };
    }
  }

  return null;
}

/**
 * What the hover should explain here: the word if there is one, otherwise the operator.
 *
 * The word wins, and that ordering matters. In `x % 2` a cursor on `x` must explain `x`
 * - which the data has nothing for, so nothing is shown - rather than reaching sideways
 * to the nearest operator and explaining `%` while the student points at a variable.
 */
export function hoverTargetAt(
  lineText: string,
  column: number,
  word: SymbolSpan | null,
  keys: Iterable<string>,
): SymbolSpan | null {
  if (word) return word;
  return operatorAt(lineText, column, keys);
}
