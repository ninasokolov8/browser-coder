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
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import compression from "compression";
import cluster from "node:cluster";

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
import { extensionFor, loadCatalog } from './server/languages/catalog.mjs';

// ============================================
// RATE LIMITER
// ============================================
class RateLimiter {
  constructor() {
    this.requests = new Map();
    setInterval(() => this.cleanup(), CONFIG.rateLimit.windowMs);
  }
  
  check(ip) {
    const now = Date.now();
    const key = ip;
    
    if (!this.requests.has(key)) {
      this.requests.set(key, { count: 1, resetAt: now + CONFIG.rateLimit.windowMs });
      return { allowed: true, remaining: CONFIG.rateLimit.maxRequests - 1 };
    }
    
    const record = this.requests.get(key);
    
    if (now > record.resetAt) {
      record.count = 1;
      record.resetAt = now + CONFIG.rateLimit.windowMs;
      return { allowed: true, remaining: CONFIG.rateLimit.maxRequests - 1 };
    }
    
    record.count++;
    const remaining = Math.max(0, CONFIG.rateLimit.maxRequests - record.count);
    
    return { allowed: record.count <= CONFIG.rateLimit.maxRequests, remaining };
  }
  
  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.requests) {
      if (now > record.resetAt) {
        this.requests.delete(key);
      }
    }
  }
}

// ============================================
// SHAREABLE MULTI-FILE WEB PREVIEW STORE
// ============================================
const PREVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const PREVIEW_MANIFEST_NAME = ".browser-coder-preview.json";
const PREVIEW_TEXT_MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".htm", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".cjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
]);
const PREVIEW_BINARY_MIME_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".avif", "image/avif"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".pdf", "application/pdf"],
]);

function ensurePreviewStorageDir() {
  try {
    fs.mkdirSync(CONFIG.preview.storageDir, {
      recursive: true,
      mode: 0o700,
    });
  } catch (error) {
    log("error", "preview_storage_unavailable", {
      path: CONFIG.preview.storageDir,
      error: error.message,
    });

    throw new Error(
      `Preview storage is not writable: ${CONFIG.preview.storageDir}`
    );
  }
}

function previewDirectoryPath(previewId) {
  if (!PREVIEW_ID_PATTERN.test(previewId)) return null;
  return path.join(CONFIG.preview.storageDir, previewId);
}

function previewManifestPath(previewId) {
  const directory = previewDirectoryPath(previewId);
  return directory ? path.join(directory, PREVIEW_MANIFEST_NAME) : null;
}

function legacyPreviewFilePath(previewId) {
  if (!PREVIEW_ID_PATTERN.test(previewId)) return null;
  return path.join(CONFIG.preview.storageDir, `${previewId}.html`);
}

function createPreviewId() {
  // 128 random bits encoded as 22 URL-safe characters.
  return crypto.randomBytes(16).toString("base64url");
}

function normalizePreviewProjectPath(value) {
  if (typeof value !== "string") return null;

  const slashPath = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!slashPath || slashPath.length > CONFIG.preview.maxPathChars) return null;
  if (slashPath.includes("\0")) return null;

  const originalSegments = slashPath.split("/");
  if (originalSegments.some(segment => segment === "..")) return null;

  const normalized = path.posix.normalize(slashPath).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../")) return null;
  if (path.posix.isAbsolute(normalized)) return null;

  return normalized;
}

function validatePreviewProject(rawFiles, rawEntryPath) {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    throw new Error("Preview project files are required");
  }

  if (rawFiles.length > CONFIG.preview.maxFileCount) {
    throw new Error(`Preview contains too many files. Maximum is ${CONFIG.preview.maxFileCount}`);
  }

  const filesByPath = new Map();
  let totalBytes = 0;

  for (const rawFile of rawFiles) {
    const filePath = normalizePreviewProjectPath(rawFile?.path);
    if (!filePath) {
      throw new Error(`Invalid preview file path: ${String(rawFile?.path || "")}`);
    }

    if (filesByPath.has(filePath)) {
      throw new Error(`Duplicate preview file path: ${filePath}`);
    }

    const content = typeof rawFile?.content === "string" ? rawFile.content : "";
    totalBytes += Buffer.byteLength(filePath, "utf8");
    totalBytes += Buffer.byteLength(content, "utf8");

    if (totalBytes > CONFIG.preview.maxHtmlBytes) {
      throw new Error(
        `Preview is too large. Maximum project size is ${CONFIG.preview.maxHtmlBytes} bytes`,
      );
    }

    filesByPath.set(filePath, {
      path: filePath,
      content,
      language: typeof rawFile?.language === "string"
        ? rawFile.language.slice(0, 100)
        : undefined,
    });
  }

  const entryPath = normalizePreviewProjectPath(rawEntryPath || "index.html");
  if (!entryPath || !filesByPath.has(entryPath)) {
    throw new Error("The preview entry HTML file was not included in the project");
  }

  if (!/\.html?$/i.test(entryPath)) {
    throw new Error("The preview entry file must be an HTML file");
  }

  return {
    entryPath,
    files: [...filesByPath.values()],
    totalBytes,
  };
}

function safePreviewAssetPath(previewId, requestedPath) {
  const directory = previewDirectoryPath(previewId);
  const normalizedPath = normalizePreviewProjectPath(requestedPath);
  if (!directory || !normalizedPath) return null;

  const resolvedDirectory = path.resolve(directory);
  const resolvedFile = path.resolve(directory, normalizedPath);
  if (!resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)) return null;

  return {
    directory,
    normalizedPath,
    filePath: resolvedFile,
  };
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function encodePreviewProjectPath(filePath) {
  return filePath
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
}

function buildPreviewShell(previewId, entryPath) {
  // The shell URL is /preview/:id. Resolving ./<id>/<entry> from that URL
  // preserves any outer mount prefix such as Arc Academy's /coder/.
  const iframeSrc = `./${encodeURIComponent(previewId)}/${encodePreviewProjectPath(entryPath)}`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Browser Coder Preview</title>
  <style>
    html,body,iframe{width:100%;height:100%;margin:0;border:0;overflow:hidden;background:#fff}
  </style>
</head>
<body>
  <iframe
    title="Browser Coder website preview"
    sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock"
    referrerpolicy="no-referrer"
    src="${escapeHtmlAttribute(iframeSrc)}"
  ></iframe>
</body>
</html>`;
}

function buildLegacyPreviewShell(html) {
  const escapedHtml = escapeHtmlAttribute(html);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Browser Coder Preview</title>
  <style>
    html,body,iframe{width:100%;height:100%;margin:0;border:0;overflow:hidden;background:#fff}
  </style>
</head>
<body>
  <iframe
    title="Browser Coder website preview"
    sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock"
    referrerpolicy="no-referrer"
    srcdoc="${escapedHtml}"
  ></iframe>
</body>
</html>`;
}

async function writeImmutablePreviewProject(files, entryPath) {
  ensurePreviewStorageDir();

  for (let attempt = 0; attempt < 5; attempt++) {
    const previewId = createPreviewId();
    const finalDirectory = previewDirectoryPath(previewId);
    const temporaryDirectory = path.join(
      CONFIG.preview.storageDir,
      `.${previewId}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`,
    );

    try {
      await fs.promises.mkdir(temporaryDirectory, { mode: 0o700 });

      for (const file of files) {
        const destination = path.resolve(temporaryDirectory, file.path);
        const resolvedTemporaryDirectory = path.resolve(temporaryDirectory);
        if (!destination.startsWith(`${resolvedTemporaryDirectory}${path.sep}`)) {
          throw new Error(`Unsafe preview file path: ${file.path}`);
        }

        await fs.promises.mkdir(path.dirname(destination), {
          recursive: true,
          mode: 0o700,
        });
        await fs.promises.writeFile(destination, file.content, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      }

      const manifest = {
        version: 2,
        entryPath,
        createdAt: Date.now(),
        fileCount: files.length,
      };
      await fs.promises.writeFile(
        path.join(temporaryDirectory, PREVIEW_MANIFEST_NAME),
        JSON.stringify(manifest),
        {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        },
      );

      await fs.promises.rename(temporaryDirectory, finalDirectory);
      return previewId;
    } catch (error) {
      await fs.promises.rm(temporaryDirectory, {
        recursive: true,
        force: true,
      }).catch(() => {});

      if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Could not allocate a unique preview ID");
}

async function readPreviewManifest(previewId) {
  const manifestPath = previewManifestPath(previewId);
  if (!manifestPath) return null;

  try {
    const raw = await fs.promises.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);
    const entryPath = normalizePreviewProjectPath(manifest?.entryPath);
    const createdAt = Number(manifest?.createdAt);

    if (!entryPath || !Number.isFinite(createdAt)) return null;
    return {
      entryPath,
      createdAt,
      fileCount: Number(manifest?.fileCount) || 0,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isPreviewExpired(createdAt) {
  return Date.now() - createdAt > CONFIG.preview.ttlMs;
}

async function removeProjectPreview(previewId) {
  const directory = previewDirectoryPath(previewId);
  if (!directory) return;
  await fs.promises.rm(directory, { recursive: true, force: true });
}

function previewMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return PREVIEW_TEXT_MIME_TYPES.get(ext)
    || PREVIEW_BINARY_MIME_TYPES.get(ext)
    || "application/octet-stream";
}

function setPreviewCommonHeaders(res) {
  res.setHeader("Cache-Control", "public, max-age=300, immutable");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function setPreviewShellHeaders(res) {
  setPreviewCommonHeaders(res);
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; child-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors *",
  );
}

function setLegacyPreviewShellHeaders(res) {
  setPreviewCommonHeaders(res);
  // Legacy previews stored only one bundled HTML string and still use srcdoc,
  // so the shell policy must permit the student document inherited by srcdoc.
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "script-src 'unsafe-inline' 'unsafe-eval' data: blob: http: https:",
      "style-src 'unsafe-inline' data: blob: http: https:",
      "img-src data: blob: http: https:",
      "font-src data: blob: http: https:",
      "media-src data: blob: http: https:",
      "connect-src data: blob: http: https: ws: wss:",
      "worker-src data: blob: http: https:",
      "frame-src 'self' data: blob: http: https:",
      "child-src 'self' data: blob: http: https:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors *",
    ].join("; "),
  );
}

function setPreviewAssetHeaders(res, filePath) {
  setPreviewCommonHeaders(res);
  res.setHeader("Content-Type", previewMimeType(filePath));
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  if (/\.html?$/i.test(filePath)) {
    // Student pages run in an iframe without allow-same-origin, so they receive
    // an opaque origin and cannot read Browser Coder/Arc Academy cookies,
    // storage, or parent DOM. This CSP intentionally permits normal beginner
    // web projects: inline JS/CSS, linked project files, modules, workers,
    // images/fonts/media, and optional CDN/API resources.
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        "script-src 'unsafe-inline' 'unsafe-eval' data: blob: http: https:",
        "style-src 'unsafe-inline' data: blob: http: https:",
        "img-src data: blob: http: https:",
        "font-src data: blob: http: https:",
        "media-src data: blob: http: https:",
        "connect-src data: blob: http: https: ws: wss:",
        "worker-src data: blob: http: https:",
        "frame-src data: blob: http: https:",
        "child-src data: blob: http: https:",
        "manifest-src data: blob: http: https:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors *",
      ].join("; "),
    );
  }
}

async function cleanupExpiredPreviews() {
  ensurePreviewStorageDir();
  const expiresBefore = Date.now() - CONFIG.preview.ttlMs;
  const abandonedTemporaryBefore = Date.now() - 60 * 60 * 1000;

  let entries;
  try {
    entries = await fs.promises.readdir(CONFIG.preview.storageDir, {
      withFileTypes: true,
    });
  } catch (error) {
    log("warn", "Preview cleanup could not read storage", {
      error: error.message,
    });
    return;
  }

  await Promise.allSettled(entries.map(async entry => {
    const itemPath = path.join(CONFIG.preview.storageDir, entry.name);

    if (entry.isFile() && /^[A-Za-z0-9_-]{22}\.html$/.test(entry.name)) {
      const stat = await fs.promises.stat(itemPath);
      if (stat.mtimeMs < expiresBefore) await fs.promises.unlink(itemPath);
      return;
    }

    if (entry.isDirectory() && PREVIEW_ID_PATTERN.test(entry.name)) {
      const manifest = await readPreviewManifest(entry.name).catch(() => null);
      const createdAt = manifest?.createdAt
        || (await fs.promises.stat(itemPath)).mtimeMs;
      if (createdAt < expiresBefore) {
        await fs.promises.rm(itemPath, { recursive: true, force: true });
      }
      return;
    }

    if (entry.isDirectory() && /^\.[A-Za-z0-9_-]{22}\..+\.tmp$/.test(entry.name)) {
      const stat = await fs.promises.stat(itemPath);
      if (stat.mtimeMs < abandonedTemporaryBefore) {
        await fs.promises.rm(itemPath, { recursive: true, force: true });
      }
    }
  }));
}

let previewStorageReady = false;
try {
  ensurePreviewStorageDir();
  previewStorageReady = true;
} catch (error) {
  log("error", "preview_storage_startup_failed", {
    path: CONFIG.preview.storageDir,
    error: error instanceof Error ? error.message : String(error),
  });
}

const previewCleanupTimer = setInterval(() => {
  if (previewStorageReady) void cleanupExpiredPreviews();
}, CONFIG.preview.cleanupIntervalMs);
previewCleanupTimer.unref?.();
if (previewStorageReady) void cleanupExpiredPreviews();

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
const rateLimiter = new RateLimiter();

// Reap job directories left by a crash or a hard kill. Live session
// directories are excluded, because a student thinking about what to type is
// not garbage. Unlike the sweep this replaces, one undeletable entry cannot
// abort the pass (V-25).
const jobReaperTimer = setInterval(() => {
  reapAbandonedJobs(EXECUTION_ROOT, 60 * 60 * 1000, sessions.liveDirectories());
}, 5 * 60 * 1000);
jobReaperTimer.unref?.();

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

// Middleware
app.set("trust proxy", true);
app.use(compression());

// Only preview publishing receives the larger request-body allowance.
app.use(
  "/api/previews",
  express.json({ limit: CONFIG.preview.maxHtmlBytes * 2 + 1024 * 1024 }),
);

// /api/run carries a whole multi-file project as JSON. JSON-encoding the raw
// code inflates its byte size well past CONFIG.execution.maxCodeChars: every
// newline/quote/backslash in the source doubles when escaped, non-ASCII
// comments/strings cost extra UTF-8 bytes, and each file adds JSON wrapper
// overhead ({"name":...,"content":...,"language":...,"isMain":...}). A body
// limit equal to maxCodeChars therefore rejects legitimate projects that are
// well within the app's own size policy (enforced below in POST /api/run)
// before the handler even runs - that's the previous 413. Size the transport
// limit for the actual worst case allowed by that policy instead of copying
// the same number:
//   - content: up to 3x for escaping + multi-byte overhead
//   - per file: path + ~100 bytes of JSON metadata, up to maxProjectFiles files
//   - a few KB slack for language/version/entryPoint and JSON punctuation
// Derived from the size policy in server/config.mjs so raising a limit there
// raises the transport allowance too. See that module for the reasoning.
app.use("/api/run", express.json({ limit: RUN_BODY_LIMIT_BYTES }));

app.use(express.json({ limit: "100kb" }));

// Request ID
app.use((req, res, next) => {
  req.id = crypto.randomBytes(4).toString("hex");
  res.setHeader("X-Request-ID", req.id);
  next();
});

// ============================================
// CORS CONFIGURATION - Step-Up Integration
// ============================================
const ALLOWED_ORIGINS = [
  'http://localhost:8000',
  'http://localhost:3000',
  'http://localhost',
  'http://127.0.0.1:8000',
  'http://127.0.0.1:3000',
  'https://stepup.school',
  'https://step-up.co.il',
  'https://www.stepup.school',
  'https://www.step-up.co.il',
    'https://arc.co',
     'https://www.arc.co',
  // Development / staging
  'http://stepup.local',
  'https://staging.stepup.school',
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  
  // Direct match
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  
  // Subdomain match for stepup.school and step-up.co.il
  const allowedDomains = ['stepup.school', 'step-up.co.il'];
  for (const domain of allowedDomains) {
    if (origin.endsWith('.' + domain) || origin.endsWith('://' + domain)) {
      return true;
    }
  }
  
  return false;
}

// CORS middleware
app.use("/api", (req, res, next) => {
  const origin = req.headers.origin;
  
  // In development, allow all origins for easier testing
  if (CONFIG.isDev) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else if (origin && isAllowedOrigin(origin)) {
    // Production: only allow specific origins
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    // No origin header (same-origin requests, server-to-server, etc.)
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else {
    // Origin not allowed - log and reject preflight, allow other requests but log warning
    log('warn', 'cors_rejected', { origin, path: req.path, method: req.method });
    if (req.method === "OPTIONS") {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    // For non-preflight, still set headers but log
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Rate limiting (bypass for localhost/tests)
// NOTE: the "api" service has no published port (docker-compose.yml only
// publishes nginx on :80) - the only things that can reach it directly on
// the "internal" bridge network are sibling containers we control
// (nginx, security-tests, autoscaler). Real end-user traffic always comes
// through nginx, which sets X-Forwarded-For with the true public client IP
// (trust proxy is enabled below), so it is still rate-limited correctly.
// Requests hitting api directly from a private/internal IP (e.g. the
// security-tests container running `security/run.mjs` against
// http://api:3001) are therefore safe to exempt.
function isTrustedInternalIp(ip) {
  if (!ip) return false;
  const v4 = ip.replace(/^::ffff:/, '');
  if (v4 === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  return (
    /^10\./.test(v4) ||
    /^192\.168\./.test(v4) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(v4)
  );
}

app.use("/api", (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  
  // Bypass rate limiting for localhost and trusted internal/private network callers
  if (isTrustedInternalIp(ip)) {
    return next();
  }
  
  const { allowed, remaining } = rateLimiter.check(ip);
  
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Limit", CONFIG.rateLimit.maxRequests);
  
  if (!allowed) {
    return res.status(429).json({ error: "Too many requests", retryAfter: 60 });
  }
  next();
});

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
// Publish an immutable, shareable multi-file web preview.
app.post("/api/previews", async (req, res) => {
  if (!previewStorageReady) {
    return res.status(503).json({
      error: "Preview storage is unavailable. Configure PREVIEW_STORAGE_DIR as a writable persistent volume.",
    });
  }

  const rawEntryPath = typeof req.body?.entryPath === "string"
    ? req.body.entryPath
    : "index.html";

  // Backward compatibility for an older frontend that sent one bundled HTML
  // string. New clients send the entire workspace in files[].
  const rawFiles = Array.isArray(req.body?.files)
    ? req.body.files
    : typeof req.body?.html === "string"
      ? [{ path: rawEntryPath, content: req.body.html, language: "html" }]
      : [];

  let project;
  try {
    project = validatePreviewProject(rawFiles, rawEntryPath);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid preview project",
    });
  }

  try {
    const previewId = await writeImmutablePreviewProject(
      project.files,
      project.entryPath,
    );
    const previewPath = `/preview/${previewId}`;

    return res.status(201).json({
      id: previewId,
      entryPath: project.entryPath,
      fileCount: project.files.length,
      previewPath,
      previewUrl: previewPath,
      expiresAt: new Date(Date.now() + CONFIG.preview.ttlMs).toISOString(),
    });
  } catch (error) {
    log("error", "Failed to publish preview", {
      requestId: req.id,
      error: error.message,
    });
    return res.status(500).json({ error: "Could not publish preview" });
  }
});

// Public shell. Student code is never executed in this top-level document;
// it runs inside the sandboxed iframe loaded from the immutable project files.
app.get("/preview/:previewId", async (req, res) => {
  if (!previewStorageReady) {
    return res.status(503).type("text/plain").send("Preview storage is unavailable");
  }

  if (!PREVIEW_ID_PATTERN.test(req.params.previewId)) {
    return res.status(404).type("text/plain").send("Preview not found");
  }

  try {
    const manifest = await readPreviewManifest(req.params.previewId);
    if (manifest) {
      if (isPreviewExpired(manifest.createdAt)) {
        await removeProjectPreview(req.params.previewId).catch(() => {});
        return res.status(410).type("text/plain").send("This preview has expired");
      }

      setPreviewShellHeaders(res);
      return res.status(200).type("html").send(
        buildPreviewShell(req.params.previewId, manifest.entryPath),
      );
    }

    // Preserve already-issued one-file preview URLs from the previous format.
    const legacyPath = legacyPreviewFilePath(req.params.previewId);
    if (!legacyPath) {
      return res.status(404).type("text/plain").send("Preview not found");
    }

    const stat = await fs.promises.stat(legacyPath);
    if (Date.now() - stat.mtimeMs > CONFIG.preview.ttlMs) {
      await fs.promises.unlink(legacyPath).catch(() => {});
      return res.status(410).type("text/plain").send("This preview has expired");
    }

    const html = await fs.promises.readFile(legacyPath, "utf8");
    setLegacyPreviewShellHeaders(res);
    return res.status(200).type("html").send(buildLegacyPreviewShell(html));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return res.status(404).type("text/plain").send("Preview not found");
    }

    log("error", "Failed to load preview", {
      requestId: req.id,
      previewId: req.params.previewId,
      error: error.message,
    });
    return res.status(500).type("text/plain").send("Could not load preview");
  }
});

// Serve every immutable workspace file below the preview ID. Relative links
// such as style.css, ./js/app.js and ../images/logo.svg therefore behave like
// they do in a normal website, including navigation between multiple HTML files.
app.get("/preview/:previewId/*", async (req, res) => {
  if (!previewStorageReady) {
    return res.status(503).type("text/plain").send("Preview storage is unavailable");
  }

  const previewId = req.params.previewId;
  const requestedPath = req.params[0] || "";
  if (!PREVIEW_ID_PATTERN.test(previewId)) {
    return res.status(404).type("text/plain").send("Preview file not found");
  }

  try {
    const manifest = await readPreviewManifest(previewId);
    if (!manifest) {
      return res.status(404).type("text/plain").send("Preview file not found");
    }

    if (isPreviewExpired(manifest.createdAt)) {
      await removeProjectPreview(previewId).catch(() => {});
      return res.status(410).type("text/plain").send("This preview has expired");
    }

    const asset = safePreviewAssetPath(previewId, requestedPath);
    if (!asset || asset.normalizedPath === PREVIEW_MANIFEST_NAME) {
      return res.status(404).type("text/plain").send("Preview file not found");
    }

    const content = await fs.promises.readFile(asset.filePath);
    setPreviewAssetHeaders(res, asset.normalizedPath);
    return res.status(200).send(content);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") {
      return res.status(404).type("text/plain").send("Preview file not found");
    }

    log("error", "Failed to load preview file", {
      requestId: req.id,
      previewId,
      requestedPath,
      error: error.message,
    });
    return res.status(500).type("text/plain").send("Could not load preview file");
  }
});

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

// Reports API - list all security reports
app.get("/api/reports", async (req, res) => {
  try {
    const reportsDir = path.join(__dirname, "security", "reports");
    if (!fs.existsSync(reportsDir)) {
      return res.json([]);
    }
    
    const files = fs.readdirSync(reportsDir);
    const reports = [];
    
    for (const file of files) {
      if (file === 'index.html') continue; // Skip the hub page
      
      const isHtml = file.endsWith('.html');
      const isJson = file.endsWith('.json');
      
      if (isHtml || isJson) {
        const report = {
          name: file,
          type: isHtml ? 'html' : 'json',
          path: `/reports/${file}`,
        };
        
        // For JSON files, try to extract summary
        if (isJson && !file.includes('latest')) {
          try {
            const content = fs.readFileSync(path.join(reportsDir, file), 'utf8');
            const data = JSON.parse(content);
            if (data.summary) {
              report.summary = data.summary;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
        
        reports.push(report);
      }
    }
    
    res.json(reports);
  } catch (err) {
    log('error', 'reports_api_error', { error: err.message });
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

// Check if tests can be run (cooldown disabled for now)
app.get("/api/reports/can-run", (req, res) => {
  // Cooldown disabled - always allow running tests
  res.json({ canRun: true, lastRun: null, hoursAgo: null });
});

// Track running test status with full terminal output
let testRunStatus = { running: false, startTime: null, progress: null, output: '' };

// Run security tests (cooldown disabled for now)
app.post("/api/reports/run-tests", async (req, res) => {
  try {
    // Check if already running
    if (testRunStatus.running) {
      return res.status(409).json({ 
        error: 'Tests already running', 
        startTime: testRunStatus.startTime 
      });
    }
    
    // Cooldown check disabled for now
    
    // Mark as running with empty output buffer
    testRunStatus = { running: true, startTime: new Date().toISOString(), progress: 'starting', output: '' };
    
    // Return immediately, tests run in background
    res.json({ 
      status: 'started', 
      message: 'Security tests started. Check back in ~30 seconds for results.',
      startTime: testRunStatus.startTime
    });
    
    // Run tests in background using the security module
    const { spawn: nodeSpawn } = await import('node:child_process');
    const testProcess = nodeSpawn('node', ['security/run.mjs', '--server=http://localhost:3001'], {
      cwd: __dirname,
      env: { ...process.env, API_URL: 'http://localhost:3001' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    testProcess.stdout.on('data', (data) => {
      testRunStatus.output += data.toString();
      testRunStatus.progress = 'running';
    });
    
    testProcess.stderr.on('data', (data) => {
      testRunStatus.output += data.toString();
    });
    
    testProcess.on('close', (code) => {
      const finalOutput = testRunStatus.output;
      testRunStatus = { 
        running: false, 
        startTime: null, 
        progress: code === 0 ? 'completed' : 'failed',
        output: finalOutput,
        lastResult: { code, output: finalOutput.slice(-1000) }
      };
      log('info', 'test_run_completed', { exitCode: code });
    });
    
    testProcess.on('error', (err) => {
      testRunStatus = { running: false, startTime: null, progress: 'error', error: err.message };
      log('error', 'test_run_error', { error: err.message });
    });
    
  } catch (err) {
    testRunStatus = { running: false, startTime: null, progress: 'error' };
    log('error', 'run_tests_error', { error: err.message });
    res.status(500).json({ error: 'Failed to start tests' });
  }
});

// Get test run status
app.get("/api/reports/status", (req, res) => {
  res.json(testRunStatus);
});

// Get terminal output (for live streaming)
app.get("/api/reports/output", (req, res) => {
  const offset = parseInt(req.query.offset || '0', 10);
  const output = testRunStatus.output || '';
  res.json({
    running: testRunStatus.running,
    progress: testRunStatus.progress,
    output: output.slice(offset),
    totalLength: output.length
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

  clearInterval(previewCleanupTimer);
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
