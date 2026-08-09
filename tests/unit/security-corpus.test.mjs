/**
 * One security corpus, and nothing that pretends to be a test run.
 *
 * ## The fork this closes
 *
 * There were two copies of the attack fixtures: `security/attacks/*.mjs` and
 * `tests/security/attacks/*.mjs`. Five of the six were byte-identical, and
 * `python.mjs` had DIVERGED - 1190 lines against 1307 - so the two runners were
 * asserting different things about the same product, and nothing said which was right.
 *
 * CI runs `security/run.mjs`, which imports the fixtures below, making this corpus
 * the one gating a merge. `security/attacks/index.mjs` imports it
 * rather than shipping a second copy, and keeps only the `_he.mjs` files, which supply
 * translated EXPLANATIONS for the Hebrew report and never contained assertions at all.
 *
 * Blueprint 21.1 states the rule this restores: "Security attack fixtures have one
 * canonical source and are reused in local, CI, staging, and production-validation
 * jobs."
 *
 * ## Why a test rather than a comment
 *
 * A fork closed by hand reopens the first time somebody adds a fixture to the copy
 * they happen to have open. This fails when a second copy appears.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const CANONICAL = join(ROOT, 'tests/security/attacks');
const OVERLAY = join(ROOT, 'security/attacks');

const LANGUAGES = ['javascript', 'typescript', 'python', 'php', 'java', 'csharp'];

describe('one canonical corpus', () => {
  test('every language has exactly one English fixture file, and it is the canonical one', () => {
    for (const language of LANGUAGES) {
      assert.ok(
        existsSync(join(CANONICAL, `${language}.mjs`)),
        `the canonical corpus is missing ${language}.mjs`,
      );
      assert.ok(
        !existsSync(join(OVERLAY, `${language}.mjs`)),
        `a second copy of ${language}.mjs has reappeared in security/attacks/ - `
        + 'that fork is what let python.mjs diverge by 117 lines without anyone noticing',
      );
    }
  });

  test('the Hebrew overlay is translations only, never a second set of assertions', async () => {
    // `security/run.mjs` swaps only `explanation` when producing the Hebrew report, so
    // these files never needed the expectations - and if they grow some, the two
    // languages can start disagreeing about whether an attack should be refused.
    for (const language of LANGUAGES) {
      const path = join(OVERLAY, `${language}_he.mjs`);
      assert.ok(existsSync(path), `missing Hebrew overlay for ${language}`);

      const module = await import(`../../security/attacks/${language}_he.mjs`);
      const exports = Object.values(module);
      assert.equal(exports.length, 1, `${language} should export one explanation catalog`);
      assert.ok(!Array.isArray(exports[0]), `${language} must not duplicate executable fixtures`);
      assert.ok(
        Object.values(exports[0]).every(value => typeof value === 'string'),
        `${language} contains data other than translated explanations`,
      );
    }
  });

  test('the shared index loads and exposes fixtures', async () => {
    const index = await import('../../security/attacks/index.mjs');
    assert.equal(typeof index.getAllTests, 'function');
    assert.ok(index.getAllTests('en').length > 0, 'no fixtures loaded at all');
  });

  test('the report index exposes every canonical fixture', async () => {
    // The point of collapsing the fork. The report layer and the direct fixture
    // modules must describe the same corpus.
    const index = await import('../../security/attacks/index.mjs');

    let direct = 0;
    for (const language of LANGUAGES) {
      const module = await import(`../../tests/security/attacks/${language}.mjs`);
      const exported = Object.values(module).find(value => Array.isArray(value));
      direct += exported?.length ?? 0;
    }

    assert.equal(index.getAllTests('en').length, direct);
  });

  test('every canonical fixture has exactly one Hebrew explanation', async () => {
    for (const language of LANGUAGES) {
      const englishModule = await import(`../../tests/security/attacks/${language}.mjs`);
      const hebrewModule = await import(`../../security/attacks/${language}_he.mjs`);
      const englishTests = Object.values(englishModule).find(Array.isArray);
      const explanations = Object.values(hebrewModule)[0];

      assert.deepEqual(
        Object.keys(explanations).sort(),
        englishTests.map(test => test.name).sort(),
        `${language} Hebrew explanations have missing or orphaned fixture names`,
      );
      for (const [name, explanation] of Object.entries(explanations)) {
        assert.match(explanation, /[\u0590-\u05ff]/, `${language}/${name} is not translated to Hebrew`);
      }
    }
  });
});

describe('nothing pretends to have run', () => {
  /*
   * A runner that prints a banner and exits 0 is worse than a missing runner: the
   * pipeline is green, somebody reads "LANGUAGE TESTS" in the log, and nothing was
   * tested. `tests/run-tests.sh` had three of these, and `docker-compose.test.yml` had
   * four services whose entry points did not exist.
   */
  test('the obsolete umbrella runner is absent', () => {
    assert.ok(
      !existsSync(join(ROOT, 'tests/run-tests.sh')),
      'tests/run-tests.sh is back - three of its four advertised suites never existed',
    );
  });

  test('every command in docker-compose.test.yml points at a file that exists', () => {
    const compose = readFileSync(join(ROOT, 'docker-compose.test.yml'), 'utf8');
    const commands = [...compose.matchAll(/command:\s*\["node",\s*"([^"]+)"/g)].map(match => match[1]);

    assert.ok(commands.length > 0, 'no test services found - has the file been restructured?');
    for (const entry of commands) {
      // Commands run with `tests/` as the working directory.
      assert.ok(
        existsSync(join(ROOT, 'tests', entry)) || existsSync(join(ROOT, entry)),
        `docker-compose.test.yml runs "${entry}", which does not exist`,
      );
    }
  });

  test('the root has no orphaned test suite', () => {
    // `_test_suite.mjs` was 863 lines asserting against a server.mjs that no longer
    // exists in that shape, referenced by no script, no CI job and no compose file.
    assert.ok(
      !existsSync(join(ROOT, '_test_suite.mjs')),
      '_test_suite.mjs is back - it tests a server that no longer exists',
    );
  });

  test('the security report script reads the directory the compose file writes', () => {
    /*
     * They disagreed: the script looked in `tests/reports/` and the compose file
     * mounts `security/reports/`. So it printed whatever run happened to be in the
     * other directory - which for a long time meant reporting July's numbers as
     * today's result.
     */
    const script = readFileSync(join(ROOT, 'run-security-tests.sh'), 'utf8');
    const compose = readFileSync(join(ROOT, 'docker-compose.test.yml'), 'utf8');

    if (!/security\/reports/.test(compose)) return;
    assert.match(
      script,
      /security\/reports/,
      'run-security-tests.sh reads a different directory from the one the run writes to',
    );
  });
});

describe('the language directories are clean', () => {
  test('no orphaned attack file sits in security/attacks', () => {
    const allowed = new Set(['index.mjs', ...LANGUAGES.map(language => `${language}_he.mjs`)]);
    for (const entry of readdirSync(OVERLAY)) {
      assert.ok(allowed.has(entry), `unexpected file in security/attacks: ${entry}`);
    }
  });
});
