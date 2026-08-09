/**
 * The PHP debug adapter's protocol, against real Xdebug.
 *
 * Drives `languages/php/debug_adapter.mjs` directly - no server, no browser - for the
 * same reason the other adapter contract tests do.
 *
 * This one skips more often than the others, and the reason is worth stating: Xdebug
 * is a compiled PHP extension, not a binary on a PATH, so "PHP is installed" is not
 * enough. The probe below therefore checks that the extension actually loads, rather
 * than checking that `php` exists and hoping. The runtime image installs
 * `php-pecl-xdebug` and this suite runs there.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ADAPTER = resolve(import.meta.dirname, '../../languages/php/debug_adapter.mjs');

/** A PHP that can load Xdebug, or null. */
function findPhp() {
  for (const candidate of [process.env.PHP_BIN, 'php', 'php8', 'php84', 'php83']) {
    if (!candidate) continue;
    const probe = spawnSync(
      candidate,
      ['-dzend_extension=xdebug', '-r', 'echo extension_loaded("xdebug") ? "ok" : "no";'],
      { encoding: 'utf8' },
    );
    if (probe.status === 0 && /ok/.test(probe.stdout)) return candidate;
  }
  return null;
}

const PHP = findPhp();
const skip = PHP ? false : 'no php with xdebug on this host';

/**
 * The interpreter hardening a real run applies.
 *
 * Passed here too, deliberately. A debug run must not be looser than an ordinary one,
 * and `disable_functions` in particular includes `eval` - so this suite is also the
 * check that DBGp's `eval` command still works, which it does because it is
 * implemented by the engine rather than by PHP's `eval()` construct.
 */
function hardeningArgs(dir) {
  return [
    '-d', `open_basedir=${dir}`,
    '-d', 'memory_limit=64M',
    '-d', 'disable_functions=exec,passthru,shell_exec,system,proc_open,popen,eval,assert,fopen,file_get_contents',
    '-d', 'allow_url_fopen=Off',
  ];
}

/** One debug session: writes the program, spawns the adapter, speaks the protocol. */
class DebugSession {
  #server;
  #socket = null;
  #child = null;
  #buffer = '';
  #events = [];
  #waiters = [];

  stdout = '';
  stderr = '';
  exited = null;

  constructor(dir, sources, entry) {
    this.dir = dir;
    this.programPath = join(dir, entry);

    for (const [name, source] of Object.entries(sources)) {
      const full = join(dir, name);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, source, 'utf8');
    }
  }

  async start() {
    this.#server = net.createServer(connection => {
      this.#socket = connection;
      connection.on('data', chunk => this.#onData(chunk));
      // Killing the child resets the connection; on Windows Node reports that as an
      // unhandled 'error' and fails the file even though every assertion passed.
      connection.on('error', () => {});
    });
    this.#server.on('error', () => {});
    await new Promise(resolveListen => this.#server.listen(0, '127.0.0.1', resolveListen));

    this.#child = spawn(process.execPath, ['--no-warnings', ADAPTER], {
      cwd: this.dir,
      env: {
        ...process.env,
        BROWSER_CODER_DEBUG_PORT: String(this.#server.address().port),
        BROWSER_CODER_DEBUG_TOKEN: 'contract-token',
        BROWSER_CODER_WORKSPACE: this.dir,
        BROWSER_CODER_DEBUG_PROGRAM: this.programPath,
        BROWSER_CODER_PHP_BIN: PHP,
        BROWSER_CODER_PHP_ARGS: JSON.stringify(hardeningArgs(this.dir)),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.#child.stdout.on('data', data => { this.stdout += data.toString('utf8'); });
    this.#child.stderr.on('data', data => { this.stderr += data.toString('utf8'); });
    this.#child.on('exit', code => { this.exited = code; });
  }

  #onData(chunk) {
    this.#buffer += chunk.toString('utf8');
    let index;
    while ((index = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === 'output') {
        const stream = event.stream === 'stderr' ? 'stderr' : 'stdout';
        this[stream] += String(event.data ?? '');
      }
      this.#events.push(event);
      const waiterIndex = this.#waiters.findIndex(waiter => waiter.type === event.type);
      if (waiterIndex !== -1) {
        const [waiter] = this.#waiters.splice(waiterIndex, 1);
        event.__taken = true;
        waiter.resolve(event);
      }
    }
  }

  send(payload) {
    this.#socket?.write(`${JSON.stringify(payload)}\n`);
  }

  waitFor(type, timeoutMs = 30000) {
    const existing = this.#events.find(event => event.type === type && !event.__taken);
    if (existing) {
      existing.__taken = true;
      return Promise.resolve(existing);
    }
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for "${type}"; saw: ${this.#events.map(e => e.type).join(', ')}\nstderr: ${this.stderr}`)),
        timeoutMs,
      );
      this.#waiters.push({
        type,
        resolve: event => { clearTimeout(timer); resolvePromise(event); },
      });
    });
  }

  /** Wait for adapter teardown and any final shutdown work. */
  waitForExit(timeoutMs = 20000) {
    if (this.exited !== null) return Promise.resolve(this.exited);
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('the debugged process did not exit')), timeoutMs);
      this.#child.on('exit', code => {
        clearTimeout(timer);
        setImmediate(() => resolvePromise(code));
      });
    });
  }

  dispose() {
    try { this.#child?.kill(); } catch { /* already gone */ }
    try { this.#server?.close(); } catch { /* already closed */ }
    try { rmSync(this.dir, { recursive: true, force: true }); } catch { /* fine */ }
  }
}

function session(sources, entry = 'main.php') {
  return new DebugSession(mkdtempSync(join(tmpdir(), 'bc-phpdbg-')), sources, entry);
}

const MAIN = [
  '<?php',                                            // 1
  "require_once __DIR__ . '/lib/helper.php';",        // 2
  '',                                                 // 3
  '$name = "world";',                                 // 4
  '$total = twice(3);',                               // 5
  '$list = [1, 2, 3];',                               // 6
  '$person = new Person("Ada", 36);',                 // 7
  'echo $name . $total . "\\n";',                     // 8
  'echo "done\\n";',                                  // 9
].join('\n');

const HELPER = [
  '<?php',                                            // 1
  'class Person {',                                   // 2
  '  public $name;',                                  // 3
  '  public $age;',                                   // 4
  '  function __construct($name, $age) {',            // 5
  '    $this->name = $name;',                         // 6
  '    $this->age = $age;',                           // 7
  '  }',                                              // 8
  '}',                                                // 9
  '',                                                 // 10
  'function twice($n) {',                             // 11
  '  $doubled = $n * 2;',                             // 12
  '  return $doubled;',                               // 13
  '}',                                                // 14
].join('\n');

describe('breakpoints, stepping and variables', { skip }, () => {
  let debug;

  before(async () => {
    debug = session({ 'main.php': MAIN, 'lib/helper.php': HELPER });
    await debug.start();
  });

  after(() => debug?.dispose());

  test('the adapter connects and identifies its session', async () => {
    const hello = await debug.waitFor('hello');
    assert.equal(hello.token, 'contract-token');
    assert.equal(hello.language, 'php');
  });

  test('breakpoints sent the instant it says hello arm in two files at once', async () => {
    /*
     * Sent with no wait after `hello`, deliberately - that is the race.
     *
     * `hello` is what makes the server report `debug:attached`, and a client reacts
     * to that at once. But `hello` goes out when the socket to the IDE opens, which
     * is before Xdebug has dialled back, so a command arriving in that window has no
     * engine to reach. It used to be dropped: nothing armed, and the program ran
     * straight past the student's breakpoint five seconds later when the fallback
     * timer gave up. Commands are queued until the engine exists.
     */
    debug.send({
      command: 'setBreakpoints',
      lines: [],
      files: { 'main.php': [8], 'lib/helper.php': [12] },
    });
    const armed = await debug.waitFor('breakpoints');
    assert.deepEqual(armed.files['main.php'], [8]);
    assert.deepEqual(armed.files['lib/helper.php'], [12]);
  });

  /** The stop inside `twice`, captured once and asserted on by two tests. */
  let inHelper = null;

  test('the deeper file stops first, and the stack names the caller', async () => {
    inHelper = await debug.waitFor('stopped');
    assert.equal(inHelper.reason, 'breakpoint');
    assert.equal(inHelper.file, 'lib/helper.php');
    assert.equal(inHelper.line, 12);
    assert.deepEqual(
      inHelper.stack.map(frame => `${frame.name}@${frame.file}:${frame.line}`),
      ['twice@lib/helper.php:12', '(main)@main.php:5'],
    );
    // `{main}` is Xdebug's name for top-level code; a student never wrote it.
    assert.doesNotMatch(JSON.stringify(inHelper.stack), /\{main\}/);
  });

  test('locals include the parameter, and one not yet assigned says so', async () => {
    const locals = Object.fromEntries(inHelper.locals.map(local => [local.name, local.value]));
    assert.equal(locals.$n.text, '3');
    assert.equal(locals.$n.type, 'int');
    // The stop is BEFORE line 12 runs, so $doubled genuinely has no value yet.
    // "uninitialized" is PHP's own distinction and is worth keeping: an empty cell
    // would read as "this variable holds nothing", which is a different claim.
    assert.equal(locals.$doubled.text, 'uninitialized');
  });

  test('a watch expression is evaluated by the engine, with disable_functions in force', async () => {
    debug.send({ command: 'evaluate', expression: '$n * 100' });
    const evaluated = await debug.waitFor('evaluated');
    assert.equal(evaluated.value.text, '300');
    assert.equal(evaluated.value.type, 'int');
  });

  test('continuing reaches the breakpoint in the entry file', async () => {
    debug.send({ command: 'continue' });
    const stopped = await debug.waitFor('stopped');
    assert.equal(stopped.file, 'main.php');
    assert.equal(stopped.line, 8);

    const locals = Object.fromEntries(stopped.locals.map(local => [local.name, local.value]));
    // PHP variables carry their sigil, and the panel shows what the student typed.
    assert.equal(locals.$name.text, '"world"');
    assert.equal(locals.$name.type, 'string');
    assert.equal(locals.$total.text, '6');
    assert.equal(locals.$list.text, 'array(3 items)');
    assert.equal(locals.$person.type, 'object');
    assert.match(locals.$person.text, /^Person\(/);
  });

  test('a watch expression can call a function and index an array', async () => {
    debug.send({ command: 'evaluate', expression: 'count($list)' });
    assert.equal((await debug.waitFor('evaluated')).value.text, '3');

    debug.send({ command: 'evaluate', expression: 'strtoupper($name)' });
    assert.equal((await debug.waitFor('evaluated')).value.text, '"WORLD"');

    debug.send({ command: 'evaluate', expression: '$person->name' });
    assert.equal((await debug.waitFor('evaluated')).value.text, '"Ada"');
  });

  test('a syntactically broken expression is reported, not silently dropped', async () => {
    debug.send({ command: 'evaluate', expression: '$list[' });
    const evaluated = await debug.waitFor('evaluated');
    assert.equal(evaluated.value, undefined);
    assert.ok(typeof evaluated.error === 'string' && evaluated.error.length > 0);
  });

  test('step over advances one line without entering a call', async () => {
    debug.send({ command: 'next' });
    const stepped = await debug.waitFor('stopped');
    assert.equal(stepped.reason, 'step');
    assert.equal(stepped.file, 'main.php');
    assert.equal(stepped.line, 9);
  });

  test('continuing runs to the end and the process actually exits', async () => {
    /*
     * The bug this pins.
     *
     * Xdebug answers the last `run` with status="stopping", not "stopped": the script
     * has finished but the engine is still holding the process open waiting for a
     * final command. Without sending one, the PHP process never exits, the run hangs
     * until the session timer kills it, and the student sees their output followed by
     * nothing.
     */
    debug.send({ command: 'continue' });
    const terminated = await debug.waitFor('terminated');
    assert.equal(terminated.exitCode, 0);

    await debug.waitForExit();
    assert.match(debug.stdout, /world6/);
    assert.match(debug.stdout, /done/);
    // Xdebug's own diagnostics must never reach the student's console.
    assert.doesNotMatch(debug.stdout, /Xdebug/i);
  });
});

describe('a program with no breakpoints still runs', { skip }, () => {
  let debug;

  before(async () => {
    debug = session({ 'main.php': '<?php\necho "straight through\\n";\n' });
    await debug.start();
    await debug.waitFor('hello');
  });

  after(() => debug?.dispose());

  test('an empty breakpoint set does not leave the program suspended forever', async () => {
    // Xdebug holds the program before its first line whether or not anyone wants a
    // breakpoint, so "no breakpoints" is the case most likely to hang.
    debug.send({ command: 'setBreakpoints', lines: [] });
    await debug.waitFor('breakpoints');
    await debug.waitFor('terminated');
    await debug.waitForExit();
    assert.match(debug.stdout, /straight through/);
  });
});

describe('a path outside the workspace', { skip }, () => {
  let debug;

  before(async () => {
    debug = session({ 'main.php': '<?php\necho "safe\\n";\n' });
    await debug.start();
    await debug.waitFor('hello');
  });

  after(() => debug?.dispose());

  test('a traversal is refused rather than armed', async () => {
    /*
     * Defence in depth, and this test proves the depth rather than the adapter.
     *
     * Two independent things refuse this: the adapter's own workspace check, and
     * PHP's `open_basedir`, which is set to the same directory. Deleting the adapter
     * check leaves this test passing - measured, not assumed - so the check itself is
     * pinned by `tests/unit/dbgp.test.mjs`, where nothing else can stand in for it.
     * What this asserts is the end-to-end outcome: nothing outside the workspace is
     * ever reported as armed.
     */
    debug.send({
      command: 'setBreakpoints',
      lines: [],
      files: { '../../etc/passwd': [1], 'main.php': [2] },
    });
    const armed = await debug.waitFor('breakpoints');
    assert.deepEqual(Object.keys(armed.files), ['main.php']);
  });
});
