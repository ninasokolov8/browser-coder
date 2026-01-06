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
 */

export { javascriptTests } from './javascript.mjs';
export { typescriptTests } from './typescript.mjs';
export { pythonTests } from './python.mjs';
export { phpTests } from './php.mjs';
export { javaTests } from './java.mjs';

/**
 * Get all tests combined with language metadata
 */
export function getAllTests() {
  const { javascriptTests } = require('./javascript.mjs');
  const { typescriptTests } = require('./typescript.mjs');
  const { pythonTests } = require('./python.mjs');
  const { phpTests } = require('./php.mjs');
  const { javaTests } = require('./java.mjs');

  return [
    ...javascriptTests.map(t => ({ ...t, language: 'javascript' })),
    ...typescriptTests.map(t => ({ ...t, language: 'typescript' })),
    ...pythonTests.map(t => ({ ...t, language: 'python' })),
    ...phpTests.map(t => ({ ...t, language: 'php' })),
    ...javaTests.map(t => ({ ...t, language: 'java' })),
  ];
}

/**
 * Get tests by language
 */
export function getTestsByLanguage(language) {
  const testMap = {
    javascript: () => import('./javascript.mjs').then(m => m.javascriptTests),
    typescript: () => import('./typescript.mjs').then(m => m.typescriptTests),
    python: () => import('./python.mjs').then(m => m.pythonTests),
    php: () => import('./php.mjs').then(m => m.phpTests),
    java: () => import('./java.mjs').then(m => m.javaTests),
  };
  
  return testMap[language]?.() || Promise.resolve([]);
}

/**
 * Get tests by category across all languages
 */
export async function getTestsByCategory(category) {
  const all = await Promise.all([
    import('./javascript.mjs').then(m => m.javascriptTests),
    import('./typescript.mjs').then(m => m.typescriptTests),
    import('./python.mjs').then(m => m.pythonTests),
    import('./php.mjs').then(m => m.phpTests),
    import('./java.mjs').then(m => m.javaTests),
  ]);
  
  return all.flat().filter(t => t.category === category);
}

/**
 * Get unique categories across all tests
 */
export async function getCategories() {
  const all = await Promise.all([
    import('./javascript.mjs').then(m => m.javascriptTests),
    import('./typescript.mjs').then(m => m.typescriptTests),
    import('./python.mjs').then(m => m.pythonTests),
    import('./php.mjs').then(m => m.phpTests),
    import('./java.mjs').then(m => m.javaTests),
  ]);
  
  const categories = new Set();
  all.flat().forEach(t => categories.add(t.category));
  return Array.from(categories).sort();
}

/**
 * Summary statistics
 */
export async function getTestStats() {
  const [js, ts, py, php, java] = await Promise.all([
    import('./javascript.mjs').then(m => m.javascriptTests),
    import('./typescript.mjs').then(m => m.typescriptTests),
    import('./python.mjs').then(m => m.pythonTests),
    import('./php.mjs').then(m => m.phpTests),
    import('./java.mjs').then(m => m.javaTests),
  ]);
  
  return {
    javascript: { total: js.length, blocked: js.filter(t => t.expectBlocked).length },
    typescript: { total: ts.length, blocked: ts.filter(t => t.expectBlocked).length },
    python: { total: py.length, blocked: py.filter(t => t.expectBlocked).length },
    php: { total: php.length, blocked: php.filter(t => t.expectBlocked).length },
    java: { total: java.length, blocked: java.filter(t => t.expectBlocked).length },
    total: js.length + ts.length + py.length + php.length + java.length,
  };
}
