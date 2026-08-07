// Language configuration types for the Web IDE

export interface VersionConfig {
  id: string;
  name: string;
  default?: boolean;
  // Monaco-specific settings
  monacoTarget?: string;
  strict?: boolean;
  // Runner-specific settings
  sourceLevel?: string;
}

/**
 * What the IDE may offer for a language.
 *
 * ## Why this is data and not four lists in four files
 *
 * It used to be four: `DEBUGGABLE_LANGUAGES` in editor-commands, `TAUGHT_LANGUAGES` in
 * hover-help, `SELECTION_RUNNABLE_LANGUAGES` in selection-run, and `LANGUAGE_ICONS` in
 * this file. Every one of them was a hand-maintained mirror of a fact that belongs to
 * the language, and adding a language meant finding all four - which is precisely the
 * kind of edit that gets three of them.
 *
 * Debugging is the case that proves it: the server decides whether a language can be
 * debugged (`supportsDebug` on its adapter), and the client had its own copy of that
 * list. The two agreeing was a matter of somebody remembering. Now both read the same
 * `config.json`, and `tests/contract/adapter-manifest.test.mjs` fails if they diverge.
 *
 * Every field is optional and defaults to false, so a new language gets nothing until
 * somebody says it works - which is the right default for a promise to a student.
 */
export interface LanguageCapabilities {
  /** The Debug button is offered. Must match the server adapter's `supportsDebug`. */
  debug?: boolean;
  /** Hover explains this language's keywords and operators (languages/<id>/keywords.json). */
  taughtKeywords?: boolean;
  /**
   * "Run selection" is offered.
   *
   * False for Java on purpose: its adapter needs a file declaring a class with `main`,
   * so a selection of statements can never compile, and offering it would produce
   * "class, interface, or enum expected" for a gesture that looks reasonable.
   */
  runSelection?: boolean;
}

export interface LanguageConfig {
  id: string;
  name: string;
  /** Primary extension. Used when the IDE names a new file. */
  extension: string;
  /**
   * Additional extensions that mean the same language.
   *
   * `extension` alone cannot express that `.htm` is HTML, `.mjs` is JavaScript and
   * `.markdown` is Markdown - so an imported or host-supplied file with any of
   * those names fell through to the default language and was stored, coloured and
   * executed as something else.
   */
  extensions?: string[];
  monacoLanguage: string;
  icon?: string; // Emoji icon for file tree
  versions: VersionConfig[];
  /** What the IDE may offer. Absent means "nothing beyond running it". */
  capabilities?: LanguageCapabilities;
}

export interface KeywordEntry {
  explanation: string;
  example: string;
  // Optional category tag (e.g. "control_flow", "access_modifier") shown as a
  // small badge in the "Explain this keyword" popup, when present.
  type?: string;
}

/**
 * What one error means, in words a beginner can act on.
 *
 * A superset of `KeywordEntry` because the two are rendered by the same code and
 * translated by the same pipeline - but an error needs one thing a keyword does not:
 * the usual CAUSE. "NameError means Python could not find that name" tells a student
 * nothing they cannot read off the message; "you probably misspelled it, or used it
 * before the line that creates it" is the sentence that unblocks them.
 */
export interface ErrorEntry extends KeywordEntry {
  /** One sentence: why this usually happens to a beginner. */
  cause?: string;
}

export interface LoadedLanguage extends LanguageConfig {
  starters: Record<string, string>;
  keywords: Record<string, KeywordEntry>;
  // Optional Hebrew translations of `keywords` (explanation only - type,
  // keyword name, and example always stay in English). Safe to be empty if
  // languages/<id>/keywords_he.json doesn't exist for this language yet.
  keywordsHe: Record<string, KeywordEntry>;
  /**
   * Curated explanations for the errors this language produces, keyed by the
   * identifier `errorKeyFrom` extracts from real compiler or runtime output.
   *
   * Same optionality as keywords: a language with no errors.json simply explains
   * nothing, and the raw message is still shown.
   */
  errors: Record<string, ErrorEntry>;
  errorsHe: Record<string, ErrorEntry>;
}

// What getKeywordExplanation() actually returns: an English KeywordEntry,
// with `explanation` swapped for the Hebrew translation (and `rtl: true`)
// when the UI language is Hebrew AND a translation exists for that keyword.
// Falls back to the English explanation (rtl: false) otherwise - keeps the
// popup fail-safe if a keywords_he.json file or a specific entry is missing.
export interface ResolvedKeywordEntry extends KeywordEntry {
  rtl: boolean;
}

/** Same idea for an error: the entry with Hebrew swapped in when there is one. */
export interface ResolvedErrorEntry extends ErrorEntry {
  rtl: boolean;
}

export type LanguageId = string;

// Default icons for common languages
export const LANGUAGE_ICONS: Record<string, string> = {
  javascript: '🟨',
  typescript: '🔷',
  python: '🐍',
  java: '☕',
  php: '🐘',
  csharp: '🟦',
  html: '🌐',
  css: '🎨',
  svg: '🖼️',
  json: '⚙️',
  markdown: '📝',
  text: '📄',
  asset: '🖼️',
};
