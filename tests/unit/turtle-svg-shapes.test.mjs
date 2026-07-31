/**
 * SVG cursor shapes: the server-side bound and validation.
 *
 * This feature arrived from `main`, written against the pre-refactor architecture
 * where nothing sanitised the turtle payload. Merged onto this branch it would have
 * been silently DROPPED - `sanitizeTurtleData` is an allowlist, and `svgShapes` was
 * not on it, so the renderer would never have seen the field. Nothing in a clean
 * merge, a typecheck or a Python parse catches that; only a test does.
 *
 * The content inside the payload is the student's, so it is untrusted even though
 * the shim that wrapped it is trusted. The renderer draws it via `new Image()` and
 * `ctx.drawImage`, which is the safe context - a browser runs no scripts and fetches
 * no external references for an SVG loaded as an image. These checks are therefore
 * defence in depth, and worth having exactly because that guarantee lives in the
 * client: rendering the same payload with `innerHTML`, `<object>`, `<embed>` or
 * `<use>` would make it live, and this is what stops that becoming a hole.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeTurtleData, GRAPHICS_LIMITS } from '../../server/graphics/turtle.mjs';

/**
 * A minimal payload that survives sanitisation on its own.
 *
 * `k`, not `t`. The first version of this file used `{ t: 'M' }` - the same imagined
 * schema the sanitiser itself was built on - so it passed against the broken
 * sanitiser and failed the moment the sanitiser was corrected. Captured from the
 * real shim now, like every other fixture that describes program output.
 */
const BASE = { shapes: [{ k: 'M', x: 0, y: 0 }], cursors: [] };

const dataUrl = svg =>
  `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;

const withShapes = svgShapes => sanitizeTurtleData({ ...BASE, svgShapes });

describe('the field survives at all', () => {
  test('a clean SVG cursor is kept', () => {
    const out = withShapes({
      'player.svg': { data: dataUrl('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'), w: 40, h: 30 },
    });
    assert.ok(out?.svgShapes, 'svgShapes was dropped entirely');
    assert.ok(out.svgShapes['player.svg'], 'the shape was dropped');
  });

  test('dimensions and rotate are preserved', () => {
    const out = withShapes({
      'p.svg': { data: dataUrl('<svg viewBox="0 0 10 10"/>'), w: 40, h: 30, rotate: true },
    });
    assert.equal(out.svgShapes['p.svg'].w, 40);
    assert.equal(out.svgShapes['p.svg'].h, 30);
    assert.equal(out.svgShapes['p.svg'].rotate, true);
  });

  test('rotate defaults to false rather than undefined', () => {
    const out = withShapes({ 'p.svg': { data: dataUrl('<svg viewBox="0 0 1 1"/>') } });
    assert.equal(out.svgShapes['p.svg'].rotate, false);
  });

  test('a missing or zero dimension falls back instead of drawing nothing', () => {
    const out = withShapes({
      'a.svg': { data: dataUrl('<svg viewBox="0 0 1 1"/>') },
      'b.svg': { data: dataUrl('<svg viewBox="0 0 1 1"/>'), w: 0, h: -5 },
    });
    assert.equal(out.svgShapes['a.svg'].w, 42);
    assert.equal(out.svgShapes['b.svg'].w, 42);
    assert.equal(out.svgShapes['b.svg'].h, 42);
  });

  test('a payload with no SVG shapes is unaffected', () => {
    const out = sanitizeTurtleData(BASE);
    assert.equal(out.svgShapes, undefined);
  });
});

describe('active content is refused', () => {
  const refused = [
    ['a script element', '<svg><script>alert(1)</script></svg>'],
    ['a spaced script element', '<svg>< script >alert(1)</script></svg>'],
    ['an onload handler', '<svg onload="alert(1)"><rect/></svg>'],
    ['an onerror handler', '<svg><image onerror="alert(1)"/></svg>'],
    ['a javascript: URL', '<svg><a href="javascript:alert(1)"><rect/></a></svg>'],
    ['foreignObject', '<svg><foreignObject><div/></foreignObject></svg>'],
    ['an iframe', '<svg><iframe src="x"/></svg>'],
    ['an embed', '<svg><embed src="x"/></svg>'],
    ['an object', '<svg><object data="x"/></svg>'],
    ['a use element', '<svg><use href="other.svg#a"/></svg>'],
    ['an http image reference', '<svg><image href="https://evil.example/x.png"/></svg>'],
    ['a protocol-relative image reference', '<svg><image href="//evil.example/x.png"/></svg>'],
    ['an xlink:href to http', '<svg><image xlink:href="http://evil.example/x"/></svg>'],
    ['an xlink:href to data', '<svg><image xlink:href="data:text/html,x"/></svg>'],
    ['an ENTITY declaration', '<!ENTITY a "b"><svg/>'],
    ['a DOCTYPE with an internal subset', '<!DOCTYPE svg [<!ENTITY a "b">]><svg/>'],
  ];

  for (const [name, svg] of refused) {
    test(`${name} is refused`, () => {
      const out = withShapes({ 'x.svg': { data: dataUrl(svg) } });
      assert.equal(out?.svgShapes, undefined, `${name} survived`);
    });
  }

  test('a plain decorative SVG with a gradient and a path is NOT refused', () => {
    // The rejection list must not be so broad that real artwork fails. A cursor
    // that legitimately uses defs, gradients and paths has to work.
    const svg =
      '<svg viewBox="0 0 24 24"><defs><linearGradient id="g">' +
      '<stop offset="0" stop-color="#0f0"/><stop offset="1" stop-color="#080"/>' +
      '</linearGradient></defs><path d="M2 2 L22 12 L2 22 Z" fill="url(#g)"/></svg>';
    const out = withShapes({ 'ok.svg': { data: dataUrl(svg) } });
    assert.ok(out?.svgShapes?.['ok.svg'], 'legitimate artwork was rejected');
  });
});

describe('the envelope must come from the shim', () => {
  test('a non-svg data URL is refused', () => {
    const out = withShapes({
      'x.svg': { data: `data:text/html;base64,${Buffer.from('<svg/>').toString('base64')}` },
    });
    assert.equal(out?.svgShapes, undefined);
  });

  test('a plain URL is refused', () => {
    const out = withShapes({ 'x.svg': { data: 'https://evil.example/cursor.svg' } });
    assert.equal(out?.svgShapes, undefined);
  });

  test('malformed base64 is refused', () => {
    const out = withShapes({ 'x.svg': { data: 'data:image/svg+xml;base64,!!!nope!!!' } });
    assert.equal(out?.svgShapes, undefined);
  });

  test('base64 that does not decode to SVG is refused', () => {
    const out = withShapes({ 'x.svg': { data: dataUrl('just some text') } });
    assert.equal(out?.svgShapes, undefined);
  });

  test('a non-string data field is refused', () => {
    for (const data of [null, undefined, 42, {}, []]) {
      const out = withShapes({ 'x.svg': { data } });
      assert.equal(out?.svgShapes, undefined, `data=${JSON.stringify(data)}`);
    }
  });

  test('a non-object entry is refused', () => {
    for (const entry of ['string', 42, null, []]) {
      const out = withShapes({ 'x.svg': entry });
      assert.equal(out?.svgShapes, undefined, `entry=${JSON.stringify(entry)}`);
    }
  });
});

describe('bounds', () => {
  test('an SVG larger than maxSvgBytes is refused', () => {
    const big = `<svg viewBox="0 0 1 1">${'A'.repeat(GRAPHICS_LIMITS.maxSvgBytes + 1024)}</svg>`;
    const out = withShapes({ 'x.svg': { data: dataUrl(big) } });
    assert.equal(out?.svgShapes, undefined);
  });

  test('the number of shapes is capped', () => {
    const many = {};
    for (let index = 0; index < GRAPHICS_LIMITS.maxSvgShapes + 20; index += 1) {
      many[`t${index}.svg`] = { data: dataUrl('<svg viewBox="0 0 1 1"/>') };
    }
    const out = withShapes(many);
    assert.equal(Object.keys(out.svgShapes).length, GRAPHICS_LIMITS.maxSvgShapes);
  });

  test('the total byte budget stops many large shapes adding up', () => {
    // Each is under the per-shape cap; together they exceed the total.
    const each = `<svg viewBox="0 0 1 1">${'B'.repeat(200 * 1024)}</svg>`;
    const many = {};
    for (let index = 0; index < GRAPHICS_LIMITS.maxSvgShapes; index += 1) {
      many[`s${index}.svg`] = { data: dataUrl(each) };
    }
    const kept = Object.keys(withShapes(many).svgShapes).length;
    assert.ok(kept > 0, 'the budget rejected everything');
    assert.ok(kept < GRAPHICS_LIMITS.maxSvgShapes, `nothing was capped: kept ${kept}`);
  });

  test('an absurd dimension is clamped to the default, not honoured', () => {
    const out = withShapes({
      'x.svg': { data: dataUrl('<svg viewBox="0 0 1 1"/>'), w: 1e9, h: 1e9 },
    });
    assert.equal(out.svgShapes['x.svg'].w, 42);
  });

  test('the shim and the server agree on the per-shape limit', () => {
    // The shim caps at _MAX_SVG_BYTES. If the two drift, the shim produces
    // payloads the server silently drops - which is how the ported version's 12 MB
    // limit would have behaved against an 8 MB channel.
    assert.equal(GRAPHICS_LIMITS.maxSvgBytes, 256 * 1024);
  });

  test('one bad shape does not discard the good ones alongside it', () => {
    const out = withShapes({
      'good.svg': { data: dataUrl('<svg viewBox="0 0 1 1"><rect/></svg>') },
      'bad.svg': { data: dataUrl('<svg><script>x</script></svg>') },
    });
    assert.ok(out.svgShapes['good.svg'], 'the good shape was discarded');
    assert.equal(out.svgShapes['bad.svg'], undefined, 'the bad shape survived');
  });
});
