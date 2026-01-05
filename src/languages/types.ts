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
  extension: string;
  monacoLanguage: string;
  icon?: string; // Emoji icon for file tree
  versions: VersionConfig[];
  runner: RunnerConfig;
}

export interface LoadedLanguage extends LanguageConfig {
  starters: Record<string, string>;
}

export type LanguageId = string;

// Default icons for common languages
export const LANGUAGE_ICONS: Record<string, string> = {
  javascript: '🟨',
  typescript: '🔷',
  python: '🐍',
  java: '☕',
  php: '🐘',
};
