/**
 * Browser Coder - composition root.
 *
 * This file used to be the server: 4,563 lines holding the execution engine, the
 * security corpus, the preview store, every route, the middleware and the shutdown
 * logic. It is now only the wiring - what exists, in what order, and what starts
 * when. Every decision below should be either self-evident or one comment long; if
 * something needs a paragraph, the paragraph belongs in the module that owns it.
 *
 * Two ordering rules govern everything here, and both are observable behaviour
 * rather than style:
 *
 *   - Middleware runs in registration order, so a route registered before a guard
 *     is NOT covered by it.
 *   - Anything that touches the filesystem or arms a timer is started EXPLICITLY.
 *     Import-time side effects are what made the old file impossible to load in a
 *     test without creating directories and background work.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { CONFIG, CPU_COUNT, MEMORY_BUDGET, TOTAL_MEMORY_MB, RUN_BODY_LIMIT_BYTES } from './server/config.mjs';
import { log } from './server/logging.mjs';
import { loadCatalog } from './server/languages/catalog.mjs';

import { ExecutionPipeline } from './server/execution/pipeline.mjs';
import { SessionRegistry } from './server/execution/session-registry.mjs';
import { reapAbandonedJobs } from './server/execution/job.mjs';
import { PreviewStore } from './server/previews/store.mjs';

import { applyRequestContext } from './server/http/middleware/request-context.mjs';
import { createCorsMiddleware } from './server/http/middleware/cors.mjs';
import { RateLimiter, createRateLimitMiddleware } from './server/http/middleware/rate-limit.mjs';
import { registerHealthRoutes } from './server/http/routes/health.mjs';
import { registerLanguageRoutes } from './server/http/routes/languages.mjs';
import { registerPreviewRoutes } from './server/http/routes/previews.mjs';
import { registerReportRoutes } from './server/http/routes/reports.mjs';
import { registerRunRoutes } from './server/http/routes/run.mjs';
import { createLifecycle } from './server/http/lifecycle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Collaborators ───────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);

// Job directories and warm toolchain templates both live under the process temp
// root, but every job gets its OWN directory beneath it - see
// server/execution/job.mjs for the three defects the shared root caused.
const EXECUTION_ROOT = path.join(os.tmpdir(), `browser-coder-exec-${process.pid}`);
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

const previewStore = new PreviewStore({
  storageDir: CONFIG.preview.storageDir,
  limits: CONFIG.preview,
  log,
});

// Reap job directories left by a crash or a hard kill. Live session directories
// are excluded, because a student thinking about what to type is not garbage.
// Unlike the sweep it replaces, one undeletable entry cannot abort the pass (V-25).
const jobReaper = setInterval(() => {
  reapAbandonedJobs(EXECUTION_ROOT, 60 * 60 * 1000, sessions.liveDirectories());
}, 5 * 60 * 1000);
jobReaper.unref?.();

const lifecycle = createLifecycle({
  server,
  pipeline,
  sessions,
  log,
  stoppables: [previewStore, rateLimiter, { stop: () => clearInterval(jobReaper) }],
  // Live directories are already empty here: every session was terminated first.
  finalSweep: () => reapAbandonedJobs(EXECUTION_ROOT, 0, new Set()),
});

// ── Start what has side effects ─────────────────────────────────────────────

rateLimiter.start();

// Creates a directory and arms a sweep, so it is a call rather than an import.
// A failure is reported and survivable: previews answer 503 while code execution
// carries on unaffected.
previewStore.start();

// ── Request pipeline. Order is behaviour. ───────────────────────────────────

applyRequestContext(app, { config: CONFIG, runBodyLimitBytes: RUN_BODY_LIMIT_BYTES });

// Both guard /api and must be registered before any /api route, or that route is
// simply not covered by them.
app.use('/api', createCorsMiddleware({ isDev: CONFIG.isDev, log }));
app.use('/api', createRateLimitMiddleware({ limiter: rateLimiter }));

// ── Routes ──────────────────────────────────────────────────────────────────

registerHealthRoutes(app, {
  pipeline,
  sessions,
  config: CONFIG,
  // A function, not the boolean: these handlers are registered long before
  // shutdown begins and must read the value at request time.
  isShuttingDown: lifecycle.isShuttingDown,
  hostInfo: { cpuCount: CPU_COUNT, memoryMB: TOTAL_MEMORY_MB },
});

registerPreviewRoutes(app, { store: previewStore, log });
registerLanguageRoutes(app, { rootDir: __dirname, log });

// These handlers hold no language logic: they translate HTTP into a pipeline
// request and the result back into the frozen v1 envelope.
registerRunRoutes(app, { pipeline, sessions, config: CONFIG });

// Reading a published artifact stays open; commanding the service to run the suite
// requires ADMIN_TOKEN and fails closed (V-45, N-08).
registerReportRoutes(app, { rootDir: __dirname, config: CONFIG, log });

// ── Static assets ───────────────────────────────────────────────────────────
//
// Hashed Vite assets must return the real file or a real 404, and must never fall
// through to index.html - a browser receiving text/html for a .js request reports a
// MIME-type failure that looks nothing like the deployment problem it is.
// index.html itself is never cached, so a deploy cannot leave a user holding an old
// document that references assets the new image deleted.
if (!CONFIG.isDev) {
  const distPath = path.join(__dirname, 'dist');

  if (fs.existsSync(distPath)) {
    app.use(
      '/assets',
      express.static(path.join(distPath, 'assets'), {
        fallthrough: false,
        index: false,
        immutable: true,
        maxAge: '1y',
        setHeaders(res) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.setHeader('X-Content-Type-Options', 'nosniff');
        },
      }),
    );

    app.get(['/', '/index.html'], (req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, 'index.html'));
    });

    app.use(
      express.static(distPath, {
        fallthrough: true,
        index: false,
        maxAge: 0,
        setHeaders(res, filePath) {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          }
        },
      }),
    );

    // The SPA fallback is for navigation routes only. A request that looks like a
    // file gets a real 404.
    app.get('*', (req, res, next) => {
      if (path.extname(req.path)) return next();

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return res.sendFile(path.join(distPath, 'index.html'));
    });

    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      return res.status(404).type('text/plain').send('Static asset not found');
    });
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────

lifecycle.install();

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

  // Startup used to execute two real programs through the executor to prime process
  // pools that were themselves dead code (V-35). Running user-shaped code from the
  // listen callback - outside the request path, outside admission, before preview
  // storage was confirmed - was an unguarded execution path for no benefit (N-07).
  // Preloading the catalog achieves the actual goal, a warm first request, without
  // starting anything.
  loadCatalog({ force: true });
});
