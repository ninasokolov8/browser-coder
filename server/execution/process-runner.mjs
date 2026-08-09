/**
 * The single managed-process primitive. Every execution in the service goes
 * through it: buffered runs, interactive sessions, compilers and linters.
 *
 * Consolidating them is what makes the following defects fixable once instead of
 * four times (they were duplicated across single/multi x buffered/interactive):
 *
 *   V-20  Termination is now always classified explicitly. The old
 *         `killed ? -1 : (exitCode || 0)` reported exit 0 for an output-cap kill
 *         (because `killed` was set only by the wall-clock timer) and for any
 *         signal death (because `null || 0` is 0).
 *   V-21  Kills target the whole process GROUP. `dotnet run` execs the built
 *         application as a grandchild, which previously survived every timeout,
 *         cancellation and output cap, holding CPU and memory until the
 *         container restarted.
 *   V-22  `stop()` is public, so a client disconnect can cancel real work
 *         instead of leaving it running with nobody reading the output.
 *   V-31  Output is decoded with a STREAMING UTF-8 decoder, so a multi-byte
 *         character split across two pipe chunks is no longer corrupted into
 *         U+FFFD. Bytes are never trimmed - leading and trailing whitespace is
 *         output the program actually produced.
 *
 * Backpressure note: stdout/stderr are always drained, even after the output cap
 * is reached. A process whose pipe fills stops making progress, which silently
 * changes program behaviour and can deadlock; discarding is the only safe policy
 * once we have decided to stop reporting.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

import { TerminationReason, classifyExit } from '../domain/termination.mjs';
import { log } from '../logging.mjs';

/** POSIX gets a real process group; Windows needs taskkill for the tree. */
const IS_WINDOWS = process.platform === 'win32';

/**
 * Kill an entire process tree.
 *
 * On POSIX the child is spawned detached so it leads its own process group, and
 * a negative PID signals the whole group. Without this, only the direct child
 * dies: `dotnet run` and `npx` both exec their real workload as a grandchild.
 */
function killTree(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (IS_WINDOWS) {
    try {
      // /T kills the tree, /F forces. Fire-and-forget: the exit handler is what
      // actually resolves the run.
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      }).on('error', () => {});
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    // ESRCH means the group is already gone; anything else still deserves a
    // direct attempt at the child itself.
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

/**
 * A bounded, streaming, UTF-8-correct output sink.
 *
 * Counts characters against the budget but keeps decoding after the cap so the
 * pipe never fills. `truncated` is what turns into an OUTPUT_LIMIT termination.
 */
class OutputSink {
  constructor(maxChars, onChunk) {
    this.maxChars = maxChars;
    this.onChunk = onChunk;
    this.decoder = new TextDecoder('utf-8');
    this.length = 0;
    this.truncated = false;
    this.parts = [];
  }

  push(buffer) {
    // stream: true retains an incomplete trailing sequence until the bytes that
    // complete it arrive. This is the whole fix for V-31.
    const text = this.decoder.decode(buffer, { stream: true });
    if (!text) return '';
    return this.accept(text);
  }

  /** Flush any bytes the decoder is still holding at end of stream. */
  finish() {
    const text = this.decoder.decode();
    return text ? this.accept(text) : '';
  }

  accept(text) {
    if (this.truncated) return '';

    const remaining = this.maxChars - this.length;
    if (remaining <= 0) {
      this.truncated = true;
      return '';
    }

    const emitted = text.length > remaining ? text.slice(0, remaining) : text;
    this.length += emitted.length;
    if (emitted.length < text.length) this.truncated = true;

    this.parts.push(emitted);
    if (this.onChunk && emitted) this.onChunk(emitted);
    return emitted;
  }

  /** Exact bytes as produced. Deliberately NOT trimmed - see V-31. */
  value() {
    return this.parts.join('');
  }
}

/**
 * Spawn and manage one process.
 *
 * @param {object} options
 * @param {string} options.command
 * @param {string[]} options.args              argument array, never a shell string
 * @param {string} options.cwd
 * @param {Record<string,string>} options.env  complete environment; not merged with the parent's
 * @param {number} options.timeoutMs           wall-clock budget, 0 disables
 * @param {number} options.maxOutputChars
 * @param {boolean} [options.stdin]            keep stdin open for interactive input
 * @param {(text: string) => void} [options.onStdout]
 * @param {(text: string) => void} [options.onStderr]
 * @param {(text: string) => string} [options.transformStderr] rewrite paths before the user sees them
 * @param {number[]} [options.extraFds]        additional inherited descriptors (graphics channel)
 * @returns {ManagedProcess}
 */
export function spawnManaged(options) {
  const {
    command,
    args,
    cwd,
    env,
    timeoutMs = 0,
    maxOutputChars = Infinity,
    stdin = false,
    onStdout,
    onStderr,
    transformStderr,
    extraFds = [],
  } = options;

  const startedAt = Date.now();

  /** Set once, by whoever decides to stop the process. Wins over the OS view. */
  let serviceReason = null;
  let settled = false;
  let resolveDone;
  const done = new Promise(resolve => {
    resolveDone = resolve;
  });

  const stdio = [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe', ...extraFds];

  let child;
  try {
    child = spawn(command, args, {
      cwd,
      env,
      stdio,
      // Own process group so killTree can signal the whole tree. Not unref'd:
      // we still want its exit event.
      detached: !IS_WINDOWS,
      shell: false,
      windowsHide: true,
    });
  } catch (error) {
    const termination = classifyExit({
      code: null,
      signal: null,
      serviceReason: TerminationReason.STARTUP_ERROR,
    });
    return {
      pid: null,
      termination,
      writeStdin: () => false,
      closeStdin: () => {},
      stop: () => {},
      done: Promise.resolve({
        termination,
        stdout: '',
        stderr: `Could not start ${command}: ${error.message}`,
        truncated: false,
        durationMs: 0,
      }),
    };
  }

  const stdoutSink = new OutputSink(maxOutputChars, onStdout);
  const stderrSink = new OutputSink(maxOutputChars, text => {
    if (onStderr) onStderr(transformStderr ? transformStderr(text) : text);
  });

  /** Stop the process for a stated reason. First reason wins. */
  const stop = (reason, signal = 'SIGKILL') => {
    if (settled) return;
    if (serviceReason === null) serviceReason = reason;
    killTree(child, signal);
  };

  const timeoutTimer =
    timeoutMs > 0
      ? setTimeout(() => stop(TerminationReason.TIMEOUT), timeoutMs)
      : null;

  const checkOutputCap = () => {
    if (stdoutSink.truncated || stderrSink.truncated) {
      // Both streams share one budget conceptually: exceeding either means the
      // user is no longer seeing the whole picture, which is not success.
      stop(TerminationReason.OUTPUT_LIMIT);
    }
  };

  child.stdout?.on('data', buffer => {
    stdoutSink.push(buffer);
    checkOutputCap();
  });
  child.stderr?.on('data', buffer => {
    stderrSink.push(buffer);
    checkOutputCap();
  });

  // A write to a closed stdin raises EPIPE on the stream, which would otherwise
  // become an unhandled 'error' and take the process down.
  child.stdin?.on('error', () => {});

  child.on('error', error => {
    if (settled) return;
    settled = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    log('warn', 'process_error', { command, error: error.message });
    resolveDone({
      termination: classifyExit({
        code: null,
        signal: null,
        serviceReason: TerminationReason.STARTUP_ERROR,
      }),
      stdout: stdoutSink.value(),
      stderr: `${stderrSink.value()}${error.message}`,
      truncated: false,
      durationMs: Date.now() - startedAt,
    });
  });

  child.on('close', (code, signal) => {
    if (settled) return;
    settled = true;
    if (timeoutTimer) clearTimeout(timeoutTimer);

    // Flush trailing partial multi-byte sequences before reporting.
    stdoutSink.finish();
    stderrSink.finish();

    const truncated = stdoutSink.truncated || stderrSink.truncated;
    // If the cap was hit but nothing set a reason (e.g. the process exited on
    // its own the same tick), the run is still truncated and not a success.
    if (truncated && serviceReason === null) serviceReason = TerminationReason.OUTPUT_LIMIT;

    const termination = classifyExit({ code, signal, serviceReason });

    let stderr = stderrSink.value();
    if (transformStderr && !onStderr) {
      // Buffered mode transforms once at the end; streaming mode transformed per
      // chunk on the way out. Doing both would double-apply the rewrite.
      try {
        stderr = transformStderr(stderr);
      } catch {
        /* leave raw */
      }
    }

    resolveDone({
      termination,
      stdout: stdoutSink.value(),
      stderr,
      truncated,
      durationMs: Date.now() - startedAt,
    });
  });

  return {
    pid: child.pid,

    /**
     * Feed output from a runtime's debug protocol through the same bounded sinks as
     * the child pipes. This preserves both ordering and the normal output limit.
     */
    writeOutput(stream, text) {
      if (settled || !text) return false;
      const sink = stream === 'stderr' ? stderrSink : stdoutSink;
      sink.accept(String(text));
      checkOutputCap();
      return !sink.truncated;
    },

    /** @returns {boolean} whether the bytes were accepted */
    writeStdin(text) {
      if (settled || !child.stdin || child.stdin.destroyed) return false;
      try {
        return child.stdin.write(text);
      } catch {
        return false;
      }
    },

    /** Signals EOF, which is what makes `input()` at end of input raise. */
    closeStdin() {
      try {
        child.stdin?.end();
      } catch {
        /* already closed */
      }
    },

    stop,
    done,
  };
}

/**
 * Convenience wrapper for a step whose output we only need at the end -
 * compilers and linters. Same managed process, no streaming callbacks.
 */
export async function runToCompletion(options) {
  const managed = spawnManaged(options);
  return managed.done;
}
