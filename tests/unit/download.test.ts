/**
 * Exporting files, and the bug where an exported image was not an image.
 *
 * `downloadFile` wrapped every file in a `text/plain` Blob, and the project ZIP passed
 * `file.content` straight to `zip.file(...)`. Correct for source; wrong for an asset,
 * whose content is BASE64. Exporting a PNG produced a file containing the characters
 * `iVBORw0KGgo...` under a `.png` name - which opens in nothing, and reads as a
 * corrupt image rather than a wrong export.
 *
 * `fileBytesFor` is the shared decision both paths now use, so they cannot drift again.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { fileBytesFor } from '../../src/components/download.ts';
import { bytesToBase64 } from '../../src/workspace/assets.ts';

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A small but structurally real PNG-ish payload. */
function pngBytes(extra = 32): Uint8Array {
  const bytes = new Uint8Array(PNG_HEADER.length + extra);
  bytes.set(PNG_HEADER, 0);
  for (let index = PNG_HEADER.length; index < bytes.length; index += 1) {
    bytes[index] = (index * 7) & 0xff;
  }
  return bytes;
}

describe('source files stay text', () => {
  test('code is returned unchanged, as a string', () => {
    const code = 'def main():\n    print("hello")\n';
    const { data, mediaType } = fileBytesFor('main.py', code);
    assert.equal(data, code);
    assert.match(mediaType, /text\/plain/);
  });

  test('every source extension is treated as text', () => {
    for (const name of ['a.py', 'a.js', 'a.ts', 'a.java', 'a.cs', 'a.php', 'a.html', 'a.css', 'a.json', 'a.md', 'a.svg']) {
      const { data } = fileBytesFor(name, 'x');
      assert.equal(typeof data, 'string', name);
    }
  });

  test('an SVG stays text, because it IS text', () => {
    // SVG is deliberately not an asset: it has its own editor and sanitiser.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    assert.equal(fileBytesFor('icon.svg', svg).data, svg);
  });
});

describe('assets are decoded back to bytes', () => {
  test('a PNG comes back as the original bytes, not as base64 text', () => {
    const original = pngBytes();
    const { data, mediaType } = fileBytesFor('logo.png', bytesToBase64(original));

    assert.ok(data instanceof Uint8Array, 'still a string - the export would be corrupt');
    assert.deepEqual(data, original);
    assert.equal(mediaType, 'image/png');
  });

  test('the decoded bytes begin with the real PNG signature', () => {
    // The assertion that would have caught the bug: a base64 string starts with
    // 'iVBORw0KGgo', not with 0x89 'P' 'N' 'G'.
    const { data } = fileBytesFor('logo.png', bytesToBase64(pngBytes()));
    assert.deepEqual([...(data as Uint8Array).slice(0, 8)], PNG_HEADER);
  });

  test('each asset type gets its own media type', () => {
    const cases: Array<[string, string]> = [
      ['a.png', 'image/png'],
      ['a.jpg', 'image/jpeg'],
      ['a.gif', 'image/gif'],
      ['a.webp', 'image/webp'],
      ['a.pdf', 'application/pdf'],
      ['a.mp3', 'audio/mpeg'],
      ['a.zip', 'application/zip'],
    ];
    for (const [name, expected] of cases) {
      // Content need not be valid here: the media type comes from the validated name.
      assert.equal(fileBytesFor(name, bytesToBase64(pngBytes())).mediaType, expected, name);
    }
  });

  test('the round trip is byte-exact for every byte value', () => {
    const all = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) all[index] = index;
    const { data } = fileBytesFor('blob.zip', bytesToBase64(all));
    assert.deepEqual(data, all);
  });
});

describe('degenerate input does not produce an empty file', () => {
  test('content that is not decodable base64 falls back to text', () => {
    // An empty file would silently discard whatever the student had. Writing the raw
    // text at least preserves it for them to look at.
    const { data } = fileBytesFor('broken.png', '!!! not base64 !!!');
    assert.equal(typeof data, 'string');
  });

  test('empty content is handled', () => {
    const { data } = fileBytesFor('empty.png', '');
    assert.equal((data as Uint8Array).length ?? 0, 0);
  });

  test('a name with no extension is text', () => {
    assert.equal(typeof fileBytesFor('README', 'notes').data, 'string');
  });

  test('the extension check is case-insensitive', () => {
    const { mediaType } = fileBytesFor('LOGO.PNG', bytesToBase64(pngBytes()));
    assert.equal(mediaType, 'image/png');
  });
});
