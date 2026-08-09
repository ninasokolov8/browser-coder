/**
 * Turning an error message into something a beginner can act on.
 *
 * ## Why this is worth building
 *
 * The IDE shows the runtime's own message. Those are written for professionals, and
 * the education research on this is unusually direct: an enhanced-error-message
 * intervention across 200 CS1 students cut total errors by 32% (109 average errors per
 * student against 132 in the control group), and the readability work names the
 * specific failures - length, jargon, sentence structure, vocabulary.
 *
 * A student who reads `NameError: name 'y' is not defined` and does not already know
 * what a "name" is in Python has been told nothing. The traceback is still shown - they
 * have to learn to read it eventually - with the explanation underneath it.
 *
 * ## Why the key is extracted rather than matched
 *
 * The obvious implementation is to search the message for each known error string. That
 * is quadratic in the size of the dictionary, and worse, it matches substrings: an entry
 * for `TypeError` would fire on `NotATypeError`, and one for `error` would fire on
 * everything. So each language gets ONE deterministic rule that pulls a single key out
 * of the message, and the key is looked up exactly.
 *
 * Every rule here is written against the message strings
 * `src/diagnostics/compiler-output.ts` really produces - the fixtures in
 * `tests/unit/compiler-output.test.ts`, captured from the production image. A rule
 * written against a remembered format matches nothing, and a lookup that never hits
 * looks exactly like a language with no explanations.
 *
 * Pure: no DOM, no Monaco, no language loader. Tested in node.
 */

/** What the lookup returns, restated so this module imports nothing. */
import { t } from '../i18n/index.ts';

export interface ErrorHelp {
  readonly explanation: string;
  readonly cause?: string;
  readonly example?: string;
  readonly type?: string;
  readonly rtl?: boolean;
}

/**
 * Python and JavaScript both name the exception class first: `NameError: …`.
 *
 * Anchored at the start and required to look like a class name, so a message that
 * merely mentions an error type in prose does not match. Python's dotted form
 * (`json.decoder.JSONDecodeError`) keeps only the last segment, because that is what
 * the student sees in the traceback's final line and what a dictionary is keyed by.
 *
 * The optional bracket covers node's `Error [ERR_MODULE_NOT_FOUND]: …`, so a dictionary
 * that only has a general `Error` entry still says something when it has no entry for
 * the specific code.
 */
function exceptionClassKey(message: string): string | null {
  const match = message.match(/^\s*(?:[A-Za-z_][\w.]*\.)?([A-Z][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*:/);
  return match ? match[1] : null;
}

/**
 * An exception class named ANYWHERE in the message, with its package or namespace
 * dropped.
 *
 * Both runtimes bury it: the JVM writes
 * `Exception in thread "main" java.lang.NullPointerException: …` and .NET writes
 * `Unhandled exception. System.NullReferenceException: …`. Neither starts with the
 * class, so the anchored rule above cannot see it and a dictionary keyed by the class
 * would be dead for every runtime error.
 */
function qualifiedExceptionKey(message: string): string | null {
  const match = message.match(
    /(?:^|[\s.])(?:[A-Za-z][\w.]*\.)?([A-Z][A-Za-z0-9_]*(?:Exception|Error))\b/,
  );
  return match ? match[1] : null;
}

/**
 * Java, two shapes in one language.
 *
 * `javac` reports a PHRASE (`cannot find symbol`, `';' expected`), while the JVM
 * reports an exception class. Both are keys; the phrase is normalised so a dictionary
 * does not need an entry per quoted token or per variable name.
 */
function javaKey(message: string): string | null {
  const exception = qualifiedExceptionKey(message);
  if (exception) return exception;

  const text = message.trim();
  if (text.length === 0) return null;

  // `';' expected`, `class, interface, enum, or record expected` -> `<token> expected`
  // collapses to one entry, because the advice is the same whichever token is missing.
  if (/\bexpected$/.test(text)) {
    return /^'.+' expected$/.test(text) ? "'<token>' expected" : text;
  }

  // javac names the offending identifier inside the sentence, so the message differs
  // for every variable. The identifier is removed to leave one key for one problem -
  // without this, an entry could only ever match the one variable name it was written
  // for, and would be dead for every real program.
  const uninitialised = text.match(/^variable \w+ (might not have been initialized)$/);
  if (uninitialised) return `variable ${uninitialised[1]}`;

  return text;
}

/**
 * C# and TypeScript both carry a stable numeric code, which is the ideal key: it does
 * not move between versions and it is what a student pastes into a search engine.
 */
function codeKey(message: string, pattern: RegExp): string | null {
  const match = message.match(pattern);
  return match ? match[1] : null;
}

/**
 * PHP names a severity and then a category.
 *
 * `PHP Parse error:  syntax error, unexpected token "echo", … in main.php on line 3`
 * reaches this as `Parse error: syntax error, unexpected token "echo", …` - the parser
 * drops the `PHP ` prefix and the ` in file on line N` suffix but KEEPS the severity
 * word, which was measured rather than assumed. The severity is stripped here because
 * it says how bad the error is, not what it is, and a dictionary keyed on
 * `Parse error: syntax error` would need one entry per severity for the same advice.
 */
function phpKey(message: string): Array<string | null> {
  const withoutSeverity = message
    .trim()
    .replace(/^(?:PHP\s+)?(?:Parse error|Fatal error|Warning|Notice|Deprecated|Recoverable fatal error)\s*:\s*/i, '');

  // `Fatal error: Uncaught Error: Call to undefined function foo()` nests two things:
  // the exception CLASS and the specific phrase. The phrase is the useful one - almost
  // every fatal PHP error is an `Error`, so keying on the class alone would give one
  // answer for a dozen different mistakes - so the class is kept as a fallback and
  // tried last.
  const uncaught = withoutSeverity.match(/^Uncaught\s+(?:\\)?([A-Za-z_][\w\\]*)\s*:\s*/);
  const className = uncaught
    ? uncaught[1].split('\\')[uncaught[1].split('\\').length - 1]
    : null;

  const text = (uncaught ? withoutSeverity.slice(uncaught[0].length) : withoutSeverity).trim();

  let phrase: string | null = null;
  if (/^syntax error/i.test(text)) phrase = 'syntax error';
  else if (/^Undefined variable/i.test(text)) phrase = 'Undefined variable';
  else if (/^Undefined (array key|index|offset)/i.test(text)) phrase = 'Undefined array key';
  else if (/^Undefined property/i.test(text)) phrase = 'Undefined property';
  else if (/^Call to undefined method/i.test(text)) phrase = 'Undefined method';
  else if (/^Call to undefined function/i.test(text)) phrase = 'Call to undefined function';
  else if (/^Cannot modify header information/i.test(text)) phrase = 'Cannot modify header information';
  else if (/Division by zero/i.test(text)) phrase = 'DivisionByZeroError';

  return [phrase, className];
}

/**
 * Node names some failures by a CODE rather than by an exception class:
 * `Error [ERR_MODULE_NOT_FOUND]: Cannot find package …` and
 * `Error: ENOENT: no such file or directory, open 'x'`.
 *
 * `Error` is a true answer for both and a useless one, so the code is preferred.
 */
function nodeCodeKey(message: string): string | null {
  const bracketed = message.match(/\[(ERR_[A-Z0-9_]+)\]/);
  if (bracketed) return bracketed[1];

  const errno = message.match(/^\s*(?:[A-Za-z]*Error:\s*)?(E[A-Z]{3,})\b/);
  return errno ? errno[1] : null;
}

/**
 * One rule per language, returning candidates from most specific to least.
 *
 * A list rather than a single key because the useful explanation is often more
 * specific than the class: `TypeError: Cannot read properties of undefined` is the most
 * common mistake a JavaScript beginner makes and deserves its own answer, while a bare
 * `TypeError` still needs one for everything else. The resolver takes the first
 * candidate the dictionary actually has, so a language can be as specific as its data
 * allows and no more.
 */
const EXTRACTORS: Record<string, (message: string) => Array<string | null>> = {
  python: message => [exceptionClassKey(message)],
  javascript: message => [nodeCodeKey(message), exceptionClassKey(message)],
  typescript: message => [
    codeKey(message, /\b(TS\d{3,5})\b/),
    nodeCodeKey(message),
    exceptionClassKey(message),
  ],
  // A compiler code when the build failed, an exception class when the program ran and
  // then died. C# produces both and they never appear together.
  csharp: message => [codeKey(message, /\b(CS\d{4})\b/), qualifiedExceptionKey(message)],
  java: message => [javaKey(message)],
  php: phpKey,
};

/**
 * Every key worth trying for one parsed message, most specific first.
 *
 * Empty rather than a guess: a wrong explanation is worse than no explanation, in
 * exactly the way a marker on the wrong line is worse than no marker.
 */
export function errorKeyCandidates(languageId: string, message: string): string[] {
  if (!message || !message.trim()) return [];
  const extract = EXTRACTORS[languageId];
  if (!extract) return [];

  try {
    const seen = new Set<string>();
    for (const candidate of extract(message)) {
      const key = candidate?.trim();
      if (key) seen.add(key);
    }
    return [...seen];
  } catch {
    // An extractor must never be able to break a run's reporting.
    return [];
  }
}

/** The primary key: the most specific one an extractor could name. */
export function errorKeyFrom(languageId: string, message: string): string | null {
  return errorKeyCandidates(languageId, message)[0] ?? null;
}

/**
 * Does `message` begin with `key` at a word boundary?
 *
 * The boundary matters: a dictionary entry for `Error` must match
 * `Error: something` and must NOT match `ErrorFoo: something`, which is a different
 * error entirely.
 */
function beginsWithKey(message: string, key: string): boolean {
  if (!message.startsWith(key)) return false;
  const next = message.charAt(key.length);
  return next === '' || next === ':' || next === ' ';
}

/**
 * Pick the entry to show, given what the dictionary actually contains.
 *
 * The extractor decides first, then a prefix match REFINES its answer:
 *
 *  1. The first extractor candidate the dictionary has. The candidates are already
 *     ordered most-specific-first, which is what makes `ERR_MODULE_NOT_FOUND` win over
 *     the `Error` that node also prints on that line.
 *  2. A longer dictionary key that both starts with that answer and matches the start
 *     of the message. This is what lets `RangeError: Maximum call stack size exceeded`
 *     have its own entry while a bare `RangeError` keeps the general one.
 *  3. Only if the extractor found nothing usable, the longest dictionary key the
 *     message begins with - which covers the messages that carry a detail after the
 *     key, like javac's `incompatible types: String cannot be converted to int`.
 *
 * Doing the prefix match FIRST was wrong and the data caught it: `Error [ERR_x]: …`
 * begins with the dictionary's general `Error`, so every specific node code resolved to
 * the least useful entry in the file.
 *
 * `availableKeys` is passed in rather than imported so this stays pure - the loader is
 * full of Vite globs and cannot be loaded by node.
 */
export function selectErrorKey(
  languageId: string,
  message: string,
  availableKeys: Iterable<string>,
): string | null {
  if (!message || !message.trim()) return null;
  const text = message.trim();
  const keys = [...availableKeys];
  const known = new Set(keys);

  let base: string | null = null;
  for (const candidate of errorKeyCandidates(languageId, text)) {
    if (known.has(candidate)) {
      base = candidate;
      break;
    }
  }

  let best = base;
  for (const key of keys) {
    if (!beginsWithKey(text, key)) continue;
    // Without a base, any prefix match will do; with one, only a refinement of it.
    if (base && !key.startsWith(base)) continue;
    if (!best || key.length > best.length) best = key;
  }

  return best;
}

/**
 * The lines of the explanation block, in order, ready to be escaped and printed.
 *
 * Returned as data rather than as markup so the caller decides how to render it - the
 * output panel wants HTML with its semantic classes, and a test wants text. Keeping the
 * markup out of here is also what lets this be tested in node.
 */
export interface ErrorHelpBlock {
  readonly heading: string;
  readonly explanation: string;
  readonly cause: string | null;
  readonly example: string | null;
  readonly rtl: boolean;
}

/**
 * Lay out one explanation.
 *
 * The heading names the error so the block is obviously ABOUT the traceback above it
 * rather than a second, unrelated failure - which is how a student reads two paragraphs
 * of red text.
 */
export function buildErrorHelpBlock(key: string, help: ErrorHelp): ErrorHelpBlock {
  const label = help.type ? `${key} — ${help.type}` : key;
  return {
    heading: label,
    explanation: help.explanation.trim(),
    cause: help.cause?.trim() ? help.cause.trim() : null,
    example: help.example?.trim() ? help.example.trim() : null,
    rtl: help.rtl === true,
  };
}

/**
 * Lay out an editor diagnostic as short, named sections.
 *
 * Monaco's marker hover accepts plain text, not a custom card. Section headings and
 * whitespace therefore carry the visual hierarchy: the runtime's wording is the
 * error, the teaching text explains it, and an example can no longer be mistaken for
 * another instruction or another failure.
 */
export function formatErrorMarker(message: string, help?: ErrorHelpBlock): string {
  const labels = {
    error: t('error.marker.error'),
    meaning: t('error.marker.meaning'),
    cause: t('error.marker.cause'),
    example: t('error.marker.example'),
  };

  const sections = [`${labels.error}\n${message.trim()}`];
  if (!help) return sections[0];

  sections.push(`${labels.meaning}\n${help.explanation}`);
  if (help.cause) sections.push(`${labels.cause}\n${help.cause}`);
  if (help.example) sections.push(`${labels.example}\n${help.example}`);
  return sections.join('\n\n');
}
