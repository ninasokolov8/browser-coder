/**
 * The one HTML escaper.
 *
 * There were eight hand-rolled copies with three different behaviours. Two of the
 * three variants omitted quote escaping, and the weakest of them built markup for
 * the output panel. Every call site there interpolated into element content rather
 * than an attribute, so it was not exploitable - but nothing recorded that, and the
 * next person to reach for the local helper had no way to know it was the weak one.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml } from '../../src/components/html-escape.ts';

describe('all five structural characters', () => {
  test('each one is escaped', () => {
    assert.equal(escapeHtml('&'), '&amp;');
    assert.equal(escapeHtml('<'), '&lt;');
    assert.equal(escapeHtml('>'), '&gt;');
    assert.equal(escapeHtml('"'), '&quot;');
    assert.equal(escapeHtml("'"), '&#39;');
  });

  test('all five together, in order', () => {
    assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  });

  test('ampersand is escaped FIRST, so escapes are not double-escaped', () => {
    // Escaping < before & would turn "<" into "&lt;" and then into "&amp;lt;".
    assert.equal(escapeHtml('<a>'), '&lt;a&gt;');
    assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  });
});

describe('the attacks the old variants would have allowed', () => {
  test('a tag cannot be injected into element content', () => {
    const escaped = escapeHtml('<script>alert(1)</script>');
    assert.doesNotMatch(escaped, /<script>/);
    assert.match(escaped, /&lt;script&gt;/);
  });

  test('a quote cannot break out of a double-quoted attribute', () => {
    // This is what the three-character variants could not stop. The output panel
    // never interpolated into an attribute, so it was latent - but the escaper is
    // now safe in both positions, so it cannot become live by someone reusing it.
    const escaped = escapeHtml('" onmouseover="alert(1)');
    assert.doesNotMatch(escaped, /" onmouseover="/);
    assert.match(escaped, /&quot;/);
  });

  test('a quote cannot break out of a single-quoted attribute either', () => {
    const escaped = escapeHtml("' onerror='alert(1)");
    assert.doesNotMatch(escaped, /' onerror='/);
    assert.match(escaped, /&#39;/);
  });
});

describe('inputs the old copies handled differently', () => {
  test('non-strings are coerced, not crashed on', () => {
    // run-panel's copies took `unknown` and called String(); others took `string`.
    // One function has to accept both, or a caller passing a number breaks.
    assert.equal(escapeHtml(42), '42');
    assert.equal(escapeHtml(true), 'true');
  });

  test('null and undefined become empty, not the words "null"/"undefined"', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });

  test('an empty string stays empty', () => {
    assert.equal(escapeHtml(''), '');
  });

  test('text with nothing to escape is unchanged', () => {
    assert.equal(escapeHtml('hello world 123'), 'hello world 123');
  });

  test('newlines and tabs survive, because the output panel relies on them', () => {
    assert.equal(escapeHtml('a\nb\tc'), 'a\nb\tc');
  });

  test('non-ASCII text is untouched', () => {
    assert.equal(escapeHtml('שלום 世界 🐢'), 'שלום 世界 🐢');
  });
});

describe('it is idempotent in the sense that matters', () => {
  test('escaping twice is visibly wrong, so callers must not', () => {
    // Recorded as a property rather than a guarantee: this is a reminder that
    // markdown.ts unescapes before re-escaping attribute values for exactly this
    // reason.
    assert.equal(escapeHtml(escapeHtml('&')), '&amp;amp;');
  });
});
