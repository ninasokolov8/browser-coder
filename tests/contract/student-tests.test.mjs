/**
 * "Check my work", end to end, against real interpreters.
 *
 * The parser and the harness-discovery rule are unit-tested. What this proves is the
 * part neither can: that a hidden harness naming the student's own file as an import
 * actually RUNS - which depends on the entry-point override reaching the server, the
 * whole project travelling with the run, and each language resolving a local import
 * from the job directory.
 *
 * The last of those is not hypothetical. A multi-file Python project could not import
 * its own modules under the debugger until that was found and fixed; the same class of
 * bug here would make every task's checks fail with ModuleNotFoundError while the
 * student's code was perfectly correct.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from './support/server.mjs';
import { requires } from './support/toolchain.mjs';
/*
 * The BCTEST lines are matched here rather than by importing the real parser.
 *
 * Not laziness: the production image ships `dist/`, not `src/`, so a contract test
 * running inside it cannot import a client module at all. It is also the right
 * boundary - this file exists to prove the harness RUNS and prints the protocol, and
 * how that text is then parsed is `tests/unit/test-protocol.test.ts`.
 */
function casesIn(stdout) {
  const cases = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const match = /^\s*BCTEST case (.+?) (pass|fail|skip)\b ?(.*)$/.exec(line);
    if (match) cases.push({ name: match[1], status: match[2], detail: match[3] });
  }
  return cases;
}

const hasLine = (stdout, text) =>
  String(stdout).split(/\r?\n/).some(line => line.trim() === text);

/**
 * One task per language: the student's file, and a hidden harness that imports it.
 *
 * `entryPoint` is the harness, which is exactly what the "Check my work" command sends.
 */
const TASKS = {
  python: {
    version: 'python3',
    entryPoint: 'X_HIDDEN_tests.py',
    files: [
      { name: 'main.py', path: 'main.py', content: 'def add(a, b):\n    return a + b\n' },
      {
        name: 'X_HIDDEN_tests.py',
        path: 'X_HIDDEN_tests.py',
        isMain: true,
        content: [
          'from main import add',
          'print("BCTEST plan 2")',
          'print("BCTEST case adds two numbers", "pass" if add(2, 3) == 5 else "fail")',
          'print("BCTEST case adds zero fail expected 0 but got", add(0, 1))',
          'print("BCTEST done")',
        ].join('\n'),
      },
    ],
  },

  javascript: {
    version: 'es2022',
    entryPoint: 'X_HIDDEN_tests.mjs',
    files: [
      { name: 'main.mjs', path: 'main.mjs', content: 'export const add = (a, b) => a + b;\n' },
      {
        name: 'X_HIDDEN_tests.mjs',
        path: 'X_HIDDEN_tests.mjs',
        isMain: true,
        content: [
          "import { add } from './main.mjs';",
          "console.log('BCTEST plan 2');",
          "console.log('BCTEST case adds two numbers', add(2, 3) === 5 ? 'pass' : 'fail');",
          "console.log('BCTEST case adds zero fail expected 0 but got', add(0, 1));",
          "console.log('BCTEST done');",
        ].join('\n'),
      },
    ],
  },

  php: {
    version: 'php8',
    entryPoint: 'X_HIDDEN_tests.php',
    files: [
      { name: 'main.php', path: 'main.php', content: '<?php\nfunction add($a, $b) { return $a + $b; }\n' },
      {
        name: 'X_HIDDEN_tests.php',
        path: 'X_HIDDEN_tests.php',
        isMain: true,
        content: [
          '<?php',
          "require_once __DIR__ . '/main.php';",
          'echo "BCTEST plan 2\\n";',
          'echo "BCTEST case adds two numbers " . (add(2, 3) === 5 ? "pass" : "fail") . "\\n";',
          'echo "BCTEST case adds zero fail expected 0 but got " . add(0, 1) . "\\n";',
          'echo "BCTEST done\\n";',
        ].join('\n'),
      },
    ],
  },

  java: {
    version: 'java17',
    entryPoint: 'X_HIDDEN_Tests.java',
    files: [
      {
        name: 'Main.java',
        path: 'Main.java',
        content: 'public class Main {\n  static int add(int a, int b) { return a + b; }\n}\n',
      },
      {
        name: 'X_HIDDEN_Tests.java',
        path: 'X_HIDDEN_Tests.java',
        isMain: true,
        content: [
          'public class X_HIDDEN_Tests {',
          '  public static void main(String[] args) {',
          '    System.out.println("BCTEST plan 2");',
          '    System.out.println("BCTEST case adds two numbers " + (Main.add(2, 3) == 5 ? "pass" : "fail"));',
          '    System.out.println("BCTEST case adds zero fail expected 0 but got " + Main.add(0, 1));',
          '    System.out.println("BCTEST done");',
          '  }',
          '}',
        ].join('\n'),
      },
    ],
  },

  csharp: {
    version: 'csharp12',
    entryPoint: 'X_HIDDEN_Tests.cs',
    files: [
      {
        name: 'Program.cs',
        path: 'Program.cs',
        content: 'class Program {\n  public static int Add(int a, int b) { return a + b; }\n}\n',
      },
      {
        name: 'X_HIDDEN_Tests.cs',
        path: 'X_HIDDEN_Tests.cs',
        isMain: true,
        content: [
          'class X_HIDDEN_Tests {',
          '  static void Main() {',
          '    System.Console.WriteLine("BCTEST plan 2");',
          '    System.Console.WriteLine("BCTEST case adds two numbers " + (Program.Add(2, 3) == 5 ? "pass" : "fail"));',
          '    System.Console.WriteLine("BCTEST case adds zero fail expected 0 but got " + Program.Add(0, 1));',
          '    System.Console.WriteLine("BCTEST done");',
          '  }',
          '}',
        ].join('\n'),
      },
    ],
  },
};

describe('a marking harness runs and reports per case', () => {
  let server;
  let base;

  before(async () => {
    server = await startServer();
    base = server.baseUrl;
  });

  after(async () => {
    await server?.stop();
  });

  for (const [language, task] of Object.entries(TASKS)) {
    test(`${language}: the hidden harness imports the student's file and marks it`, requires(language), async () => {
      const response = await fetch(`${base}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language,
          version: task.version,
          files: task.files,
          entryPoint: task.entryPoint,
        }),
      });

      assert.equal(response.ok, true, `run failed: ${response.status}`);
      const body = await response.json();

      // The harness importing the student's file is the thing most likely to break -
      // and it fails as a runtime error, not as a failed check.
      assert.equal(
        body.exitCode,
        0,
        `the harness did not run cleanly:\n${body.stderr}\n${body.stdout}`,
      );

      const cases = casesIn(body.stdout);
      assert.ok(cases.length > 0, `no BCTEST lines in:\n${body.stdout}`);
      assert.ok(hasLine(body.stdout, 'BCTEST plan 2'), 'no plan line');
      assert.ok(hasLine(body.stdout, 'BCTEST done'), 'the harness did not reach BCTEST done');

      assert.deepEqual(
        cases.map(entry => `${entry.name}:${entry.status}`),
        ['adds two numbers:pass', 'adds zero:fail'],
      );

      // The detail is the useful half of a failure: it says what to do next.
      assert.match(cases[1].detail, /expected 0 but got 1/);
    });
  }
});

describe('the harness is hidden from the student', () => {
  let server;
  let base;

  before(async () => {
    server = await startServer();
    base = server.baseUrl;
  });

  after(async () => {
    await server?.stop();
  });

  test('a hidden file still reaches the sandbox, or nothing could mark anything', requires('python'), async () => {
    /*
     * The contract `workspace-visibility.ts` states: hidden entries "remain fully
     * present in storage and execution payloads. They are only excluded from
     * student-facing navigation surfaces."
     *
     * Worth a test of its own, because the obvious way to "fix" a leak of teacher
     * solutions is to strip X_HIDDEN_ files from the run payload - and that would
     * silently disable every marking harness in the platform.
     */
    const response = await fetch(`${base}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'python',
        version: 'python3',
        entryPoint: 'X_HIDDEN_tests.py',
        files: [
          {
            name: 'X_HIDDEN_tests.py',
            path: 'X_HIDDEN_tests.py',
            isMain: true,
            content: 'print("BCTEST case hidden files run pass")\nprint("BCTEST done")',
          },
        ],
      }),
    });

    const body = await response.json();
    assert.deepEqual(
      casesIn(body.stdout).map(entry => entry.status),
      ['pass'],
      `hidden harness did not run:\n${body.stderr}`,
    );
  });
});
