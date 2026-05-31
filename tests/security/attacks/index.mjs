/**
 * Security Attack Vectors - Central Index
 *
 * This module exports all language-specific security tests.
 * Each language file contains tests with educational explanations
 * of how hackers use each attack vector.
 *
 * Structure:
 * - javascript.mjs - JavaScript/Node.js attack vectors
 * - typescript.mjs - TypeScript-specific attack vectors
 * - python.mjs - Python attack vectors
 * - php.mjs - PHP attack vectors
 * - java.mjs - Java attack vectors
 * - csharp.mjs - C# / .NET attack vectors
 */

export { javascriptTests } from './javascript.mjs';
export { typescriptTests } from './typescript.mjs';
export { pythonTests } from './python.mjs';
export { phpTests } from './php.mjs';
export { javaTests } from './java.mjs';
export { csharpTests } from './csharp.mjs';

import { javascriptTests } from './javascript.mjs';
import { typescriptTests } from './typescript.mjs';
import { pythonTests } from './python.mjs';
import { phpTests } from './php.mjs';
import { javaTests } from './java.mjs';
import { csharpTests } from './csharp.mjs';

/**
 * Get all tests combined with language metadata
 */
export function getAllTests() {
  return [
    ...javascriptTests.map(t => ({ ...t, language: 'javascript' })),
    ...typescriptTests.map(t => ({ ...t, language: 'typescript' })),
    ...pythonTests.map(t => ({ ...t, language: 'python' })),
    ...phpTests.map(t => ({ ...t, language: 'php' })),
    ...javaTests.map(t => ({ ...t, language: 'java' })),
    ...csharpTests.map(t => ({ ...t, language: 'csharp' })),
  ];
}

/**
 * Get tests by language
 */
export function getTestsByLanguage(language) {
  const testMap = {
    javascript: javascriptTests,
    typescript: typescriptTests,
    python: pythonTests,
    php: phpTests,
    java: javaTests,
    csharp: csharpTests,
  };
  return testMap[language] || [];
}

/**
 * Get tests by category across all languages
 */
export function getTestsByCategory(category) {
  return getAllTests().filter(t => t.category === category);
}

/**
 * Get unique categories across all tests
 */
export function getCategories() {
  const categories = new Set();
  getAllTests().forEach(t => categories.add(t.category));
  return Array.from(categories).sort();
}

/**
 * Summary statistics
 */
export function getTestStats() {
  return {
    javascript: { total: javascriptTests.length, blocked: javascriptTests.filter(t => t.expectBlocked).length },
    typescript: { total: typescriptTests.length, blocked: typescriptTests.filter(t => t.expectBlocked).length },
    python: { total: pythonTests.length, blocked: pythonTests.filter(t => t.expectBlocked).length },
    php: { total: phpTests.length, blocked: phpTests.filter(t => t.expectBlocked).length },
    java: { total: javaTests.length, blocked: javaTests.filter(t => t.expectBlocked).length },
    csharp: { total: csharpTests.length, blocked: csharpTests.filter(t => t.expectBlocked).length },
    total:
      javascriptTests.length +
      typescriptTests.length +
      pythonTests.length +
      phpTests.length +
      javaTests.length +
      csharpTests.length,
  };
}
