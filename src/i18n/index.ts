/**
 * i18n - Internationalization Module
 * Simple, fast, scalable language support
 */

import english from './locales/en.json' with { type: 'json' };
import hebrew from './locales/he.json' with { type: 'json' };

export interface Translations {
  [key: string]: string;
}

export interface LanguageConfig {
  code: string;
  name: string;
  nativeName: string;
  dir: 'ltr' | 'rtl';
}

// Supported languages
export const languages: LanguageConfig[] = [
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', dir: 'rtl' },
];

// Current state
const DEFAULT_LANGUAGE = 'en';
const LANGUAGE_STORAGE_KEY = 'language';

let currentLang: string = DEFAULT_LANGUAGE;
const fallbackTranslations: Translations = english;
const localeTranslations: Record<string, Translations> = {
  en: english,
  he: hebrew,
};

function readSavedLanguage(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveLanguage(lang: string): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Language still changes for this session when storage is unavailable.
  }
}

/**
 * Initialize i18n with the saved preference, then the browser language.
 * Embedded callers can override this with the explicit `uilang` URL parameter;
 * the editor itself remains LTR independently of the surrounding UI language.
 */
export async function initI18n(): Promise<void> {
  const saved = readSavedLanguage();
  if (saved && languages.some(language => language.code === saved)) {
    currentLang = saved;
  } else {
    const browserLang = navigator.language.split('-')[0];
    if (languages.some(language => language.code === browserLang)) {
      currentLang = browserLang;
    }
  }

  applyDirection();
  translatePage();
}

/**
 * Change language
 */
export async function setLanguage(lang: string): Promise<void> {
  if (!languages.some(l => l.code === lang)) {
    console.warn(`Language ${lang} not supported`);
    return;
  }

  currentLang = lang;
  saveLanguage(lang);
  applyDirection();
  translatePage();
}

/**
 * Get current language code
 */
export function getLanguage(): string {
  return currentLang;
}

/**
 * Get current language config
 */
export function getLanguageConfig(): LanguageConfig {
  return languages.find(l => l.code === currentLang) || languages[0];
}

/**
 * Translate a key
 */
export function translateInLanguage(
  lang: string,
  key: string,
  params?: Record<string, string | number>,
): string {
  const locale = localeTranslations[lang];
  return applyTranslationParams(locale?.[key] ?? fallbackTranslations[key] ?? key, params);
}

export function t(key: string, params?: Record<string, string | number>): string {
  return translateInLanguage(currentLang, key, params);
}

function applyTranslationParams(
  text: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return text;
  let result = text;
  for (const [key, value] of Object.entries(params)) {
    result = result.split(`{{${key}}}`).join(String(value));
  }
  return result;
}

/** Translate a count with the locale's own plural category. */
export function tn(
  key: string,
  count: number,
  params: Record<string, string | number> = {},
): string {
  const category = new Intl.PluralRules(currentLang).select(count);
  const candidates = [`${key}.${category}`, `${key}.other`, key];
  const locale = localeTranslations[currentLang] ?? fallbackTranslations;
  const selected = candidates.find(candidate =>
    locale[candidate] !== undefined || fallbackTranslations[candidate] !== undefined,
  ) ?? key;
  return t(selected, { count, ...params });
}

/**
 * Apply RTL/LTR direction.
 *
 * Product decision: every UI element stays in the exact same position as
 * English (activity bar, sidebar, editor, controls, tree indentation -
 * nothing moves) when Hebrew is selected. So this deliberately does NOT set
 * `dir`/`direction` on <html> or <body>, and does NOT add a `.rtl` class
 * that CSS uses to reposition layout - only `lang` is updated here (useful
 * for accessibility/spellcheck). Individual translated text elements get
 * their own `dir` set directly in translatePage() below, so only the text
 * itself becomes right-to-left, never the surrounding layout.
 */
function applyDirection(): void {
  const config = getLanguageConfig();
  document.documentElement.lang = config.code;
}

/**
 * Translate all elements with data-i18n attribute
 */
function translatePage(): void {
  const dir = getLanguageConfig().dir;

  // Translate text content. `dir` is set directly on each translated
  // element (not inherited from an ancestor) so only that element's own
  // text flows right-to-left - its position within the page layout is
  // completely unaffected.
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')!;
    el.textContent = t(key);
    (el as HTMLElement).dir = dir;
  });

  // Translate placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder')!;
    (el as HTMLInputElement).placeholder = t(key);
    (el as HTMLElement).dir = dir;
  });

  // Translate titles (tooltips)
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title')!;
    el.setAttribute('title', t(key));
  });

  // Translate accessible names independently from visible text. Icon-only
  // controls otherwise remain English to screen-reader users.
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria-label')!;
    el.setAttribute('aria-label', t(key));
  });

  // Dispatch event for dynamic content
  window.dispatchEvent(new CustomEvent('languageChanged', {
    detail: { lang: currentLang }
  }));
}
