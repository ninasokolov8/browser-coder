/**
 * The JavaScript debug adapter: the thread that runs the student's program.
 *
 * ## Why a worker rather than an external inspector
 *
 * V8's inspector pauses the isolate. An in-process `inspector.Session` therefore
 * cannot report the pause or read the next command, because the thread that would do
 * that is the thread that is stopped - the classic reason JavaScript debuggers run out
 * of process.
 *
 * The usual answer is `node --inspect-brk` plus a supervising process that speaks the
 * Chrome DevTools Protocol over a WebSocket. That was rejected here: it puts a
 * grandchild process under the run, and the pipeline's timeout kills the process it
 * spawned. An orphaned node process per timed-out debug session is a leak that only
 * shows up under the load this service is sized for.
 *
 * `Session.connectToMainThread()` gives the same separation without the extra process:
 * a worker thread attaches to the MAIN thread's inspector, and the worker's event loop
 * keeps running while the main thread is stopped. So the debugger lives inside the same
 * process the pipeline already owns, and the same kill ends both.
 *
 * ## What this half does
 *
 * Almost nothing, deliberately. It starts the worker, waits until breakpoints are
 * armed, runs the program, and reports how it ended. Everything else - the protocol,
 * the pausing, the variables - is in `debug_worker.mjs`, which is where the thread that
 * can still run lives.
 */

import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

import { installFsGuard } from './fs_guard.mjs';

const PORT = Number(process.env.BROWSER_CODER_DEBUG_PORT || 0);
const TOKEN = process.env.BROWSER_CODER_DEBUG_TOKEN || '';
const PROGRAM = process.env.BROWSER_CODER_DEBUG_PROGRAM || '';
const WORKSPACE = process.env.BROWSER_CODER_WORKSPACE || '';

if (!PORT || !TOKEN || !PROGRAM || !WORKSPACE) {
  process.stderr.write('debug adapter: missing session environment\n');
  process.exit(2);
}

/*
 * Confinement first, before the worker and long before the program.
 *
 * A debug run cannot use Node's permission model - the inspector is itself a
 * permission and is denied outright, with no flag to grant it - so the filesystem
 * grant that a normal run gets from `--allow-fs-read` is replaced by a language-level
 * guard, exactly as Python does it. Installed here rather than inside the worker
 * because it patches THIS thread's `fs`, which is the thread the program runs on.
 */
installFsGuard(WORKSPACE);

const worker = new Worker(new URL('./debug_worker.mjs', import.meta.url), {
  workerData: { port: PORT, token: TOKEN, program: PROGRAM, pid: process.pid },
});

/**
 * Wait for one message of a given kind from the worker.
 *
 * Bounded, because a debugger that never arms must not turn into a program that never
 * runs: the student would see a blank panel with no error. On timeout the program runs
 * undebugged, which is worse than debugging and much better than nothing.
 */
function waitFor(kind, timeoutMs) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      worker.off('message', onMessage);
      resolve(false);
    }, timeoutMs);

    function onMessage(message) {
      if (message?.kind !== kind) return;
      clearTimeout(timer);
      worker.off('message', onMessage);
      resolve(true);
    }

    worker.on('message', onMessage);
  });
}

worker.on('error', error => {
  process.stderr.write(`debug adapter: ${error?.message || error}\n`);
});

const armed = await waitFor('armed', 15000);
if (!armed) {
  process.stderr.write('debug adapter: the debugger did not arm; running without it\n');
}

/*
 * The program runs with NO rejection handler attached, on purpose.
 *
 * V8 decides whether an exception is "uncaught" at the moment it is thrown, by asking
 * whether a handler already exists. `await import(...)` inside a try/catch installs
 * one, so a program whose top level throws was reported to the debugger as *caught* -
 * and with `setPauseOnExceptions: 'uncaught'` the debugger never stopped, which is
 * precisely the case a student most needs it to.
 *
 * So the rejection is left unhandled and picked up by the process-level hook below,
 * which runs after the debugger has had its pause.
 */
/** How the program died, if it did. Sent to the worker so it can report a post-mortem. */
let failure = null;

const exitCode = await new Promise(resolve => {
  process.on('unhandledRejection', error => {
    // Printed in the shape node itself uses, so a student cannot tell a debugger was
    // attached from the way their error looks.
    process.stderr.write(`${error?.stack || error}\n`);
    failure = {
      name: error?.name || 'Error',
      message: error?.message || String(error),
      stack: String(error?.stack || ''),
    };
    resolve(1);
  });
  process.on('uncaughtException', error => {
    process.stderr.write(`${error?.stack || error}\n`);
    failure = {
      name: error?.name || 'Error',
      message: error?.message || String(error),
      stack: String(error?.stack || ''),
    };
    resolve(1);
  });

  // `import()` rather than a require, so an ES module entry point and a CommonJS one
  // both work - which one it is depends on the package.json the adapter kit pins.
  import(pathToFileURL(PROGRAM).href).then(() => resolve(0));
});

worker.postMessage({ kind: 'finished', exitCode, error: failure });

// Give the worker a moment to send `terminated` and close the socket. Bounded for the
// same reason as the arming wait: a stuck worker must not hold the run open.
await Promise.race([
  new Promise(resolve => worker.once('exit', resolve)),
  new Promise(resolve => setTimeout(resolve, 2000)),
]);

await worker.terminate().catch(() => {});
process.exit(exitCode);
