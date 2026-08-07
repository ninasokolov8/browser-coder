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
  // An explicit statement of the real limit, for a deployment where the process is
  // constrained by something the cgroup files do not describe - a VM sized for this
  // service, a systemd slice, or a host where /sys/fs/cgroup is not mounted. Also
  // the only way to exercise the small-container path without a container.
  const declared = intFromEnv('MEMORY_BUDGET_MB', 0);
  if (declared > 0) return { megabytes: declared, source: 'declared' };

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

/**
 * Memory kept for the API process itself: express, the session registry, buffered
 * output, and the V8 heap of this process. Spending the whole budget on concurrent
 * runs leaves nothing for the thing supervising them, and the first symptom is the
 * supervisor being killed rather than a run being refused.
 */
function defaultReserveMb(budgetMb) {
  // A flat 256 starves a small container: the production compose limit is 512 MB,
  // where a fixed reserve would take half the budget and leave room for five runs.
  // A quarter of the budget, clamped, keeps the reserve proportionate at both ends -
  // 128 MB is about what express plus the session registry plus this process's own
  // V8 heap actually occupies, and above 1 GB more than 256 MB is waste.
  return Math.min(256, Math.max(128, Math.floor(budgetMb / 4)));
}

const SERVER_RESERVE_MB = intFromEnv('SERVER_RESERVE_MB', 0);

/**
 * Assumed peak resident memory of one run.
 *
 * Deliberately an assumption with a name rather than a magic 50 buried in a
 * division. It is also optimistic: the Java adapter passes `-Xmx128m` and node gets
 * `--max-old-space-size=128`, so a heavy run can exceed this. It is retained as the
 * default because it is the value this deployment has been sized against, and
 * lowering concurrency further is a capacity decision rather than a bug fix - but
 * `RUN_MEMORY_MB` now exists to make that decision without editing code.
 */
const RUN_MEMORY_MB = intFromEnv('RUN_MEMORY_MB', 50);

/**
 * How many runs may execute at once (V-36).
 *
 * The previous derivation was `min(500, floor(TOTAL_MEMORY_MB / 50))` - the HOST's
 * memory. On the production droplet that is 30 GiB against a 1 GiB container, so
 * the limit computed to the 500 ceiling: **eight times** the memory actually
 * available. Admission therefore never refused anything, and the kernel enforced
 * the real limit by OOM-killing the container. A capacity control that is 8x too
 * high is not a capacity control; it converts a clean 503 into an outage.
 *
 * Derived from the real budget now, minus the server's own reserve. MAX_CONCURRENT
 * overrides it outright for an operator who has measured something better.
 */
export function deriveMaxConcurrent({
  budgetMb,
  reserveMb = SERVER_RESERVE_MB || defaultReserveMb(budgetMb),
  perRunMb = RUN_MEMORY_MB,
  override = 0,
  ceiling = 500,
}) {
  if (override > 0) return override;

  const available = Math.max(0, budgetMb - reserveMb);
  // At least 1: a tiny container should run one program slowly rather than refuse
  // every request and look broken.
  return Math.max(1, Math.min(ceiling, Math.floor(available / perRunMb)));
}

const MAX_CONCURRENT = deriveMaxConcurrent({
  budgetMb: MEMORY_BUDGET.megabytes,
  override: intFromEnv('MAX_CONCURRENT', 0),
});

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
    // The C# debugger: dncdbg, the netcoredbg maintainer's fork, which is the only
    // .NET debugger that works on musl (see blueprint section 49). Not packaged for
    // Alpine, so the image unpacks its published linux-musl-x64 build here. Where it
    // is absent a debug run reports `debug:unsupported`; an ordinary run is unaffected.
    dotnetDebugger: stringFromEnv('DOTNET_DEBUGGER_BIN', '/opt/dncdbg/dncdbg'),
  },

  // The `scaling` block is gone (V-35). It configured a worker pool and an
  // autoscaler that did not exist - minWorkers, maxWorkers, scaleUpThreshold and
  // the rest were read by nothing. Configuration that describes machinery the
  // system does not have is worse than absent: it tells the next reader there is a
  // pool to tune, and it makes the real limit harder to find.

  execution: {
    timeoutMs: intFromEnv('RUN_TIMEOUT_MS', 10000),
    // Java pays for javac on every run; .NET pays for the first build.
    javaTimeoutMs: intFromEnv('JAVA_TIMEOUT_MS', 30000),
    csharpTimeoutMs: intFromEnv('CSHARP_TIMEOUT_MS', 45000),

    // Derived from the real memory budget rather than the host's (V-36). See
    // deriveMaxConcurrent() above.
    maxConcurrent: MAX_CONCURRENT,
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

    // Bounded by the same memory budget as buffered runs, because since A3/A4
    // every run IS a session holding a live process - the two limits describe the
    // same resource. Leaving this at a flat 200 while `maxConcurrent` derives to
    // 15 would mean the session cap never binds and the honest limit is bypassed
    // by using the interactive endpoint, which is the one the IDE always uses.
    maxInteractiveSessions: Math.min(
      intFromEnv('MAX_INTERACTIVE_SESSIONS', 200),
      MAX_CONCURRENT,
    ),
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

  /**
   * The asset cache: content-addressed, shared, and disposable.
   *
   * A project with a 2 MiB image sends it base64-encoded on EVERY run - 2.8 MB each
   * time. Thirty runs while working on one exercise is 84 MB of the same picture.
   * Sending a digest instead, and the bytes only when the server does not have them,
   * makes that 2.8 MB plus twenty-nine short requests.
   *
   * `directory` MUST be shared across replicas to be worth anything - a per-replica
   * cache hits 1/N of the time and a miss costs an extra round trip. Where it is not
   * writable the feature simply does not engage and every run carries its assets
   * inline, exactly as before.
   *
   * It is a cache and never a store of record: the browser workspace is where a
   * student's files live, and losing every entry here costs one re-upload.
   */
  blobs: {
    directory: process.env.BLOB_CACHE_DIR || path.join(os.tmpdir(), 'browser-coder-blobs'),
    maxBytes: intFromEnv('BLOB_CACHE_MAX_BYTES', 512 * 1024 * 1024),
    ttlMs: intFromEnv('BLOB_CACHE_TTL_MS', 7 * 24 * 60 * 60 * 1000),
    sweepIntervalMs: intFromEnv('BLOB_CACHE_SWEEP_MS', 60 * 60 * 1000),
    /** Largest single asset accepted. Matches the client-side import limit. */
    maxBlobBytes: intFromEnv('BLOB_MAX_BYTES', 4 * 1024 * 1024),
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
