/**
 * The turtle shim's payload, against the sanitiser that has to accept it.
 *
 * ## The bug this exists to prevent
 *
 * `sanitizeTurtleData` was written against an imagined schema. It required every
 * entry to carry `t` or `type`; the shim emits `k`. It bounded a `text` field; the
 * shim emits `txt`. It ran cursors through the shape sanitiser; cursors carry no
 * kind at all. So every shape and every cursor was rejected, both arrays came out
 * empty, and the trailing "nothing to draw" check turned every drawing into
 * `turtleData: null`.
 *
 * Turtle graphics - the headline feature of this IDE - rendered nothing whatsoever,
 * and the unit tests all passed because every one of them used a hand-written
 * fixture in the shape the sanitiser expected.
 *
 * So this test does not use a fixture. It runs the REAL shim through the REAL
 * interpreter and feeds the REAL output to the sanitiser. Drift in either direction
 * fails here, which is the only way this class of bug gets caught.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { sanitizeTurtleData, GRAPHICS_LIMITS } from '../../server/graphics/turtle.mjs';

const SHIM = resolve(import.meta.dirname, '../../languages/python/turtle_shim.py');
const USER_CODE_SEPARATOR = '\n\n# ── user code ──\n';

function findPython() {
  for (const candidate of [process.env.PYTHON_BIN, 'python3', 'python']) {
    if (!candidate) continue;
    const probe = spawnSync(candidate, ['-c', 'print("ok")'], { encoding: 'utf8' });
    if (probe.status === 0 && /ok/.test(probe.stdout)) return candidate;
  }
  return null;
}

const PYTHON = findPython();
const skip = PYTHON ? false : 'no python on this host';

/** Run `code` under the real shim and return the raw payload it wrote. */
function runShim(code) {
  const dir = mkdtempSync(join(tmpdir(), 'bc-turtle-'));
  try {
    const program = join(dir, 'main.py');
    const output = join(dir, 'out.json');
    writeFileSync(program, readFileSync(SHIM, 'utf8') + USER_CODE_SEPARATOR + code, 'utf8');

    const result = spawnSync(PYTHON, ['-u', program], {
      encoding: 'utf8',
      cwd: dir,
      env: {
        ...process.env,
        BROWSER_CODER_GRAPHICS_OUT: output,
        BROWSER_CODER_WORKSPACE: dir,
      },
    });

    return {
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      raw: existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null,
      dir,
    };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* fine */ }
  }
}

describe('a drawing survives the whole chain', { skip }, () => {
  let raw;
  let clean;

  before(() => {
    const run = runShim([
      'import turtle',
      's = turtle.Screen()',
      's.bgcolor("lightblue")',
      't = turtle.Turtle()',
      't.forward(50)',
      't.left(90)',
      't.begin_fill()',
      't.circle(30)',
      't.end_fill()',
      't.penup()',
      't.goto(100, 100)',
      't.pendown()',
      't.write("hello", font=("Arial", 12, "normal"), align="center")',
      't.dot(10, "red")',
      't.stamp()',
      's.register_shape("tri", ((0, 0), (10, 0), (5, 10)))',
      't.shape("tri")',
    ].join('\n'));

    assert.equal(run.status, 0, `the shim failed: ${run.stderr}`);
    raw = run.raw;
    clean = sanitizeTurtleData(raw);
  });

  test('the shim writes a payload', () => {
    assert.ok(raw, 'no graphics file was written');
    assert.ok(Array.isArray(raw.shapes) && raw.shapes.length > 0);
  });

  test('the sanitiser does NOT reject the whole drawing', () => {
    // This is the assertion that was missing. It returned null for every real
    // drawing this IDE has ever produced.
    assert.notEqual(clean, null, 'sanitizeTurtleData rejected a real drawing');
  });

  test('every shape the shim emitted survives', () => {
    assert.equal(
      clean.shapes.length,
      raw.shapes.length,
      `dropped ${raw.shapes.length - clean.shapes.length} of ${raw.shapes.length} shapes`,
    );
  });

  test('the cursor survives', () => {
    assert.ok(raw.cursors.length > 0, 'the shim emitted no cursor');
    assert.equal(clean.cursors.length, raw.cursors.length);
  });

  test('every kind the shim can emit is recognised', () => {
    // If the shim gains a kind and the sanitiser is not told, those shapes vanish
    // silently. Listing them here means adding one without updating the table fails.
    const emitted = new Set(raw.shapes.map(shape => shape.k));
    for (const kind of emitted) {
      assert.ok(
        SHAPE_KINDS.has(kind),
        `the shim emits kind "${kind}" but the sanitiser does not recognise it`,
      );
    }
    // And this program is broad enough to exercise most of them.
    for (const expected of ['l', 'F', 'M', 'T', 'D', 'S']) {
      assert.ok(emitted.has(expected), `the probe program did not produce kind "${expected}"`);
    }
  });

  test('text is carried under the key the shim actually uses', () => {
    const text = clean.shapes.find(shape => shape.k === 'T');
    assert.ok(text, 'the text shape was dropped');
    // `txt`, not `text`. The old sanitiser bounded `text` and so never saw this.
    assert.equal(text.txt, 'hello');
  });

  test('colours and geometry are carried', () => {
    const line = clean.shapes.find(shape => shape.k === 'l');
    assert.equal(line.c, 'black');
    assert.equal(line.x1, 0);
    assert.equal(line.x2, 50);

    const dot = clean.shapes.find(shape => shape.k === 'D');
    assert.equal(dot.c, 'red');
    // `dot(size)` takes a DIAMETER in CPython's turtle, and the shim stores a
    // radius - so `dot(10)` is r=5. Pinned because getting it backwards would draw
    // every dot at twice the size the student asked for, which looks plausible.
    assert.equal(dot.r, 5);
  });

  test('a filled polygon keeps its points', () => {
    const fill = clean.shapes.find(shape => shape.k === 'F');
    assert.ok(Array.isArray(fill.pts) && fill.pts.length >= 3);
  });

  test('screen settings are carried', () => {
    assert.equal(clean.bg, 'lightblue');
    assert.equal(clean.w, 600);
    assert.equal(clean.h, 600);
  });

  test('a registered polygon shape is carried', () => {
    assert.ok(clean.polys?.tri, 'register_shape polygon was dropped');
  });

  test('the cursor keeps its visibility flag', () => {
    // A boolean, which a numbers-and-strings-only copier drops - and then the
    // renderer cannot tell a hidden turtle from a visible one.
    assert.equal(typeof clean.cursors[0].vis, 'boolean');
  });
});

/** Kept in step with SHAPE_FIELDS.kinds in server/graphics/turtle.mjs. */
const SHAPE_KINDS = new Set(['l', 'F', 'M', 'T', 'D', 'S', 'SH']);

describe('unknown fields do not travel through', { skip }, () => {
  test('a field the sanitiser has not reviewed is dropped', () => {
    // The old implementation did `{ ...shape }` and then patched a few keys, so
    // anything new in the shim reached the browser unreviewed - the opposite of the
    // allowlist its own comment claimed.
    const clean = sanitizeTurtleData({
      shapes: [{ k: 'l', x1: 0, y1: 0, x2: 1, y2: 1, smuggled: '<script>alert(1)</script>' }],
      cursors: [],
    });
    assert.equal(clean.shapes[0].smuggled, undefined, 'an unlisted field survived');
  });

  test('an unknown shape kind is dropped rather than passed on', () => {
    const clean = sanitizeTurtleData({
      shapes: [{ k: 'l', x1: 0, y1: 0, x2: 1, y2: 1 }, { k: 'EVIL', x: 1 }],
      cursors: [],
    });
    assert.equal(clean.shapes.length, 1);
  });

  test('bounds still apply to real output', () => {
    assert.ok(GRAPHICS_LIMITS.maxShapes > 0);
    const clean = sanitizeTurtleData({
      shapes: [{ k: 'T', txt: 'x'.repeat(GRAPHICS_LIMITS.maxTextLength + 500), x: 0, y: 0 }],
      cursors: [],
    });
    assert.equal(clean.shapes[0].txt.length, GRAPHICS_LIMITS.maxTextLength);
  });
});

describe('an SVG cursor reaches the renderer', { skip }, () => {
  test('inline SVG source registers and survives sanitisation', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';
    const run = runShim([
      'import turtle',
      `SVG = ${JSON.stringify(svg)}`,
      's = turtle.Screen()',
      's.register_shape("player.svg", SVG)',
      't = turtle.Turtle()',
      't.shape("player.svg")',
      't.forward(20)',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.raw?.svgShapes?.['player.svg'], 'the shim did not emit svgShapes');

    const clean = sanitizeTurtleData(run.raw);
    assert.ok(clean?.svgShapes?.['player.svg'], 'svgShapes was stripped by the sanitiser');
    assert.ok(clean.svgShapes['player.svg'].data.startsWith('data:image/svg+xml;base64,'));
  });

  test('an absolute path is not treated as a workspace file', () => {
    // The ported version called expanduser/abspath on the shape name, so this named
    // a real path to open. Confined now, and `open` is guarded as well.
    const run = runShim([
      'import turtle',
      's = turtle.Screen()',
      's.register_shape("/etc/hostname.svg")',
      't = turtle.Turtle()',
      't.forward(5)',
      'print("svg shapes:", [x for x in s.getshapes() if x.endswith(".svg")])',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /svg shapes: \[\]/);
    assert.equal(run.raw?.svgShapes, undefined);
  });

  test('a hostile SVG in the workspace is refused by the server', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>';
    const run = runShim([
      'import turtle',
      `SVG = ${JSON.stringify(svg)}`,
      's = turtle.Screen()',
      's.register_shape("evil.svg", SVG)',
      't = turtle.Turtle()',
      't.forward(5)',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    // The shim accepts it - it is not the security boundary.
    assert.ok(run.raw?.svgShapes?.['evil.svg']);
    // The server is.
    const clean = sanitizeTurtleData(run.raw);
    assert.equal(clean?.svgShapes, undefined, 'a script-bearing SVG reached the client');
  });
});
