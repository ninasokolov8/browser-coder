/**
 * Compress the built assets once, at build time, instead of once per cold client.
 *
 * The measurement that prompted this, on the real `dist/` of this repo:
 *
 *     monaco-editor  3254 KB -> 837 KB gzip, 43.6 ms of CPU
 *     ts.worker      5882 KB -> 1335 KB gzip, 75.5 ms
 *     index           835 KB -> 234 KB gzip, 12.4 ms
 *     all 99 files   12.6 MB -> 3.1 MB gzip, 179 ms
 *
 * Every one of those milliseconds was being spent again for every cache-cold browser,
 * on the same container that runs student code. A class of 30 opening the IDE at the
 * same time costs a couple of seconds of CPU for nothing; a school of a thousand costs
 * a minute of a core, competing with the execution pipeline for the libuv thread pool
 * that also does its filesystem work.
 *
 * Brotli is included because it is free here: at quality 11 the editor chunk is 666 KB
 * against gzip's 854 KB - 22% less over the wire - and the 87 ms it costs is paid once,
 * in CI, not per request.
 *
 * Files are written NEXT TO the original, so the uncompressed file is still there for a
 * client that asks for no encoding, and the server picks a variant from Accept-Encoding.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const DIST = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');

/** Only text formats: an image or a font is already compressed. */
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.json', '.svg', '.map', '.txt', '.ttf']);

/**
 * Below this, the encoding overhead and the extra request bookkeeping are not worth
 * it - and a file that compresses to more than it started as would be actively worse.
 */
const MIN_BYTES = 1024;

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

let files = 0;
let raw = 0;
let gzipped = 0;
let brotlied = 0;

for (const file of walk(DIST)) {
  if (file.endsWith('.gz') || file.endsWith('.br')) continue;
  if (!COMPRESSIBLE.has(extname(file))) continue;
  if (statSync(file).size < MIN_BYTES) continue;

  const source = readFileSync(file);
  const gz = gzipSync(source, { level: 9 });
  const br = brotliCompressSync(source, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
    },
  });

  // Never ship a "compressed" file that is bigger than the original.
  if (gz.length < source.length) writeFileSync(`${file}.gz`, gz);
  if (br.length < source.length) writeFileSync(`${file}.br`, br);

  files += 1;
  raw += source.length;
  gzipped += gz.length;
  brotlied += br.length;
}

const mb = bytes => (bytes / (1024 * 1024)).toFixed(2);
process.stdout.write(
  `precompressed ${files} files: ${mb(raw)} MB -> ${mb(gzipped)} MB gzip, ${mb(brotlied)} MB brotli\n`,
);
