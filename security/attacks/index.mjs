/**
 * Security Attack Vectors - Central Index
 *
 * This module exports all language-specific security tests.
 * Each language file contains tests with educational explanations
 * of how hackers use each attack vector.
 *
 * English files:
 * - javascript.mjs
 * - typescript.mjs
 * - python.mjs
 * - php.mjs
 * - java.mjs
 * - csharp.mjs
 *
 * Hebrew files:
 * - javascript_he.mjs
 * - typescript_he.mjs
 * - python_he.mjs
 * - php_he.mjs
 * - java_he.mjs
 * - csharp_he.mjs
 */

// Default/backwards-compatible exports: English attack vectors
export { javascriptTests } from './javascript.mjs';
export { typescriptTests } from './typescript.mjs';
export { pythonTests } from './python.mjs';
export { phpTests } from './php.mjs';
export { javaTests } from './java.mjs';
export { csharpTests } from './csharp.mjs';

import { javascriptTests as javascriptTestsEn } from './javascript.mjs';
import { typescriptTests as typescriptTestsEn } from './typescript.mjs';
import { pythonTests as pythonTestsEn } from './python.mjs';
import { phpTests as phpTestsEn } from './php.mjs';
import { javaTests as javaTestsEn } from './java.mjs';
import { csharpTests as csharpTestsEn } from './csharp.mjs';

import { javascriptTests as javascriptTestsHe } from './javascript_he.mjs';
import { typescriptTests as typescriptTestsHe } from './typescript_he.mjs';
import { pythonTests as pythonTestsHe } from './python_he.mjs';
import { phpTests as phpTestsHe } from './php_he.mjs';
import { javaTests as javaTestsHe } from './java_he.mjs';
import { csharpTests as csharpTestsHe } from './csharp_he.mjs';

export const SUPPORTED_ATTACK_LANGS = ['en', 'he'];

const ENGLISH_TESTS = {
  javascript: javascriptTestsEn,
  typescript: typescriptTestsEn,
  python: pythonTestsEn,
  php: phpTestsEn,
  java: javaTestsEn,
  csharp: csharpTestsEn,
};

const HEBREW_TESTS = {
  javascript: javascriptTestsHe,
  typescript: typescriptTestsHe,
  python: pythonTestsHe,
  php: phpTestsHe,
  java: javaTestsHe,
  csharp: csharpTestsHe,
};

const TESTS_BY_REPORT_LANGUAGE = {
  en: ENGLISH_TESTS,
  he: HEBREW_TESTS,
};

export function normalizeAttackLanguage(lang = 'en') {
  const normalized = String(lang || 'en').toLowerCase();
  return normalized.startsWith('he') ? 'he' : 'en';
}

/**
 * Get the attack-vector map for a report language.
 *
 * The test code/name/category/expectBlocked stay the same.
 * Only the explanation values differ in the Hebrew files.
 */
export function getSecurityTests(lang = 'en') {
  return TESTS_BY_REPORT_LANGUAGE[normalizeAttackLanguage(lang)] || ENGLISH_TESTS;
}

/**
 * Get all tests combined with language metadata.
 */
export function getAllTests(lang = 'en') {
  return Object.entries(getSecurityTests(lang)).flatMap(([language, tests]) =>
    tests.map(test => ({ ...test, language }))
  );
}

/**
 * Get tests by language.
 */
export function getTestsByLanguage(language, lang = 'en') {
  return getSecurityTests(lang)[language] || [];
}

/**
 * Get tests by category across all languages.
 */
export function getTestsByCategory(category, lang = 'en') {
  return getAllTests(lang).filter(test => test.category === category);
}

/**
 * Get unique categories across all tests.
 */
export function getCategories(lang = 'en') {
  const categories = new Set();
  getAllTests(lang).forEach(test => categories.add(test.category));
  return Array.from(categories).sort();
}

/**
 * Summary statistics.
 */
export function getTestStats(lang = 'en') {
  const tests = getSecurityTests(lang);

  const stats = Object.fromEntries(
    Object.entries(tests).map(([language, languageTests]) => [
      language,
      {
        total: languageTests.length,
        blocked: languageTests.filter(test => test.expectBlocked).length,
      },
    ])
  );

  stats.total = Object.values(tests).reduce((sum, languageTests) => sum + languageTests.length, 0);

  return stats;
}
