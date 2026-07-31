/**
 * Locale completeness.
 *
 * A missing key does not fail loudly: `t()` returns the key itself, so a Hebrew
 * user sees `panel.problems` - or, when a key was never added at all, an English
 * string sitting inside an RTL layout. Both look like a rendering bug rather than a
 * translation gap, so the gap survives.
 *
 * These checks are cheap and catch it at the point it is introduced.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const LOCALES_DIR = path.join(process.cwd(), 'src', 'i18n', 'locales');
const REFERENCE = 'en';

function loadLocale(code) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), 'utf8'));
}

const localeCodes = fs
  .readdirSync(LOCALES_DIR)
  .filter(name => name.endsWith('.json'))
  .map(name => name.replace(/\.json$/, ''));

describe('locales', () => {
  test('there is more than one locale to compare', () => {
    assert.ok(localeCodes.length >= 2, `found only ${localeCodes.join(', ')}`);
    assert.ok(localeCodes.includes(REFERENCE));
  });

  test('every locale has exactly the reference key set', () => {
    const reference = Object.keys(loadLocale(REFERENCE)).sort();

    for (const code of localeCodes) {
      if (code === REFERENCE) continue;
      const keys = Object.keys(loadLocale(code)).sort();

      const missing = reference.filter(key => !keys.includes(key));
      const extra = keys.filter(key => !reference.includes(key));

      assert.deepEqual(missing, [], `${code} is missing keys present in ${REFERENCE}`);
      // An extra key is dead weight, and usually a rename applied to one file only.
      assert.deepEqual(extra, [], `${code} has keys ${REFERENCE} does not`);
    }
  });

  test('no value is empty', () => {
    for (const code of localeCodes) {
      for (const [key, value] of Object.entries(loadLocale(code))) {
        assert.equal(typeof value, 'string', `${code}.${key} is not a string`);
        assert.notEqual(value.trim(), '', `${code}.${key} is empty`);
      }
    }
  });

  test('placeholders match across locales', () => {
    // `t()` substitutes {{name}}. A translation that drops or renames one renders
    // the literal braces to the user.
    const placeholdersOf = value => [...String(value).matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort();
    const reference = loadLocale(REFERENCE);

    for (const code of localeCodes) {
      if (code === REFERENCE) continue;
      const locale = loadLocale(code);

      for (const [key, englishValue] of Object.entries(reference)) {
        assert.deepEqual(
          placeholdersOf(locale[key]),
          placeholdersOf(englishValue),
          `${code}.${key} has different placeholders from ${REFERENCE}`,
        );
      }
    }
  });

  test('every data-i18n key in index.html exists', () => {
    // The markup names keys directly, so a typo there is invisible until someone
    // looks at that part of the UI in a non-default language.
    const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
    const reference = loadLocale(REFERENCE);

    const used = new Set();
    for (const match of html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)) {
      used.add(match[1]);
    }

    const unknown = [...used].filter(key => !(key in reference)).sort();
    assert.deepEqual(unknown, [], 'index.html references translation keys that do not exist');
  });
});
