/**
 * Asset classification and validation.
 *
 * The security-relevant assertions are the mismatch ones. An attacker's simplest
 * move is renaming `payload.html` to `avatar.png`; if the IDE trusted the extension
 * it would store that as an image and the preview publisher would later serve it
 * from a real origin, where a sniffing browser or an `<object>` that ignores the
 * declared type executes it. Stored XSS, delivered by the IDE.
 *
 * So the rule under test is: the content must agree with the name, and disagreement
 * is REFUSED rather than reclassified in either direction.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSET_TYPES,
  assetTypeFor,
  base64ToBytes,
  bytesToBase64,
  detectByContent,
  extensionOf,
  formatBytes,
  isAssetName,
  validateAsset,
  DEFAULT_ASSET_LIMITS,
} from '../../src/workspace/assets.ts';

/** Real leading bytes for each format, so nothing here is a hand-waved fixture. */
const HEADERS: Record<string, number[]> = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff, 0xe0],
  gif: [...'GIF89a'].map(c => c.charCodeAt(0)),
  webp: [...'RIFF'].map(c => c.charCodeAt(0)).concat([0x20, 0x00, 0x00, 0x00], [...'WEBP'].map(c => c.charCodeAt(0))),
  bmp: [...'BM'].map(c => c.charCodeAt(0)),
  ico: [0x00, 0x00, 0x01, 0x00],
  avif: [0x00, 0x00, 0x00, 0x20, ...[...'ftypavif'].map(c => c.charCodeAt(0))],
  pdf: [...'%PDF-1.7'].map(c => c.charCodeAt(0)),
  mp3: [...'ID3'].map(c => c.charCodeAt(0)),
  wav: [...'RIFF'].map(c => c.charCodeAt(0)).concat([0x20, 0x00, 0x00, 0x00], [...'WAVE'].map(c => c.charCodeAt(0))),
  woff: [...'wOFF'].map(c => c.charCodeAt(0)),
  woff2: [...'wOF2'].map(c => c.charCodeAt(0)),
  ttf: [0x00, 0x01, 0x00, 0x00],
  zip: [0x50, 0x4b, 0x03, 0x04],
};

/** Header plus filler, so length checks are meaningful. */
const fileBytes = (format: string, extra = 64): Uint8Array => {
  const header = HEADERS[format];
  assert.ok(header, `no header fixture for ${format}`);
  const out = new Uint8Array(header.length + extra);
  out.set(header, 0);
  return out;
};

describe('extensions', () => {
  test('lower-cased and without the dot', () => {
    assert.equal(extensionOf('photo.PNG'), 'png');
    assert.equal(extensionOf('a/b/c.Gif'), 'gif');
  });

  test('a name with no extension has none', () => {
    assert.equal(extensionOf('README'), '');
    assert.equal(extensionOf('.gitignore'), '', 'a leading dot is not an extension');
    assert.equal(extensionOf('trailing.'), '');
  });

  test('only the last extension counts', () => {
    assert.equal(extensionOf('archive.tar.gz'), 'gz');
    // The classic double-extension trick: the real type is the last one.
    assert.equal(extensionOf('payload.png.html'), 'html');
  });
});

describe('which names are assets', () => {
  test('the image formats are', () => {
    for (const name of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.bmp', 'a.ico', 'a.avif']) {
      assert.equal(isAssetName(name), true, name);
      assert.equal(assetTypeFor(name)?.kind, 'image', name);
    }
  });

  test('non-displayable binaries are assets too, but not images', () => {
    for (const name of ['a.pdf', 'a.mp3', 'a.wav', 'a.woff2', 'a.zip']) {
      assert.equal(assetTypeFor(name)?.kind, 'binary', name);
      assert.equal(assetTypeFor(name)?.displayable, false, name);
    }
  });

  test('source files are NOT assets', () => {
    for (const name of ['main.py', 'app.ts', 'index.html', 'style.css', 'data.json', 'notes.md', 'logo.svg']) {
      assert.equal(isAssetName(name), false, name);
    }
  });

  test('svg is deliberately not in the asset list', () => {
    // SVG is XML text with its own language, editor and sanitiser. Treating it as an
    // opaque binary would lose all of that - and it is the one image format that can
    // carry script, so it must keep going through the text path that checks it.
    assert.equal(assetTypeFor('icon.svg'), null);
  });

  test('an unknown binary is refused rather than accepted as generic', () => {
    // "Accept any binary" means storing and later serving content nobody reasoned
    // about.
    assert.equal(isAssetName('firmware.bin'), false);
    assert.equal(isAssetName('a.exe'), false);
    assert.equal(isAssetName('a.dll'), false);
  });
});

describe('content detection reads the bytes', () => {
  for (const format of Object.keys(HEADERS)) {
    test(`${format} is detected from its signature`, () => {
      const detected = detectByContent(fileBytes(format));
      assert.ok(detected, `${format} was not detected`);
      const declared = assetTypeFor(`file.${format}`);
      assert.equal(detected.mediaType, declared?.mediaType, format);
    });
  }

  test('text is not detected as any asset', () => {
    const text = new TextEncoder().encode('#!/usr/bin/env python\nprint("hi")\n');
    assert.equal(detectByContent(text), null);
  });

  test('a truncated signature does not match', () => {
    // The first two bytes of a PNG only.
    assert.equal(detectByContent(new Uint8Array([0x89, 0x50])), null);
  });

  test('an empty buffer matches nothing', () => {
    assert.equal(detectByContent(new Uint8Array(0)), null);
  });

  test('webp needs both RIFF and WEBP, not just RIFF', () => {
    // RIFF alone is also WAV and AVI; matching on it would misfile those.
    const riffOnly = new Uint8Array(16);
    riffOnly.set([...'RIFF'].map(c => c.charCodeAt(0)), 0);
    const detected = detectByContent(riffOnly);
    assert.notEqual(detected?.mediaType, 'image/webp');
  });

  test('wav and webp are told apart despite the shared RIFF prefix', () => {
    assert.equal(detectByContent(fileBytes('wav'))?.mediaType, 'audio/wav');
    assert.equal(detectByContent(fileBytes('webp'))?.mediaType, 'image/webp');
  });
});

describe('a renamed file is refused', () => {
  test('HTML named .png is refused, not stored as an image', () => {
    const html = new TextEncoder().encode('<html><script>alert(document.cookie)</script></html>');
    const verdict = validateAsset('avatar.png', html);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'content-mismatch');
    assert.match(verdict.message, /contents, not its name/);
  });

  test('a real PNG named .gif is refused', () => {
    // Refused rather than silently reclassified: storing avatar.gif as a PNG is
    // surprising in the other direction, and the preview would serve the wrong type.
    const verdict = validateAsset('avatar.gif', fileBytes('png'));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'content-mismatch');
    assert.match(verdict.message, /image\/gif/);
    assert.match(verdict.message, /image\/png/);
  });

  test('a script named .pdf is refused', () => {
    const script = new TextEncoder().encode('#!/bin/sh\nrm -rf /\n');
    assert.equal(validateAsset('brief.pdf', script).ok, false);
  });

  test('a ZIP named .png is refused', () => {
    assert.equal(validateAsset('image.png', fileBytes('zip')).ok, false);
  });

  test('the double-extension trick does not work', () => {
    // payload.png.html has extension `html`, which is not an asset at all.
    const verdict = validateAsset('payload.png.html', fileBytes('png'));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'not-an-asset');
  });

  test('.jpg and .jpeg agree with each other', () => {
    // Compared by media type, so the same bytes are valid under either name.
    assert.equal(validateAsset('a.jpg', fileBytes('jpg')).ok, true);
    assert.equal(validateAsset('a.jpeg', fileBytes('jpg')).ok, true);
  });
});

describe('a matching file is accepted', () => {
  for (const format of Object.keys(HEADERS)) {
    test(`a real ${format} named .${format} is accepted`, () => {
      const verdict = validateAsset(`file.${format}`, fileBytes(format));
      assert.equal(verdict.ok, true, JSON.stringify(verdict));
      if (verdict.ok) assert.equal(verdict.type.extension, format);
    });
  }

  test('the extension check is case-insensitive', () => {
    assert.equal(validateAsset('PHOTO.PNG', fileBytes('png')).ok, true);
  });
});

describe('size and emptiness', () => {
  test('an empty file is refused', () => {
    const verdict = validateAsset('a.png', new Uint8Array(0));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'empty');
  });

  test('a file over the limit is refused', () => {
    const big = new Uint8Array(DEFAULT_ASSET_LIMITS.maxBytes + 1);
    big.set(HEADERS.png, 0);
    const verdict = validateAsset('big.png', big);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'too-large');
    assert.match(verdict.message, /MB/);
  });

  test('a file exactly at the limit is accepted', () => {
    const exact = new Uint8Array(DEFAULT_ASSET_LIMITS.maxBytes);
    exact.set(HEADERS.png, 0);
    assert.equal(validateAsset('exact.png', exact).ok, true);
  });

  test('a custom limit is honoured', () => {
    const verdict = validateAsset('a.png', fileBytes('png'), { maxBytes: 8 });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'too-large');
  });

  test('the size check happens before the content check', () => {
    // Cheapest rejection first: a 50 MB file should not be scanned to find out it is
    // too big.
    const big = new Uint8Array(DEFAULT_ASSET_LIMITS.maxBytes + 1);
    // Deliberately NOT a PNG, so if content were checked first the reason would differ.
    const verdict = validateAsset('big.png', big);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.reason, 'too-large');
  });
});

describe('base64 round-trips', () => {
  test('every byte value survives', () => {
    const all = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) all[index] = index;
    assert.deepEqual(base64ToBytes(bytesToBase64(all)), all);
  });

  test('all three padding cases round-trip', () => {
    for (const length of [1, 2, 3, 4, 5, 6, 7]) {
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) bytes[index] = (index * 37) & 0xff;
      assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes, `length ${length}`);
    }
  });

  test('padding is emitted correctly', () => {
    assert.equal(bytesToBase64(new Uint8Array([0x41])), 'QQ==');
    assert.equal(bytesToBase64(new Uint8Array([0x41, 0x42])), 'QUI=');
    assert.equal(bytesToBase64(new Uint8Array([0x41, 0x42, 0x43])), 'QUJD');
  });

  test('it agrees with node Buffer, which the server uses', () => {
    // The two halves must produce identical text or an asset written by the client
    // decodes to different bytes on the server.
    const bytes = fileBytes('png', 300);
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
  });

  test('whitespace in the input is tolerated', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const wrapped = bytesToBase64(bytes).replace(/(.{2})/g, '$1\n');
    assert.deepEqual(base64ToBytes(wrapped), bytes);
  });

  test('an empty buffer round-trips to an empty string', () => {
    assert.equal(bytesToBase64(new Uint8Array(0)), '');
    assert.deepEqual(base64ToBytes(''), new Uint8Array(0));
  });

  test('a decoded asset still validates', () => {
    // The full path an imported image takes: bytes in, base64 stored, bytes back out.
    const original = fileBytes('gif');
    const restored = base64ToBytes(bytesToBase64(original));
    assert.equal(validateAsset('a.gif', restored).ok, true);
  });
});

describe('the type table is coherent', () => {
  test('every entry has a media type and at least one signature', () => {
    for (const type of ASSET_TYPES) {
      assert.ok(type.mediaType.includes('/'), type.extension);
      assert.ok(type.signatures.length > 0, `${type.extension} has no signature`);
    }
  });

  test('no media type is ever text/html or a script type', () => {
    // A media type the browser will execute must never be reachable through the
    // asset path, whatever the bytes say.
    for (const type of ASSET_TYPES) {
      assert.doesNotMatch(type.mediaType, /html|javascript|xml|svg/i, type.extension);
    }
  });

  test('every displayable type is an image', () => {
    for (const type of ASSET_TYPES) {
      if (type.displayable) assert.equal(type.kind, 'image', type.extension);
    }
  });

  test('extensions are unique and already lower case', () => {
    const seen = new Set<string>();
    for (const type of ASSET_TYPES) {
      assert.equal(type.extension, type.extension.toLowerCase());
      assert.ok(!seen.has(type.extension), `duplicate ${type.extension}`);
      seen.add(type.extension);
    }
  });
});

describe('formatBytes', () => {
  test('reads sensibly at each scale', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2.0 KB');
    assert.equal(formatBytes(3 * 1048576), '3.0 MB');
  });
});
