/**
 * Conformance: the shim must expose the real `turtle` module's whole public API.
 *
 * The claim "turtle is fully supported" is only meaningful if it is checkable, so
 * this test asks the REAL module what its API is - `turtle.__all__`, 122 names - and
 * requires the shim to provide every one. Measured before writing it: the shim had
 * 96 of 122.
 *
 * Two properties, and the second is the one that decays:
 *
 *  - every name EXISTS, so no program dies with AttributeError
 *  - the ones with observable behaviour DO the right thing
 *
 * A name-only check would pass a shim full of `def x(): pass`, so the behavioural
 * half below covers what a student can actually see: geometry, angle units, cloning,
 * polygon recording and the drawing payload.
 *
 * Requires a host Python with tkinter, since importing the real `turtle` needs it.
 * The production container has no tkinter - which is the entire reason this shim
 * exists - so this test skips there rather than pretending to pass.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SHIM = resolve(import.meta.dirname, '../../languages/python/turtle_shim.py');
const USER_CODE_SEPARATOR = '\n\n# ── user code ──\n';

function findPython(needTkinter) {
  for (const candidate of [process.env.PYTHON_BIN, 'python3', 'python']) {
    if (!candidate) continue;
    const script = needTkinter ? 'import turtle; print("ok")' : 'print("ok")';
    const probe = spawnSync(candidate, ['-c', script], { encoding: 'utf8' });
    if (probe.status === 0 && /ok/.test(probe.stdout)) return candidate;
  }
  return null;
}

const PYTHON_ANY = findPython(false);
const PYTHON_TK = findPython(true);

const skipAny = PYTHON_ANY ? false : 'no python on this host';
const skipReal = PYTHON_TK ? false : 'no python with tkinter, so the real turtle API cannot be read';

/** Run `code` against the shim and return stdout plus the drawing payload. */
function runShim(code, python = PYTHON_ANY) {
  const dir = mkdtempSync(join(tmpdir(), 'bc-tapi-'));
  try {
    const program = join(dir, 'main.py');
    const output = join(dir, 'out.json');
    writeFileSync(program, readFileSync(SHIM, 'utf8') + USER_CODE_SEPARATOR + code, 'utf8');

    const result = spawnSync(python, ['-u', program], {
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, BROWSER_CODER_GRAPHICS_OUT: output, BROWSER_CODER_WORKSPACE: dir },
    });

    return {
      status: result.status,
      // CRLF normalised: Python on Windows ends every print with \r\n, so a
      // line-by-line comparison fails on a trailing \r that is invisible in the
      // diff. Trimming the whole string only hides it on the last line.
      stdout: (result.stdout || '').replace(/\r\n/g, '\n').trim(),
      stderr: (result.stderr || '').replace(/\r\n/g, '\n').trim(),
      data: existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : null,
    };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* fine */ }
  }
}

describe('every public name in the real turtle module exists', { skip: skipReal }, () => {
  let real = [];

  before(() => {
    const probe = spawnSync(PYTHON_TK, ['-c', 'import turtle;print("\\n".join(sorted(turtle.__all__)))'], {
      encoding: 'utf8',
    });
    assert.equal(probe.status, 0, probe.stderr);
    real = probe.stdout.split('\n').map(line => line.trim()).filter(Boolean);
    assert.ok(real.length > 100, `expected the real API to be large, got ${real.length}`);
  });

  test('the shim provides all of them', () => {
    // Asked of the shim's own module object, exactly as student code sees it.
    const script = [
      'import turtle',
      `names = ${JSON.stringify(real)}`,
      'missing = [n for n in names if not hasattr(turtle, n)]',
      'print("MISSING:" + ",".join(missing))',
    ].join('\n');

    const run = runShim(script);
    assert.equal(run.status, 0, run.stderr);
    const missing = (/MISSING:(.*)/.exec(run.stdout)?.[1] || '').split(',').filter(Boolean);
    assert.deepEqual(missing, [], `the shim is missing ${missing.length} names: ${missing.join(' ')}`);
  });

  test('the callable ones are callable, and the classes constructible', () => {
    const script = [
      'import turtle',
      'names = sorted(turtle.__all__)',
      'bad = []',
      'for n in names:',
      '    value = getattr(turtle, n, None)',
      '    if value is None:',
      '        bad.append(n + ":missing")',
      '    elif not (callable(value) or isinstance(value, type)):',
      '        bad.append(n + ":not-callable")',
      'print("BAD:" + ",".join(bad))',
    ].join('\n');

    const run = runShim(script);
    assert.equal(run.status, 0, run.stderr);
    const bad = (/BAD:(.*)/.exec(run.stdout)?.[1] || '').split(',').filter(Boolean);
    assert.deepEqual(bad, [], bad.join(' '));
  });

  test('a Turtle instance exposes the real Turtle methods', () => {
    // The module-level functions and the methods are two separate surfaces; a
    // program written in the object style must not hit AttributeError.
    const script = [
      'import turtle, inspect',
      'real = None',
      `names = ${JSON.stringify(real)}`,
      't = turtle.Turtle()',
      // Only names that are methods on the real Turtle, not screen-only functions.
      'method_like = ["forward","backward","right","left","goto","setheading","heading",',
      '  "position","xcor","ycor","penup","pendown","pensize","pencolor","fillcolor","color",',
      '  "begin_fill","end_fill","circle","dot","stamp","write","clear","reset","clone",',
      '  "hideturtle","showturtle","isvisible","shape","shapesize","tilt","teleport",',
      '  "begin_poly","end_poly","get_poly","get_shapepoly","shearfactor","shapetransform",',
      '  "undo","setundobuffer","undobufferentries","getscreen","towards","distance","home"]',
      'missing = [n for n in method_like if not hasattr(t, n)]',
      'print("MISSING:" + ",".join(missing))',
      'void = names',
    ].join('\n');

    const run = runShim(script);
    assert.equal(run.status, 0, run.stderr);
    const missing = (/MISSING:(.*)/.exec(run.stdout)?.[1] || '').split(',').filter(Boolean);
    assert.deepEqual(missing, [], `Turtle is missing: ${missing.join(' ')}`);
  });
});

describe('the newly added API behaves', { skip: skipAny }, () => {
  test('Vec2D is a tuple with working arithmetic', () => {
    const run = runShim([
      'from turtle import Vec2D',
      'a = Vec2D(3, 4)',
      'b = Vec2D(1, 2)',
      'print(isinstance(a, tuple), abs(a))',
      'print(tuple(a + b), tuple(a - b))',
      'print(a * b, tuple(a * 2), tuple(2 * a))',
      'print(tuple(-a))',
      'print(tuple(round(v, 6) for v in Vec2D(1, 0).rotate(90)))',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    const lines = run.stdout.split('\n');
    assert.equal(lines[0], 'True 5.0');
    assert.equal(lines[1], '(4.0, 6.0) (2.0, 2.0)');
    // Dot product, then two scalings.
    assert.equal(lines[2], '11.0 (6.0, 8.0) (6.0, 8.0)');
    assert.equal(lines[3], '(-3.0, -4.0)');
    assert.equal(lines[4], '(0.0, 1.0)');
  });

  test('radians() and degrees() change the unit headings are read in', () => {
    const run = runShim([
      'import turtle',
      't = turtle.Turtle()',
      'turtle.setheading(90)',
      'print("deg", round(turtle.heading(), 6))',
      'turtle.radians()',
      // The same physical heading, now reported in radians.
      'print("rad", round(turtle.heading(), 6))',
      'turtle.setheading(3.141592653589793)',
      'turtle.degrees()',
      'print("back", round(turtle.heading(), 6))',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    const out = run.stdout.split('\n');
    assert.equal(out[0], 'deg 90.0');
    assert.equal(out[1], 'rad 1.570796');
    // pi radians set, read back as 180 degrees.
    assert.equal(out[2], 'back 180.0');
  });

  test('an angle set in radians moves the turtle the same way as degrees', () => {
    // The unit must convert on the way IN as well as out, or the drawing itself is
    // wrong while the reported heading looks right.
    const run = runShim([
      'import turtle',
      'turtle.radians()',
      'turtle.setheading(1.5707963267948966)',   // 90 degrees
      'turtle.forward(10)',
      'print(round(turtle.xcor(), 6), round(turtle.ycor(), 6))',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, '0.0 10.0');
  });

  test('clone() produces an independent turtle at the same place', () => {
    const run = runShim([
      'import turtle',
      't = turtle.Turtle()',
      't.goto(30, 40)',
      't.pencolor("red")',
      'c = t.clone()',
      'print(c.position() == t.position(), c is t)',
      'c.forward(10)',
      'print(t.position() != c.position())',
      'print(len(turtle.turtles()) >= 2)',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.split('\n')[0], 'True False');
    assert.equal(run.stdout.split('\n')[1], 'True');
    assert.equal(run.stdout.split('\n')[2], 'True');
  });

  test('teleport() moves without drawing a line', () => {
    const run = runShim([
      'import turtle',
      't = turtle.Turtle()',
      't.forward(10)',
      't.teleport(100, 100)',
      't.forward(10)',
      'print("done")',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    const lines = (run.data?.shapes || []).filter(shape => shape.k === 'l');
    // Two drawn segments, and no line bridging the teleport.
    assert.equal(lines.length, 2, JSON.stringify(lines));
    assert.ok(!lines.some(line => line.x1 === 10 && line.x2 === 100), 'the teleport drew a line');
    // The pen was down before and must still be down after.
    assert.equal(lines[1].x1, 100);
  });

  test('teleport(fill_gap=True) keeps the pen down across the jump', () => {
    const run = runShim([
      'import turtle',
      't = turtle.Turtle()',
      't.forward(10)',
      't.teleport(50, 0, fill_gap=True)',
      'print("ok")',
    ].join('\n'));
    assert.equal(run.status, 0, run.stderr);
    const lines = (run.data?.shapes || []).filter(shape => shape.k === 'l');
    assert.equal(lines.length, 2, 'the gap was not filled');
  });

  test('begin_poly/end_poly/get_poly record the path', () => {
    const run = runShim([
      'import turtle',
      't = turtle.Turtle()',
      't.begin_poly()',
      't.forward(10)',
      't.left(90)',
      't.forward(10)',
      't.end_poly()',
      'poly = t.get_poly()',
      'print(len(poly) >= 1, tuple(poly[0]))',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^True \(0\.0, 0\.0\)$/);
  });

  test('get_shapepoly answers for a built-in and a registered shape', () => {
    const run = runShim([
      'import turtle',
      's = turtle.Screen()',
      't = turtle.Turtle()',
      't.shape("square")',
      'print(len(t.get_shapepoly()) > 0)',
      's.register_shape("tri", ((0,0),(10,0),(5,10)))',
      't.shape("tri")',
      'print(len(t.get_shapepoly()) == 3)',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'True\nTrue');
  });

  test('shearfactor and shapetransform round-trip', () => {
    const run = runShim([
      'import turtle',
      't = turtle.Turtle()',
      'print(t.shearfactor())',
      't.shearfactor(0.5)',
      'print(t.shearfactor())',
      't.shapetransform(2, 0, 0, 2)',
      'print(t.shapetransform())',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    const out = run.stdout.split('\n');
    assert.equal(out[0], '0.0');
    assert.equal(out[1], '0.5');
    assert.equal(out[2], '(2.0, 0.0, 0.0, 2.0)');
  });

  test('the undo buffer reports a size', () => {
    const run = runShim([
      'import turtle',
      't = turtle.Turtle()',
      't.setundobuffer(0)',
      'print(t.undobufferentries())',
      't.setundobuffer(None)',
      'print(isinstance(t.undobufferentries(), int))',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, '0\nTrue');
  });

  test('getpen returns the same object every time', () => {
    // Two objects sharing one state would make `getpen() is getpen()` false and
    // break identity comparisons.
    const run = runShim([
      'import turtle',
      'print(turtle.getpen() is turtle.getpen(), turtle.getturtle() is turtle.getpen())',
      'turtle.forward(5)',
      'print(round(turtle.getpen().xcor(), 6))',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'True True\n5.0');
  });

  test('Shape objects can be registered', () => {
    const run = runShim([
      'import turtle',
      's = turtle.Screen()',
      'shape = turtle.Shape("polygon", ((0,0),(20,0),(10,20)))',
      's.register_shape("custom", shape)',
      'print("custom" in s.getshapes())',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'True');
  });

  test('setworldcoordinates is accepted and recorded', () => {
    const run = runShim([
      'import turtle',
      's = turtle.Screen()',
      's.setworldcoordinates(-100, -100, 100, 100)',
      't = turtle.Turtle()',
      't.forward(10)',
      'print("ok")',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'ok');
  });

  test('Terminator is a real exception class', () => {
    const run = runShim([
      'import turtle',
      'try:',
      '    raise turtle.Terminator()',
      'except turtle.Terminator:',
      '    print("caught")',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'caught');
  });

  test('ondrag and onrelease accept a handler without failing', () => {
    const run = runShim([
      'import turtle',
      't = turtle.Turtle()',
      'def moved(x, y): pass',
      't.ondrag(moved)',
      't.onrelease(moved)',
      'turtle.ondrag(moved)',
      'turtle.onrelease(moved)',
      'print("ok")',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'ok');
  });

  test('the names that cannot work say so, instead of failing obscurely', () => {
    // A tkinter canvas does not exist here. An honest NotImplementedError naming the
    // reason beats an AttributeError, and beats a stub that silently does nothing.
    const run = runShim([
      'import turtle',
      'for name in ("getcanvas", "write_docstringdict"):',
      '    try:',
      '        getattr(turtle, name)()',
      '        print(name, "NO ERROR")',
      '    except NotImplementedError as error:',
      '        print(name, "explained" if "Browser Coder" in str(error) else "unclear")',
      'try:',
      '    turtle.ScrolledCanvas()',
      '    print("ScrolledCanvas NO ERROR")',
      'except NotImplementedError:',
      '    print("ScrolledCanvas explained")',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      run.stdout,
      'getcanvas explained\nwrite_docstringdict explained\nScrolledCanvas explained',
    );
  });

  test('the class aliases resolve for isinstance', () => {
    const run = runShim([
      'import turtle',
      't = turtle.Turtle()',
      'print(isinstance(t, turtle.RawTurtle), isinstance(t, turtle.Pen), isinstance(t, turtle.RawPen))',
      's = turtle.Screen()',
      'print(isinstance(s, turtle.TurtleScreen))',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'True True True\nTrue');
  });
});

describe('a broad program still draws', { skip: skipAny }, () => {
  test('exercising much of the API produces a valid payload', () => {
    const run = runShim([
      'import turtle',
      's = turtle.Screen()',
      's.setup(400, 400)',
      's.bgcolor("white")',
      's.title("everything")',
      's.tracer(0)',
      't = turtle.Turtle()',
      't.speed(0)',
      't.shape("turtle")',
      't.shapesize(2, 2, 1)',
      't.pensize(3)',
      't.color("blue", "cyan")',
      't.begin_fill()',
      'for _ in range(4):',
      '    t.forward(50)',
      '    t.left(90)',
      't.end_fill()',
      't.penup(); t.teleport(-100, -100); t.pendown()',
      't.begin_poly(); t.circle(20, 180); t.end_poly()',
      't.dot(8, "red")',
      't.stamp()',
      't.write("done", align="center", font=("Arial", 10, "bold"))',
      't.tilt(15)',
      't.shearfactor(0.2)',
      'clone = t.clone()',
      'clone.forward(5)',
      's.update()',
      'print("turtles", len(turtle.turtles()))',
    ].join('\n'));

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /turtles \d+/);
    assert.ok(run.data, 'no drawing payload was written');
    assert.ok(run.data.shapes.length > 5, `only ${run.data.shapes.length} shapes`);
    assert.ok(run.data.cursors.length >= 2, 'the clone produced no cursor');
    assert.equal(run.data.w, 400);
  });
});
