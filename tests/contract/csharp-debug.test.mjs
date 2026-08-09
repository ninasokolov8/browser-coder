/**
 * The C# debug adapter's protocol, against a real .NET debugger.
 *
 * Drives `languages/csharp/debug_adapter.mjs` directly - no server, no browser - for
 * the same reason the other adapter contract tests do.
 *
 * This suite skips unless BOTH a .NET SDK and `dncdbg` are present, and the second is
 * the unusual requirement. `netcoredbg`, the obvious debugger, builds on Alpine and
 * then segfaults the instant it launches a program: on musl, CoreCLR's PAL probes the
 * stack with `_alloca(1.5 MB)` from a thread whose stack is exactly 1.5 MB
 * (dotnet/runtime#103741 and Samsung/netcoredbg#206, both open). `dncdbg` is the
 * netcoredbg maintainer's own fork with that fixed, and the runtime image unpacks it.
 * Blueprint section 49 has the whole story.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ADAPTER = resolve(import.meta.dirname, '../../languages/csharp/debug_adapter.mjs');
const TARGET_FRAMEWORK = 'net8.0';

/** A .NET SDK and a working debugger, or null. */
function findToolchain() {
  const dotnet = process.env.DOTNET_BIN || 'dotnet';
  const sdk = spawnSync(dotnet, ['--version'], { encoding: 'utf8' });
  if (sdk.status !== 0) return null;

  for (const candidate of [process.env.DOTNET_DEBUGGER_BIN, '/opt/dncdbg/dncdbg', 'dncdbg']) {
    if (!candidate) continue;
    if (candidate.startsWith('/') && !existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return { dotnet, debugger: candidate };
  }
  return null;
}

const TOOLCHAIN = findToolchain();
const skip = TOOLCHAIN ? false : 'no dotnet SDK with a musl-capable .NET debugger on this host';

const PROJECT = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>${TARGET_FRAMEWORK}</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AssemblyName>UserProgram</AssemblyName>
    <UseAppHost>false</UseAppHost>
  </PropertyGroup>
</Project>
`;

/** One debug session: writes the project, builds it, drives the adapter. */
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
    this.entry = entry;

    writeFileSync(join(dir, 'UserProgram.csproj'), PROJECT, 'utf8');
    for (const [name, source] of Object.entries(sources)) {
      const full = join(dir, name);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, source, 'utf8');
    }

    // Debug configuration, not Release: Release elides locals into registers and
    // reorders lines, so a stepping test would assert against optimised code.
    const build = spawnSync(
      TOOLCHAIN.dotnet,
      ['build', '-c', 'Debug', '--nologo', '-v', 'q', dir],
      { cwd: dir, encoding: 'utf8' },
    );
    if (build.status !== 0) throw new Error(`dotnet build failed: ${build.stdout}${build.stderr}`);

    this.assembly = join(dir, 'bin', 'Debug', TARGET_FRAMEWORK, 'UserProgram.dll');
  }

  async start() {
    this.#server = net.createServer(connection => {
      this.#socket = connection;
      connection.on('data', chunk => this.#onData(chunk));
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
        BROWSER_CODER_DOTNET_ASSEMBLY: this.assembly,
        BROWSER_CODER_DEBUG_ENTRY: this.entry,
        BROWSER_CODER_DOTNET_DEBUGGER: TOOLCHAIN.debugger,
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

  waitFor(type, timeoutMs = 60000) {
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

  waitForExit(timeoutMs = 30000) {
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

function session(sources, entry = 'Program.cs') {
  return new DebugSession(mkdtempSync(join(tmpdir(), 'bc-csdbg-')), sources, entry);
}

const PROGRAM = [
  'using System;',                                    // 1
  'using System.Collections.Generic;',                // 2
  '',                                                 // 3
  'class Program {',                                  // 4
  '  static void Main() {',                           // 5
  '    string name = "world";',                       // 6
  '    int total = Helper.Twice(3);',                 // 7
  '    var list = new List<int> { 1, 2, 3 };',        // 8
  '    var person = new Person("Ada", 36);',          // 9
  '    Console.WriteLine(name + total);',             // 10
  '    Console.WriteLine("done");',                   // 11
  '  }',                                              // 12
  '}',                                                // 13
].join('\n');

const HELPER = [
  'class Helper {',                                   // 1
  '  public static int Twice(int n) {',               // 2
  '    int doubled = n * 2;',                         // 3
  '    return doubled;',                              // 4
  '  }',                                              // 5
  '}',                                                // 6
  '',                                                 // 7
  'class Person {',                                   // 8
  '  public string Name;',                            // 9
  '  public int Age;',                                // 10
  '  public Person(string name, int age) { Name = name; Age = age; }', // 11
  '}',                                                // 12
].join('\n');

describe('breakpoints, stepping and variables', { skip }, () => {
  let debug;

  before(async () => {
    debug = session({ 'Program.cs': PROGRAM, 'lib/Helper.cs': HELPER });
    await debug.start();
  });

  after(() => debug?.dispose());

  test('the adapter connects and identifies its session', async () => {
    const hello = await debug.waitFor('hello');
    assert.equal(hello.token, 'contract-token');
    assert.equal(hello.language, 'csharp');
  });

  test('breakpoints sent the instant it says hello arm in two files at once', async () => {
    /*
     * Sent with no wait after `hello`, deliberately - that is the race.
     *
     * `hello` is what makes the server report `debug:attached`, and a client reacts
     * to that at once. But `hello` goes out when the socket to the IDE opens, before
     * `initialize` has even been sent, and DAP will not accept breakpoints until the
     * `initialized` event. A command arriving in that window used to be dropped:
     * nothing armed, and the program ran straight past the student's breakpoint.
     * Commands are queued until the debugger is configurable.
     *
     * Pending counts as armed.
     *
     * The debugger answers before the program exists, with `verified: false` and
     * "The breakpoint is pending and will be resolved when debugging starts".
     * Reporting that as rejected left the margin empty while the program stopped
     * there anyway - the most confusing pair of behaviours available.
     */
    debug.send({
      command: 'setBreakpoints',
      lines: [],
      files: { 'Program.cs': [10], 'lib/Helper.cs': [3] },
    });
    const armed = await debug.waitFor('breakpoints');
    assert.deepEqual(armed.files['Program.cs'], [10]);
    assert.deepEqual(armed.files['lib/Helper.cs'], [3]);
  });

  /** The stop inside `Twice`, captured once and asserted on by two tests. */
  let inHelper = null;

  test('the deeper file stops first, and the stack names the caller', async () => {
    inHelper = await debug.waitFor('stopped');
    assert.equal(inHelper.reason, 'breakpoint');
    assert.equal(inHelper.file, 'lib/Helper.cs');
    assert.equal(inHelper.line, 3);
    assert.deepEqual(
      inHelper.stack.map(frame => `${frame.file}:${frame.line}`),
      ['lib/Helper.cs:3', 'Program.cs:7'],
    );
    // justMyCode: the base class library frames beneath Main are not the student's
    // and are not shown.
    assert.doesNotMatch(JSON.stringify(inHelper.stack), /System\.Private\.CoreLib/);
  });

  test('locals carry their declared type as well as their value', async () => {
    const locals = Object.fromEntries(inHelper.locals.map(local => [local.name, local.value]));
    assert.equal(locals.n.text, '3');
    assert.equal(locals.n.type, 'int');
    // The stop is before line 3 runs, so `doubled` is still its default.
    assert.equal(locals.doubled.text, '0');
  });

  test('a watch expression is compiled and evaluated against the frame', async () => {
    debug.send({ command: 'evaluate', expression: 'n * 100' });
    const evaluated = await debug.waitFor('evaluated');
    assert.equal(evaluated.value.text, '300');
    assert.equal(evaluated.value.type, 'int');
  });

  test('continuing reaches the breakpoint in the entry file', async () => {
    debug.send({ command: 'continue' });
    const stopped = await debug.waitFor('stopped');
    assert.equal(stopped.file, 'Program.cs');
    assert.equal(stopped.line, 10);

    const locals = Object.fromEntries(stopped.locals.map(local => [local.name, local.value]));
    assert.equal(locals.name.text, '"world"');
    assert.equal(locals.total.text, '6');
    assert.match(locals.list.text, /List<int>/);
    assert.match(locals.person.text, /Person/);
  });

  test('a watch expression can read a field and call a property', async () => {
    debug.send({ command: 'evaluate', expression: 'person.Name' });
    assert.equal((await debug.waitFor('evaluated')).value.text, '"Ada"');

    debug.send({ command: 'evaluate', expression: 'list.Count' });
    assert.equal((await debug.waitFor('evaluated')).value.text, '3');

    debug.send({ command: 'evaluate', expression: 'total + 1' });
    assert.equal((await debug.waitFor('evaluated')).value.text, '7');
  });

  test("an expression that does not compile reports the compiler's own message", async () => {
    debug.send({ command: 'evaluate', expression: 'nope' });
    const evaluated = await debug.waitFor('evaluated');
    assert.equal(evaluated.value, undefined);
    assert.match(evaluated.error, /nope/);
  });

  test('step over advances one line without entering a call', async () => {
    debug.send({ command: 'next' });
    const stepped = await debug.waitFor('stopped');
    assert.equal(stepped.reason, 'step');
    assert.equal(stepped.file, 'Program.cs');
    assert.equal(stepped.line, 11);
  });

  test('continuing runs to the end, with the program output and nothing else', async () => {
    debug.send({ command: 'continue' });
    const terminated = await debug.waitFor('terminated');
    assert.equal(terminated.exitCode, 0);

    await debug.waitForExit();
    assert.match(debug.stdout, /world6/);
    assert.match(debug.stdout, /done/);

    /*
     * The debugger's own remarks are not the program's output.
     *
     * "Could not load state machine method info from PDB file" arrives on the
     * `stderr` OUTPUT CATEGORY, indistinguishable by category from the program's real
     * stderr - so it is filtered by content. A student who wrote a correct console
     * program must not be shown it as though their code produced it.
     */
    assert.doesNotMatch(debug.stdout, /state machine method info/);
    assert.doesNotMatch(debug.stderr, /state machine method info/);
  });
});

describe('a program with no breakpoints still runs', { skip }, () => {
  let debug;

  before(async () => {
    debug = session({
      'Program.cs': 'class Program { static void Main() { System.Console.WriteLine("straight through"); } }',
    });
    await debug.start();
    await debug.waitFor('hello');
  });

  after(() => debug?.dispose());

  test('an empty breakpoint set does not leave the program suspended', async () => {
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
    debug = session({ 'Program.cs': 'class Program { static void Main() { System.Console.WriteLine("safe"); } }' });
    await debug.start();
    await debug.waitFor('hello');
  });

  after(() => debug?.dispose());

  test('a traversal is refused rather than armed', async () => {
    // The containment rule itself is pinned by tests/unit/workspace-paths.test.mjs,
    // where nothing else can stand in for it. This is the end-to-end outcome.
    debug.send({
      command: 'setBreakpoints',
      lines: [],
      files: { '../../etc/passwd': [1], 'Program.cs': [1] },
    });
    const armed = await debug.waitFor('breakpoints');
    assert.ok(!Object.keys(armed.files).some(file => file.includes('passwd')));
  });
});
