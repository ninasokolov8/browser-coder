/**
 * Just enough of a source map to debug a compiled language.
 *
 * TypeScript is compiled to JavaScript before it runs, so a breakpoint on a `.ts` line
 * has to be armed against the `.js` line it became, and a stop in that `.js` has to be
 * reported back as the `.ts` line the student is looking at. Without both directions a
 * breakpoint either never fires or fires somewhere the student did not click - which is
 * why TypeScript was excluded from the debuggable set rather than half-supported.
 *
 * Written here rather than taken from a package for the reason the rest of this
 * directory exists: these files are copied into the image and loaded by the student's
 * own process, and the two mappings needed are about sixty lines. `source-map` and
 * friends bring a WASM blob and an async API for a job that is a base64 VLQ decode.
 *
 * Deliberately language-agnostic. The debugger knows about source maps, not about
 * TypeScript, so anything else that compiles to JavaScript works for free.
 */

import fs from 'node:fs';
import path from 'node:path';

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Character -> 6-bit value, built once. */
const BASE64_VALUES = new Map([...BASE64].map((character, index) => [character, index]));

/**
 * Decode one base64 VLQ run into signed integers.
 *
 * The format: six bits per character, the low bit of the FIRST value carrying the sign
 * and the top bit of each character saying whether another follows. Getting the
 * continuation bit and the sign bit the wrong way round produces plausible-looking
 * numbers that are quietly wrong, which is why this is tested directly.
 */
function decodeVlq(segment) {
  const values = [];
  let shift = 0;
  let value = 0;

  for (const character of segment) {
    const digit = BASE64_VALUES.get(character);
    if (digit === undefined) return values;

    const hasContinuation = (digit & 32) !== 0;
    value += (digit & 31) << shift;

    if (hasContinuation) {
      shift += 5;
      continue;
    }

    const negative = (value & 1) === 1;
    value >>= 1;
    values.push(negative ? (value === 0 ? -0 : -value) : value);
    value = 0;
    shift = 0;
  }

  return values;
}

/**
 * Every mapping in a source map, as flat records.
 *
 * Flat rather than nested because both lookups scan: one by generated line, one by
 * source and original line. A file a student is debugging has thousands of mappings at
 * most, so an index would be complexity without a measurable gain.
 */
export function parseMappings(map) {
  const sources = Array.isArray(map?.sources) ? map.sources : [];
  const records = [];

  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;

  const lines = String(map?.mappings ?? '').split(';');

  for (let generatedLine = 0; generatedLine < lines.length; generatedLine++) {
    let generatedColumn = 0;

    for (const segment of lines[generatedLine].split(',')) {
      if (!segment) continue;

      const fields = decodeVlq(segment);
      if (fields.length === 0) continue;

      generatedColumn += fields[0];
      // A one-field segment says "generated code with no original" - a helper the
      // compiler inserted. It moves the column and maps to nothing.
      if (fields.length < 4) continue;

      sourceIndex += fields[1];
      originalLine += fields[2];
      originalColumn += fields[3];

      records.push({
        generatedLine: generatedLine + 1,
        generatedColumn,
        source: sources[sourceIndex] ?? null,
        originalLine: originalLine + 1,
        originalColumn,
      });
    }
  }

  return records;
}

/** Normalise a path for comparison: forward slashes, no leading `./`. */
function normalise(candidate) {
  return String(candidate ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * A two-way mapping between one generated file and its sources.
 *
 * `null` when there is no usable map, so a caller can carry on treating the file as
 * plain JavaScript - which is exactly what an uncompiled `.js` is.
 */
export function loadSourceMap(generatedPath) {
  const mapPath = `${generatedPath}.map`;

  let raw;
  try {
    raw = fs.readFileSync(mapPath, 'utf8');
  } catch {
    return null;
  }

  let map;
  try {
    map = JSON.parse(raw);
  } catch {
    return null;
  }

  const records = parseMappings(map);
  if (records.length === 0) return null;

  // Sources are relative to the map, which sits beside the generated file.
  const base = path.dirname(generatedPath);
  const resolvedSources = new Map();
  for (const source of map.sources ?? []) {
    resolvedSources.set(normalise(source), path.resolve(base, source));
  }

  return {
    /** Absolute paths of the files this one was compiled from. */
    sources: [...resolvedSources.values()],

    /**
     * The generated line for a line in one of the sources.
     *
     * When the exact line has no mapping - a blank line, a comment, a type-only
     * declaration that emits nothing - the NEXT mapped line is used. That matches what
     * every debugger does with a breakpoint on a line that produces no code, and what
     * V8 itself does when it binds a breakpoint.
     */
    toGenerated(sourcePath, line) {
      const wanted = normalise(path.isAbsolute(sourcePath)
        ? path.relative(base, sourcePath)
        : sourcePath);

      let best = null;
      for (const record of records) {
        if (!record.source || normalise(record.source) !== wanted) continue;
        if (record.originalLine < line) continue;
        if (
          best === null
          || record.originalLine < best.originalLine
          || (record.originalLine === best.originalLine && record.generatedLine < best.generatedLine)
        ) {
          best = record;
        }
      }

      return best ? best.generatedLine : null;
    },

    /**
     * The original file and line for a generated line.
     *
     * The FIRST mapping on that line, by column: a generated line can carry several
     * segments, and the leftmost is the statement the student would point at.
     */
    toOriginal(generatedLine) {
      let best = null;
      for (const record of records) {
        if (record.generatedLine !== generatedLine || !record.source) continue;
        if (best === null || record.generatedColumn < best.generatedColumn) best = record;
      }
      if (!best) return null;

      return {
        source: resolvedSources.get(normalise(best.source)) ?? best.source,
        line: best.originalLine,
      };
    },
  };
}
