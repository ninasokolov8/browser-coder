/**
 * Boots the real server as a child process for black-box contract tests.
 *
 * Black-box on purpose: these tests must pass identically against the
 * pre-refactor monolith and the post-refactor module tree, so they may not
 * import application internals. Anything they assert is, by construction, part
 * of the frozen public contract.
 *
 * Each boot gets its own temp and preview directories so suites cannot observe
 * each other's jobs or previews.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Reserve a free TCP port by opening and immediately closing a listener. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `server exited before becoming healthy (code=${child.exitCode} signal=${child.signalCode})`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      // Any HTTP answer proves the listener is up. /health deliberately returns
      // 503 under load, so status is not a readiness signal here.
      if (response.status > 0) return;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  throw new Error(`server did not answer /health within ${timeoutMs}ms (last error: ${lastError})`);
}

/**
 * The HTTP surface the tests use.
 *
 * Shared verbatim by the spawned-server and remote-server paths, so an assertion
 * cannot behave differently depending on which one it is talking to.
 */
function makeClient(baseUrl) {
  const parse = async response => {
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: plain-text errors and HTML previews are both expected.
      body = null;
    }
    return { status: response.status, headers: response.headers, body, text };
  };

  return {
    /** POST JSON and return { status, headers, body, text }. */
    async postJson(routePath, payload, init = {}) {
      return parse(
        await fetch(`${baseUrl}${routePath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
          body: JSON.stringify(payload),
          signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? 90000),
        }),
      );
    },

    async get(routePath, init = {}) {
      return parse(
        await fetch(`${baseUrl}${routePath}`, {
          headers: init.headers,
          // manual, so a redirect is observable rather than silently followed:
          // the preview compatibility path depends on which one happens.
          redirect: init.redirect ?? 'manual',
          signal: AbortSignal.timeout(init.timeoutMs ?? 30000),
        }),
      );
    },
  };
}

/**
 * Start a server instance.
 *
 * @param {object} [options]
 * @param {Record<string,string>} [options.env] extra environment for the child
 * @param {number} [options.startupTimeoutMs] defaults to 180s, because the
 *   current implementation can block startup on a synchronous C# template build
 *   (see blueprint V-37). Lower this once that is non-blocking.
 */
export async function startServer(options = {}) {
  // CONTRACT_TARGET_URL points the suite at an already-running server instead of
  // spawning one. This is how the language matrix gets verified for real: the
  // authoring host has no PHP, its `python3` is the Windows Store alias, and its
  // JRE is version 8 against a version 17 compiler, so Python, PHP, Java and
  // .NET 8 can only be exercised inside the production image.
  //
  // Because the suite is black-box, the same assertions run unchanged against a
  // container. Nothing below this branch knows which it is talking to.
  if (process.env.CONTRACT_TARGET_URL) {
    const remoteUrl = process.env.CONTRACT_TARGET_URL.replace(/\/+$/, '');
    await waitForHealth(
      remoteUrl,
      { exitCode: null, signalCode: null },
      options.startupTimeoutMs ?? 60000,
    );
    return {
      baseUrl: remoteUrl,
      port: Number.parseInt(new URL(remoteUrl).port || '80', 10),
      // A remote server's job root lives inside the container, so a test that
      // needs a host-visible path must skip rather than pretend.
      sandboxRoot: null,
      previewDir: null,
      serverLog: () => '(remote server: logs are in the container)',
      stop: async () => {},
      ...makeClient(remoteUrl),
    };
  }

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-contract-'));
  const previewDir = path.join(sandboxRoot, 'previews');
  fs.mkdirSync(previewDir, { recursive: true });

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      TMPDIR: sandboxRoot,
      PREVIEW_STORAGE_DIR: previewDir,
      // Keep contract runs from being throttled by the shared rate limiter.
      RATE_LIMIT_MAX: '100000',
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const logLines = [];
  const record = chunk => {
    const text = chunk.toString();
    logLines.push(text);
    if (logLines.length > 500) logLines.shift();
    if (process.env.CONTRACT_VERBOSE) process.stderr.write(text);
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  };

  try {
    await waitForHealth(baseUrl, child, options.startupTimeoutMs ?? 180000);
  } catch (error) {
    const tail = logLines.join('').split('\n').slice(-40).join('\n');
    await stop();
    throw new Error(`${error.message}\n--- server output (tail) ---\n${tail}`);
  }

  return {
    baseUrl,
    port,
    sandboxRoot,
    previewDir,
    serverLog: () => logLines.join(''),
    stop,
    ...makeClient(baseUrl),
  };
}

/**
 * Run an interactive session and collect its NDJSON events.
 *
 * The output stream is the response body of the same request that starts the
 * program, so this drives both halves: it reads events as they arrive and
 * invokes `onEvent`, which may post stdin using the returned session id.
 *
 * @returns {Promise<{compile?: object, events: object[], sessionId: string|null}>}
 */
export async function runInteractive(server, payload, options = {}) {
  const response = await fetch(`${server.baseUrl}/api/run/interactive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(options.timeoutMs ?? 90000),
  });

  const contentType = response.headers.get('content-type') || '';

  // A compile/lint failure never becomes a live session: it answers as JSON.
  if (!contentType.includes('x-ndjson')) {
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { compile: body?.compile ?? null, events: [], sessionId: null, status: response.status, body };
  }

  const events = [];
  let sessionId = null;
  let buffer = '';

  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });

    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error(`interactive stream emitted a non-JSON line: ${line}`);
      }
      events.push(event);
      if (event.type === 'session') sessionId = event.sessionId;
      if (options.onEvent) await options.onEvent(event, sessionId, server);
    }
  }

  return { events, sessionId, status: response.status };
}
