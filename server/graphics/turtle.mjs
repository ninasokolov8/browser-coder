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

  // ── SVG cursor shapes ────────────────────────────────────────────────────
  //
  // An SVG cursor is an ICON. The version of this feature written on the old
  // architecture allowed 12 MB per shape, which base64 inflates to 16 MB - twice
  // the whole channel's 8 MB budget, so a payload at that limit could never have
  // been read at all. These bounds are sized for what a cursor actually is.
  maxSvgShapes: 16,
  /** Bytes of decoded SVG per shape. A detailed icon is a few KB. */
  maxSvgBytes: 256 * 1024,
  /** Total across every shape, so 16 large ones cannot add up to a stall. */
  maxSvgTotalBytes: 1024 * 1024,
  /** Cursor edge length in canvas units. */
  maxSvgDimension: 2000,
});

/** The one data-URL form the shim is allowed to produce. */
const SVG_DATA_URL_PREFIX = 'data:image/svg+xml;base64,';

/**
 * Constructs that make an SVG active rather than a picture.
 *
 * The renderer draws these through `new Image()` and `ctx.drawImage`, which is the
 * safe context: a browser will not run scripts or fetch external references for an
 * SVG loaded as an image. So this is defence in depth, not the only barrier - and it
 * is worth having precisely because that guarantee lives in the client. Anyone who
 * later renders the same payload with `innerHTML`, `<object>`, `<embed>` or `<use>`
 * would silently make it live, and this check is what stops that becoming a hole.
 */
const ACTIVE_SVG_CONSTRUCTS = [
  /<\s*script/i,
  /<\s*foreignObject/i,
  /<\s*iframe/i,
  /<\s*embed/i,
  /<\s*object/i,
  /<\s*use\b/i,          // can pull in an external document fragment
  /<\s*image[^>]*href\s*=\s*["']?\s*(?:https?:|\/\/)/i,
  /<!ENTITY/i,           // XXE / billion laughs
  /<!DOCTYPE[^>]*\[/i,   // internal DTD subset
  /\son\w+\s*=/i,        // onload, onerror, onclick, ...
  /javascript\s*:/i,
  /\bxlink:href\s*=\s*["']?\s*(?:https?:|\/\/|data:)/i,
];

/**
 * The payload the shim actually emits.
 *
 * ## Why this is a table and not a guess
 *
 * The previous version of this sanitiser required every entry to carry `t` or
 * `type`, bounded a `text` field, and ran cursors through the same function as
 * shapes. The shim emits **`k`** for the kind, **`txt`** for text, and cursors that
 * carry no kind at all. So every shape and every cursor was rejected, the payload
 * came out with two empty arrays, and the final
 * `if (out.shapes.length === 0 && out.cursors.length === 0) return null` turned the
 * whole drawing into `turtleData: null`.
 *
 * Turtle graphics - the headline feature of this IDE - rendered nothing at all, and
 * no test caught it because none of them looked at a real payload.
 *
 * These tables were captured by running the real shim in the production image and
 * printing the key set of every distinct shape kind. Same discipline as the
 * compiler-output parsers: write the schema down from what the program actually
 * produced, not from what it ought to produce.
 *
 * Kinds: l=line, F=filled polygon, M=move (pen up), T=text, D=dot, S=stamp,
 * SH=cursor-state change.
 */
const NUMERIC_FIELDS = [
  'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'w', 'h', 'pw', 'r',
  'sw', 'sl', 'ow', 'tl', 'sid', 'ln',
];

/** String fields, bounded by `maxStringLength` unless listed as text. */
const STRING_FIELDS = ['c', 'fc', 'pc', 'sh', 'font', 'align'];

/** Free text, bounded by the larger `maxTextLength`. */
const TEXT_FIELDS = ['txt'];

/** Point arrays, capped hardest because they dominate the payload. */
const POINT_FIELDS = ['pts'];

const SHAPE_FIELDS = {
  numbers: NUMERIC_FIELDS,
  strings: STRING_FIELDS,
  texts: TEXT_FIELDS,
  points: POINT_FIELDS,
  /** Recognised kinds. An unknown kind is dropped rather than passed through. */
  kinds: new Set(['l', 'F', 'M', 'T', 'D', 'S', 'SH', 'H', 'C', 'HT', 'ST']),
};

const CURSOR_FIELDS = {
  numbers: NUMERIC_FIELDS,
  strings: STRING_FIELDS,
  texts: [],
  points: POINT_FIELDS,
  booleans: ['vis'],
};

/**
 * Copy one record field by field, bounding each and dropping anything unlisted.
 *
 * Rebuilt rather than spread-and-patched. The old version did `{ ...shape }` first,
 * which meant any field the shim had not been reviewed for travelled straight
 * through to the browser - the opposite of the allowlist the comment claimed.
 */
function sanitizeRecord(record, fields, limits, requireKind) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;

  const out = {};

  if (requireKind) {
    const kind = typeof record.k === 'string' ? record.k : null;
    if (kind === null || !fields.kinds.has(kind)) return null;
    out.k = kind;
  }

  for (const key of fields.numbers) {
    if (record[key] === undefined) continue;
    const value = finiteNumber(record[key], limits.coordinateLimit);
    if (value !== null) out[key] = value;
  }

  for (const key of fields.strings) {
    if (typeof record[key] !== 'string') continue;
    out[key] = boundedString(record[key], limits.maxStringLength);
  }

  for (const key of fields.texts) {
    if (typeof record[key] !== 'string') continue;
    out[key] = boundedString(record[key], limits.maxTextLength);
  }

  for (const key of fields.points) {
    if (!Array.isArray(record[key])) continue;
    const cleaned = [];
    for (const point of record[key].slice(0, limits.maxPointsPerShape)) {
      if (Array.isArray(point) && point.length >= 2) {
        const x = finiteNumber(point[0], limits.coordinateLimit);
        const y = finiteNumber(point[1], limits.coordinateLimit);
        if (x !== null && y !== null) cleaned.push([x, y]);
      } else {
        const n = finiteNumber(point, limits.coordinateLimit);
        if (n !== null) cleaned.push(n);
      }
    }
    out[key] = cleaned;
  }

  for (const key of fields.booleans ?? []) {
    if (typeof record[key] === 'boolean') out[key] = record[key];
  }

  return out;
}

/**
 * Validate one SVG cursor entry, returning a bounded copy or null.
 *
 * The payload is produced by the trusted shim, but the SVG CONTENT inside it comes
 * from the student's workspace - so the content is untrusted even though the
 * envelope is not.
 */
function sanitizeSvgShape(value, limits, budget) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.data !== 'string') return null;
  if (!value.data.startsWith(SVG_DATA_URL_PREFIX)) return null;

  const encoded = value.data.slice(SVG_DATA_URL_PREFIX.length);
  // Strict base64: anything else means the shim was not the author.
  if (encoded.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;

  // Check the decoded size against the budget BEFORE decoding a second time.
  const approximateBytes = Math.floor((encoded.length * 3) / 4);
  if (approximateBytes > limits.maxSvgBytes) return null;
  if (budget.used + approximateBytes > limits.maxSvgTotalBytes) return null;

  let text;
  try {
    text = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }

  if (!/<\s*svg/i.test(text)) return null;
  for (const pattern of ACTIVE_SVG_CONSTRUCTS) {
    if (pattern.test(text)) {
      log('warn', 'turtle_svg_shape_rejected', { reason: String(pattern) });
      return null;
    }
  }

  const width = finiteNumber(value.w, limits.maxSvgDimension);
  const height = finiteNumber(value.h, limits.maxSvgDimension);

  budget.used += approximateBytes;

  return {
    data: value.data,
    // A non-positive or absent dimension falls back to the renderer's default
    // rather than producing a zero-area or inverted draw.
    w: width !== null && width > 0 ? width : 42,
    h: height !== null && height > 0 ? height : 42,
    rotate: value.rotate === true,
  };
}

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

  const sanitizeShape = shape => sanitizeRecord(shape, SHAPE_FIELDS, limits, true);
  const sanitizeCursor = cursor => sanitizeRecord(cursor, CURSOR_FIELDS, limits, false);

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
      // A cursor is NOT a shape: it carries no `k`, so running it through the shape
      // sanitiser rejected every one of them.
      .map(sanitizeCursor)
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

  // SVG cursor shapes, from `register_shape("player.svg")`.
  //
  // This whole block is why the allowlist shape of this function matters: the
  // feature was written against the old architecture, where nothing sanitised the
  // payload. Merged here unchanged it would have been silently DROPPED - the field
  // is not in the allowlist, so the renderer would never have seen it. A test now
  // pins that it survives, and pins the bounds it survives within.
  if (raw.svgShapes && typeof raw.svgShapes === 'object' && !Array.isArray(raw.svgShapes)) {
    const svgShapes = {};
    const budget = { used: 0 };
    let count = 0;

    for (const [name, value] of Object.entries(raw.svgShapes)) {
      if (count >= limits.maxSvgShapes) break;
      const key = boundedString(name, limits.maxStringLength);
      if (key === null || key === '') continue;

      const shape = sanitizeSvgShape(value, limits, budget);
      if (!shape) continue;

      svgShapes[key] = shape;
      count += 1;
    }

    if (count > 0) out.svgShapes = svgShapes;
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
