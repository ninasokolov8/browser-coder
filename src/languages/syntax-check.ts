/**
 * Instant, conservative syntax problems - the ones findable without a compiler.
 *
 * ## Why this exists
 *
 * Monaco ships live language services for TypeScript, JavaScript, CSS, HTML and JSON,
 * so those squiggle as you type. Python, Java, PHP and C# had nothing: their only
 * diagnostics came from the server AFTER a run. A student typing `prnt("hi")` saw a
 * clean editor until they pressed Run, which is the opposite of what an IDE is for.
 *
 * The real compiler still runs - see the server check - but it is a round trip and,
 * for Java and C#, seconds of work. This closes the gap in the moment: an unclosed
 * bracket is knowable from the text alone, instantly, with no server and no toolchain.
 *
 * ## The rule that governs every check here: never be wrong
 *
 * A red underline on correct code is worse than no underline at all. It teaches a
 * student to distrust the one signal that tells them where they went wrong, and they
 * cannot tell our false alarm from their real mistake.
 *
 * So this reports ONLY what is unambiguously broken no matter what the rest of the
 * file says:
 *
 *   - a closing bracket with no opener, or an opener never closed
 *   - a string opened and not closed
 *   - (Python) a compound statement header with no `:`
 *
 * Deliberately NOT checked: missing semicolons in Java/C#/PHP - an expression may
 * legally span lines, so a "missing" semicolon is usually a continuation and flagging
 * it would fire constantly on correct code. Undefined names, type errors and anything
 * else needing real semantics belong to the compiler, which is the source of truth and
 * whose findings supersede these.
 *
 * ## Scope
 *
 * Only the four languages Monaco cannot check. Running this alongside Monaco's own
 * service would mean two producers disagreeing about the same file, and Monaco's is a
 * real parser where this is a scanner.
 */

import {
  SYNTAX,
  type StringDelimiter,
  isKnownLanguage,
  maskCommentsAndStrings,
} from './syntax.ts';

export interface SyntaxProblem {
  /** 1-based, matching what editors and compilers report. */
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly severity: 'error';
}

/**
 * Languages with no live Monaco language service, which are therefore the only ones
 * this runs for.
 */
const CHECKED = new Set(['python', 'java', 'php', 'csharp']);

export function hasInstantSyntaxCheck(languageId: string): boolean {
  return CHECKED.has(languageId);
}

/** The three code brackets. Identical across all four checked languages. */
const PAIRS: ReadonlyArray<{ open: string; close: string }> = [
  { open: '(', close: ')' },
  { open: '[', close: ']' },
  { open: '{', close: '}' },
];

const OPENERS = new Map(PAIRS.map(pair => [pair.open, pair.close]));
const CLOSERS = new Map(PAIRS.map(pair => [pair.close, pair.open]));

/**
 * Python statements that must end in a colon.
 *
 * Matched only when the keyword starts the line, so `x = [i for i in y]` and a
 * variable named `iffy` are untouched.
 */
const PYTHON_BLOCK_KEYWORDS =
  /^\s*(if|elif|else|for|while|def|class|try|except|finally|with|match|case)\b/;

interface Cursor {
  line: number;
  column: number;
}

/**
 * Walk the source once, tracking whether we are inside a string or a comment.
 *
 * Everything here needs the same walk - brackets must be counted only in code, and an
 * unterminated string is a property of the walk itself - so it is done once and the
 * findings are collected as it goes.
 */
export function findSyntaxProblems(languageId: string, code: string): SyntaxProblem[] {
  if (!CHECKED.has(languageId) || !isKnownLanguage(languageId)) return [];

  const syntax = SYNTAX[languageId];
  const source = String(code ?? '');
  const problems: SyntaxProblem[] = [];

  /*
   * PHP is only PHP between its tags.
   *
   * Outside `<?php ... ?>` the file is literal output - usually HTML - where a stray
   * brace in a CSS block or an apostrophe in prose is not a syntax error. Scanning it
   * as code would report both. When the file has no open tag at all it is all PHP,
   * which is how a single-file script is normally written.
   */
  const phpRegions = languageId === 'php' ? phpCodeRegions(source) : null;
  const inCode = (index: number): boolean =>
    !phpRegions || phpRegions.some(region => index >= region.start && index < region.end);

  const stack: Array<{ char: string; line: number; column: number }> = [];
  const cursor: Cursor = { line: 1, column: 1 };

  let index = 0;
  while (index < source.length) {
    const character = source[index];

    if (character === '\n') {
      cursor.line += 1;
      cursor.column = 1;
      index += 1;
      continue;
    }

    if (!inCode(index)) {
      index += 1;
      cursor.column += 1;
      continue;
    }

    // Comments: skip to their end, tracking lines so positions after them are right.
    const lineComment = syntax.lineComments.find(marker => source.startsWith(marker, index));
    if (lineComment) {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
        cursor.column += 1;
      }
      continue;
    }

    const blockComment = syntax.blockComments.find(pair => source.startsWith(pair.open, index));
    if (blockComment) {
      const end = source.indexOf(blockComment.close, index + blockComment.open.length);
      const stop = end === -1 ? source.length : end + blockComment.close.length;
      advance(source, index, stop, cursor);
      index = stop;
      continue;
    }

    // Strings: the delimiters are longest-open-first, which is load-bearing for
    // Python's `"""` and Java's text blocks - see the note in syntax.ts.
    const opener = syntax.strings.find(delimiter => source.startsWith(delimiter.open, index));
    if (opener) {
      const startLine = cursor.line;
      const startColumn = cursor.column;
      const end = scanString(source, index, opener);

      if (end === null) {
        problems.push({
          line: startLine,
          column: startColumn,
          severity: 'error',
          message: opener.multiline
            ? `This ${opener.open} string is never closed.`
            : `This string is never closed - add a matching ${opener.close}`,
        });
        // Everything after an unterminated string is inside it as far as the language
        // is concerned, so the walk stops rather than reporting brackets from text
        // that is not code.
        return problems;
      }

      advance(source, index, end, cursor);
      index = end;
      continue;
    }

    if (OPENERS.has(character)) {
      stack.push({ char: character, line: cursor.line, column: cursor.column });
    } else if (CLOSERS.has(character)) {
      const expected = CLOSERS.get(character)!;
      const top = stack[stack.length - 1];

      if (!top) {
        problems.push({
          line: cursor.line,
          column: cursor.column,
          severity: 'error',
          message: `This ${character} has no matching ${expected}`,
        });
      } else if (top.char !== expected) {
        problems.push({
          line: cursor.line,
          column: cursor.column,
          severity: 'error',
          message:
            `Expected ${OPENERS.get(top.char)} to close the ${top.char} ` +
            `opened on line ${top.line}, but found ${character}`,
        });
        stack.pop();
      } else {
        stack.pop();
      }
    }

    index += 1;
    cursor.column += 1;
  }

  // Whatever is still open was never closed. Reported at the opening bracket, which is
  // where the student has to go to fix it - the end of the file tells them nothing.
  for (const unclosed of stack) {
    problems.push({
      line: unclosed.line,
      column: unclosed.column,
      severity: 'error',
      message: `This ${unclosed.char} is never closed - add a matching ${OPENERS.get(unclosed.char)}`,
    });
  }

  /*
   * The colon check runs over the MASKED source, not the raw text.
   *
   * It is line-based - a header can only be judged once its line is complete - and a
   * line-based pass over raw text cannot tell code from the inside of a docstring. It
   * reported "this if needs a :" for the word `if` written in a docstring, which is
   * the exact false alarm this whole module is supposed to avoid.
   *
   * `maskCommentsAndStrings` blanks string and comment CONTENT while preserving length
   * and newline positions, so line and column numbers still refer to the real file.
   */
  if (languageId === 'python') {
    problems.push(...pythonMissingColons(maskCommentsAndStrings(languageId, source)));
  }

  return problems.sort((left, right) => left.line - right.line || left.column - right.column);
}

/** Move `cursor` over `source[from, to)`, counting newlines. */
function advance(source: string, from: number, to: number, cursor: Cursor): void {
  for (let index = from; index < to; index++) {
    if (source[index] === '\n') {
      cursor.line += 1;
      cursor.column = 1;
    } else {
      cursor.column += 1;
    }
  }
}

/**
 * Where the string starting at `start` ends, or null if it never does.
 *
 * A single-line string is also unterminated if the line ends first - which is the
 * common typo this catches, and why the newline check is not just a guard.
 */
function scanString(source: string, start: number, delimiter: StringDelimiter): number | null {
  let index = start + delimiter.open.length;

  while (index < source.length) {
    if (delimiter.escapes && source[index] === '\\') {
      index += 2;
      continue;
    }
    if (!delimiter.multiline && source[index] === '\n') return null;
    if (source.startsWith(delimiter.close, index)) return index + delimiter.close.length;
    index += 1;
  }

  return null;
}

/**
 * Python compound statements that are missing their colon.
 *
 * Line-based on purpose. A header can only be judged once its own line is complete,
 * and a header whose condition continues across lines - inside brackets, or after a
 * backslash - is skipped entirely rather than guessed at.
 */
function pythonMissingColons(source: string): SyntaxProblem[] {
  const problems: SyntaxProblem[] = [];
  const lines = source.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    if (!PYTHON_BLOCK_KEYWORDS.test(raw)) continue;

    // Strip a trailing comment, then trailing whitespace.
    const hash = indexOfCodeHash(raw);
    const statement = (hash === -1 ? raw : raw.slice(0, hash)).trimEnd();
    if (!statement) continue;

    // A continuation line cannot be judged yet.
    if (statement.endsWith('\\')) continue;
    if (countUnclosed(statement) > 0) continue;
    if (statement.endsWith(':')) continue;

    // `else` and `try` with nothing after them are already covered; a bare keyword
    // that is actually a variable (`match = 1`) has an `=` and is not a header.
    if (/^\s*(match|case)\b/.test(statement) && !/[:\s]$/.test(statement) && statement.includes('=')) {
      continue;
    }

    const keyword = statement.trim().split(/\s+/)[0].replace(/[^a-z]/g, '');
    problems.push({
      line: index + 1,
      column: statement.length + 1,
      severity: 'error',
      message: `This ${keyword} needs a : at the end of the line`,
    });
  }

  return problems;
}

/** The first `#` that is not inside a string, or -1. */
function indexOfCodeHash(line: string): number {
  let quote: string | null = null;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '#') return index;
  }

  return -1;
}

/** How many brackets this line leaves open. Strings are ignored. */
function countUnclosed(line: string): number {
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (OPENERS.has(character)) depth += 1;
    else if (CLOSERS.has(character)) depth -= 1;
  }

  return depth;
}

/** The `<?php ... ?>` spans, or the whole file when it has no open tag. */
function phpCodeRegions(source: string): Array<{ start: number; end: number }> {
  const open = /<\?(php|=)?/g;
  const regions: Array<{ start: number; end: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = open.exec(source)) !== null) {
    const start = match.index + match[0].length;
    const close = source.indexOf('?>', start);
    const end = close === -1 ? source.length : close;
    regions.push({ start, end });
    open.lastIndex = end;
  }

  return regions.length > 0 ? regions : [{ start: 0, end: source.length }];
}
