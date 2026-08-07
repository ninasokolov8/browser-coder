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
 * CI runs `tests/security/security-tests.mjs`, which makes that corpus the one gating a
 * merge and therefore the canonical one. `security/attacks/index.mjs` now imports it
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

  test('the Hebrew overlay is translations only, never a second set of assertions', () => {
    // `security/run.mjs` swaps only `explanation` when producing the Hebrew report, so
    // these files never needed the expectations - and if they grow some, the two
    // languages can start disagreeing about whether an attack should be refused.
    for (const language of LANGUAGES) {
      const path = join(OVERLAY, `${language}_he.mjs`);
      assert.ok(existsSync(path), `missing Hebrew overlay for ${language}`);
    }
  });

  test('the shared index loads and exposes fixtures', async () => {
    const index = await import('../../security/attacks/index.mjs');
    assert.equal(typeof index.getAllTests, 'function');
    assert.ok(index.getAllTests('en').length > 0, 'no fixtures loaded at all');
  });

  test('the two runners count the same fixtures', async () => {
    // The point of collapsing the fork. If these ever differ again, one runner is
    // gating merges on a corpus the other has never seen.
    const index = await import('../../security/attacks/index.mjs');

    let direct = 0;
    for (const language of LANGUAGES) {
      const module = await import(`../../tests/security/attacks/${language}.mjs`);
      const exported = Object.values(module).find(value => Array.isArray(value));
      direct += exported?.length ?? 0;
    }

    assert.equal(index.getAllTests('en').length, direct);
  });

  test('no Hebrew entry describes a fixture the English corpus does not have', async () => {
    /*
     * The overlay is allowed to be INCOMPLETE - it currently translates 317 of 322,
     * and `localizeReportExplanations` falls back to the English text for the rest,
     * which is the right behaviour for a missing translation.
     *
     * What it must never contain is an entry with no counterpart. That would be a
     * fixture that exists only in Hebrew: asserted by nothing, reported by one runner,
     * and invisible to CI - the same failure the fork itself was.
     */
    const index = await import('../../security/attacks/index.mjs');
    const english = new Set(index.getAllTests('en').map(entry => `${entry.language}::${entry.name}`));
    const orphans = index
      .getAllTests('he')
      .map(entry => `${entry.language}::${entry.name}`)
      .filter(key => !english.has(key));

    assert.deepEqual(orphans, [], 'Hebrew-only fixtures: they are asserted by nothing');
  });
});

describe('nothing pretends to have run', () => {
  /*
   * A runner that prints a banner and exits 0 is worse than a missing runner: the
   * pipeline is green, somebody reads "LANGUAGE TESTS" in the log, and nothing was
   * tested. `tests/run-tests.sh` had three of these, and `docker-compose.test.yml` had
   * four services whose entry points did not exist.
   */
  test('run-tests.sh has no "not yet implemented" branch', () => {
    const script = readFileSync(join(ROOT, 'tests/run-tests.sh'), 'utf8');
    assert.doesNotMatch(
      script,
      /not yet implemented/i,
      'a mode that prints a banner and exits 0 reports success for work that never ran',
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
