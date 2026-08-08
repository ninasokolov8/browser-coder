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

import { javascriptTests as javascriptTestsEn } from '../../tests/security/attacks/javascript.mjs';
import { typescriptTests as typescriptTestsEn } from '../../tests/security/attacks/typescript.mjs';
import { pythonTests as pythonTestsEn } from '../../tests/security/attacks/python.mjs';
import { phpTests as phpTestsEn } from '../../tests/security/attacks/php.mjs';
import { javaTests as javaTestsEn } from '../../tests/security/attacks/java.mjs';
import { csharpTests as csharpTestsEn } from '../../tests/security/attacks/csharp.mjs';

import { javascriptExplanations } from './javascript_he.mjs';
import { typescriptExplanations } from './typescript_he.mjs';
import { pythonExplanations } from './python_he.mjs';
import { phpExplanations } from './php_he.mjs';
import { javaExplanations } from './java_he.mjs';
import { csharpExplanations } from './csharp_he.mjs';

const ENGLISH_TESTS = {
  javascript: javascriptTestsEn,
  typescript: typescriptTestsEn,
  python: pythonTestsEn,
  php: phpTestsEn,
  java: javaTestsEn,
  csharp: csharpTestsEn,
};

const HEBREW_EXPLANATIONS = {
  javascript: javascriptExplanations,
  typescript: typescriptExplanations,
  python: pythonExplanations,
  php: phpExplanations,
  java: javaExplanations,
  csharp: csharpExplanations,
};

const HEBREW_TESTS = Object.fromEntries(
  Object.entries(ENGLISH_TESTS).map(([language, tests]) => [
    language,
    tests.map(test => ({
      ...test,
      explanation: HEBREW_EXPLANATIONS[language][test.name] ?? test.explanation,
    })),
  ]),
);

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
