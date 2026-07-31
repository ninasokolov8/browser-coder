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

export interface LoadedLanguage extends LanguageConfig {
  starters: Record<string, string>;
  keywords: Record<string, KeywordEntry>;
  // Optional Hebrew translations of `keywords` (explanation only - type,
  // keyword name, and example always stay in English). Safe to be empty if
  // languages/<id>/keywords_he.json doesn't exist for this language yet.
  keywordsHe: Record<string, KeywordEntry>;
}

// What getKeywordExplanation() actually returns: an English KeywordEntry,
// with `explanation` swapped for the Hebrew translation (and `rtl: true`)
// when the UI language is Hebrew AND a translation exists for that keyword.
// Falls back to the English explanation (rtl: false) otherwise - keeps the
// popup fail-safe if a keywords_he.json file or a specific entry is missing.
export interface ResolvedKeywordEntry extends KeywordEntry {
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
};
