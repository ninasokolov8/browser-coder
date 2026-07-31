/**
 * Preview project rules.
 *
 * These checks decide whether a published preview can write or read outside its
 * own directory, and until this refactor they were unreachable from a test: the
 * logic sat in server.mjs behind an express handler and a filesystem write. Now
 * that it is a pure module, the containment rules can be asserted directly.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  PREVIEW_ID_PATTERN,
  normalizePreviewProjectPath,
  safePreviewAssetPath,
  validatePreviewProject,
} from '../../server/previews/project.mjs';
import {
  buildLegacyPreviewShell,
  buildPreviewShell,
  encodePreviewProjectPath,
  escapeHtmlAttribute,
} from '../../server/previews/shell.mjs';
import { isActivePreviewDocument, previewMimeType } from '../../server/previews/headers.mjs';

const LIMITS = {
  maxPathChars: 300,
  maxFileCount: 50,
  maxHtmlBytes: 100_000,
  ttlMs: 60_000,
  cleanupIntervalMs: 60_000,
};

describe('normalizePreviewProjectPath', () => {
  test('accepts an ordinary nested path', () => {
    assert.equal(normalizePreviewProjectPath('js/app.js', LIMITS), 'js/app.js');
  });

  test('accepts backslashes as separators', () => {
    assert.equal(normalizePreviewProjectPath('js\\app.js', LIMITS), 'js/app.js');
  });

  test('strips a leading slash rather than rejecting it', () => {
    // Deliberate: unlike the run-path validator, a preview path arrives from the
    // IDE's own publish button rather than from an arbitrary API caller, and the
    // frozen behaviour has always been to accept it.
    assert.equal(normalizePreviewProjectPath('/index.html', LIMITS), 'index.html');
  });

  test('rejects a traversal segment', () => {
    assert.equal(normalizePreviewProjectPath('../secret', LIMITS), null);
    assert.equal(normalizePreviewProjectPath('a/../../secret', LIMITS), null);
    assert.equal(normalizePreviewProjectPath('a/b/../../../secret', LIMITS), null);
  });

  test('rejects traversal that only appears before normalization', () => {
    // `a/../b` normalizes to a harmless `b`. It is still rejected, because
    // accepting it would mean the check depends on normalization order - and the
    // ordering mistake is what makes traversal filters fail.
    assert.equal(normalizePreviewProjectPath('a/../b', LIMITS), null);
  });

  test('rejects a NUL byte', () => {
    assert.equal(normalizePreviewProjectPath('a\0b.html', LIMITS), null);
  });

  test('rejects an empty path', () => {
    assert.equal(normalizePreviewProjectPath('', LIMITS), null);
    assert.equal(normalizePreviewProjectPath('/', LIMITS), null);
    assert.equal(normalizePreviewProjectPath('.', LIMITS), null);
  });

  test('rejects a path longer than the limit', () => {
    assert.equal(normalizePreviewProjectPath('a'.repeat(301), LIMITS), null);
  });

  test('rejects a non-string', () => {
    assert.equal(normalizePreviewProjectPath(undefined, LIMITS), null);
    assert.equal(normalizePreviewProjectPath(42, LIMITS), null);
    assert.equal(normalizePreviewProjectPath({}, LIMITS), null);
  });
});

describe('validatePreviewProject', () => {
  const project = files => validatePreviewProject(files, 'index.html', LIMITS);

  test('accepts a minimal project', () => {
    const result = project([{ path: 'index.html', content: '<h1>hi</h1>' }]);
    assert.equal(result.entryPath, 'index.html');
    assert.equal(result.files.length, 1);
  });

  test('rejects an empty file list', () => {
    assert.throws(() => project([]), /files are required/);
    assert.throws(() => validatePreviewProject(null, 'index.html', LIMITS), /files are required/);
  });

  test('rejects too many files', () => {
    const many = Array.from({ length: 51 }, (_, index) => ({ path: `f${index}.html`, content: '' }));
    assert.throws(() => project(many), /too many files/);
  });

  test('rejects a duplicate path after normalization', () => {
    assert.throws(
      () => project([
        { path: 'index.html', content: 'a' },
        { path: '/index.html', content: 'b' },
      ]),
      /Duplicate preview file path/,
    );
  });

  test('rejects a project larger than the byte budget', () => {
    assert.throws(
      () => project([{ path: 'index.html', content: 'x'.repeat(100_001) }]),
      /too large/,
    );
  });

  test('rejects an entry that is not in the project', () => {
    assert.throws(
      () => validatePreviewProject([{ path: 'other.html', content: '' }], 'index.html', LIMITS),
      /entry HTML file was not included/,
    );
  });

  test('rejects a non-HTML entry', () => {
    assert.throws(
      () => validatePreviewProject([{ path: 'main.js', content: '' }], 'main.js', LIMITS),
      /must be an HTML file/,
    );
  });

  test('defaults the entry to index.html', () => {
    const result = validatePreviewProject([{ path: 'index.html', content: '' }], undefined, LIMITS);
    assert.equal(result.entryPath, 'index.html');
  });

  test('a non-string content becomes empty rather than throwing', () => {
    const result = project([{ path: 'index.html', content: { not: 'a string' } }]);
    assert.equal(result.files[0].content, '');
  });

  test('truncates an over-long language label', () => {
    const result = project([{ path: 'index.html', content: '', language: 'x'.repeat(500) }]);
    assert.equal(result.files[0].language.length, 100);
  });
});

describe('safePreviewAssetPath', () => {
  const STORAGE = path.resolve('/srv/previews');
  const ID = 'a'.repeat(22);

  test('resolves a nested asset inside the preview directory', () => {
    const asset = safePreviewAssetPath(STORAGE, ID, 'css/site.css', LIMITS);
    assert.ok(asset);
    assert.equal(asset.normalizedPath, 'css/site.css');
    assert.ok(asset.filePath.startsWith(path.join(STORAGE, ID)));
  });

  test('rejects an id that is not a preview id', () => {
    assert.equal(safePreviewAssetPath(STORAGE, '../etc', 'a.html', LIMITS), null);
    assert.equal(safePreviewAssetPath(STORAGE, 'short', 'a.html', LIMITS), null);
  });

  test('rejects a traversal in the requested path', () => {
    assert.equal(safePreviewAssetPath(STORAGE, ID, '../../etc/passwd', LIMITS), null);
  });

  test('cannot reach a sibling whose name merely starts the same', () => {
    // The containment check compares against `directory + separator`. Comparing
    // against the bare directory would let /srv/previews/aaa...a-evil pass as being
    // "inside" /srv/previews/aaa...a.
    const asset = safePreviewAssetPath(STORAGE, ID, 'x', LIMITS);
    assert.ok(asset);
    assert.ok(
      asset.filePath.startsWith(path.join(STORAGE, ID) + path.sep),
      'resolved file must be strictly beneath the preview directory',
    );
  });
});

describe('preview id', () => {
  test('accepts 22 URL-safe characters and nothing else', () => {
    assert.ok(PREVIEW_ID_PATTERN.test('A'.repeat(22)));
    assert.ok(PREVIEW_ID_PATTERN.test('aA0_-'.repeat(4) + 'ab'));
    assert.ok(!PREVIEW_ID_PATTERN.test('A'.repeat(21)));
    assert.ok(!PREVIEW_ID_PATTERN.test('A'.repeat(23)));
    assert.ok(!PREVIEW_ID_PATTERN.test('A'.repeat(21) + '.'));
    assert.ok(!PREVIEW_ID_PATTERN.test('../..'));
  });
});

describe('preview shell', () => {
  const ID = 'b'.repeat(22);

  test('the iframe sandbox withholds allow-same-origin', () => {
    // Granting allow-same-origin together with allow-scripts is equivalent to no
    // sandbox at all.
    const shell = buildPreviewShell(ID, 'index.html');
    assert.ok(shell.includes('sandbox="'));
    assert.ok(!shell.includes('allow-same-origin'));
  });

  test('the iframe sandbox withholds popup escape (V-04)', () => {
    const shell = buildPreviewShell(ID, 'index.html');
    assert.ok(!shell.includes('allow-popups-to-escape-sandbox'));
    assert.ok(!shell.includes('allow-popups'));
  });

  test('the iframe sandbox grants what a student page needs', () => {
    const shell = buildPreviewShell(ID, 'index.html');
    for (const token of ['allow-scripts', 'allow-forms', 'allow-modals', 'allow-downloads']) {
      assert.ok(shell.includes(token), `expected sandbox token ${token}`);
    }
  });

  test('the src is relative, so an outer mount prefix survives', () => {
    const shell = buildPreviewShell(ID, 'index.html');
    assert.ok(shell.includes(`src="./${ID}/index.html"`));
  });

  test('a quote in the entry path cannot break out of the attribute', () => {
    const shell = buildPreviewShell(ID, 'a"><script>alert(1)</script>.html');
    assert.ok(!shell.includes('<script>alert(1)</script>'));
  });

  test('legacy srcdoc content is escaped', () => {
    const shell = buildLegacyPreviewShell('<img src="x" onerror="alert(1)">');
    assert.ok(shell.includes('srcdoc="'));
    assert.ok(!shell.includes('<img src="x"'));
    assert.ok(shell.includes('&lt;img'));
  });

  test('path segments are encoded but separators are not', () => {
    assert.equal(encodePreviewProjectPath('a b/c.html'), 'a%20b/c.html');
  });

  test('escapeHtmlAttribute covers the characters that matter in an attribute', () => {
    assert.equal(escapeHtmlAttribute('&"<>'), '&amp;&quot;&lt;&gt;');
  });
});

describe('preview content types', () => {
  test('known text and binary types are mapped', () => {
    assert.equal(previewMimeType('a.html'), 'text/html; charset=utf-8');
    assert.equal(previewMimeType('a.CSS'), 'text/css; charset=utf-8');
    assert.equal(previewMimeType('a.png'), 'image/png');
  });

  test('an unknown extension is not guessed', () => {
    assert.equal(previewMimeType('a.wat'), 'application/octet-stream');
    assert.equal(previewMimeType('noextension'), 'application/octet-stream');
  });

  test('SVG and XML count as active documents', () => {
    // Both can execute script when navigated to directly - SVG via <script>, XML
    // via XSLT - so both must receive the sandboxing CSP.
    for (const file of ['a.svg', 'a.xml', 'a.xhtml', 'a.xsl', 'a.html', 'a.htm']) {
      assert.equal(isActivePreviewDocument(file), true, `${file} must be treated as active`);
    }
  });

  test('passive assets are not treated as documents', () => {
    for (const file of ['a.css', 'a.js', 'a.png', 'a.json']) {
      assert.equal(isActivePreviewDocument(file), false, `${file} must not be treated as active`);
    }
  });
});
