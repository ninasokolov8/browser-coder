/**
 * Unified Smart Server for Web IDE
 * 
 * Auto-scaling, fail-safe, production-ready server that works in dev & prod.
 * Designed for 10k-50k concurrent users with zero configuration.
 * 
 * Features:
 * - Auto-scaling worker pool based on CPU/memory/queue load
 * - Every run executes for real: program output is never cached or coalesced,
 *   so random/time/input-dependent programs behave correctly on every run
 * - Circuit breaker pattern for fail-safety
 * - Graceful degradation under extreme load
 * - Health monitoring and self-healing
 * - Zero-config cloud deployment ready
 * - SECURITY: Code sandboxing and dangerous function blocking
 */

import express from "express";
import http from "http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

// ── Extracted modules ───────────────────────────────────────────────────────
// Phase A of the architecture refactor. These were inline in this file; the
// security corpus was moved by script and proven equivalent over 2,484
// comparisons (attack corpus x 6 languages, every shipped starter, and the
// Python source-stripper) rather than by retyping it.
import { CONFIG, CPU_COUNT, MEMORY_BUDGET, TOTAL_MEMORY_MB, RUN_BODY_LIMIT_BYTES } from './server/config.mjs';
import { log } from './server/logging.mjs';
import SECURITY from './server/security/patterns.mjs';
import { validateCodeSecurity } from './server/security/validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Execution core (Phase A3/A4) ────────────────────────────────────────────
// What used to live here: the turtle stdout parser, the TypeScript compiler
// loader, per-language error cleaners, CircuitBreaker, ProcessPool and the
// 1,600-line SmartExecutor with its four implementations of every language
// (single/multi x buffered/interactive).
//
// It is now one pipeline over six adapters. Transport is not a language
// concern, and a single file is a one-file project, so 24 code paths became 6.
import { ExecutionPipeline } from './server/execution/pipeline.mjs';
import { SessionRegistry } from './server/execution/session-registry.mjs';
import { reapAbandonedJobs } from './server/execution/job.mjs';
import { registerRunRoutes } from './server/http/routes/run.mjs';
import { registerPreviewRoutes } from './server/http/routes/previews.mjs';
import { PreviewStore } from './server/previews/store.mjs';
import { applyRequestContext } from './server/http/middleware/request-context.mjs';
import { createCorsMiddleware } from './server/http/middleware/cors.mjs';
import { RateLimiter, createRateLimitMiddleware } from './server/http/middleware/rate-limit.mjs';
import { extensionFor, loadCatalog } from './server/languages/catalog.mjs';

// The preview store owns its own directory, cleanup timer and readiness flag.
// Constructed here rather than at import time so that importing the server no
// longer touches the filesystem or arms a timer as a side effect.
const previewStore = new PreviewStore({
  storageDir: CONFIG.preview.storageDir,
  limits: CONFIG.preview,
  log,
});
// ============================================
// SERVER SETUP
// ============================================
// Declared here rather than beside gracefulShutdown() because the health
// handlers below read it. A `let` further down the file is in its temporal dead
// zone until evaluated, so a request arriving during startup would throw.
let shuttingDown = false;

const app = express();
const server = http.createServer(app);

// Job directories and warm toolchain templates both live under the process
// temp root, but every job now gets its OWN directory beneath it - see
// server/execution/job.mjs for the three defects the shared root caused.
const EXECUTION_ROOT = path.join(os.tmpdir(), 'browser-coder-exec-' + process.pid);
fs.mkdirSync(EXECUTION_ROOT, { recursive: true });

const pipeline = new ExecutionPipeline({
  config: CONFIG,
  jobRoot: EXECUTION_ROOT,
  templateRoot: EXECUTION_ROOT,
});
const sessions = new SessionRegistry({ config: CONFIG });
const rateLimiter = new RateLimiter({
  windowMs: CONFIG.rateLimit.windowMs,
  maxRequests: CONFIG.rateLimit.maxRequests,
});
rateLimiter.start();

// Reap job directories left by a crash or a hard kill. Live session
// directories are excluded, because a student thinking about what to type is
// not garbage. Unlike the sweep this replaces, one undeletable entry cannot
// abort the pass (V-25).
const jobReaperTimer = setInterval(() => {
  reapAbandonedJobs(EXECUTION_ROOT, 60 * 60 * 1000, sessions.liveDirectories());
}, 5 * 60 * 1000);
jobReaperTimer.unref?.();

// Explicit, because it creates a directory and arms a sweep. This used to happen
// as an import-time side effect, which meant merely importing the server touched
// the filesystem. A failure here is reported and survivable: previews answer 503
// while code execution carries on unaffected.
previewStore.start();

// Language configs cache
let languageConfigsCache = null;
let languageConfigsCacheTime = 0;

async function loadLanguageConfigs() {
  if (languageConfigsCache && Date.now() - languageConfigsCacheTime < 300000) {
    return languageConfigsCache;
  }
  
  const languagesDir = path.join(__dirname, "languages");
  const languages = {};
  
  try {
    const dirs = fs.readdirSync(languagesDir);
    for (const dir of dirs) {
      const configPath = path.join(languagesDir, dir, "config.json");
      if (fs.existsSync(configPath)) {
        languages[dir] = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }
    }
  } catch (err) {
    log('error', 'Failed to load language configs', { error: err.message });
  }
  
  languageConfigsCache = languages;
  languageConfigsCacheTime = Date.now();
  return languages;
}

applyRequestContext(app, { config: CONFIG, runBodyLimitBytes: RUN_BODY_LIMIT_BYTES });

// Order is behaviour: CORS answers preflights before anything else touches the
// request, and the rate limiter must sit in front of every /api route rather
// than beside them, or a route registered earlier would not be covered.
app.use('/api', createCorsMiddleware({ isDev: CONFIG.isDev, log }));
app.use('/api', createRateLimitMiddleware({ limiter: rateLimiter }));

// ============================================
// API ROUTES
// ============================================

// ── Health, liveness and readiness ─────────────────────────────────────────
//
// V-29: /health was derived only from buffered `activeExecutions`, so interactive
// sessions were invisible to it, and it returned 503 at 90% load - which the
// container healthcheck treats as death, so heavy load caused restarts, which
// shed the load, which is a feedback loop rather than a health signal.
//
// The three endpoints now answer three different questions:
//   /live   is this process working?      -> restart me if not
//   /ready  may this instance take work?  -> stop sending me traffic if not
//   /health legacy, kept 200-on-healthy because Step-Up's IdeHelper::isAvailable()
//           requires exactly 200, and it is derived from readiness components.

function executionLoad() {
  const stats = pipeline.stats();
  return {
    ...stats,
    interactiveSessions: sessions.size,
    maxInteractiveSessions: CONFIG.execution.maxInteractiveSessions,
  };
}

/** Saturated means "do not send more work", never "this process is broken". */
function isSaturated() {
  const runsFull = pipeline.activeCount >= CONFIG.execution.maxConcurrent;
  const sessionsFull = sessions.size >= CONFIG.execution.maxInteractiveSessions;
  return runsFull || sessionsFull;
}

app.get("/live", (req, res) => {
  // Deliberately unconditional: reaching this handler proves the event loop is
  // turning and the HTTP stack is intact, which is the entire question. Checking
  // dependencies or saturation here is what produces restart storms.
  res.status(200).json({ status: "live", pid: process.pid });
});

app.get("/ready", (req, res) => {
  const draining = shuttingDown;
  const saturated = isSaturated();
  const ready = !draining && !saturated;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : draining ? "draining" : "saturated",
    draining,
    saturated,
    ...executionLoad(),
  });
});

app.get("/health", (req, res) => {
  // Legacy shape. Saturation is reported as "degraded" with a 200, because a
  // saturated instance is working correctly - it is simply busy - and answering
  // 503 here is what made the healthcheck kill it.
  const load = executionLoad();
  res.status(shuttingDown ? 503 : 200).json({
    status: shuttingDown ? "draining" : isSaturated() ? "degraded" : "healthy",
    ...load,
    config: {
      maxConcurrent: CONFIG.execution.maxConcurrent,
      cpuCount: CPU_COUNT,
      memoryMB: TOTAL_MEMORY_MB,
    },
  });
});

// Get languages
// Shareable multi-file web previews. The store, the CSP policy and the HTML
// wrappers live in server/previews/; these are just the three endpoints.
registerPreviewRoutes(app, { store: previewStore, log });

app.get("/api/languages", async (req, res) => {
  try {
    const languages = await loadLanguageConfigs();
    res.json(languages);
  } catch (err) {
    res.status(500).json({ error: "Failed to load languages" });
  }
});

// Get starter code
app.get("/api/starter/:language/:version", async (req, res) => {
  try {
    const { language, version } = req.params;
    const starterPath = path.join(__dirname, "languages", language, "starters", `${version}.${getExtension(language)}`);
    
    if (!fs.existsSync(starterPath)) {
      return res.status(404).json({ error: "Starter not found" });
    }
    
    const code = fs.readFileSync(starterPath, "utf-8");
    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: "Failed to load starter" });
  }
});

// getExtension() used to hardcode a language->extension map here, duplicating
// languages/*/config.json, so adding a language meant editing the core (N-09).
// It now comes from the catalog.
const getExtension = extensionFor;

// ── Run routes ─────────────────────────────────────────────────────────────
// /api/run, /api/run/interactive and the session commands. These handlers hold
// no language logic: they translate HTTP to a pipeline request and the result
// back into the frozen v1 envelope.
registerRunRoutes(app, { pipeline, sessions, config: CONFIG });

// Stats endpoint. Route kept for compatibility; the payload is deliberately
// coarse (counts and percentages, no identities, paths or source).
app.get("/api/stats", (req, res) => {
  res.json(executionLoad());
});

// ============================================
// OPERATIONS: SECURITY REPORT PLANE (V-45, N-08)
// ============================================
//
// What was here: `POST /api/reports/run-tests` with no authentication, no CSRF
// protection and an explicitly disabled cooldown, so one anonymous request
// spawned the entire security suite - hundreds of internal executions - and
// `/api/reports/status` and `/api/reports/output` streamed the resulting terminal
// output to anyone who asked. Step-Up sends `hacklab=1` for both student and
// instructor sandboxes, so this was reachable from a learner iframe.
//
// Product decision recorded in blueprint 33.2: learners keep the read-only report
// pages, so `hacklab=1` shows no visible regression, and EXECUTION moves behind
// administrative authorisation.
//
// The line drawn is between reading a published artifact and commanding the
// service to do expensive work. The first is harmless; the second is an
// operations action and needs an operator.

/**
 * Administrative authorisation for operations endpoints.
 *
 * Requires ADMIN_TOKEN to be configured AND presented. Deliberately fails CLOSED
 * when unset: an operations endpoint that becomes public because an environment
 * variable is missing is exactly how the original defect would come back. The
 * response is 404 rather than 401 so an unauthenticated caller cannot even
 * confirm the route exists.
 */
function requireAdmin(req, res) {
  const expected = process.env.ADMIN_TOKEN || '';
  if (expected.length < 16) {
    log('warn', 'admin_route_unconfigured', { path: req.path });
    res.status(404).type('text/plain').send('Not found');
    return false;
  }

  const presented =
    req.get('x-admin-token') ||
    (req.get('authorization') || '').replace(/^Bearer\s+/i, '');

  // Constant-time compare so the token cannot be recovered a byte at a time.
  const a = Buffer.from(String(presented));
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    log('warn', 'admin_auth_failed', { path: req.path });
    res.status(404).type('text/plain').send('Not found');
    return false;
  }
  return true;
}

// Listing published reports stays available: it returns filenames for artifacts
// that are already served as static files under /reports, so withholding the
// index while serving the files would be theatre. It no longer parses arbitrary
// JSON from disk into the response, which is where N-08's disclosure came from.
app.get("/api/reports", async (req, res) => {
  try {
    const reportsDir = path.join(__dirname, "security", "reports");
    if (!fs.existsSync(reportsDir)) return res.json([]);

    const reports = fs
      .readdirSync(reportsDir)
      .filter(file => file !== 'index.html' && /\.(html|json)$/.test(file))
      .map(file => ({
        name: file,
        type: file.endsWith('.html') ? 'html' : 'json',
        path: `/reports/${file}`,
      }));

    return res.json(reports);
  } catch (err) {
    log('error', 'reports_api_error', { error: err.message });
    return res.status(500).json({ error: 'Failed to load reports' });
  }
});

// ── Operations only: running the suite and reading its terminal output ──────
let testRunStatus = { running: false, startTime: null, progress: null, output: '' };

/** Cooldown, re-enabled. "Disabled for now" plus no auth was the amplifier. */
const TEST_RUN_COOLDOWN_MS = 15 * 60 * 1000;
let lastTestRunAt = 0;

app.get("/api/reports/can-run", (req, res) => {
  if (!requireAdmin(req, res)) return undefined;
  const elapsed = Date.now() - lastTestRunAt;
  const ready = !testRunStatus.running && elapsed >= TEST_RUN_COOLDOWN_MS;
  return res.json({
    canRun: ready,
    running: testRunStatus.running,
    lastRun: lastTestRunAt ? new Date(lastTestRunAt).toISOString() : null,
    cooldownRemainingMs: Math.max(0, TEST_RUN_COOLDOWN_MS - elapsed),
  });
});

app.post("/api/reports/run-tests", async (req, res) => {
  if (!requireAdmin(req, res)) return undefined;

  if (testRunStatus.running) {
    return res
      .status(409)
      .json({ error: 'Tests already running', startTime: testRunStatus.startTime });
  }

  const elapsed = Date.now() - lastTestRunAt;
  if (elapsed < TEST_RUN_COOLDOWN_MS) {
    return res.status(429).json({
      error: 'Test suite is cooling down',
      retryAfterMs: TEST_RUN_COOLDOWN_MS - elapsed,
    });
  }

  lastTestRunAt = Date.now();
  testRunStatus = {
    running: true,
    startTime: new Date().toISOString(),
    progress: 'starting',
    output: '',
  };

  res.json({ status: 'started', startTime: testRunStatus.startTime });

  const { spawn: nodeSpawn } = await import('node:child_process');
  const testProcess = nodeSpawn(
    process.execPath,
    ['security/run.mjs', `--server=http://127.0.0.1:${CONFIG.port}`],
    {
      cwd: __dirname,
      env: { ...process.env, API_URL: `http://127.0.0.1:${CONFIG.port}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  // Bounded. The previous buffer grew without limit for the lifetime of the
  // process, which is a slow leak in a long-running server.
  const MAX_OUTPUT = 512 * 1024;
  const append = data => {
    testRunStatus.output = (testRunStatus.output + data.toString()).slice(-MAX_OUTPUT);
    testRunStatus.progress = 'running';
  };
  testProcess.stdout.on('data', append);
  testProcess.stderr.on('data', append);

  testProcess.on('close', code => {
    testRunStatus = {
      running: false,
      startTime: null,
      progress: code === 0 ? 'completed' : 'failed',
      output: testRunStatus.output,
      exitCode: code,
    };
    log('info', 'test_run_completed', { exitCode: code });
  });

  testProcess.on('error', err => {
    testRunStatus = {
      running: false,
      startTime: null,
      progress: 'error',
      output: testRunStatus.output,
    };
    log('error', 'test_run_error', { error: err.message });
  });

  return undefined;
});

app.get("/api/reports/status", (req, res) => {
  if (!requireAdmin(req, res)) return undefined;
  return res.json({
    running: testRunStatus.running,
    progress: testRunStatus.progress,
    startTime: testRunStatus.startTime,
    exitCode: testRunStatus.exitCode ?? null,
  });
});

// Terminal output is operational data: it names internal hosts, ports and paths,
// and is exactly what an attacker probing containment wants to read.
app.get("/api/reports/output", (req, res) => {
  if (!requireAdmin(req, res)) return undefined;
  const offset = Math.max(0, Number.parseInt(req.query.offset || '0', 10) || 0);
  const output = testRunStatus.output || '';
  return res.json({
    running: testRunStatus.running,
    progress: testRunStatus.progress,
    output: output.slice(offset),
    totalLength: output.length,
  });
});

// Serve security reports directory (always enable - volume mount creates it)
const reportsPath = path.join(__dirname, "security", "reports");
// Ensure directory exists
if (!fs.existsSync(reportsPath)) {
  fs.mkdirSync(reportsPath, { recursive: true });
}
app.use("/reports", express.static(reportsPath, { index: 'index.html' }));

// Serve static files in production.
//
// Important:
// - Hashed Vite assets must either return the real file or a real 404.
// - They must never fall through to index.html, otherwise browsers receive
//   text/html for JavaScript/CSS and report MIME-type/preload failures.
// - index.html is not cached so a deployment cannot leave users with an old
//   HTML document that references assets removed by the new image.
if (!CONFIG.isDev) {
  const distPath = path.join(__dirname, "dist");

  if (fs.existsSync(distPath)) {
    const assetsPath = path.join(distPath, "assets");

    app.use(
      "/assets",
      express.static(assetsPath, {
        fallthrough: false,
        index: false,
        immutable: true,
        maxAge: "1y",
        setHeaders(res) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          res.setHeader("X-Content-Type-Options", "nosniff");
        },
      }),
    );

    app.get(["/", "/index.html"], (req, res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.sendFile(path.join(distPath, "index.html"));
    });

    app.use(
      express.static(distPath, {
        fallthrough: true,
        index: false,
        maxAge: 0,
        setHeaders(res, filePath) {
          if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          }
        },
      }),
    );

    // SPA fallback is only for navigation routes. Requests that look like
    // files receive a real 404 instead of index.html.
    app.get("*", (req, res, next) => {
      if (path.extname(req.path)) return next();

      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.sendFile(path.join(distPath, "index.html"));
    });

    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      return res.status(404).type("text/plain").send("Static asset not found");
    });
  }
}

// ============================================
// GRACEFUL SHUTDOWN AND DRAIN
// ============================================
//
// V-30: the previous implementation closed the HTTP server and then exited.
// Running jobs and live interactive sessions were neither terminated nor
// reconciled, so every deploy left orphaned compilers and interpreters holding
// CPU and memory until the container was destroyed - and their job directories
// behind, which the broken reaper (V-25) then never collected.
//
// Drain is now ordered, and the order matters:
//   1. flip readiness false, so the load balancer stops sending new work while
//      this instance is still able to finish what it has;
//   2. stop accepting new connections;
//   3. terminate live sessions explicitly, so each one sends a real terminal
//      event instead of the client seeing a truncated stream;
//   4. reap job directories;
//   5. exit.

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  // Readiness is already false at this point because /ready reads this flag, so
  // the drain window begins before any connection is refused.
  log('info', 'shutdown_started', { signal, activeRuns: pipeline.activeCount, sessions: sessions.size });

  previewStore.stop();
  rateLimiter.stop();
  clearInterval(jobReaperTimer);

  const stopped = sessions.stopAll();
  if (stopped > 0) log('info', 'shutdown_sessions_terminated', { count: stopped });

  server.close(() => {
    // Best-effort final sweep. Live directories are empty by now because every
    // session was terminated above.
    try {
      reapAbandonedJobs(EXECUTION_ROOT, 0, new Set());
    } catch {
      /* nothing more we can do while exiting */
    }
    log('info', 'shutdown_complete');
    process.exit(0);
  });

  // Backstop. A connection that will not close must not hold the deploy open
  // forever, but 10s is enough for a terminated session to flush its exit event.
  setTimeout(() => {
    log('warn', 'shutdown_forced', { activeRuns: pipeline.activeCount });
    process.exit(1);
  }, 10000).unref?.();
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

// ============================================
// START SERVER
// ============================================
server.listen(CONFIG.port, '0.0.0.0', () => {
  log('info', 'server_started', {
    port: CONFIG.port,
    mode: CONFIG.isDev ? 'development' : 'production',
    maxConcurrent: CONFIG.execution.maxConcurrent,
    cpuCount: CPU_COUNT,
    memoryMB: TOTAL_MEMORY_MB,
    memoryBudgetMB: MEMORY_BUDGET.megabytes,
    memoryBudgetSource: MEMORY_BUDGET.source,
    languages: Object.keys(loadCatalog()).sort().join(','),
  });

  // The previous startup executed two real programs through the executor to prime
  // process pools. Those pools were dead code (V-35), and running user-shaped
  // code from the listen callback - outside the request path, outside admission,
  // before preview storage was confirmed - was an unguarded execution path for no
  // benefit (N-07). Preloading the language catalog achieves the actual goal (a
  // warm first request) without starting anything.
  loadCatalog({ force: true });
});
