/**
 * Adapter registry.
 *
 * The point of this file is what is NOT in it: no language-specific behaviour.
 * Adding a language means adding an adapter module and one entry here. The
 * pipeline, the HTTP routes, the session layer and the process runner never learn
 * its name.
 *
 * That is the extensibility requirement from section 2.5 - "adding a language or
 * version must not require new switches throughout the core" - made structural.
 * The pre-refactor code had six `switch (language)` statements plus a hardcoded
 * extension map, so a seventh language meant editing the core in seven places.
 */

import { csharpAdapter } from './adapters/csharp.mjs';
import { javaAdapter } from './adapters/java.mjs';
import { javascriptAdapter } from './adapters/javascript.mjs';
import { phpAdapter } from './adapters/php.mjs';
import { pythonAdapter } from './adapters/python.mjs';
import { typescriptAdapter } from './adapters/typescript.mjs';

const ADAPTERS = new Map([
  [javascriptAdapter.id, javascriptAdapter],
  [typescriptAdapter.id, typescriptAdapter],
  [pythonAdapter.id, pythonAdapter],
  [javaAdapter.id, javaAdapter],
  [phpAdapter.id, phpAdapter],
  [csharpAdapter.id, csharpAdapter],
]);

/** @returns {import('./adapter-kit.mjs').LanguageAdapter | null} */
export function getAdapter(languageId) {
  return ADAPTERS.get(languageId) || null;
}
