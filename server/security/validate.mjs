/**
 * Pre-execution policy check.
 *
 * MOVED VERBATIM from server.mjs (lines 624-652 of the pre-refactor file), with
 * only the two imports added.
 */

import SECURITY from './patterns.mjs';
import { stripPythonCommentsAndStrings } from './python-source.mjs';

/**
 * Validates code for dangerous patterns
 * @returns {{ safe: boolean, reason?: string, matched?: string }}
 */
function validateCodeSecurity(language, code) {
  const patterns = SECURITY.patterns[language];
  if (!patterns) {
    return { safe: true };
  }

  // Python patterns describe code, so comments and string literals are removed
  // before matching. Every other language is still scanned as written.
  const haystack = language === 'python'
    ? stripPythonCommentsAndStrings(code)
    : code;

  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (match) {
      return {
        safe: false,
        reason: SECURITY.messages[language],
        matched: match[0],
      };
    }
  }
  
  return { safe: true };
}

export { validateCodeSecurity };
