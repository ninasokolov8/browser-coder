/**
 * The security report plane (V-45, N-08).
 *
 * What was here before: `POST /api/reports/run-tests` with no authentication, no
 * CSRF protection and an explicitly disabled cooldown, so one anonymous request
 * spawned the entire security suite - hundreds of internal executions - while
 * `/api/reports/status` and `/api/reports/output` streamed the resulting terminal
 * output to anyone who asked. Step-Up sends `hacklab=1` for both student and
 * instructor sandboxes, so all of it was reachable from a learner iframe.
 *
 * The line drawn, recorded as a product decision in blueprint 33.2: reading a
 * published artifact is harmless and stays open, so `hacklab=1` shows no visible
 * regression; COMMANDING the service to do expensive work is an operations action
 * and needs an operator.
 *
 * The run state lives in this module rather than as loose bindings in the
 * composition root, because it is only meaningful to these five handlers.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { spawn } from 'node:child_process';

/** Re-enabled. "Disabled for now" plus no auth was the amplifier. */
const TEST_RUN_COOLDOWN_MS = 15 * 60 * 1000;

/** The captured terminal output is bounded; the previous buffer grew forever. */
const MAX_OUTPUT_BYTES = 512 * 1024;

/**
 * @param {import('express').Express} app
 * @param {object} deps
 * @param {string} deps.rootDir
 * @param {object} deps.config
 * @param {Function} deps.log
 */
export function registerReportRoutes(app, { rootDir, config, log }) {
  const reportsDir = path.join(rootDir, 'security', 'reports');

  let testRunStatus = { running: false, startTime: null, progress: null, output: '' };
  let lastTestRunAt = 0;

  /**
   * Administrative authorisation.
   *
   * Requires ADMIN_TOKEN to be configured AND presented, and fails CLOSED when it
   * is unset: an operations endpoint that becomes public because an environment
   * variable is missing is exactly how the original defect comes back. The answer
   * is 404 rather than 401 so an unauthenticated caller cannot even confirm the
   * route exists.
   */
  function requireAdmin(req, res) {
    const expected = process.env.ADMIN_TOKEN || '';
    if (expected.length < 16) {
      log('warn', 'admin_route_unconfigured', { path: req.path });
      res.status(404).type('text/plain').send('Not found');
      return false;
    }

    const presented =
      req.get('x-admin-token') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');

    // Constant-time compare, so the token cannot be recovered a byte at a time.
    // The length check short-circuits before timingSafeEqual, which throws on a
    // length mismatch - that is a disclosure of length only, which is unavoidable.
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

  // Listing published reports stays open: it returns filenames for artifacts that
  // are already served as static files under /reports, so withholding the index
  // while serving the files would be theatre. It no longer parses arbitrary JSON
  // from disk into the response, which is where N-08's disclosure came from.
  app.get('/api/reports', async (req, res) => {
    try {
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
    } catch (error) {
      log('error', 'reports_api_error', { error: error.message });
      return res.status(500).json({ error: 'Failed to load reports' });
    }
  });

  app.get('/api/reports/can-run', (req, res) => {
    if (!requireAdmin(req, res)) return undefined;
    const elapsed = Date.now() - lastTestRunAt;
    return res.json({
      canRun: !testRunStatus.running && elapsed >= TEST_RUN_COOLDOWN_MS,
      running: testRunStatus.running,
      lastRun: lastTestRunAt ? new Date(lastTestRunAt).toISOString() : null,
      cooldownRemainingMs: Math.max(0, TEST_RUN_COOLDOWN_MS - elapsed),
    });
  });

  app.post('/api/reports/run-tests', async (req, res) => {
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

    // Stamped BEFORE the spawn, so two requests racing here cannot both start a run.
    lastTestRunAt = Date.now();
    testRunStatus = {
      running: true,
      startTime: new Date().toISOString(),
      progress: 'starting',
      output: '',
    };

    res.json({ status: 'started', startTime: testRunStatus.startTime });

    const testProcess = spawn(
      process.execPath,
      ['security/run.mjs', `--server=http://127.0.0.1:${config.port}`],
      {
        cwd: rootDir,
        env: { ...process.env, API_URL: `http://127.0.0.1:${config.port}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const append = data => {
      testRunStatus.output = (testRunStatus.output + data.toString()).slice(-MAX_OUTPUT_BYTES);
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

    testProcess.on('error', error => {
      testRunStatus = {
        running: false,
        startTime: null,
        progress: 'error',
        output: testRunStatus.output,
      };
      log('error', 'test_run_error', { error: error.message });
    });

    return undefined;
  });

  app.get('/api/reports/status', (req, res) => {
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
  app.get('/api/reports/output', (req, res) => {
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

  // The published artifacts themselves. Created if absent because the deployment
  // mounts a volume here that may start empty.
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  app.use('/reports', express.static(reportsDir, { index: 'index.html' }));
}
