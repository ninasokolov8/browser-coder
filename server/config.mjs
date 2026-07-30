/**
 * All configuration in one place.
 *
 * Moved out of server.mjs so limits stop being scattered constants. Every value
 * an operator can tune is parsed here, once, with its rationale next to it.
 *
 * This commit is a MOVE: every default is byte-identical to the pre-refactor
 * values, so behaviour does not change. Two capabilities are added but not yet
 * used for anything that alters behaviour:
 *   - `detectMemoryBudgetMb()` reads the real cgroup limit (blueprint V-36).
 *     `CONFIG` still derives concurrency from os.totalmem() exactly as before;
 *     Phase B switches it over deliberately, because the correct value is much
 *     smaller in a 512 MiB container and that is a real change in when the
 *     service reports capacity.
 *   - `CONFIG.tools` makes interpreter binaries configurable. Defaults are the
 *     current hardcoded names, so nothing changes in production - but it lets a
 *     developer whose `python3` is the Windows Store alias point at a real one,
 *     and it removes a hardcoded assumption from the execution layer.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const intFromEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stringFromEnv = (name, fallback) => {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
};

export const CPU_COUNT = os.cpus().length;
export const TOTAL_MEMORY_MB = Math.floor(os.totalmem() / 1024 / 1024);

/**
 * The memory this process is actually allowed to use.
 *
 * `os.totalmem()` reports the HOST's memory, which inside a container is
 * unrelated to the limit the kernel will enforce. On a 4 GiB droplet running a
 * 512 MiB container it over-reports by 8x, so any concurrency derived from it
 * guarantees an OOM kill under load rather than a clean capacity rejection.
 *
 * Reads cgroup v2 first, then v1, then falls back to the host value with a flag
 * so the caller can tell a real budget from a guess.
 *
 * @returns {{megabytes: number, source: 'cgroup-v2'|'cgroup-v1'|'host'}}
 */
export function detectMemoryBudgetMb() {
  const readLimit = filePath => {
    try {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      // cgroup v2 writes the literal string "max" when unlimited.
      if (raw === 'max') return null;
      const bytes = Number.parseInt(raw, 10);
      if (!Number.isFinite(bytes) || bytes <= 0) return null;
      // An unlimited v1 cgroup reports a sentinel near 2^63, which is not a
      // budget. Anything larger than the host cannot be a real limit either.
      const megabytes = Math.floor(bytes / 1024 / 1024);
      if (megabytes <= 0 || megabytes > TOTAL_MEMORY_MB) return null;
      return megabytes;
    } catch {
      return null;
    }
  };

  const v2 = readLimit('/sys/fs/cgroup/memory.max');
  if (v2 !== null) return { megabytes: v2, source: 'cgroup-v2' };

  const v1 = readLimit('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  if (v1 !== null) return { megabytes: v1, source: 'cgroup-v1' };

  return { megabytes: TOTAL_MEMORY_MB, source: 'host' };
}

export const MEMORY_BUDGET = detectMemoryBudgetMb();

export const CONFIG = {
  port: intFromEnv('PORT', 3001),
  isDev: process.env.NODE_ENV !== 'production',

  /**
   * External executables. Defaults are the previously hardcoded names, so
   * production behaviour is unchanged.
   */
  tools: {
    node: stringFromEnv('NODE_BIN', 'node'),
    python: stringFromEnv('PYTHON_BIN', 'python3'),
    php: stringFromEnv('PHP_BIN', 'php'),
    java: stringFromEnv('JAVA_BIN', 'java'),
    javac: stringFromEnv('JAVAC_BIN', 'javac'),
    dotnet: stringFromEnv('DOTNET_BIN', 'dotnet'),
  },

  // Retained verbatim. The pool these describe is unused dead code (blueprint
  // V-35) and is removed in Phase B; the values stay here until then so this
  // commit changes nothing.
  scaling: {
    minWorkers: Math.max(2, Math.floor(CPU_COUNT / 2)),
    maxWorkers: CPU_COUNT * 2,
    scaleUpThreshold: 0.7,
    scaleDownThreshold: 0.3,
    scaleCheckIntervalMs: 5000,
    workerIdleTimeoutMs: 60000,
  },

  execution: {
    timeoutMs: intFromEnv('RUN_TIMEOUT_MS', 10000),
    // Java pays for javac on every run; .NET pays for the first build.
    javaTimeoutMs: intFromEnv('JAVA_TIMEOUT_MS', 30000),
    csharpTimeoutMs: intFromEnv('CSHARP_TIMEOUT_MS', 45000),

    // Unchanged derivation, including the incorrect memory source. See
    // detectMemoryBudgetMb() above and blueprint V-36.
    maxConcurrent: Math.min(500, Math.floor(TOTAL_MEMORY_MB / 50)),
    // Configured but never read: no queue exists (blueprint V-35).
    maxQueueSize: Math.min(10000, Math.floor(TOTAL_MEMORY_MB / 10)),
    maxOutputChars: intFromEnv('MAX_OUTPUT_CHARS', 100000),

    // Project size policy. maxCodeChars applies to BOTH single-file `code` and
    // the SUM of every file's content in a multi-file project. The transport
    // body limit is derived from these rather than duplicating the number, so
    // raising a limit here raises the allowance too.
    //
    // The default is baked in rather than left at 100 KB on purpose: the prod
    // deploy reliably pulls a fresh image, but the compose env block only
    // reaches the container if the droplet's git pull succeeded. Relying on the
    // env var alone silently fell back to 100 KB when that pull was skipped.
    maxCodeChars: intFromEnv('MAX_CODE_CHARS', 750000),
    maxProjectFiles: intFromEnv('MAX_PROJECT_FILES', 300),
    maxPathChars: intFromEnv('MAX_PATH_CHARS', 300),

    // Interactive stdin sessions stay alive while the user thinks, so they need
    // their own kill switches: an idle timeout (a process blocked on input
    // forever is a resource-hold), an absolute lifetime, and concurrency caps.
    //
    // The per-IP cap is deliberately loose. A whole classroom sits behind one
    // NAT address, so it exists to stop one machine opening unbounded sessions,
    // not to ration legitimate simultaneous use.
    interactiveIdleTimeoutMs: intFromEnv('INTERACTIVE_IDLE_MS', 300000),
    interactiveMaxLifetimeMs: intFromEnv('INTERACTIVE_MAX_MS', 900000),
    maxInteractiveSessions: intFromEnv('MAX_INTERACTIVE_SESSIONS', 200),
    maxInteractiveSessionsPerIp: intFromEnv('MAX_INTERACTIVE_PER_IP', 50),
  },

  circuitBreaker: {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    halfOpenRequests: 3,
  },

  rateLimit: {
    windowMs: 60000,
    maxRequests: intFromEnv('RATE_LIMIT_MAX', 100),
  },

  health: {
    checkIntervalMs: 10000,
    unhealthyThreshold: 3,
  },

  preview: {
    maxHtmlBytes: intFromEnv('PREVIEW_MAX_BYTES', 5 * 1024 * 1024),
    maxFileCount: intFromEnv('PREVIEW_MAX_FILES', 250),
    maxPathChars: intFromEnv('PREVIEW_MAX_PATH_CHARS', 500),
    ttlMs: intFromEnv('PREVIEW_TTL_MS', 30 * 24 * 60 * 60 * 1000),
    cleanupIntervalMs: intFromEnv('PREVIEW_CLEANUP_INTERVAL_MS', 60 * 60 * 1000),
    storageDir:
      process.env.PREVIEW_STORAGE_DIR || path.join(os.tmpdir(), 'browser-coder-previews'),

    // Set in docker-compose.prod.yml but never read by the pre-refactor server
    // (blueprint V-38). Parsed here so the values are at least visible; Phase B
    // enforces them.
    maxStorageBytes: intFromEnv('PREVIEW_MAX_STORAGE_BYTES', 0),
    publishesPerMinute: intFromEnv('PREVIEW_PUBLISHES_PER_MINUTE', 0),
  },
};

/**
 * Body limit for /api/run.
 *
 * JSON-encoding source inflates it well past maxCodeChars: every newline, quote
 * and backslash doubles when escaped, non-ASCII costs extra UTF-8 bytes, and
 * each file adds JSON wrapper overhead. A limit equal to maxCodeChars therefore
 * rejects projects that are well inside the app's own size policy - which is
 * what produced the earlier spurious 413s. Sized for the actual worst case the
 * policy permits rather than by copying the same number.
 */
export const RUN_BODY_LIMIT_BYTES =
  CONFIG.execution.maxCodeChars * 3 +
  CONFIG.execution.maxProjectFiles * (CONFIG.execution.maxPathChars + 100) +
  4096;

export default CONFIG;
