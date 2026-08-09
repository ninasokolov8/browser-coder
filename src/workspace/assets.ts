/**
 * Binary assets: what the IDE will hold, and how it decides.
 *
 * Until now `StoredFile.content` was a `string` and nothing else, so an image could
 * only exist as SVG text or as a data URI pasted into source - recorded as a gap in
 * §35.4. This module is the rule for what a real asset is.
 *
 * ## The extension is a hint, never the answer
 *
 * Every decision that matters is made from the file's own leading bytes. An
 * attacker's simplest move is to rename: `payload.html` to `avatar.png`. If the IDE
 * trusted the extension it would store that as an image, and the preview publisher
 * would later serve it from a real origin - where a browser that sniffs, or an
 * `<object>` that ignores the declared type, executes it. Stored XSS, delivered by
 * the IDE itself.
 *
 * So the classifier reads magic bytes and REFUSES a file whose content contradicts
 * its name. A mismatch is not silently reclassified either: silently storing
 * `avatar.png` as HTML would be just as surprising, in the other direction.
 *
 * ## Base64, deliberately
 *
 * Binary content is held as base64 inside the same `content` string the rest of the
 * domain already understands. The alternative - a parallel `Blob` field - would mean
 * touching the working-copy buffer, the revision comparison, the persistence queue,
 * the ZIP export, the execution snapshot and the preview publisher, all of which are
 * correct today and all of which treat content as an opaque string. The 33% size
 * cost is worth not reopening six tested seams.
 *
 * Pure: no DOM, no Monaco, no storage. Tested directly in node.
 */

/**
 * The single language id every binary asset is stored under.
 *
 * One id rather than one per format: from the workspace's point of view they are all
 * opaque base64 that is never edited as text. The FORMAT lives in the document's
 * `version` field, which holds the validated extension.
 */
export const ASSET_LANGUAGE_ID = 'asset';

export type AssetKind = 'text' | 'image' | 'binary';

export interface AssetType {
  /** Canonical extension, lower case, no dot. */
  readonly extension: string;
  /** What the IDE does with it. */
  readonly kind: AssetKind;
  /** Served and rendered as this. */
  readonly mediaType: string;
  /** Leading-byte signatures. Empty when the format has none worth checking. */
  readonly signatures: readonly ByteSignature[];
  /** True when the browser can display it directly in an <img>. */
  readonly displayable: boolean;
}

export interface ByteSignature {
  /** Byte offset the pattern starts at. */
  readonly offset: number;
  /** Bytes to compare; null means "any byte here". */
  readonly bytes: readonly (number | null)[];
}

const signature = (offset: number, ...bytes: (number | null)[]): ByteSignature => ({ offset, bytes });

/** ASCII helper, for text-based signatures like `GIF89a`. */
const ascii = (offset: number, text: string): ByteSignature =>
  signature(offset, ...[...text].map(character => character.charCodeAt(0)));

/**
 * A RIFF container signature: `RIFF`, four size bytes, then the form type.
 *
 * The four length bytes in between are file-specific and must be skipped, which is
 * why this needs the wildcard. Matching on `RIFF` alone would file WAV, AVI and WEBP
 * as whichever entry happened to be listed first.
 */
const riffSignature = (form: string): ByteSignature =>
  signature(
    0,
    ...[...'RIFF'].map(character => character.charCodeAt(0)),
    null, null, null, null,
    ...[...form].map(character => character.charCodeAt(0)),
  );

/**
 * The formats the IDE accepts as assets.
 *
 * Deliberately a closed list. "Accept any binary" sounds friendlier and means the
 * IDE stores and later serves content nobody has reasoned about.
 */
export const ASSET_TYPES: readonly AssetType[] = [
  {
    extension: 'png',
    kind: 'image',
    mediaType: 'image/png',
    displayable: true,
    signatures: [signature(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
  },
  {
    extension: 'jpg',
    kind: 'image',
    mediaType: 'image/jpeg',
    displayable: true,
    signatures: [signature(0, 0xff, 0xd8, 0xff)],
  },
  {
    extension: 'jpeg',
    kind: 'image',
    mediaType: 'image/jpeg',
    displayable: true,
    signatures: [signature(0, 0xff, 0xd8, 0xff)],
  },
  {
    extension: 'gif',
    kind: 'image',
    mediaType: 'image/gif',
    displayable: true,
    // GIF87a and GIF89a.
    signatures: [ascii(0, 'GIF87a'), ascii(0, 'GIF89a')],
  },
  {
    extension: 'webp',
    kind: 'image',
    mediaType: 'image/webp',
    displayable: true,
    // RIFF....WEBP - the four size bytes in between are not part of the signature.
    signatures: [
      riffSignature('WEBP'),
    ],
  },
  {
    extension: 'bmp',
    kind: 'image',
    mediaType: 'image/bmp',
    displayable: true,
    signatures: [ascii(0, 'BM')],
  },
  {
    extension: 'ico',
    kind: 'image',
    mediaType: 'image/x-icon',
    displayable: true,
    signatures: [signature(0, 0x00, 0x00, 0x01, 0x00)],
  },
  {
    extension: 'avif',
    kind: 'image',
    mediaType: 'image/avif',
    displayable: true,
    // ....ftypavif - the first four bytes are a box length.
    signatures: [ascii(4, 'ftypavif'), ascii(4, 'ftypavis')],
  },
  {
    extension: 'pdf',
    kind: 'binary',
    mediaType: 'application/pdf',
    // Not displayed inline. A PDF viewer is a scripting surface, and the IDE has no
    // reason to become one - it is stored so a project can carry a brief.
    displayable: false,
    signatures: [ascii(0, '%PDF-')],
  },
  {
    extension: 'mp3',
    kind: 'binary',
    mediaType: 'audio/mpeg',
    displayable: false,
    signatures: [ascii(0, 'ID3'), signature(0, 0xff, 0xfb), signature(0, 0xff, 0xf3)],
  },
  {
    extension: 'wav',
    kind: 'binary',
    mediaType: 'audio/wav',
    displayable: false,
    signatures: [
      riffSignature('WAVE'),
    ],
  },
  {
    extension: 'ttf',
    kind: 'binary',
    mediaType: 'font/ttf',
    displayable: false,
    signatures: [signature(0, 0x00, 0x01, 0x00, 0x00), ascii(0, 'true')],
  },
  {
    extension: 'woff',
    kind: 'binary',
    mediaType: 'font/woff',
    displayable: false,
    signatures: [ascii(0, 'wOFF')],
  },
  {
    extension: 'woff2',
    kind: 'binary',
    mediaType: 'font/woff2',
    displayable: false,
    signatures: [ascii(0, 'wOF2')],
  },
  {
    extension: 'zip',
    kind: 'binary',
    mediaType: 'application/zip',
    displayable: false,
    // PK\x03\x04, plus the empty and spanned variants.
    signatures: [signature(0, 0x50, 0x4b, 0x03, 0x04), signature(0, 0x50, 0x4b, 0x05, 0x06), signature(0, 0x50, 0x4b, 0x07, 0x08)],
  },
];

const BY_EXTENSION = new Map(ASSET_TYPES.map(type => [type.extension, type]));

/** The lower-case extension of a file name, or '' when it has none. */
export function extensionOf(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** The asset type for a file name, or null when it is not an asset extension. */
export function assetTypeFor(fileName: string): AssetType | null {
  return BY_EXTENSION.get(extensionOf(fileName)) ?? null;
}

export function isAssetName(fileName: string): boolean {
  return assetTypeFor(fileName) !== null;
}

/** Whether `bytes` starts with `candidate`'s signature. */
function matchesSignature(bytes: Uint8Array, candidate: ByteSignature): boolean {
  if (bytes.length < candidate.offset + candidate.bytes.length) return false;
  for (let index = 0; index < candidate.bytes.length; index += 1) {
    const expected = candidate.bytes[index];
    if (expected === null) continue;
    if (bytes[candidate.offset + index] !== expected) return false;
  }
  return true;
}

/** The asset type whose signature these bytes actually match, if any. */
export function detectByContent(bytes: Uint8Array): AssetType | null {
  for (const type of ASSET_TYPES) {
    for (const candidate of type.signatures) {
      if (matchesSignature(bytes, candidate)) return type;
    }
  }
  return null;
}

export type AssetRejection =
  | { readonly ok: false; readonly reason: 'not-an-asset'; readonly message: string }
  | { readonly ok: false; readonly reason: 'empty'; readonly message: string }
  | { readonly ok: false; readonly reason: 'too-large'; readonly message: string; readonly maxMegabytes: string }
  | { readonly ok: false; readonly reason: 'content-mismatch'; readonly message: string; readonly expected: string; readonly actual?: string };

export type AssetAcceptance = {
  readonly ok: true;
  readonly type: AssetType;
};

export type AssetVerdict = AssetAcceptance | AssetRejection;

export interface AssetLimits {
  /** Bytes, before base64 expansion. */
  readonly maxBytes: number;
}

export const DEFAULT_ASSET_LIMITS: AssetLimits = {
  // Generous for a sprite or a photo in a student project, and small enough that a
  // handful of them stay inside the project size policy once base64 is counted.
  maxBytes: 4 * 1024 * 1024,
};

/**
 * Decide whether a named byte sequence may enter the workspace as an asset.
 *
 * The content must agree with the name. A mismatch is refused rather than
 * reclassified in either direction - storing `avatar.png` as HTML and storing
 * `payload.html` as an image are both surprising, and the second is exploitable.
 */
export function validateAsset(
  fileName: string,
  bytes: Uint8Array,
  limits: AssetLimits = DEFAULT_ASSET_LIMITS,
): AssetVerdict {
  const declared = assetTypeFor(fileName);
  if (!declared) {
    return {
      ok: false,
      reason: 'not-an-asset',
      message: `${fileName} is not a file type Browser Coder can hold as an asset.`,
    };
  }

  if (bytes.length === 0) {
    return { ok: false, reason: 'empty', message: `${fileName} is empty.` };
  }

  if (bytes.length > limits.maxBytes) {
    const megabytes = (limits.maxBytes / 1048576).toFixed(0);
    return {
      ok: false,
      reason: 'too-large',
      maxMegabytes: megabytes,
      message: `${fileName} is larger than ${megabytes} MB.`,
    };
  }

  const actual = detectByContent(bytes);

  if (!actual) {
    return {
      ok: false,
      reason: 'content-mismatch',
      expected: declared.extension.toUpperCase(),
      message:
        `${fileName} does not contain ${declared.extension.toUpperCase()} data. ` +
        `Browser Coder checks the file's contents, not its name.`,
    };
  }

  // Compared by media type, not extension, so `.jpg` and `.jpeg` agree and a WEBP
  // named `.webp` is not rejected for matching the `webp` entry rather than itself.
  if (actual.mediaType !== declared.mediaType) {
    return {
      ok: false,
      reason: 'content-mismatch',
      expected: declared.mediaType,
      actual: actual.mediaType,
      message:
        `${fileName} is named as ${declared.mediaType} but contains ${actual.mediaType} data. ` +
        `Rename it to match its real type.`,
    };
  }

  return { ok: true, type: declared };
}

// ── base64 ──────────────────────────────────────────────────────────────────
//
// Hand-rolled rather than using `btoa`/`atob`, because those are DOM globals and this
// module has to load in node for its tests. They are also byte-oriented in a way that
// mangles anything above U+00FF, which is exactly the case that matters here.

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];

    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : BASE64_ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : BASE64_ALPHABET[c & 0x3f];
  }
  return out;
}

export function base64ToBytes(text: string): Uint8Array {
  // Whitespace is legal in transport-encoded base64 and would otherwise decode to
  // garbage bytes.
  const clean = text.replace(/[\s]/g, '');
  const lookup = new Map([...BASE64_ALPHABET].map((character, index) => [character, index]));

  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const length = Math.floor((clean.length * 3) / 4) - padding;
  const out = new Uint8Array(Math.max(0, length));

  let outIndex = 0;
  for (let index = 0; index < clean.length; index += 4) {
    const a = lookup.get(clean[index]) ?? 0;
    const b = lookup.get(clean[index + 1]) ?? 0;
    const c = lookup.get(clean[index + 2]) ?? 0;
    const d = lookup.get(clean[index + 3]) ?? 0;

    if (outIndex < out.length) out[outIndex++] = (a << 2) | (b >> 4);
    if (outIndex < out.length) out[outIndex++] = ((b & 0x0f) << 4) | (c >> 2);
    if (outIndex < out.length) out[outIndex++] = ((c & 0x03) << 6) | d;
  }

  return out;
}

/** A data URL for displaying an asset held as base64. */
export function assetDataUrl(type: AssetType, base64: string): string {
  return `data:${type.mediaType};base64,${base64}`;
}

/** Human-readable size, for the asset viewer and for refusal messages. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
