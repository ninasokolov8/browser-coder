/**
 * POST /api/check - the compiler, asked without running anything.
 *
 * The property that matters most is AGREEMENT: a check must call a program broken
 * exactly when running it would have. Being told a file is fine and then watching it
 * fail to run is worse than having no check at all, so these compare the two answers
 * rather than only asserting the check's own shape.
 *
 * That is also why `pipeline.check()` IS the run pipeline's `prepare()` step rather
 * than a second, cheaper validator per language - there is no second implementation
 * that could drift.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from './support/server.mjs';
import { requires } from './support/toolchain.mjs';

let server;

before(async () => {
  server = await startServer();
});

after(async () => {
  await server?.stop();
});

describe('the request surface', () => {
  it('rejects a missing language, like every other route', async () => {
    const { status } = await server.postJson('/api/check', { code: 'x' });
    assert.equal(status, 400);
  });

  it('rejects an unsupported language', async () => {
    const { status } = await server.postJson('/api/check', { language: 'ruby', code: 'x' });
    assert.equal(status, 400);
  });
});

describe('nothing is ever executed', requires('python'), () => {
  it('a program that would sleep for 30s returns at once', async () => {
    const started = Date.now();
    const { status, body } = await server.postJson('/api/check', {
      language: 'python',
      code: 'import time\nprint("SHOULD NOT RUN")\ntime.sleep(30)\n',
    });

    assert.equal(status, 200);
    assert.equal(body.ok, true, 'the file is valid Python');
    assert.equal(body.output, '', 'nothing to report');
    assert.ok(Date.now() - started < 20000, 'and it did not sleep');
  });

  it('returns every undefined-name occurrence, including repeated names', async () => {
    const { status, body } = await server.postJson('/api/check', {
      language: 'python',
      code: 't\ng\ng\n',
    });

    assert.equal(status, 200);
    assert.equal(body.ok, false);
    assert.equal(
      (body.output.match(/NameError:/g) || []).length,
      3,
      body.output,
    );
    assert.match(body.output, /line 1/);
    assert.match(body.output, /line 2/);
    assert.match(body.output, /line 3/);
  });

  it('keeps syntax and name diagnostics together after parser recovery', async () => {
    const { status, body } = await server.postJson('/api/check', {
      language: 'python',
      code: [
        't',
        'g',
        'terry.forward(18g0)',
        'time.sleep(0.7-)',
        'g',
      ].join('\n'),
    });

    assert.equal(status, 200);
    assert.equal(body.ok, false);
    assert.equal((body.output.match(/SyntaxError:/g) || []).length, 2, body.output);
    assert.equal((body.output.match(/NameError:/g) || []).length, 3, body.output);
    for (const line of [1, 2, 3, 4, 5]) {
      assert.match(body.output, new RegExp(`line ${line}(?:\\D|$)`), body.output);
    }
  });

  it('recovers past malformed blocks and expressions without cascade errors', async () => {
    const block = await server.postJson('/api/check', {
      language: 'python',
      code: [
        'if ready',
        '    inside_missing',
        'outside_missing',
      ].join('\n'),
    });
    assert.equal(block.status, 200);
    assert.equal((block.body.output.match(/SyntaxError:/g) || []).length, 1, block.body.output);
    assert.match(block.body.output, /name 'inside_missing' is not defined/);
    assert.match(block.body.output, /name 'outside_missing' is not defined/);

    const expression = await server.postJson('/api/check', {
      language: 'python',
      code: [
        'value = (',
        '    1 +',
        ')',
        'later_missing',
      ].join('\n'),
    });
    assert.equal(expression.status, 200);
    assert.match(expression.body.output, /SyntaxError:/);
    assert.match(expression.body.output, /name 'later_missing' is not defined/);

    const binding = await server.postJson('/api/check', {
      language: 'python',
      code: [
        'answer =',
        'print(answer)',
        'independent_missing',
      ].join('\n'),
    });
    assert.equal(binding.status, 200);
    assert.doesNotMatch(binding.body.output, /name 'answer' is not defined/);
    assert.match(binding.body.output, /name 'independent_missing' is not defined/);

    const receiver = await server.postJson('/api/check', {
      language: 'python',
      code: [
        'terry.forward(18g0)',
        'terry.forward(10)',
      ].join('\n'),
    });
    assert.equal(receiver.status, 200);
    assert.match(receiver.body.output, /SyntaxError:/);
    assert.match(receiver.body.output, /line 2/);
    assert.match(receiver.body.output, /name 'terry' is not defined/);
  });
});

/*
 * One block per language, each gated on its own toolchain so an absent one skips
 * honestly instead of passing for the wrong reason - which is exactly what happened
 * while this file was being written: `requires()` returns an options OBJECT, and
 * `if (!requires('python'))` is never true, so the Python cases ran against a missing
 * interpreter and reported the code clean because the preflight could not start.
 */
const CASES = [
  {
    language: 'python',
    broken: 'def f(:\n    pass\n',
    valid: 'def f():\n    return 1\n',
  },
  {
    language: 'php',
    broken: '<?php\n$x = ;\n',
    valid: '<?php\n$x = 1;\necho $x;\n',
  },
  {
    language: 'java',
    broken: 'public class Main { public static void main(String[] a) { int x = "no"; } }\n',
    valid: 'public class Main { public static void main(String[] a) { System.out.println(1); } }\n',
  },
  {
    language: 'csharp',
    broken: 'class Program { static void Main() { int x = "no"; } }\n',
    valid: 'class Program { static void Main() { System.Console.WriteLine(1); } }\n',
  },
  {
    language: 'typescript',
    broken: 'const x: number = "not a number";\n',
    valid: 'const x: number = 1;\nconsole.log(x);\n',
  },
  {
    language: 'javascript',
    broken: 'function f( {\n',
    valid: 'function f() { return 1; }\nconsole.log(f());\n',
  },
];

for (const testCase of CASES) {
  describe(`${testCase.language}`, requires(testCase.language), () => {
    it('reports broken code, and a real run agrees it is broken', async () => {
      const check = await server.postJson('/api/check', {
        language: testCase.language,
        code: testCase.broken,
      });
      assert.equal(check.status, 200);
      assert.equal(check.body.ok, false, 'the check must catch it');

      const run = await server.postJson('/api/run', {
        language: testCase.language,
        code: testCase.broken,
      });
      assert.notEqual(run.body.exitCode, 0, 'and running it must fail too');
    });

    it('reports valid code as clean', async () => {
      const { status, body } = await server.postJson('/api/check', {
        language: testCase.language,
        code: testCase.valid,
      });
      assert.equal(status, 200);
      assert.equal(body.ok, true, `expected clean, got: ${body.output}`);
      assert.equal(body.output, '');
    });

    it('the message is compiler text the client can parse', async () => {
      const { body } = await server.postJson('/api/check', {
        language: testCase.language,
        code: testCase.broken,
      });
      // The client runs `parseCompilerOutput` over this - the same parser it uses for
      // a failed run - so it has to be the tool's own output, not a summary.
      assert.ok(body.output.length > 0, 'there is text to parse');
      assert.match(body.output, /\d+/, 'carrying a line number');
    });
  });
}

describe('a project is checked from the file being edited', requires('python'), () => {
  /*
   * The client sends the whole project and names the ACTIVE file as the entry point.
   *
   * That is what makes this work for Python, whose preflight checks the entry file:
   * whichever file the student is looking at is the one that gets checked. The
   * compiled languages see every file regardless, so one rule serves all of them.
   */
  const HELPER_IS_BROKEN = [
    { name: 'main.py', content: 'from helper import twice\nprint(twice(2))\n', isMain: true },
    { name: 'helper.py', content: 'def twice(n)\n    return n * 2\n', isMain: false },
  ];

  it('an error in the file being edited is found', async () => {
    const { status, body } = await server.postJson('/api/check', {
      language: 'python',
      entryPoint: 'helper.py',
      files: HELPER_IS_BROKEN,
    });

    assert.equal(status, 200);
    assert.equal(body.ok, false, `expected helper.py's syntax error, got: ${JSON.stringify(body)}`);
    assert.match(body.output, /helper\.py/, 'and it is attributed to that file');
  });

  it('a project whose files are all valid is clean', async () => {
    const { body } = await server.postJson('/api/check', {
      language: 'python',
      entryPoint: 'helper.py',
      files: [
        { name: 'main.py', content: 'from helper import twice\nprint(twice(2))\n', isMain: true },
        { name: 'helper.py', content: 'def twice(n):\n    return n * 2\n', isMain: false },
      ],
    });
    assert.equal(body.ok, true, `expected clean, got: ${body.output}`);
  });
});
