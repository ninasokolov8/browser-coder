/**
 * Formatting for the languages Monaco has no formatter for.
 *
 * Monaco ships real formatters for css, html, json, javascript and typescript.
 * For Python, Java, PHP, C# and Markdown it ships nothing, and `Format document`
 * was bound to Monaco's action regardless - so for five of the ten languages the
 * command ran, reported nothing, and changed nothing. A command that silently does
 * nothing is worse than an absent one: the student concludes their code is already
 * formatted.
 *
 * ## What this is, and what it is not
 *
 * This is NOT black, prettier or google-java-format. Those are large programs with
 * their own opinions about line breaking, and running them would mean shipping four
 * more toolchains in the image. This does the subset that is unambiguous:
 *
 *   - every language: strip trailing whitespace, normalise line endings, collapse
 *     runs of blank lines, end with exactly one newline
 *   - brace languages: re-indent by nesting depth
 *   - Python: whitespace only, because indentation is syntax and re-deriving it
 *     would mean guessing at the program's meaning
 *
 * It never re-wraps or re-breaks lines. Where a student has made a deliberate
 * layout choice inside a line, it survives.
 *
 * ## The safety rule
 *
 * Indentation is only rewritten when the file can be scanned exactly. Any
 * construct the scanner does not model - a PHP heredoc, an unterminated block
 * comment, unbalanced brackets - makes it abandon re-indentation and fall back to
 * the whitespace pass. Formatting that corrupts a program is far worse than
 * formatting that declines, so every uncertain case declines.
 *
 * Pure: no DOM, no Monaco. Tested directly in node.
 */

export type FormatLanguage =
  | 'python'
  | 'java'
  | 'csharp'
  | 'php'
  | 'markdown'
  | 'svg'
  | 'xml';

export interface FormatOptions {
  /** Spaces per indent level. */
  indentSize?: number;
  /** Use a tab character per level instead of spaces. */
  useTabs?: boolean;
  /** Maximum consecutive blank lines to keep. */
  maxBlankLines?: number;
}

interface Resolved {
  indentSize: number;
  useTabs: boolean;
  maxBlankLines: number;
}

function resolve(options: FormatOptions | undefined, language: string): Resolved {
  return {
    indentSize: options?.indentSize ?? (language === 'python' ? 4 : 4),
    useTabs: options?.useTabs ?? false,
    // Two blank lines is what Python uses between top-level definitions, so
    // collapsing to one would fight the language's own convention.
    maxBlankLines: options?.maxBlankLines ?? 2,
  };
}

/** Languages this module can format. Monaco covers the rest. */
const SUPPORTED = new Set<string>(['python', 'java', 'csharp', 'php', 'markdown', 'svg', 'xml']);

/** Languages whose indentation is derived from brackets. */
const BRACE_LANGUAGES = new Set<string>(['java', 'csharp', 'php']);

export function canFormatLocally(languageId: string): boolean {
  return SUPPORTED.has(languageId);
}

// ── Whitespace pass ─────────────────────────────────────────────────────────

/**
 * The part that is safe for every language.
 *
 * Deliberately does NOT touch indentation: in Python that would change what the
 * program means, and in the brace languages the indent pass below does it with
 * the nesting actually known.
 */
export function tidyWhitespace(source: string, options: Resolved): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let blankRun = 0;

  for (const line of lines) {
    // Trailing whitespace is invisible, shows up in every diff, and is the single
    // most common thing a formatter is expected to remove.
    const trimmed = line.replace(/[ \t]+$/, '');

    if (trimmed === '') {
      blankRun += 1;
      if (blankRun <= options.maxBlankLines) out.push('');
      continue;
    }

    blankRun = 0;
    out.push(trimmed);
  }

  // Leading blank lines carry no information.
  while (out.length > 0 && out[0] === '') out.shift();
  // Exactly one trailing newline: none means a POSIX-incomplete file, several are
  // noise in the diff.
  while (out.length > 0 && out[out.length - 1] === '') out.pop();

  return out.length === 0 ? '' : `${out.join('\n')}\n`;
}

// ── Scanning ────────────────────────────────────────────────────────────────

interface LineScan {
  /** Depth change contributed by this line. */
  delta: number;
  /** How much of the delta happens before the first token, i.e. leading closers. */
  leadingClosers: number;
  /** True when the line begins inside a multi-line construct. */
  continuesString: boolean;
  /** True when the line begins inside a block comment. */
  continuesComment: boolean;
}

/** Raised when the scanner meets something it does not model exactly. */
class Unmodelled extends Error {}

/**
 * Bracket depth per line, ignoring brackets inside strings and comments.
 *
 * Throws `Unmodelled` rather than guessing. The constructs it refuses are the
 * ones where a wrong guess silently corrupts a program: a heredoc body looks like
 * code, and a verbatim string can contain an unmatched brace.
 */
function scanBraceLanguage(lines: string[], language: string): LineScan[] {
  const scans: LineScan[] = [];
  let inBlockComment = false;

  for (const line of lines) {
    let delta = 0;
    let leadingClosers = 0;
    let seenToken = false;
    const startedInComment = inBlockComment;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];

      if (inBlockComment) {
        if (char === '*' && next === '/') {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      // Line comments end the line for our purposes.
      if (char === '/' && next === '/') break;
      if (language === 'php' && char === '#' && next !== '[') break;

      if (char === '/' && next === '*') {
        inBlockComment = true;
        index += 1;
        continue;
      }

      // PHP heredoc and nowdoc bodies are arbitrary text that can contain
      // anything, including unbalanced braces. Not modelled - decline the file.
      if (language === 'php' && char === '<' && next === '<' && line[index + 2] === '<') {
        throw new Unmodelled('heredoc');
      }

      // C# verbatim strings escape a quote by doubling it, which the normal
      // backslash rule below gets wrong.
      if (language === 'csharp' && char === '@' && next === '"') {
        throw new Unmodelled('verbatim string');
      }

      if (char === '"' || char === "'") {
        const quote = char;
        index += 1;
        let closed = false;
        for (; index < line.length; index += 1) {
          if (line[index] === '\\') {
            index += 1;
            continue;
          }
          if (line[index] === quote) {
            closed = true;
            break;
          }
        }
        // A string that does not close on its line is a multi-line string, which
        // this scanner does not track across lines.
        if (!closed) throw new Unmodelled('unterminated string');
        seenToken = true;
        continue;
      }

      if (char === '{' || char === '(' || char === '[') {
        delta += 1;
        seenToken = true;
        continue;
      }

      if (char === '}' || char === ')' || char === ']') {
        delta -= 1;
        // A closer before any other token on the line dedents the line itself.
        if (!seenToken) leadingClosers += 1;
        continue;
      }

      if (!/\s/.test(char)) seenToken = true;
    }

    scans.push({
      delta,
      leadingClosers,
      continuesString: false,
      continuesComment: startedInComment,
    });
  }

  if (inBlockComment) throw new Unmodelled('unterminated block comment');

  return scans;
}

/** Re-indent a brace language, or return null if the file cannot be scanned. */
function reindentBraceLanguage(
  source: string,
  language: string,
  options: Resolved,
): string | null {
  const lines = source.split('\n');

  let scans: LineScan[];
  try {
    scans = scanBraceLanguage(lines, language);
  } catch (error) {
    if (error instanceof Unmodelled) return null;
    throw error;
  }

  // Unbalanced brackets mean the file does not parse. Re-indenting it would move
  // every line after the mistake, burying the mistake itself.
  const total = scans.reduce((sum, scan) => sum + scan.delta, 0);
  if (total !== 0) return null;

  let depth = 0;
  const unit = options.useTabs ? '\t' : ' '.repeat(options.indentSize);
  const out: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const scan = scans[index];
    const text = lines[index].trim();

    if (text === '') {
      out.push('');
      depth += scan.delta;
      continue;
    }

    // Inside a block comment the original relative layout is deliberate - ASCII
    // diagrams, aligned stars - so it is left exactly as written.
    if (scan.continuesComment) {
      out.push(lines[index].replace(/[ \t]+$/, ''));
      depth += scan.delta;
      continue;
    }

    const lineDepth = Math.max(0, depth - scan.leadingClosers);
    out.push(unit.repeat(lineDepth) + text);

    depth += scan.delta;
    if (depth < 0) return null;
  }

  return out.join('\n');
}

// ── Python ──────────────────────────────────────────────────────────────────

/**
 * Python, where indentation is syntax.
 *
 * Only the width is normalised, and only when the file indents consistently with
 * tabs - converting those to spaces is a change a student can safely accept.
 * Anything else is left alone: re-deriving Python indentation means deciding where
 * blocks end, which is deciding what the program does.
 */
function normalisePythonIndent(source: string, options: Resolved): string {
  const lines = source.split('\n');
  const indents = lines
    .filter(line => line.trim() !== '')
    .map(line => /^[ \t]*/.exec(line)![0]);

  const usesTabs = indents.some(indent => indent.includes('\t'));
  const usesSpaces = indents.some(indent => indent.includes(' '));

  // Mixed indentation is exactly the case where guessing is dangerous: the file
  // may already mean something the student did not intend, and rewriting it would
  // silently pick one interpretation.
  if (!usesTabs || usesSpaces) return source;

  return lines
    .map(line => {
      const match = /^(\t*)(.*)$/.exec(line)!;
      return ' '.repeat(match[1].length * options.indentSize) + match[2];
    })
    .join('\n');
}

// ── Entry point ─────────────────────────────────────────────────────────────

export interface FormatResult {
  text: string;
  /** True when indentation was rewritten, not just whitespace tidied. */
  reindented: boolean;
  /** Set when re-indentation was declined, naming why. */
  declinedReason?: string;
}

/**
 * Format `source` for `languageId`.
 *
 * Always returns text. The result is never a partial or best-effort rewrite: if
 * the structural pass cannot run, the whitespace pass alone is returned, and
 * `declinedReason` says so, so the caller can tell the student the truth.
 */
export function formatSource(
  languageId: string,
  source: string,
  options?: FormatOptions,
): FormatResult {
  const resolved = resolve(options, languageId);

  if (!SUPPORTED.has(languageId)) {
    return { text: source, reindented: false, declinedReason: 'unsupported language' };
  }

  if (languageId === 'python') {
    const normalised = normalisePythonIndent(source, resolved);
    return {
      text: tidyWhitespace(normalised, resolved),
      reindented: false,
      declinedReason: 'Python indentation is part of the syntax and is never rewritten',
    };
  }

  if (BRACE_LANGUAGES.has(languageId)) {
    const reindented = reindentBraceLanguage(source, languageId, resolved);
    if (reindented === null) {
      return {
        text: tidyWhitespace(source, resolved),
        reindented: false,
        declinedReason:
          'indentation was left alone: the file has unbalanced brackets, or uses a ' +
          'construct that cannot be scanned exactly (a heredoc, a verbatim string, ' +
          'or an unterminated string or comment)',
      };
    }
    return { text: tidyWhitespace(reindented, resolved), reindented: true };
  }

  // Markdown, SVG and XML: whitespace only. Markdown's indentation is meaningful
  // (nested lists, indented code) and re-indenting XML would need a parser that
  // knows which elements preserve whitespace.
  return { text: tidyWhitespace(source, resolved), reindented: false };
}
