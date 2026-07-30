/**
 * Runs the browser smoke test end to end: dev server, receiver, headless browser.
 *
 * Deliberately not `--dump-dom`. That exits the browser as soon as loading
 * finishes, which destroys the page before an async test touching IndexedDB and
 * debounced timers can complete - so it always reports "running…". Instead the
 * browser stays open and the page reports its own result, and this process exits
 * with that result.
 *
 * Finds a browser rather than depending on Playwright: this repo needs one browser
 * on a developer machine and in CI, not a matrix, and a ~150MB download for a
 * single smoke test is a poor trade.
 *
 *   node tests/browser/run.mjs
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { once } from 'node:events';

let VITE_PORT = 0; // set from the suite definition below
const RECEIVER_PORT = Number(process.env.RECEIVER_PORT || 5200);
// Which page to run, and on which port.
//
// The port is part of the suite definition, not a preference: stepup-bus.ts only
// accepts postMessage from an allowlisted origin, so the embedded suite MUST be
// served from one of them or every message is correctly ignored and the test fails
// for entirely the wrong reason.
const SUITES = {
  workspace: { page: '/tests/browser/workspace-smoke.html', port: 5199 },
  'app-boot': { page: '/tests/browser/app-boot.html', port: 5199 },
  embedded: { page: '/tests/browser/embedded.html?embed-host=1', port: 3000 },
};
const SUITE = process.argv[2] || 'workspace';
const selected = SUITES[SUITE];
if (!selected) {
  process.stderr.write(
    `Unknown suite "${SUITE}". Known: ${Object.keys(SUITES).join(', ')}\n`,
  );
  process.exit(1);
}
const PAGE = selected.page;
VITE_PORT = Number(process.env.SMOKE_VITE_PORT || selected.port);

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 120000);

const BROWSER_CANDIDATES = [
  process.env.SMOKE_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// Uses the hostname rather than a literal address: on Windows, Vite binds to
// [::1] only, so probing 127.0.0.1 reports the server as down while it is
// serving happily on the same port over IPv6.
async function waitForServer(url, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

/** Resolves with the page's report. */
function startReceiver() {
  let resolveReport;
  const report = new Promise(resolve => {
    resolveReport = resolve;
  });

  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'content-type');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (request.method === 'OPTIONS') return void response.writeHead(204).end();
    if (request.method !== 'POST') return void response.writeHead(405).end();

    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on('end', () => {
      response.writeHead(204).end();
      try {
        resolveReport(JSON.parse(body));
      } catch {
        resolveReport({ lines: [`could not parse report: ${body.slice(0, 500)}`], failures: 1 });
      }
    });
  });

  server.listen(RECEIVER_PORT, '127.0.0.1');
  return { server, report };
}

const browser = findBrowser();
if (!browser) {
  process.stderr.write(
    'No Chrome or Edge found. Set SMOKE_BROWSER to a Chromium binary.\n' +
      `Looked in:\n${BROWSER_CANDIDATES.map(path => `  ${path}`).join('\n')}\n`,
  );
  process.exit(1);
}

const started = [];
function cleanup() {
  for (const child of started) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

// Reuse an already-running dev server when there is one, so an interactive
// session does not fight over the port.
let vite = null;
const alreadyRunning = await waitForServer(`http://localhost:${VITE_PORT}/`, 1);
if (!alreadyRunning) {
  process.stderr.write(`starting vite on ${VITE_PORT}…\n`);
  vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(VITE_PORT), '--strictPort'],
    { stdio: 'ignore', shell: process.platform === 'win32' },
  );
  started.push(vite);

  if (!(await waitForServer(`http://localhost:${VITE_PORT}/`))) {
    process.stderr.write('vite did not become ready\n');
    process.exit(1);
  }
} else {
  process.stderr.write(`reusing the dev server already on ${VITE_PORT}\n`);
}

const { server, report } = startReceiver();
await once(server, 'listening');

// A fresh profile every run. Reusing it carries IndexedDB across runs, so the
// workspace is not empty at boot and assertions about counts quietly drift - which
// is exactly how a test starts depending on the one before it.
const profileDir = `${process.env.TEMP || '/tmp'}/browser-coder-smoke-profile`;
try {
  rmSync(profileDir, { recursive: true, force: true });
} catch {
  /* first run, or the browser still holds a handle; both are tolerable */
}

process.stderr.write(`launching ${browser} for suite "${SUITE}"\n`);
const chrome = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    // A throwaway profile, so the test never inherits or leaves browsing state.
    `--user-data-dir=${profileDir}`,
    `http://localhost:${VITE_PORT}${PAGE}`,
  ],
  { stdio: 'ignore' },
);
started.push(chrome);

const timeout = new Promise(resolve =>
  setTimeout(() => resolve({ lines: ['TIMED OUT waiting for the page to report'], failures: 1 }), TIMEOUT_MS),
);

const result = await Promise.race([report, timeout]);
server.close();

process.stdout.write(`${(result.lines || []).join('\n')}\n`);
const failures = Number(result.failures ?? 1);
process.stdout.write(failures === 0 ? '\nBROWSER SMOKE: PASSED\n' : `\nBROWSER SMOKE: ${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
