/**
 * Per-language syntax facts, and the one lexer built from them.
 *
 * ## Why this exists
 *
 * `maskCommentsAndStrings` - blank out comments and string bodies so a regex can
 * scan code without matching things that only look like code - existed TWICE, as
 * two independent ~90-line hand-written state machines:
 *
 *   src/components/code-analysis.ts:65   (the Run panel's function outline)
 *   src/features/go-to-definition.ts:64  (symbol lookup)
 *
 * Neither took a language parameter. Both hardcoded C-like syntax: `//`, `/* *\/`,
 * and `'` `"` backtick strings. And they had DIVERGED in exactly the way duplication
 * predicts - go-to-definition grew a `#` case for Python comments, code-analysis
 * never did.
 *
 * The measured consequence, before this module:
 *
 *     def real():
 *         pass
 *     text = """
 *     def inside_a_docstring():
 *     """
 *
 * `parseFunctions(code, 'python')` reported TWO functions. `inside_a_docstring` is
 * a line inside a string literal, and Python's triple-quoted strings were not
 * modelled by either copy, so the Run panel listed a function that does not exist -
 * and "run this function in isolation" would synthesise a call to it.
 *
 * A third scanner exists in `src/features/format-core.ts`. It is deliberately NOT
 * replaced by this one: its contract is different and stricter - it must *decline*
 * on any construct it cannot model exactly, because it rewrites the file, whereas
 * this one degrades gracefully because it only feeds a read-only regex pass.
 * Forcing them together would push the wrong contract onto one of them.
 *
 * ## Omissions are a compile error
 *
 * `SYNTAX` is a `Record<KnownLanguageId, LanguageSyntax>`, so adding a language id
 * without describing its syntax does not compile. That is the point of the whole
 * exercise: the hazard being removed is "add a language, edit six switches, forget
 * one and get silently wrong behaviour in a corner of the IDE".
 *
 * Pure: no DOM, no Monaco, no imports from the rest of the app.
 */

/**
 * Every language the IDE registers.
 *
 * Kept as a literal union rather than `string` so the table below cannot be
 * partially filled. `src/languages/loader.ts` is the runtime source of truth for
 * which languages EXIST; this is the compile-time source of truth for which ones
 * have had their syntax described.
 */
export type KnownLanguageId =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'java'
  | 'csharp'
  | 'php'
  | 'html'
  | 'css'
  | 'json'
  | 'markdown'
  | 'svg';

/** A paired delimiter, e.g. block comments or a heredoc. */
export interface DelimiterPair {
  readonly open: string;
  readonly close: string;
}

export interface StringDelimiter {
  readonly open: string;
  readonly close: string;
  /** Whether a backslash escapes the next character inside this string. */
  readonly escapes: boolean;
  /** Whether the literal may span lines. */
  readonly multiline: boolean;
}

export interface LanguageSyntax {
  /** Sequences that start a comment running to end of line. */
  readonly lineComments: readonly string[];
  readonly blockComments: readonly DelimiterPair[];
  /**
   * String delimiters, longest-open-first.
   *
   * Order is load-bearing: Python's `"""` must be tried before `"`, or a docstring
   * is read as an empty string followed by loose code - which is precisely the bug
   * this module was written to fix.
   */
  readonly strings: readonly StringDelimiter[];
  /** True when indentation carries meaning, so it must never be collapsed. */
  readonly indentationIsSignificant: boolean;
  /** Extra characters that count as part of an identifier, beyond letters/digits/_. */
  readonly identifierExtras: readonly string[];
}

const C_LIKE_STRINGS: readonly StringDelimiter[] = [
  { open: '"', close: '"', escapes: true, multiline: false },
  { open: "'", close: "'", escapes: true, multiline: false },
];

const JS_STRINGS: readonly StringDelimiter[] = [
  // Template literals first: they are the only multiline form, and a backtick has
  // no other meaning.
  { open: '`', close: '`', escapes: true, multiline: true },
  ...C_LIKE_STRINGS,
];

/**
 * Python's triple-quoted forms MUST precede the single-character ones.
 *
 * `"""` shares a prefix with `"`, and the lexer takes the first delimiter that
 * matches at the cursor. Reversed, `"""x"""` scans as `""` then bare `x` then `""`,
 * and the body leaks into the code stream.
 */
const PYTHON_STRINGS: readonly StringDelimiter[] = [
  { open: '"""', close: '"""', escapes: true, multiline: true },
  { open: "'''", close: "'''", escapes: true, multiline: true },
  { open: '"', close: '"', escapes: true, multiline: false },
  { open: "'", close: "'", escapes: true, multiline: false },
];

export const SYNTAX: Record<KnownLanguageId, LanguageSyntax> = {
  javascript: {
    lineComments: ['//'],
    blockComments: [{ open: '/*', close: '*/' }],
    strings: JS_STRINGS,
    indentationIsSignificant: false,
    identifierExtras: ['$', '_'],
  },
  typescript: {
    lineComments: ['//'],
    blockComments: [{ open: '/*', close: '*/' }],
    strings: JS_STRINGS,
    indentationIsSignificant: false,
    identifierExtras: ['$', '_'],
  },
  python: {
    lineComments: ['#'],
    // Python has no block comment. A module docstring is a string, and it is
    // handled as one - which is why it must be in `strings` and not faked here.
    blockComments: [],
    strings: PYTHON_STRINGS,
    indentationIsSignificant: true,
    identifierExtras: ['_'],
  },
  java: {
    lineComments: ['//'],
    blockComments: [{ open: '/*', close: '*/' }],
    strings: [
      // Java 15+ text blocks, before the single quote form for the same
      // shared-prefix reason as Python.
      { open: '"""', close: '"""', escapes: true, multiline: true },
      ...C_LIKE_STRINGS,
    ],
    indentationIsSignificant: false,
    identifierExtras: ['$', '_'],
  },
  csharp: {
    lineComments: ['//'],
    blockComments: [{ open: '/*', close: '*/' }],
    strings: [
      // Verbatim strings do NOT honour backslash escapes - `@"C:\path"` is a real
      // path, not an escape sequence. Getting this wrong swallows the rest of the
      // file, which is why the format-core scanner refuses them outright rather
      // than guessing.
      { open: '@"', close: '"', escapes: false, multiline: true },
      ...C_LIKE_STRINGS,
    ],
    indentationIsSignificant: false,
    identifierExtras: ['_'],
  },
  php: {
    lineComments: ['//', '#'],
    blockComments: [{ open: '/*', close: '*/' }],
    strings: C_LIKE_STRINGS,
    indentationIsSignificant: false,
    identifierExtras: ['$', '_'],
  },
  html: {
    lineComments: [],
    blockComments: [{ open: '<!--', close: '-->' }],
    strings: C_LIKE_STRINGS,
    indentationIsSignificant: false,
    identifierExtras: ['-', '_'],
  },
  css: {
    lineComments: [],
    blockComments: [{ open: '/*', close: '*/' }],
    strings: C_LIKE_STRINGS,
    indentationIsSignificant: false,
    identifierExtras: ['-', '_'],
  },
  json: {
    // Strict JSON has no comments, and the editor is configured to say so (see
    // monaco-config.ts). Claiming it did would hide a real error.
    lineComments: [],
    blockComments: [],
    strings: [{ open: '"', close: '"', escapes: true, multiline: false }],
    indentationIsSignificant: false,
    identifierExtras: ['_'],
  },
  markdown: {
    // Prose. An HTML comment is the only thing that hides content, and `#` starts a
    // heading rather than a comment - treating it as one would blank every heading.
    lineComments: [],
    blockComments: [{ open: '<!--', close: '-->' }],
    strings: [],
    indentationIsSignificant: true,
    identifierExtras: ['-', '_'],
  },
  svg: {
    lineComments: [],
    blockComments: [{ open: '<!--', close: '-->' }],
    strings: C_LIKE_STRINGS,
    indentationIsSignificant: false,
    identifierExtras: ['-', '_', ':'],
  },
};

/** Syntax facts for a language id, or null when the id is not one we describe. */
export function syntaxFor(languageId: string): LanguageSyntax | null {
  return (SYNTAX as Record<string, LanguageSyntax>)[languageId] ?? null;
}

export function isKnownLanguage(languageId: string): languageId is KnownLanguageId {
  return languageId in SYNTAX;
}

/**
 * Replace every comment and string BODY with spaces, preserving line structure.
 *
 * The result has exactly the same length and the same newline positions as the
 * input, so a line number or a column offset computed against it is valid against
 * the original. Every caller depends on that: they mask, then run a regex, then
 * report the position they found.
 *
 * An unknown language is returned unchanged rather than masked with C-like rules.
 * Guessing would blank `#` comments in a language where `#` means something else -
 * and returning the input means a caller degrades to "matches too much" rather
 * than "silently matches the wrong thing".
 */
export function maskCommentsAndStrings(languageId: string, code: string): string {
  const syntax = syntaxFor(languageId);
  if (!syntax) return code;

  // Sorted longest-first so a delimiter that is a prefix of another cannot win.
  // `#` before `//` would be harmless, but `"` before `"""` is the Python bug.
  const strings = [...syntax.strings].sort((a, b) => b.open.length - a.open.length);
  const lineComments = [...syntax.lineComments].sort((a, b) => b.length - a.length);
  const blockComments = [...syntax.blockComments].sort((a, b) => b.open.length - a.open.length);

  let out = '';
  let index = 0;

  /** Spaces for `text`, but real newlines stay newlines. */
  const blank = (text: string): string => text.replace(/[^\n]/g, ' ');

  const startsWith = (token: string): boolean => code.startsWith(token, index);

  while (index < code.length) {
    let matched = false;

    for (const comment of lineComments) {
      if (!startsWith(comment)) continue;
      const newline = code.indexOf('\n', index);
      const end = newline === -1 ? code.length : newline;
      out += blank(code.slice(index, end));
      index = end;
      matched = true;
      break;
    }
    if (matched) continue;

    for (const comment of blockComments) {
      if (!startsWith(comment.open)) continue;
      const closeAt = code.indexOf(comment.close, index + comment.open.length);
      // An unterminated block comment runs to end of file, which is what the
      // compiler would also conclude.
      const end = closeAt === -1 ? code.length : closeAt + comment.close.length;
      out += blank(code.slice(index, end));
      index = end;
      matched = true;
      break;
    }
    if (matched) continue;

    for (const string of strings) {
      if (!startsWith(string.open)) continue;

      // The opening delimiter itself is preserved, so a caller can still see that
      // a string was here - `x = ""` masks to `x = ""`, not to `x =   `. That
      // keeps the token structure scannable.
      out += string.open;
      let cursor = index + string.open.length;
      let escaped = false;
      let closed = false;

      while (cursor < code.length) {
        const char = code[cursor];

        if (escaped) {
          escaped = false;
          out += char === '\n' ? '\n' : ' ';
          cursor += 1;
          continue;
        }

        if (string.escapes && char === '\\') {
          escaped = true;
          out += ' ';
          cursor += 1;
          continue;
        }

        if (code.startsWith(string.close, cursor)) {
          out += string.close;
          cursor += string.close.length;
          closed = true;
          break;
        }

        // A single-line string cannot cross a newline. Stopping here matters: it
        // stops one unterminated quote from blanking the entire rest of the file
        // and hiding every symbol below it.
        if (char === '\n' && !string.multiline) {
          out += '\n';
          cursor += 1;
          closed = true;
          break;
        }

        out += char === '\n' ? '\n' : ' ';
        cursor += 1;
      }

      if (!closed) {
        /* ran to end of file; already blanked */
      }

      index = cursor;
      matched = true;
      break;
    }
    if (matched) continue;

    out += code[index];
    index += 1;
  }

  return out;
}

/**
 * A regex character class for this language's identifiers.
 *
 * Search uses it for whole-word boundaries: `$name` in PHP and `my-class` in CSS
 * are single words, and a `\b` built for JavaScript splits both.
 */
export function identifierPattern(languageId: string): string {
  const syntax = syntaxFor(languageId);
  const extras = syntax?.identifierExtras ?? ['_'];
  const escaped = extras.map(character => character.replace(/[\\\]^-]/g, '\\$&')).join('');
  return `[A-Za-z0-9${escaped}]`;
}
