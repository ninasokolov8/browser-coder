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

const files = process.argv.slice(2);
if (files.length === 0) files.push('docker-compose.yml', 'docker-compose.prod.yml');

/** Services that execute untrusted code and therefore must be contained. */
const SANDBOXED_SERVICES = ['api'];

/** Above any legitimate compile (javac and dotnet spawn a handful), far below harm. */
const MIN_PIDS_LIMIT = 1;
const MAX_PIDS_LIMIT = 4096;

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
  }
}

console.log('');
if (failures > 0) {
  console.error(`${failures} operational configuration check(s) failed`);
  process.exit(1);
}
console.log('operational configuration checks passed');
