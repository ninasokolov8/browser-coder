/**
 * The curated error explanations, read from disk.
 *
 * Two failure modes this guards against, and they are different:
 *
 *  - **An entry nobody can ever see.** A key the extractor cannot produce and that no
 *    real message begins with is dead weight - it looks like coverage in the file and
 *    is invisible to every student. This is the mistake the first draft of this data
 *    made four separate times (a compound JavaScript key, a Java message containing a
 *    variable name, a C# runtime exception, a PHP phrase wrapped in `Uncaught Error:`),
 *    which is why the check is mechanical rather than a promise.
 *  - **A partly translated file.** A Hebrew-speaking student would get English for
 *    exactly the errors nobody bothered with.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { errorKeyCandidates, selectErrorKey } from '../../src/features/error-help.ts';

const LANGUAGES_ROOT = resolve(import.meta.dirname, '../../languages');

const TAUGHT = ['python', 'javascript', 'typescript', 'java', 'php', 'csharp'] as const;

interface Entry {
  explanation: string;
  cause?: string;
  example?: string;
  type?: string;
}

function read(language: string, file: string): Record<string, Entry> {
  return JSON.parse(readFileSync(resolve(LANGUAGES_ROOT, language, file), 'utf8'));
}

const english = (language: string) => read(language, 'errors.json');
const hebrew = (language: string) => read(language, 'errors_he.json');

/**
 * A message a runtime could really produce for this key.
 *
 * The point is to prove the key is REACHABLE - that some plausible real message
 * resolves to it - so the shapes here mirror what the runtimes actually print.
 */
function plausibleMessage(language: string, key: string): string {
  if (language === 'csharp' && /^CS\d{4}$/.test(key)) return `error ${key}: something is wrong`;
  if (language === 'typescript' && /^TS\d+$/.test(key)) return `error ${key}: something is wrong`;
  if (language === 'php') {
    if (key === 'syntax error') return 'Parse error: syntax error, unexpected token ";"';
    if (key === 'Call to undefined function') return 'Fatal error: Uncaught Error: Call to undefined function f()';
    if (key === 'Undefined method') return 'Fatal error: Uncaught Error: Call to undefined method C::m()';
    if (key.startsWith('Undefined')) return `Warning: ${key}: $x`;
    if (key === 'Cannot modify header information') return 'Warning: Cannot modify header information - headers already sent';
    return `Fatal error: Uncaught ${key}: something is wrong`;
  }
  if (language === 'java') {
    if (/Exception$|Error$/.test(key)) return `Exception in thread "main" java.lang.${key}: oops`;
    if (key === "'<token>' expected") return "';' expected";
    if (key === 'variable might not have been initialized') return 'variable total might not have been initialized';
    return key;
  }
  if (/^ERR_[A-Z_]+$/.test(key)) return `Error [${key}]: something is wrong`;
  if (/^E[A-Z]{3,}$/.test(key)) return `Error: ${key}: something is wrong`;
  // Exception classes, and the compound keys that are a message prefix.
  return key.includes(':') ? key : `${key}: something is wrong`;
}

describe('every language has explanations', () => {
  test('and each has a useful number of them', () => {
    for (const language of TAUGHT) {
      const count = Object.keys(english(language)).length;
      assert.ok(count >= 12, `${language} has only ${count} error explanations`);
    }
  });
});

describe('no entry is unreachable', () => {
  test('every key resolves from a message a runtime could really produce', () => {
    // The check that matters. An entry the resolver can never select is invisible to
    // every student while looking like coverage in the file.
    const unreachable: string[] = [];

    for (const language of TAUGHT) {
      const keys = Object.keys(english(language));
      for (const key of keys) {
        const resolved = selectErrorKey(language, plausibleMessage(language, key), keys);
        if (resolved !== key) unreachable.push(`${language}/${key} -> ${resolved ?? 'nothing'}`);
      }
    }

    assert.deepEqual(unreachable, [], `unreachable entries:\n  ${unreachable.join('\n  ')}`);
  });

  test('every key is something an extractor or a prefix could name', () => {
    // A weaker, independent check on the same property: it must be possible to arrive
    // at the key without the resolver's prefix shortcut for at least the coded ones.
    for (const language of ['csharp', 'typescript'] as const) {
      for (const key of Object.keys(english(language))) {
        if (!/^(CS|TS)\d+$/.test(key)) continue;
        const candidates = errorKeyCandidates(language, `error ${key}: x`);
        assert.ok(candidates.includes(key), `${language}/${key} is not extractable`);
      }
    }
  });
});

describe('the entries themselves', () => {
  test('every entry explains, names a cause, and shows an example', () => {
    for (const language of TAUGHT) {
      for (const [key, entry] of Object.entries(english(language))) {
        assert.ok(entry.explanation, `${language}/${key} has no explanation`);
        assert.ok(
          entry.explanation.length > 40,
          `${language}/${key} explanation is too short to teach: "${entry.explanation}"`,
        );
        assert.ok(entry.cause, `${language}/${key} does not say what usually causes it`);
        assert.ok(entry.example, `${language}/${key} has no example`);
        assert.ok(entry.type, `${language}/${key} has no category`);
      }
    }
  });

  test('an explanation does not merely restate the error name', () => {
    // "NameError means there is a name error" is worthless. A key's own words appearing
    // in the first six of the explanation is the cheap signal for it.
    for (const language of TAUGHT) {
      for (const [key, entry] of Object.entries(english(language))) {
        const opening = entry.explanation.split(/\s+/).slice(0, 6).join(' ');
        assert.ok(
          !opening.includes(key),
          `${language}/${key} opens by restating itself: "${opening}"`,
        );
      }
    }
  });

  test('the jargon a beginner will not know is absent', () => {
    // Named in the readability research as a primary reason novices cannot use error
    // messages. If one of these is genuinely needed, explain it in the same sentence -
    // and then this test tells you to reword.
    const jargon = [
      'instantiate', 'dereference', 'coerce', 'idempotent', 'polymorphic',
      'lvalue', 'rvalue', 'nullary', 'variadic', 'monomorphic', 'covariant',
    ];
    for (const language of TAUGHT) {
      for (const [key, entry] of Object.entries(english(language))) {
        const text = `${entry.explanation} ${entry.cause ?? ''}`.toLowerCase();
        for (const word of jargon) {
          assert.ok(!text.includes(word), `${language}/${key} uses "${word}"`);
        }
      }
    }
  });

  test('an example is short enough to read at a glance', () => {
    for (const language of TAUGHT) {
      for (const [key, entry] of Object.entries(english(language))) {
        const lines = (entry.example ?? '').split('\n').length;
        assert.ok(lines <= 8, `${language}/${key} has a ${lines}-line example`);
      }
    }
  });
});

describe('Hebrew', () => {
  test('covers exactly the same errors', () => {
    for (const language of TAUGHT) {
      const englishKeys = Object.keys(english(language));
      const translated = hebrew(language);
      const missing = englishKeys.filter(key => !(key in translated));
      const extra = Object.keys(translated).filter(key => !englishKeys.includes(key));

      assert.deepEqual(missing, [], `${language}: untranslated (${missing.slice(0, 5).join(', ')})`);
      assert.deepEqual(extra, [], `${language}: translated but not in English (${extra.join(', ')})`);
    }
  });

  test('translates the prose and leaves the code alone', () => {
    // The example is code. Translating it would produce something that does not run,
    // and identifiers are English in every one of these languages anyway.
    for (const language of TAUGHT) {
      const en = english(language);
      const he = hebrew(language);
      for (const key of Object.keys(en)) {
        assert.equal(he[key].example, en[key].example, `${language}/${key}: example was changed`);
        assert.equal(he[key].type, en[key].type, `${language}/${key}: category was changed`);
      }
    }
  });

  test('the explanation and the cause are actually in Hebrew', () => {
    // A file that was copied but never translated passes a key-coverage check and helps
    // nobody, so the text is checked for Hebrew letters.
    const hebrewLetters = /[֐-׿]/;
    for (const language of TAUGHT) {
      for (const [key, entry] of Object.entries(hebrew(language))) {
        assert.ok(hebrewLetters.test(entry.explanation), `${language}/${key} explanation is not Hebrew`);
        assert.ok(hebrewLetters.test(entry.cause ?? ''), `${language}/${key} cause is not Hebrew`);
      }
    }
  });
});
