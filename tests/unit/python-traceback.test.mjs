/**
 * Which traceback frames a student is shown.
 *
 * The rule: a frame the student can open, they see; a frame in a file we injected, they
 * do not. Getting it wrong in either direction is bad in a different way - keeping our
 * frames buries their error under plumbing, and dropping too much removes the line that
 * tells them what went wrong.
 *
 * The function this tests replaced an arithmetic one. The turtle shim used to be
 * prepended to the entry file, so every frame had to be shifted back by the shim's
 * length; the shim now has its own file, so the question is only whose frame it is.
 * That change is why these tests exist at all - the old version had none, and a
 * miscounted offset would have been invisible.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { dropInjectedFrames } from '../../server/languages/adapters/python.mjs';

const GUARD = '/job/abc/.browser-coder-fs-guard.py';
const SHIM = '/job/abc/.browser-coder-turtle-shim.py';

describe('dropInjectedFrames', () => {
  test("the student's own frame is kept, at the line they wrote", () => {
    const traceback = [
      'Traceback (most recent call last):',
      '  File "main.py", line 4, in <module>',
      '    boom()',
      "NameError: name 'boom' is not defined",
    ].join('\n');

    assert.equal(dropInjectedFrames(traceback, [GUARD, SHIM]), traceback);
  });

  test('a frame in the shim goes, and takes its source snippet with it', () => {
    const out = dropInjectedFrames([
      'Traceback (most recent call last):',
      '  File "main.py", line 6, in <module>',
      '    pen.forward(50)',
      `  File "${SHIM}", line 812, in forward`,
      '    _draw(distance)',
      '    ^^^^^^^^^^^^^^^',
      'ValueError: bad distance',
    ].join('\n'), [GUARD, SHIM]);

    assert.match(out, /main\.py", line 6/, "the student's frame survives");
    assert.doesNotMatch(out, /turtle-shim/, 'ours does not');
    assert.doesNotMatch(out, /_draw\(distance\)/, 'nor its snippet');
    assert.doesNotMatch(out, /\^\^\^/, 'nor its caret');
    assert.match(out, /ValueError: bad distance/, 'the error itself is untouched');
  });

  test('the launcher frames go too', () => {
    const out = dropInjectedFrames([
      'Traceback (most recent call last):',
      '  File "<string>", line 4, in <module>',
      '    runpy.run_path("/job/abc/main.py", run_name="__main__")',
      '  File "<frozen runpy>", line 287, in run_path',
      '  File "<frozen runpy>", line 98, in _run_module_code',
      '  File "/job/abc/main.py", line 4, in <module>',
      '    boom()',
      "NameError: name 'boom' is not defined",
    ].join('\n'), [GUARD, SHIM]);

    // What a student should be left with: their line, and the error.
    assert.doesNotMatch(out, /<string>/);
    assert.doesNotMatch(out, /frozen runpy/);
    assert.doesNotMatch(out, /runpy\.run_path/);
    assert.match(out, /main\.py", line 4/);
    assert.match(out, /boom\(\)/);
    assert.match(out, /NameError/);
  });

  test('a frame in one of their OTHER files is kept', () => {
    // A multi-file project: the error is in the helper they wrote, and that is exactly
    // the frame worth showing.
    const out = dropInjectedFrames([
      'Traceback (most recent call last):',
      '  File "/job/abc/main.py", line 2, in <module>',
      '    helper.twice(None)',
      '  File "/job/abc/helper.py", line 5, in twice',
      '    return value * 2',
      'TypeError: unsupported operand type(s)',
    ].join('\n'), [GUARD, SHIM]);

    assert.match(out, /helper\.py", line 5/);
    assert.match(out, /return value \* 2/);
  });

  test('a file merely NAMED like ours is not dropped by accident', () => {
    // endsWith on the basename, so `my-fs-guard.py` must survive - a student can name
    // a file anything, and silently hiding their frame would be worse than showing ours.
    const traceback = [
      '  File "/job/abc/my-fs-guard.py", line 3, in <module>',
      '    x = 1 / 0',
    ].join('\n');

    assert.equal(dropInjectedFrames(traceback, [GUARD]), traceback);
  });

  test('no injected files still filters the launcher, and empty input is safe', () => {
    assert.equal(dropInjectedFrames('', [GUARD]), '');
    assert.equal(dropInjectedFrames(null, [GUARD]), '');
    assert.doesNotMatch(
      dropInjectedFrames('  File "<frozen runpy>", line 1, in run_path\nBoom', []),
      /frozen runpy/,
    );
  });

  test('CRLF parses the same as LF', () => {
    const out = dropInjectedFrames(
      `  File "${SHIM}", line 9, in forward\r\n  File "main.py", line 1, in <module>\r`,
      [SHIM],
    );
    assert.doesNotMatch(out, /turtle-shim/);
    assert.match(out, /main\.py/);
  });
});
