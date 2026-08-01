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

export interface RunnerConfig {
  command: string;
  args?: string[];
  stdin?: boolean;
  tempFile?: boolean;
  compile?: boolean;
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
  runner: RunnerConfig;
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
