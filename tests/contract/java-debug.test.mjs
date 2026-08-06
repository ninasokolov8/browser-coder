/**
 * The Java debug adapter's protocol, against a real JVM.
 *
 * Drives `languages/java/debug_adapter.mjs` directly - no server, no browser - for the
 * same reason the Python one does: a failure here points at the adapter and the JDWP
 * client under it, not at four layers of plumbing.
 *
 * This one carries more weight than the others, because the protocol underneath it was
 * written from scratch for this project. There is no `jdb`, no JDI, no npm package
 * between these assertions and the JVM's wire format - so every framing, id-width and
 * ordering mistake shows up here or not at all. Six did, while this file was written:
 *
 *  - the handshake bytes were consumed twice, so the first packet's length was read
 *    from the ASCII "JDWP-Handshake" and came out as ~1.2 billion;
 *  - `ClassMatch '*'` round-tripped every class the JDK loads, which took seconds;
 *  - VM_START was auto-resumed before the CLASS_PREPARE request existed, so the
 *    program ran to completion without ever loading a watched class;
 *  - `ThreadReference.Frames` was asked for 50 frames, which is INVALID_LENGTH on
 *    every stack shallower than 50 - i.e. on every student program;
 *  - one source file was assumed to declare one class, so an inner class replaced its
 *    outer class and breakpoints in the outer one silently stopped arming;
 *  - VM_DEATH closed the channel before the JVM's exit code was known, so `terminated`
 *    never reached the IDE and the toolbar stayed live over a dead session.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ADAPTER = resolve(import.meta.dirname, '../../languages/java/debug_adapter.mjs');

/**
 * A JDK that can compile AND run, or null.
 *
 * `javac` and `java` on a developer's PATH are routinely different major versions -
 * this was written on a host with javac 21 and java 8 - and a class file from the
 * newer one will not load in the older one. So the runtime's version decides the
 * `--release` level, and the pair is proven by compiling and running something before
 * any test relies on it. An honest skip beats a green run over an untested adapter.
 */
function findToolchain() {
  const javac = process.env.JAVAC_BIN || 'javac';
  const java = process.env.JAVA_BIN || 'java';

  const version = spawnSync(java, ['-version'], { encoding: 'utf8' });
  if (version.error) return null;
  // `1.8.0_501` means 8; `21.0.1` means 21.
  const match = /version "(?:1\.)?(\d+)/.exec(`${version.stderr}${version.stdout}`);
  if (!match) return null;
  const release = match[1];

  const dir = mkdtempSync(join(tmpdir(), 'bc-javaprobe-'));
  try {
    writeFileSync(join(dir, 'Probe.java'), 'public class Probe { public static void main(String[] a){ System.out.println("ok"); } }');
    const compiled = spawnSync(javac, ['--release', release, '-g', '-d', dir, join(dir, 'Probe.java')], { encoding: 'utf8' });
    if (compiled.status !== 0) return null;
    const ran = spawnSync(java, ['-cp', dir, 'Probe'], { encoding: 'utf8' });
    if (ran.status !== 0 || !/ok/.test(ran.stdout)) return null;
    return { javac, java, release };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* fine */ }
  }
}

const TOOLCHAIN = findToolchain();
const skip = TOOLCHAIN ? false : 'no matching javac/java pair on this host';

/** One debug session: compiles, spawns the adapter, speaks the protocol. */
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

  constructor(dir, sources, mainClass) {
    this.dir = dir;
    this.mainClass = mainClass;
    this.classesDir = join(dir, 'classes');
    mkdirSync(this.classesDir, { recursive: true });

    const paths = [];
    for (const [name, source] of Object.entries(sources)) {
      const full = join(dir, name);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, source, 'utf8');
      paths.push(full);
    }

    // `-g` is not optional: javac's default omits the LocalVariableTable, and without
    // it the debugger stops on the right line with no variables to show.
    const compiled = spawnSync(
      TOOLCHAIN.javac,
      ['--release', TOOLCHAIN.release, '-g', '-d', this.classesDir, ...paths],
      { encoding: 'utf8' },
    );
    if (compiled.status !== 0) throw new Error(`javac failed: ${compiled.stderr}`);
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
        BROWSER_CODER_JAVA_MAIN: this.mainClass,
        BROWSER_CODER_JAVA_BIN: TOOLCHAIN.java,
        BROWSER_CODER_JAVA_CLASSPATH: this.classesDir,
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

  waitFor(type, timeoutMs = 40000) {
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

  /** The JVM's stdout is a separate pipe from the debug socket and drains later. */
  waitForExit(timeoutMs = 20000) {
    if (this.exited !== null) return Promise.resolve(this.exited);
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('the debugged JVM did not exit')), timeoutMs);
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

function session(sources, mainClass) {
  return new DebugSession(mkdtempSync(join(tmpdir(), 'bc-jdbg-')), sources, mainClass);
}

/** A deliberately plain program: default package, one class, one file. */
const SIMPLE = [
  'public class Main {',                              // 1
  '  static int twice(int n) {',                      // 2
  '    int doubled = n * 2;',                         // 3
  '    return doubled;',                              // 4
  '  }',                                              // 5
  '',                                                 // 6
  '  public static void main(String[] args) {',       // 7
  '    String name = "world";',                       // 8
  '    int total = twice(3);',                        // 9
  '    System.out.println(name + total);',            // 10
  '    System.out.println("done");',                  // 11
  '  }',                                              // 12
  '}',                                                // 13
].join('\n');

describe('breakpoints, stepping and variables', { skip }, () => {
  let debug;

  before(async () => {
    debug = session({ 'Main.java': SIMPLE }, 'Main');
    await debug.start();
  });

  after(() => debug?.dispose());

  test('the adapter connects and identifies its session', async () => {
    const hello = await debug.waitFor('hello');
    assert.equal(hello.token, 'contract-token');
  });

  test('it attaches to the JVM over JDWP before the program runs', async () => {
    await debug.waitFor('attached');
  });

  test('a breakpoint set before launch is armed and reported back', async () => {
    debug.send({ command: 'setBreakpoints', lines: [10] });
    const armed = await debug.waitFor('breakpoints');
    // Nothing has loaded yet: `Main` does not exist until the VM resumes, so the
    // first reply is honestly empty and the real one follows on CLASS_PREPARE.
    assert.deepEqual(armed.lines, []);

    const rearmed = await debug.waitFor('breakpoints');
    assert.deepEqual(rearmed.lines, [10]);
  });

  test('the program stops there, with its stack and its locals', async () => {
    const stopped = await debug.waitFor('stopped');
    assert.equal(stopped.reason, 'breakpoint');
    assert.equal(stopped.file, 'Main.java');
    assert.equal(stopped.line, 10);
    assert.deepEqual(stopped.stack.map(frame => `${frame.name}:${frame.line}`), ['main:10']);

    const locals = Object.fromEntries(stopped.locals.map(local => [local.name, local.value]));
    assert.equal(locals.name.text, '"world"');
    assert.equal(locals.name.type, 'String');
    assert.equal(locals.total.text, '6');
    assert.equal(locals.total.type, 'int');
    // The method parameter is a local too, and an array renders as its length.
    assert.equal(locals.args.type, 'array');
  });

  test('a watch expression reads a local at the paused frame', async () => {
    debug.send({ command: 'evaluate', expression: 'total' });
    const evaluated = await debug.waitFor('evaluated');
    assert.equal(evaluated.expression, 'total');
    assert.equal(evaluated.value.text, '6');
  });

  test('a watch expression reads an array length', async () => {
    debug.send({ command: 'evaluate', expression: 'args.length' });
    const evaluated = await debug.waitFor('evaluated');
    assert.equal(evaluated.value.text, '0');
  });

  test('an expression it cannot honour is refused by name, not answered wrongly', async () => {
    debug.send({ command: 'evaluate', expression: 'total + 1' });
    const evaluated = await debug.waitFor('evaluated');
    assert.equal(evaluated.value, undefined);
    assert.match(evaluated.error, /variable or a field path/);
  });

  test('step over advances one line in the same frame', async () => {
    debug.send({ command: 'next' });
    const stepped = await debug.waitFor('stopped');
    assert.equal(stepped.reason, 'step');
    assert.equal(stepped.line, 11);
    assert.equal(stepped.file, 'Main.java');
  });

  test('continuing runs the program to the end and reports its exit code', async () => {
    debug.send({ command: 'continue' });
    const terminated = await debug.waitFor('terminated');
    assert.equal(terminated.exitCode, 0);

    await debug.waitForExit();
    assert.match(debug.stdout, /world6/);
    assert.match(debug.stdout, /done/);
    // The JVM's own "Listening for transport dt_socket at address: N" banner is the
    // first thing on its stdout and must never reach the student's console.
    assert.doesNotMatch(debug.stdout, /Listening for transport/);
  });
});

/**
 * The shapes that broke the first implementation: a package, a second file, and an
 * inner class in the same file as the outer one.
 */
const PACKAGED_MAIN = [
  'package app;',                                     // 1
  '',                                                 // 2
  'public class Main {',                              // 3
  '  static int shared = 7;',                         // 4
  '',                                                 // 5
  '  static class Node {',                            // 6
  '    int value;',                                   // 7
  '    Node next;',                                   // 8
  '    Node(int value) { this.value = value; }',      // 9
  '  }',                                              // 10
  '',                                                 // 11
  '  public static void main(String[] args) {',       // 12
  '    Node head = new Node(1);',                     // 13
  '    head.next = new Node(42);',                    // 14
  '    int[] numbers = { 3, 1, 4 };',                 // 15
  '    int sum = Helper.total(numbers);',             // 16
  '    System.out.println(sum + head.next.value);',   // 17
  '  }',                                              // 18
  '}',                                                // 19
].join('\n');

const PACKAGED_HELPER = [
  'package app;',                                     // 1
  '',                                                 // 2
  'class Helper {',                                   // 3
  '  static int total(int[] values) {',               // 4
  '    int running = 0;',                             // 5
  '    for (int value : values) {',                   // 6
  '      running += value;',                          // 7
  '    }',                                            // 8
  '    return running;',                              // 9
  '  }',                                              // 10
  '}',                                                // 11
].join('\n');

describe('packages, several files and nested classes', { skip }, () => {
  let debug;

  before(async () => {
    debug = session(
      { 'src/app/Main.java': PACKAGED_MAIN, 'src/app/Helper.java': PACKAGED_HELPER },
      'app.Main',
    );
    await debug.start();
    await debug.waitFor('attached');
  });

  after(() => debug?.dispose());

  test('breakpoints arm in two files at once, in a package, by workspace path', async () => {
    debug.send({
      command: 'setBreakpoints',
      lines: [],
      files: { 'src/app/Main.java': [17], 'src/app/Helper.java': [7] },
    });

    // The classes arrive one at a time, so keep reading until both files are armed.
    const armed = {};
    for (let attempt = 0; attempt < 6 && !(armed['Main.java'] && armed['Helper.java']); attempt++) {
      Object.assign(armed, (await debug.waitFor('breakpoints')).files);
    }
    assert.deepEqual(armed['Main.java'], [17]);
    assert.deepEqual(armed['Helper.java'], [7]);
  });

  test('the deeper file stops first, and the stack names the caller', async () => {
    const stopped = await debug.waitFor('stopped');
    assert.equal(stopped.file, 'Helper.java');
    assert.equal(stopped.line, 7);
    assert.deepEqual(
      stopped.stack.map(frame => `${frame.file}:${frame.line}`),
      ['Helper.java:7', 'Main.java:16'],
    );
  });

  test('the loop hits the same breakpoint once per iteration', async () => {
    for (let iteration = 0; iteration < 2; iteration++) {
      debug.send({ command: 'continue' });
      const again = await debug.waitFor('stopped');
      assert.equal(again.line, 7);
    }
  });

  test('a breakpoint in the outer class still arms once its inner class loads', async () => {
    debug.send({ command: 'continue' });
    const stopped = await debug.waitFor('stopped');
    assert.equal(stopped.file, 'Main.java');
    assert.equal(stopped.line, 17);
  });

  test('a watch expression walks a chain of fields', async () => {
    debug.send({ command: 'evaluate', expression: 'head.next.value' });
    assert.equal((await debug.waitFor('evaluated')).value.text, '42');
  });

  test('a watch expression reads a static field of the enclosing class', async () => {
    debug.send({ command: 'evaluate', expression: 'shared' });
    assert.equal((await debug.waitFor('evaluated')).value.text, '7');
  });

  test('a null link is reported as null rather than as a broken read', async () => {
    debug.send({ command: 'evaluate', expression: 'head.next.next' });
    assert.equal((await debug.waitFor('evaluated')).value.text, 'null');
  });

  test('an unknown name says so, naming the part it could not find', async () => {
    debug.send({ command: 'evaluate', expression: 'missing.value' });
    const evaluated = await debug.waitFor('evaluated');
    assert.match(evaluated.error, /missing/);
  });

  test('the run finishes with the value the program computed', async () => {
    debug.send({ command: 'continue' });
    await debug.waitFor('terminated');
    await debug.waitForExit();
    assert.match(debug.stdout, /50/);
  });
});
