/**
 * The language capability data, and the one thing that must never drift.
 *
 * ## What this replaced
 *
 * Four hand-maintained lists, in four files, each a copy of a fact belonging to the
 * language: `DEBUGGABLE_LANGUAGES` in editor-commands, `TAUGHT_LANGUAGES` in
 * hover-help, `SELECTION_RUNNABLE_LANGUAGES` in selection-run, and the executable half
 * of `LANGUAGE_ICONS`. Adding a language meant finding all four, which is exactly the
 * kind of edit that finds three.
 *
 * ## Why the debug one is checked against the SERVER
 *
 * `capabilities.debug` decides whether the client offers a Debug button.
 * `supportsDebug` on the server adapter decides whether a debug run actually attaches.
 * Those are two answers to one question, held in two repositories of truth, and the
 * old comment in editor-commands admitted it: "Duplicated rather than fetched...
 * the server still refuses honestly if this list is ever wrong".
 *
 * Honest refusal is not good enough. A student clicking a Debug button that the IDE
 * offered and then watching the run report `debug:unsupported` has been lied to by the
 * button. This test reads BOTH sides and fails if they disagree, which is what makes
 * the single source of truth actually single.
 *
 * These read the real files rather than a copy of what they should contain - a test
 * that restates the data cannot catch the data being wrong.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const LANGUAGES_DIR = resolve(import.meta.dirname, '../../languages');

/** Every language that ships a config.json, which is what makes it executable. */
function executableLanguages() {
  return readdirSync(LANGUAGES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => existsSync(join(LANGUAGES_DIR, name, 'config.json')))
    .sort();
}

function configFor(id) {
  return JSON.parse(readFileSync(join(LANGUAGES_DIR, id, 'config.json'), 'utf8'));
}

const IDS = executableLanguages();

describe('every executable language declares itself', () => {
  test('the set is the six this IDE runs', () => {
    assert.deepEqual(IDS, ['csharp', 'java', 'javascript', 'php', 'python', 'typescript']);
  });

  for (const id of IDS) {
    test(`${id} has the fields the loader and the file tree need`, () => {
      const config = configFor(id);

      assert.equal(config.id, id, 'the id must match its directory, which is how the loader keys it');
      assert.equal(typeof config.name, 'string');
      assert.equal(typeof config.extension, 'string');
      assert.equal(typeof config.monacoLanguage, 'string');
      assert.ok(Array.isArray(config.versions) && config.versions.length > 0);
      assert.equal(config.versions.filter(version => version.default).length, 1,
        'exactly one default version, or the IDE has to guess which one to open with');

      // The icon used to live in a client-side map keyed by language id, which is a
      // fifth copy of a fact the language already owns.
      assert.equal(typeof config.icon, 'string');
      assert.ok(config.icon.length > 0);
    });
  }
});

describe('capabilities', () => {
  const KNOWN = new Set(['debug', 'taughtKeywords', 'runSelection']);

  for (const id of IDS) {
    test(`${id} declares only capabilities that exist`, () => {
      const capabilities = configFor(id).capabilities ?? {};
      for (const [name, value] of Object.entries(capabilities)) {
        assert.ok(KNOWN.has(name), `unknown capability "${name}" - a typo here silently disables a feature`);
        assert.equal(typeof value, 'boolean', `${name} must be a boolean`);
      }
    });
  }

  test('a language that teaches keywords ships the data to teach with', () => {
    // Otherwise the hover provider registers and then explains nothing, which teaches
    // the student the feature is unreliable rather than that it does not apply.
    for (const id of IDS) {
      if (configFor(id).capabilities?.taughtKeywords !== true) continue;
      assert.ok(
        existsSync(join(LANGUAGES_DIR, id, 'keywords.json')),
        `${id} claims taughtKeywords but has no keywords.json`,
      );
    }
  });

  test('Java is the one language that cannot run a selection', () => {
    // Recorded as a test rather than only as a comment: its adapter needs a file
    // declaring a class with `main`, so a selection of statements can never compile,
    // and someone "fixing the inconsistency" would produce "class, interface, or enum
    // expected" for a gesture that looks perfectly reasonable.
    assert.equal(configFor('java').capabilities?.runSelection, false);
    for (const id of IDS.filter(other => other !== 'java')) {
      assert.equal(configFor(id).capabilities?.runSelection, true, id);
    }
  });

  test('the dead runner block is gone and stays gone', () => {
    // It was a required field nobody read, and the loader fabricated values like
    // `{ command: 'preview' }` for seven built-in languages purely to satisfy the type.
    for (const id of IDS) {
      assert.equal(configFor(id).runner, undefined, `${id} still has a runner block`);
    }
  });
});

describe('the client and the server agree about debugging', () => {
  /**
   * `supportsDebug` as the server actually declares it.
   *
   * Read from the adapter source rather than by importing it: the adapters pull in the
   * config, the process runner and the logger, and a unit test that has to boot half
   * the server to ask one question is a test people stop running.
   */
  function serverSupportsDebug(id) {
    const source = readFileSync(
      resolve(import.meta.dirname, `../../server/languages/adapters/${id}.mjs`),
      'utf8',
    );
    return /^\s*supportsDebug:\s*true\s*,/m.test(source);
  }

  for (const id of IDS) {
    test(`${id}: capabilities.debug matches the adapter's supportsDebug`, () => {
      const declared = configFor(id).capabilities?.debug === true;
      const actual = serverSupportsDebug(id);

      assert.equal(
        declared,
        actual,
        declared
          ? `${id} offers a Debug button but its server adapter has no supportsDebug - `
            + 'the run will report debug:unsupported after the student clicks it'
          : `${id} can be debugged but its config.json does not say so - the button is hidden`,
      );
    });
  }

  test('every one of the six is debuggable, which is the current state of the world', () => {
    // If this ever fails because a language was ADDED, the right fix is to give it a
    // debugger or to say plainly in its config that it has none - not to loosen this.
    for (const id of IDS) {
      assert.equal(configFor(id).capabilities?.debug, true, id);
    }
  });
});
