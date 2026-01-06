/**
 * i18n Index - Export all translations
 */

import { en } from './en.mjs';
import { he } from './he.mjs';

export const translations = { en, he };

export function getTranslation(lang = 'en') {
  return translations[lang] || translations.en;
}

export function formatCategory(category, lang = 'en') {
  const t = getTranslation(lang);
  return t.categories[category] || category.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export { en, he };
