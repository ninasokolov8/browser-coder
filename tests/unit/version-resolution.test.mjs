/**
 * V-32: a requested version must be honoured, or refused - never silently swapped.
 *
 * The distinction these tests pin is the one that made the fix shippable. A single
 * "strict" switch covering every unresolved version could not be turned on, because
 * rejecting Python 3.11 would break checked-in Step-Up lessons. Separating a KNOWN
 * gap (real content asks for a toolchain this service does not have) from an UNKNOWN
 * value (a typo or a probe) lets the second be refused today while the first keeps
 * working and reports itself honestly.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveVersion } from '../../server/languages/catalog.mjs';

/** Quieten the deliberate warn logs these cases emit. */
const quiet = fn => {
  const original = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = original;
  }
};

describe('versions that are honoured', () => {
  test('an exact profile id resolves exactly', () => {
    const result = resolveVersion('python', 'python3');
    assert.equal(result.ok, true);
    assert.equal(result.profile.resolution, 'exact');
  });

  test('no version requested is the default, and that counts as honoured', () => {
    // The caller did not ask for something we failed to give them.
    for (const requested of [undefined, null, '']) {
      const result = resolveVersion('python', requested);
      assert.equal(result.ok, true);
      assert.equal(result.profile.resolution, 'default');
    }
  });

  test("Step-Up's display values resolve through the alias table", () => {
    // These are what real content sends: display strings, not canonical ids.
    const cases = [
      ['typescript', '5 Strict', 'alias'],
      ['typescript', '5', 'alias'],
      ['java', '17', 'alias'],
      ['java', '11', 'alias'],
      ['csharp', '12', 'alias'],
      ['php', '8', 'alias'],
      ['python', '3', 'alias'],
    ];

    for (const [language, requested, expected] of cases) {
      const result = resolveVersion(language, requested);
      assert.equal(result.ok, true, `${language} ${requested} was refused`);
      assert.equal(result.profile.resolution, expected);
    }
  });

  test('alias matching ignores case and whitespace but nothing else', () => {
    assert.equal(resolveVersion('typescript', '  5   STRICT ').profile.resolution, 'alias');
    // Not a fuzzy match: "5 Strictly" is not "5 Strict".
    assert.equal(quiet(() => resolveVersion('typescript', '5 Strictly').ok), false);
  });
});

describe('versions that are refused (V-32)', () => {
  test('an unknown version is a 400, not a silent substitution', () => {
    const result = quiet(() => resolveVersion('python', 'python-does-not-exist'));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'version_unknown');
    assert.match(result.message, /version/i);
  });

  test('the refusal names what IS available', () => {
    // A caller that gets a 400 must be able to fix it without reading our source.
    const result = quiet(() => resolveVersion('java', 'jdk-99'));
    assert.equal(result.ok, false);
    assert.ok(Array.isArray(result.available) && result.available.length > 0);
    assert.match(result.message, /java17|java11/);
  });

  test('an unknown language is refused separately from an unknown version', () => {
    const result = resolveVersion('cobol', 'anything');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'language_unknown');
  });
});

describe('known gaps keep working, and say so', () => {
  test('Python 3.11 falls back rather than breaking a lesson', () => {
    // Real Step-Up content requests this. Refusing it would turn a working lesson
    // into an error the Step-Up UI cannot yet explain.
    const result = quiet(() => resolveVersion('python', '3.11'));
    assert.equal(result.ok, true);
    assert.equal(result.profile.resolution, 'unavailable-fallback');
  });

  test('Java 21 falls back rather than breaking a lesson', () => {
    const result = quiet(() => resolveVersion('java', '21'));
    assert.equal(result.ok, true);
    assert.equal(result.profile.resolution, 'unavailable-fallback');
  });

  test('the fallback is REPORTED, not hidden', () => {
    // This is the whole difference from the pre-refactor behaviour, which ran a
    // different version and said nothing.
    const result = quiet(() => resolveVersion('python', '3.11'));
    assert.equal(result.profile.requested, '3.11');
    assert.notEqual(result.profile.resolution, 'exact');
  });

  test('STRICT_VERSIONS refuses the known gaps too', () => {
    // The switch to flip once Step-Up content has been migrated.
    const result = quiet(() => resolveVersion('python', '3.11', { strict: true }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'version_unavailable');
  });
});

describe('the escape hatch', () => {
  test('ALLOW_UNKNOWN_VERSIONS restores the lenient behaviour', () => {
    // Reversibility for a behaviour change: if production turns out to send a value
    // the alias table does not know, this restores the old fallback without a
    // deploy of new code.
    const result = quiet(() =>
      resolveVersion('python', 'something-unexpected', { allowUnknown: true }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.profile.resolution, 'fallback');
  });

  test('strict still wins over the escape hatch', () => {
    const result = quiet(() =>
      resolveVersion('python', 'something-unexpected', { allowUnknown: true, strict: true }),
    );
    assert.equal(result.ok, false);
  });
});
