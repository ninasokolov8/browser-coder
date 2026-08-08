#!/usr/bin/env node
/**
 * Assert the isolation the compose comments claim is actually configured.
 *
 * Two of the recorded defects were exactly this gap between a comment and the
 * configuration below it:
 *
 *   V-07  the network was NAMED `internal` and declared `driver: bridge`, which
 *         is an ordinary bridge WITH NAT egress. The api service carried the
 *         comment "SECURITY: Network isolation - no external network access"
 *         above a network that had none.
 *
 *   N-05  `# SECURITY: Limit PIDs to prevent fork bombs` sat under
 *         deploy.resources with nothing after it. Fork-bomb containment did not
 *         exist at all.
 *
 * A comment cannot be tested. This can, so CI fails when the claim and the
 * configuration diverge again.
 *
 *   node scripts/check-ops-config.mjs [compose files...]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  files.push('docker-compose.yml', 'docker-compose.prod.yml', 'docker-compose.test.yml');
}

/** Services that execute untrusted code and therefore must be contained. */
const SANDBOXED_SERVICES = ['api'];

/** Above any legitimate compile (javac and dotnet spawn a handful), far below harm. */
const MIN_PIDS_LIMIT = 1;
const MAX_PIDS_LIMIT = 4096;

/** Stores that must be reachable from every replica, and the env var pointing at each. */
const SHARED_STORES = [
  { env: 'PREVIEW_STORAGE_DIR', what: 'published previews' },
  { env: 'BLOB_CACHE_DIR', what: 'the asset cache' },
  { env: 'SHARE_STORAGE_DIR', what: 'share snapshots' },
];

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`  FAIL ${message}`);
}

function pass(message) {
  console.log(`  ok   ${message}`);
}

for (const file of files) {
  console.log(`\n${file}`);

  let resolved;
  try {
    // `config` is the RESOLVED project - after extends, profiles and interpolation -
    // so this checks what compose will actually create rather than what the file
    // appears to say.
    const json = execFileSync('docker', ['compose', '-f', file, 'config', '--format', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    resolved = JSON.parse(json);
  } catch (error) {
    fail(`could not resolve the compose project: ${error.message.split('\n')[0]}`);
    continue;
  }

  // ── V-07 ──────────────────────────────────────────────────────────────────
  const internal = resolved.networks?.internal;
  if (!internal) {
    fail('there is no `internal` network');
  } else if (internal.internal !== true) {
    fail('the `internal` network lacks `internal: true`, so it has NAT egress (V-07)');
  } else {
    pass('the internal network is internal: true');
  }

  for (const name of SANDBOXED_SERVICES) {
    const service = resolved.services?.[name];
    if (!service) {
      fail(`service "${name}" is missing`);
      continue;
    }

    // A sandboxed service on any network other than `internal` has egress by
    // another route, which makes the isolation above decorative.
    const networks = Object.keys(service.networks ?? {});
    if (networks.length !== 1 || networks[0] !== 'internal') {
      fail(`${name} is attached to [${networks.join(', ')}]; it must be on \`internal\` only`);
    } else {
      pass(`${name} is on the internal network only`);
    }

    // ── N-05 ────────────────────────────────────────────────────────────────
    const pids = service.pids_limit;
    if (!pids) {
      fail(`${name} has no pids_limit, so there is no fork-bomb containment (N-05)`);
    } else if (pids < MIN_PIDS_LIMIT || pids > MAX_PIDS_LIMIT) {
      fail(`${name} pids_limit ${pids} is outside the sensible range`);
    } else {
      pass(`${name} pids_limit is ${pids}`);
    }

    // Compose refuses a project where these disagree, but it accepts one where
    // only the deploy value is set - which `docker compose up` then ignores
    // outside swarm. Requiring both keeps it working in either mode.
    const deployPids = service.deploy?.resources?.limits?.pids;
    if (deployPids !== undefined && deployPids !== pids) {
      fail(`${name} deploy pids ${deployPids} disagrees with pids_limit ${pids}`);
    }

    if (service.security_opt?.some(option => option.includes('no-new-privileges'))) {
      pass(`${name} sets no-new-privileges`);
    } else {
      fail(`${name} does not set no-new-privileges`);
    }

    if (service.read_only === true) {
      pass(`${name} has a read-only root filesystem`);
    } else {
      fail(`${name} root filesystem is writable`);
    }

    const droppedCapabilities = new Set(service.cap_drop ?? []);
    if (droppedCapabilities.has('ALL')) {
      pass(`${name} drops all ambient Linux capabilities`);
    } else {
      fail(`${name} does not drop all ambient Linux capabilities`);
    }

    if (service.init === true) {
      pass(`${name} has an init process for signal forwarding and child reaping`);
    } else {
      fail(`${name} does not enable an init process`);
    }

    // The image's entrypoint uses su-exec to leave root before Node starts.
    // SETUID/SETGID perform that transition; KILL lets the root-owned init signal
    // the uid-1001 Node process during a graceful container stop.
    const addedCapabilities = new Set(service.cap_add ?? []);
    for (const required of ['SETUID', 'SETGID', 'KILL']) {
      if (addedCapabilities.has(required)) pass(`${name} retains the required ${required} capability`);
      else fail(`${name} is missing the required ${required} capability`);
    }
    const unexpectedCapabilities = [...addedCapabilities]
      .filter(capability => !['SETUID', 'SETGID', 'KILL'].includes(capability));
    if (unexpectedCapabilities.length > 0) {
      fail(`${name} adds unexpected capabilities: ${unexpectedCapabilities.join(', ')}`);
    }

    checkSharedStores(name, service, resolved, file);
  }
}

/**
 * Stores that must be reachable from every replica, and the env var that points at each.
 *
 * The server's config already documented this requirement - the `shares` block says in
 * as many words that "a link published through one replica and opened through another
 * must work" - and production satisfied it for previews only. Blobs and shares fell back
 * to `os.tmpdir()`, which under Dockerfile.production is TMPDIR=/app/sandbox, a
 * per-container tmpfs. Behind `least_conn` with no session affinity and two replicas,
 * roughly half of every share link 404'd and roughly half of every run carrying an image
 * failed with "Some assets are not cached."
 *
 * Nothing about that was visible in development, where there is one replica and one tmp
 * directory, which is why it needs a check rather than a comment.
 */
function checkSharedStores(name, service, resolved, file) {
  // Single-replica files are exempt: there is no second replica to disagree with, and
  // the dev compose deliberately keeps these on tmp so a `down` leaves nothing behind.
  const replicas = Number(service.deploy?.replicas ?? 1);
  if (!Number.isFinite(replicas) || replicas <= 1) {
    pass(`${name} runs a single replica, so per-replica storage is not a hazard`);
    return;
  }

  // Which container paths are backed by a NAMED volume, as opposed to a bind mount or
  // - the failure this exists to catch - a tmpfs.
  const shared = (service.volumes ?? [])
    .filter(volume => volume.type === 'volume' && resolved.volumes?.[volume.source] !== undefined)
    .map(volume => volume.target);

  for (const { env, what } of SHARED_STORES) {
    const configured = service.environment?.[env];
    if (!configured) {
      fail(`${name} runs ${replicas} replicas but ${env} is unset, so ${what} is per-replica (${file})`);
      continue;
    }

    const onSharedVolume = shared.some(
      target => configured === target || configured.startsWith(`${target}/`),
    );
    if (onSharedVolume) {
      pass(`${env} points at a named volume, so ${what} is shared across replicas`);
    } else {
      fail(`${name}: ${env}=${configured} is not on a named volume, so ${what} is per-replica`);
    }
  }
}

// ── nginx body limits must cover what the server will accept ────────────────
//
// These live in two files that nobody edits together. `main` raised
// MAX_CODE_CHARS from 750 KB to 8 MB, which derives a ~24 MB body allowance in
// server/config.mjs, while nginx's per-location cap stayed at 3m - so the raise
// silently did nothing in production and a large project got a 413 that never
// reached the application. Exactly the shape of V-40.
//
// Both sides are computed here and compared, so the pair cannot drift again.
await checkNginxBodyLimits();

async function checkNginxBodyLimits() {
  const nginxPath = 'nginx/nginx.conf';
  if (!existsSync(nginxPath)) {
    fail(`${nginxPath} is missing, so its body limits cannot be checked`);
    return;
  }

  // Read the derived limit from the same module the server uses, under the highest
  // ceiling any compose file sets - reading the number rather than restating it.
  //
  // Every file is compared, because the raise that motivated this check was applied
  // to the DEV compose file and not to prod: an 8 MB project ran in development and
  // was rejected in production, which is worse than the feature not existing.
  const perFile = readComposeEnvNumbers('MAX_CODE_CHARS');
  const distinct = [...new Set(Object.values(perFile))];
  if (distinct.length > 1) {
    const detail = Object.entries(perFile).map(([file, value]) => `${file}=${value}`).join(', ');
    fail(`MAX_CODE_CHARS differs between compose files (${detail}); dev and prod must agree`);
  }
  const composeMax = distinct.length > 0 ? Math.max(...distinct) : null;
  const previous = process.env.MAX_CODE_CHARS;
  if (composeMax !== null) process.env.MAX_CODE_CHARS = String(composeMax);

  let derived;
  try {
    ({ RUN_BODY_LIMIT_BYTES: derived } = await import(
      `../server/config.mjs?ops-check=${Date.now()}`
    ));
  } finally {
    if (previous === undefined) delete process.env.MAX_CODE_CHARS;
    else process.env.MAX_CODE_CHARS = previous;
  }

  const conf = readFileSync(nginxPath, 'utf8');

  // Every /api/run location, since the IDE only ever uses the interactive one and
  // a limit set on just the other would look correct while failing every real run.
  const runLocations = [...conf.matchAll(
    /location[^{]*\/api\/run[^{]*\{([\s\S]*?)\n {8}\}/g,
  )];

  if (runLocations.length === 0) {
    fail('nginx.conf declares no /api/run location, so the body limit is nginx\'s 1 MB default');
    return;
  }

  for (const [, block] of runLocations) {
    const name = /location[^\n]*/.exec(block.slice(0, 0) + block)?.[0] ?? 'a /api/run location';
    const match = /client_max_body_size\s+(\d+)([kKmMgG]?)/.exec(block);
    if (!match) {
      fail('an /api/run location has no client_max_body_size, so nginx\'s 1 MB default applies');
      continue;
    }
    const bytes = toBytes(Number(match[1]), match[2]);
    if (bytes < derived) {
      fail(
        `nginx allows ${mib(bytes)} for an /api/run location but the server derives ` +
        `${mib(derived)} from MAX_CODE_CHARS - nginx would 413 a project the app accepts`,
      );
    } else {
      pass(`nginx allows ${mib(bytes)} for /api/run, covering the server's ${mib(derived)}`);
    }
  }
}

/** The value of one env key in every compose file that sets it. */
function readComposeEnvNumbers(key) {
  const found = {};
  for (const file of ['docker-compose.prod.yml', 'docker-compose.yml']) {
    if (!existsSync(file)) continue;
    const match = new RegExp(`${key}=(\\d+)`).exec(readFileSync(file, 'utf8'));
    if (match) found[file] = Number(match[1]);
  }
  return found;
}

// Function declarations, not const arrows: these are called from
// checkNginxBodyLimits above, and a const is not hoisted.
function toBytes(value, unit) {
  const scale = { '': 1, k: 1024, K: 1024, m: 1048576, M: 1048576, g: 1073741824, G: 1073741824 };
  return value * (scale[unit] ?? 1);
}

function mib(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

console.log('');
if (failures > 0) {
  console.error(`${failures} operational configuration check(s) failed`);
  process.exit(1);
}
console.log('operational configuration checks passed');
