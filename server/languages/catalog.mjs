/**
 * Language catalog and version resolution.
 *
 * Fixes V-32: `version` was accepted on every run route and then never read.
 * `executeCode(language, version, code)` ignored the parameter entirely, and the
 * interactive route did not even destructure it. Java 11 ran on JDK 17 with no
 * `--release`, C# 10 compiled as C# 12, and every TypeScript profile compiled
 * with `strict: false` and ES2022 regardless of which one was selected.
 *
 * Resolution is deliberately staged rather than immediately strict.
 *
 * Being strict today would break production. Step-Up stores display values, not
 * canonical IDs - `ES2022`, `5 Strict`, `3`, `17`, `8`, `12` - and its checked-in
 * content also requests Python `3.11` and Java `21`, which have no matching
 * toolchain here. Rejecting those would turn working lessons into errors that the
 * Step-Up UI cannot yet explain.
 *
 * Silently substituting is equally wrong, and is what the pre-refactor code did.
 * So resolution is explicit and measurable:
 *
 *   exact     the requested ID is a real profile
 *   alias     a known display value mapped through the table below
 *   fallback  unrecognised; the language default is used, and this is REPORTED
 *             in the response and logged, not hidden
 *
 * `STRICT_VERSIONS=1` turns `fallback` into a 400. That is the switch to flip
 * once Step-Up content has been migrated - the enforcement order the blueprint
 * requires (accept and measure first, enforce second).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from '../logging.mjs';

const LANGUAGES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'languages',
);

/** Cache TTL matches the pre-refactor loader so hot-editing a config still works. */
const CACHE_TTL_MS = 300000;

let cache = null;
let cachedAt = 0;

/**
 * Display values Step-Up sends, mapped to canonical profile IDs.
 *
 * Frozen table from blueprint section 12.3. Matching is case- and
 * whitespace-normalized through this table ONLY - never "pick the first
 * version", which is what produced the silent substitution.
 */
const VERSION_ALIASES = Object.freeze({
  javascript: {
    es2022: 'es2022',
    es2020: 'es2020',
    es2015: 'es2015',
    es6: 'es2015',
    es5: 'es5',
    latest: 'es2022',
  },
  typescript: {
    '5strict': 'ts5-strict',
    '5': 'ts5',
    ts5: 'ts5',
    ts5strict: 'ts5-strict',
    es2020: 'ts-es2020',
    es2015: 'ts-es2015',
    strict: 'ts5-strict',
  },
  python: {
    3: 'python3',
    py3: 'python3',
    python: 'python3',
  },
  java: {
    17: 'java17',
    11: 'java11',
    jdk17: 'java17',
    jdk11: 'java11',
  },
  php: {
    8: 'php8',
    php8: 'php8',
  },
  csharp: {
    12: 'csharp12',
    10: 'csharp10',
    'c#12': 'csharp12',
    'c#10': 'csharp10',
    dotnet8: 'csharp12',
    dotnet6: 'csharp10',
  },
});

/**
 * Values known to be requested by real content that have no truthful profile.
 *
 * Kept explicit so they can be reported accurately instead of being quietly
 * folded in with genuine typos. Provisioning a real toolchain, or removing the
 * value from Step-Up authoring, is what resolves each of these.
 */
const KNOWN_UNAVAILABLE = Object.freeze({
  python: ['3.11', '3.12', '3.10', '2.7'],
  java: ['21', '8'],
  csharp: ['11', '9'],
});

const normalizeVersionKey = value =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

/** Load every languages/<id>/config.json. Cached. */
export function loadCatalog({ force = false } = {}) {
  if (!force && cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;

  const languages = {};
  try {
    for (const entry of fs.readdirSync(LANGUAGES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(LANGUAGES_DIR, entry.name, 'config.json');
      if (!fs.existsSync(configPath)) continue;
      try {
        languages[entry.name] = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (error) {
        // One malformed config must not remove every other language from the
        // catalog, which is what a single try around the whole loop would do.
        log('error', 'language_config_unparseable', {
          language: entry.name,
          error: error.message,
        });
      }
    }
  } catch (error) {
    log('error', 'language_catalog_unreadable', { error: error.message });
  }

  cache = languages;
  cachedAt = Date.now();
  return cache;
}

/** Language IDs that can actually be executed (as opposed to edited/previewed). */
export function executableLanguageIds() {
  return ['javascript', 'typescript', 'python', 'java', 'php', 'csharp'];
}

export function isExecutable(languageId) {
  return executableLanguageIds().includes(languageId);
}

/**
 * The extension a language's files use, from config rather than a hardcoded map.
 *
 * Fixes N-09: `getExtension()` duplicated this mapping inside server.mjs, so
 * adding a language meant editing the core.
 */
export function extensionFor(languageId) {
  const config = loadCatalog()[languageId];
  return config?.extension || 'txt';
}

/**
 * Resolve a requested language/version pair to a concrete profile.
 *
 * @param {string} languageId
 * @param {unknown} requestedVersion
 * @param {{strict?: boolean}} [options]
 * @returns {{ok: true, profile: VersionProfile} | {ok: false, code: string, message: string, available?: string[]}}
 */
export function resolveVersion(languageId, requestedVersion, options = {}) {
  const strict = options.strict ?? process.env.STRICT_VERSIONS === '1';
  const config = loadCatalog()[languageId];

  if (!config) {
    return {
      ok: false,
      code: 'language_unknown',
      message: `Unsupported language: ${languageId}`,
    };
  }

  const versions = Array.isArray(config.versions) ? config.versions : [];
  if (versions.length === 0) {
    return {
      ok: false,
      code: 'language_has_no_versions',
      message: `Language ${languageId} declares no versions`,
    };
  }

  const defaultVersion = versions.find(version => version.default) || versions[0];
  const available = versions.map(version => version.id);
  const requestedKey = normalizeVersionKey(requestedVersion);

  const build = (version, resolution) => ({
    ok: true,
    profile: buildProfile(config, version, {
      requested: requestedVersion == null || requestedVersion === '' ? null : String(requestedVersion),
      resolution,
    }),
  });

  // No version requested at all: the default, and that is exact - the caller did
  // not ask for something we failed to honour.
  if (requestedKey === '') return build(defaultVersion, 'default');

  const exact = versions.find(version => normalizeVersionKey(version.id) === requestedKey);
  if (exact) return build(exact, 'exact');

  const aliasTarget = VERSION_ALIASES[languageId]?.[requestedKey];
  if (aliasTarget) {
    const aliased = versions.find(version => version.id === aliasTarget);
    if (aliased) return build(aliased, 'alias');
  }

  const knownUnavailable = (KNOWN_UNAVAILABLE[languageId] || []).some(
    value => normalizeVersionKey(value) === requestedKey,
  );

  // Reported either way; whether it is fatal depends on the enforcement stage.
  log('warn', 'version_unresolved', {
    language: languageId,
    requested: String(requestedVersion).slice(0, 64),
    knownUnavailable,
    strict,
    resolvedTo: strict ? null : defaultVersion.id,
  });

  if (strict) {
    return {
      ok: false,
      code: knownUnavailable ? 'version_unavailable' : 'version_unknown',
      message: knownUnavailable
        ? `${config.name} version "${requestedVersion}" is not available on this service. Available: ${available.join(', ')}`
        : `Unknown ${config.name} version "${requestedVersion}". Available: ${available.join(', ')}`,
      available,
    };
  }

  return build(defaultVersion, knownUnavailable ? 'unavailable-fallback' : 'fallback');
}

/**
 * @typedef {object} VersionProfile
 * @property {string} languageId
 * @property {string} versionId       canonical ID actually used
 * @property {string} versionName     display name
 * @property {string|null} requested  what the caller asked for, verbatim
 * @property {string} resolution      exact | default | alias | fallback | unavailable-fallback
 * @property {string} extension
 * @property {string|null} sourceLevel  Java/C# language level, when declared
 * @property {string|null} target        ECMAScript target, when declared
 * @property {boolean} strict            TypeScript strictness
 * @property {string} runtimeNote        honest statement of what actually executes
 */
function buildProfile(config, version, { requested, resolution }) {
  return Object.freeze({
    languageId: config.id,
    versionId: version.id,
    versionName: version.name || version.id,
    requested,
    resolution,
    extension: config.extension || 'txt',
    // Java `--release`, C# `<LangVersion>`. Both are real compiler switches, so
    // these selections genuinely differentiate behaviour.
    sourceLevel: version.sourceLevel ?? null,
    // ECMAScript target for the JS/TS toolchain.
    target: version.monacoTarget ?? null,
    strict: version.strict === true,
    runtimeNote: runtimeNoteFor(config.id, version),
  });
}

/**
 * What actually executes, stated plainly.
 *
 * Recorded because a "version" is a language profile, not always a runtime
 * number, and pretending otherwise is what section 6.3 objects to. A selection
 * that only affects compilation says so.
 */
function runtimeNoteFor(languageId, version) {
  switch (languageId) {
    case 'javascript':
      return `Compiled and checked at ${version.monacoTarget || 'ES2022'}; executed on the service's Node runtime.`;
    case 'typescript':
      return `Compiled with target ${version.monacoTarget || 'ES2022'} and strict=${version.strict === true}; executed on the service's Node runtime.`;
    case 'java':
      return version.sourceLevel
        ? `Compiled with --release ${version.sourceLevel} against the installed JDK.`
        : 'Compiled against the installed JDK.';
    case 'csharp':
      return version.sourceLevel
        ? `Compiled with LangVersion ${version.sourceLevel} targeting the installed .NET runtime.`
        : 'Compiled targeting the installed .NET runtime.';
    case 'python':
      return "Executed on the service's installed CPython.";
    case 'php':
      return "Executed on the service's installed PHP.";
    default:
      return 'Executed on the installed toolchain.';
  }
}

/** Clear the cache. Used by tests. */
export function resetCatalogCache() {
  cache = null;
  cachedAt = 0;
}
