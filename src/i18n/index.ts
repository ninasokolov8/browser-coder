/**
 * i18n - Internationalization Module
 * Simple, fast, scalable language support
 */

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
let currentLang: string = 'en';
let translations: Translations = {};
let loadedLanguages: Map<string, Translations> = new Map();

/**
 * Load translations for a language
 */
async function loadTranslations(lang: string): Promise<Translations> {
  // Return cached if available
  if (loadedLanguages.has(lang)) {
    return loadedLanguages.get(lang)!;
  }

  try {
    const module = await import(`./locales/${lang}.json`);
    const trans = module.default || module;
    loadedLanguages.set(lang, trans);
    return trans;
  } catch (e) {
    console.warn(`Failed to load translations for ${lang}, falling back to English`);
    if (lang !== 'en') {
      return loadTranslations('en');
    }
    return {};
  }
}

/**
 * Initialize i18n with saved or detected language.
 * In embedded mode (embed=1), always force English/LTR for the code editor.
 */
export async function initI18n(): Promise<void> {
  // In embedded mode, always use English - code editors should be LTR
  const params = new URLSearchParams(window.location.search);
  const isEmbedded = params.get('embed') === '1';
  
  if (isEmbedded) {
    currentLang = 'en';
  } else {
    // Check saved preference
    const saved = localStorage.getItem('language');
    if (saved && languages.some(l => l.code === saved)) {
      currentLang = saved;
    } else {
      // Auto-detect from browser
      const browserLang = navigator.language.split('-')[0];
      if (languages.some(l => l.code === browserLang)) {
        currentLang = browserLang;
      }
    }
  }

  translations = await loadTranslations(currentLang);
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
  localStorage.setItem('language', lang);
  translations = await loadTranslations(lang);
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
export function t(key: string, params?: Record<string, string | number>): string {
  let text = translations[key] || key;
  
  // Replace parameters {{param}}
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
    }
  }
  
  return text;
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

  // Dispatch event for dynamic content
  window.dispatchEvent(new CustomEvent('languageChanged', { 
    detail: { lang: currentLang } 
  }));
}

/**
 * Check if current language is RTL. Only meant for deciding text
 * direction/alignment of specific content (e.g. the keyword-explain popup) -
 * never for repositioning layout.
 */
export function isRTL(): boolean {
  return getLanguageConfig().dir === 'rtl';
}
