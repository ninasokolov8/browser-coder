/**
 * Turtle graphics side channel.
 *
 * Closes two findings at their root rather than patching their symptoms.
 *
 * V-01 - confused deputy. The old design had the Python shim write JSON to a
 *   temp file and print `__TURTLE_FILE__:<path>` to stdout; the API then read and
 *   `unlink`ed that path using its own privileges. Because stdout is entirely
 *   under the student's control, any program could name any path:
 *
 *       print("__TURTLE_FILE__:/app/security/reports/index.html")
 *
 *   and the service would read it (leaking it as "turtle data") and then delete
 *   it. Filtering the marker would not have helped - the flaw is that a trusted
 *   component took a filesystem instruction from an untrusted one.
 *
 *   The fix is structural: the SERVICE chooses the path, passes it to the trusted
 *   shim out-of-band via the environment, and reads only that path. Nothing a
 *   program prints can influence which file is opened, so there is no longer a
 *   decision for an attacker to subvert.
 *
 * V-02 - unbounded marker accumulation. The interactive filter buffered any
 *   stdout beginning with `__TURTLE_` into `pending`/`turtleLines` with no cap,
 *   ahead of the ordinary output budget, so a program emitting an unterminated
 *   marker could exhaust server memory without counting a single byte against
 *   `maxOutput`. With the marker gone from stdout there is nothing to buffer:
 *   the vector no longer exists rather than being bounded.
 *
 * Everything read back is treated as untrusted input and is schema-validated and
 * bounded before it reaches a browser.
 */

import fs from 'node:fs';
import path from 'node:path';

import { log } from '../logging.mjs';

/** Environment variable the trusted shim reads to find its output target. */
export const GRAPHICS_OUT_ENV = 'BROWSER_CODER_GRAPHICS_OUT';

/** Service-owned directory name inside the job. */
const CHANNEL_DIR = '.graphics';
const CHANNEL_FILE = 'turtle.json';

/**
 * Bounds. A drawing is data for a canvas, not an arbitrary document, so every
 * dimension has a ceiling. These are generous enough for a dense spirograph and
 * far below anything that would stall a browser.
 */
export const GRAPHICS_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxShapes: 200000,
  maxPointsPerShape: 20000,
  maxCursors: 64,
  maxPolygons: 512,
  maxTextLength: 2000,
  maxStringLength: 256,
  coordinateLimit: 100000,
});

/**
 * Allocate the graphics target for a job.
 *
 * The path is derived only from the job directory - never from request data and
 * never from program output.
 *
 * @param {import('../execution/job.mjs').Job} job
 * @returns {{path: string, env: Record<string,string>}}
 */
export function createGraphicsChannel(job) {
  const directory = path.join(job.dir, CHANNEL_DIR);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filePath = path.join(directory, CHANNEL_FILE);
  return { path: filePath, env: { [GRAPHICS_OUT_ENV]: filePath } };
}

const finiteNumber = (value, limit) => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > limit || n < -limit) return null;
  return n;
};

const boundedString = (value, maxLength) => {
  if (typeof value !== 'string') return null;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
};

/**
 * Validate and bound one drawing payload.
 *
 * Deliberately allowlist-shaped: unknown keys are dropped rather than passed
 * through, so a future shim change cannot smuggle an unreviewed field into the
 * renderer. Malformed entries are skipped rather than failing the whole drawing -
 * a student who produced 10,000 valid shapes and one bad one should still see
 * their picture.
 */
export function sanitizeTurtleData(raw, limits = GRAPHICS_LIMITS) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const out = {};

  const bg = boundedString(raw.bg, limits.maxStringLength);
  if (bg !== null) out.bg = bg;

  const width = finiteNumber(raw.w, limits.coordinateLimit);
  const height = finiteNumber(raw.h, limits.coordinateLimit);
  if (width !== null) out.w = width;
  if (height !== null) out.h = height;

  const tracer = finiteNumber(raw.tracer, limits.coordinateLimit);
  if (tracer !== null) out.tracer = tracer;
  const speed = finiteNumber(raw.speed, limits.coordinateLimit);
  if (speed !== null) out.speed = speed;

  const sanitizeShape = shape => {
    if (!shape || typeof shape !== 'object') return null;
    const kind = boundedString(shape.t ?? shape.type, 32);
    if (kind === null) return null;

    const result = { ...shape };
    // Points arrays dominate the payload, so they are capped hardest.
    for (const key of ['p', 'points', 'pts']) {
      if (Array.isArray(shape[key])) {
        const capped = shape[key].slice(0, limits.maxPointsPerShape);
        const cleaned = [];
        for (const point of capped) {
          if (Array.isArray(point) && point.length >= 2) {
            const x = finiteNumber(point[0], limits.coordinateLimit);
            const y = finiteNumber(point[1], limits.coordinateLimit);
            if (x !== null && y !== null) cleaned.push([x, y]);
          } else {
            const n = finiteNumber(point, limits.coordinateLimit);
            if (n !== null) cleaned.push(n);
          }
        }
        result[key] = cleaned;
      }
    }
    if (typeof shape.text === 'string') {
      result.text = boundedString(shape.text, limits.maxTextLength);
    }
    for (const key of ['c', 'color', 'fill', 'font', 'align', 'shape']) {
      if (typeof shape[key] === 'string') {
        result[key] = boundedString(shape[key], limits.maxStringLength);
      }
    }
    return result;
  };

  if (Array.isArray(raw.shapes)) {
    out.shapes = raw.shapes
      .slice(0, limits.maxShapes)
      .map(sanitizeShape)
      .filter(Boolean);
  } else {
    out.shapes = [];
  }

  if (Array.isArray(raw.cursors)) {
    out.cursors = raw.cursors
      .slice(0, limits.maxCursors)
      .map(sanitizeShape)
      .filter(Boolean);
  } else {
    out.cursors = [];
  }

  if (raw.polys && typeof raw.polys === 'object') {
    const polys = {};
    let count = 0;
    for (const [name, points] of Object.entries(raw.polys)) {
      if (count >= limits.maxPolygons) break;
      const key = boundedString(name, limits.maxStringLength);
      if (key === null || !Array.isArray(points)) continue;
      polys[key] = points
        .slice(0, limits.maxPointsPerShape)
        .map(point => {
          if (!Array.isArray(point) || point.length < 2) return null;
          const x = finiteNumber(point[0], limits.coordinateLimit);
          const y = finiteNumber(point[1], limits.coordinateLimit);
          return x !== null && y !== null ? [x, y] : null;
        })
        .filter(Boolean);
      count++;
    }
    if (count > 0) out.polys = polys;
  }

  // `pic` names a workspace image the frontend resolves. It is a filename, not a
  // path: no separators, no traversal, so it can only ever match a project file.
  const pic = boundedString(raw.pic, limits.maxStringLength);
  if (pic !== null && pic !== '' && !pic.includes('/') && !pic.includes('\\') && !pic.includes('..')) {
    out.pic = pic;
  }

  if (out.shapes.length === 0 && out.cursors.length === 0) return null;
  return out;
}

/**
 * Read the drawing a finished job produced, if any.
 *
 * Returns null - never throws - when there is no drawing, when it is too large,
 * or when it is malformed. A broken graphics payload must not fail the run that
 * produced it.
 *
 * @param {string} channelPath the path THIS SERVICE allocated
 */
export function readGraphicsChannel(channelPath, limits = GRAPHICS_LIMITS) {
  if (!channelPath) return null;

  let stat;
  try {
    // lstat, not stat: if something replaced the target with a symlink we must
    // not follow it. The job directory is 0700 and service-owned, so this is
    // defence in depth rather than the primary control.
    stat = fs.lstatSync(channelPath);
  } catch {
    return null;
  }

  if (!stat.isFile()) {
    log('warn', 'graphics_channel_not_a_file', { size: stat.size });
    return null;
  }

  // Size is checked BEFORE reading, so an oversized payload is never allocated.
  if (stat.size > limits.maxBytes) {
    log('warn', 'graphics_channel_too_large', { bytes: stat.size, limit: limits.maxBytes });
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(channelPath, 'utf8'));
  } catch (error) {
    log('warn', 'graphics_channel_unparseable', { error: error.message });
    return null;
  }

  return sanitizeTurtleData(parsed, limits);
}

/**
 * Does this source import turtle?
 *
 * Only a hint, used to decide whether prepending the shim is worth it. A false
 * negative costs a missing drawing, never correctness, and a false positive
 * costs a few milliseconds - so a regex is the right tool here, unlike in the
 * security policy where the same shape of check would be load-bearing.
 */
export function usesTurtle(source) {
  return /\bimport\s+turtle\b|\bfrom\s+turtle\b/.test(source);
}
