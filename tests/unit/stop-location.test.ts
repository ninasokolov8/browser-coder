/**
 * Whether the debugger highlights the line it is paused on.
 *
 * The failure this pins is not subtle from a student's side: the program stops
 * correctly, the call stack names the right line, and the editor shows nothing. A
 * debugger that will not tell you where it is reads as a debugger that is broken.
 *
 * The cause was a plain string comparison. `runCode` sends only `code` for a snippet,
 * so the job writes it as `main.py` whatever the tab is called, and every stop was
 * reported in a file the workspace had never heard of. That is most runs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { stopIsOnScreen } from '../../src/features/debug/stop-location.ts';

/** A snippet run: one file open, the server calls it something else. */
const snippet = (stopFile: string | null, activeName: string) =>
  stopIsOnScreen({
    stopFile,
    activePath: activeName,
    activeName,
    workspacePaths: [activeName],
  });

describe('the case that was broken', () => {
  test('a snippet reported as main.py highlights in a tab called main_1.py', () => {
    assert.equal(snippet('main.py', 'main_1.py'), true);
  });

  test('and the same for every language that renames the entry file', () => {
    assert.equal(snippet('Main.java', 'Exercise3.java'), true);
    assert.equal(snippet('Program.cs', 'MyProgram.cs'), true);
    assert.equal(snippet('main.mjs', 'sketch.mjs'), true);
    assert.equal(snippet('main.php', 'lesson.php'), true);
  });

  test('other files being OPEN does not stop it - only a matching one would', () => {
    // The workspace can hold a dozen documents from earlier exercises. What matters is
    // whether any of them is a better candidate than the file on screen, not how many
    // there are. Counting them was the first fix and it was the wrong signal.
    assert.equal(
      stopIsOnScreen({
        stopFile: 'main.py',
        activePath: 'debug-probe.py',
        activeName: 'debug-probe.py',
        workspacePaths: ['debug-probe.py', 'live-errors.py', 'notes.txt', 'shapes.py'],
      }),
      true,
    );
  });

  test('a snippet stays on its launch document even when another tab has the runtime alias', () => {
    const base = {
      stopFile: 'main.py',
      workspacePaths: ['main.py', 'main_2.py'],
      executionDocumentId: 'document-main-2',
      singleFileExecution: true,
    } as const;

    assert.equal(
      stopIsOnScreen({
        ...base,
        activeDocumentId: 'document-main-2',
        activePath: 'main_2.py',
        activeName: 'main_2.py',
      }),
      true,
    );
    assert.equal(
      stopIsOnScreen({
        ...base,
        activeDocumentId: 'document-main',
        activePath: 'main.py',
        activeName: 'main.py',
      }),
      false,
    );
  });
});

describe('exact and near matches', () => {
  const project = ['main.py', 'src/helper.py', 'src/shapes.py'];

  test('the same path', () => {
    assert.equal(
      stopIsOnScreen({ stopFile: 'src/helper.py', activePath: 'src/helper.py', activeName: 'helper.py', workspacePaths: project }),
      true,
    );
  });

  test('a path against a name, in either direction', () => {
    assert.equal(
      stopIsOnScreen({ stopFile: 'src/helper.py', activePath: 'helper.py', activeName: 'helper.py', workspacePaths: ['helper.py'] }),
      true,
    );
    assert.equal(
      stopIsOnScreen({ stopFile: 'helper.py', activePath: 'src/helper.py', activeName: 'helper.py', workspacePaths: project }),
      true,
    );
  });

  test('windows separators do not defeat it', () => {
    assert.equal(
      stopIsOnScreen({ stopFile: 'src\\helper.py', activePath: 'src/helper.py', activeName: 'helper.py', workspacePaths: project }),
      true,
    );
  });

  test('an adapter that reports no file is trusted', () => {
    assert.equal(snippet(null, 'main.py'), true);
    assert.equal(snippet('', 'main.py'), true);
  });
});

describe('the guard that keeps the fallback honest', () => {
  test('a stop in ANOTHER of the student\'s files is not drawn here', () => {
    // The dangerous direction: an arrow on a line of a file the program is not in is
    // worse than no arrow, because the student trusts it and reads the wrong code.
    assert.equal(
      stopIsOnScreen({
        stopFile: 'helper.py',
        activePath: 'main.py',
        activeName: 'main.py',
        workspacePaths: ['main.py', 'helper.py'],
      }),
      false,
    );
  });

  test('and that holds when the other file is in a folder', () => {
    assert.equal(
      stopIsOnScreen({
        stopFile: 'src/helper.py',
        activePath: 'main.py',
        activeName: 'main.py',
        workspacePaths: ['main.py', 'src/helper.py'],
      }),
      false,
    );
  });

  test('a workspace file named exactly like the alias wins over the fallback', () => {
    // The student really does have a main.py, and is looking at something else. The
    // stop belongs to main.py, so nothing is drawn here.
    assert.equal(
      stopIsOnScreen({
        stopFile: 'main.py',
        activePath: 'helper.py',
        activeName: 'helper.py',
        workspacePaths: ['main.py', 'helper.py'],
      }),
      false,
    );
  });

  test('two files of the same name in different folders still match, deliberately', () => {
    // The one ambiguity the basename rule accepts, matching what the compiler
    // diagnostics resolver already does. Refusing would lose the arrow for every
    // correctly-reported stop in a subfolder.
    assert.equal(
      stopIsOnScreen({
        stopFile: 'a/helper.py',
        activePath: 'b/helper.py',
        activeName: 'helper.py',
        workspacePaths: ['a/helper.py', 'b/helper.py'],
      }),
      true,
    );
  });
});
