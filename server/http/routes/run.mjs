/**
 * The run routes: the v1 façade over the single execution pipeline.
 *
 * These handlers contain no language logic at all - no `switch (language)`, no
 * compiler flags, no file layout decisions. They translate HTTP into a pipeline
 * request and a pipeline result back into the exact legacy envelope. That is what
 * section 22.1 asks for, and it is what makes the language adapters the only
 * place a language is described.
 *
 * Two frozen shapes are preserved precisely:
 *
 *   POST /api/run              -> one JSON result; compile and runtime errors are
 *                                 HTTP 200 with a nonzero exitCode, because
 *                                 Step-Up's CodeRunner treats any non-2xx as "no
 *                                 result at all" and would discard the feedback.
 *   POST /api/run/interactive  -> NDJSON stream whose first line is `session`
 *                                 and last is `exit`; event names are
 *                                 session | stdout | stderr | waiting | ping | exit.
 */

import { resolveBlobFiles } from '../../blobs/resolve.mjs';
import { TerminationReason, toLegacyExitCode, toLegacyNote } from '../../domain/termination.mjs';
import { ExecutionRefused } from '../../execution/pipeline.mjs';
import { FORWARDED_HEADER } from '../../execution/session-registry.mjs';
import { buildDebugCommand } from '../../debug/channel.mjs';
import { log } from '../../logging.mjs';

/**
 * Map a pipeline result onto the frozen v1 envelope.
 *
 * The eight original keys keep their exact names and meanings. Version resolution
 * is exposed additively, which is safe for existing consumers (they read named
 * keys) and is what turns V-32 from "silently ignored" into "reported": a caller
 * who asked for Java 21 can now see that it ran on java17.
 */
/** User-visible marker, preserved from v1 so a truncated run says so. */
const TRUNCATION_NOTICE = '\n... (output truncated)';

function toLegacyResult(result) {
  // Exact bytes, deliberately NOT trimmed.
  //
  // This is the one place the refactor knowingly changes observable output. v1
  // returned `stdout.trim()`, so `print("hello")` produced "hello" rather than
  // "hello\n", and any leading indentation or trailing whitespace a program
  // actually wrote was destroyed (V-31). For a tool whose job is to show a
  // program's output, silently editing that output is wrong - a student aligning
  // columns with trailing spaces, or printing a blank line, was shown something
  // their program did not produce.
  //
  // The visible effect on existing consumers is a trailing newline where there
  // was none. Step-Up renders stdout inside a <pre> and does not compare it, so
  // this is cosmetic there; it is called out in the implementation log because it
  // is a contract change rather than an internal one.
  const stdout = result.truncated ? result.stdout + TRUNCATION_NOTICE : result.stdout;

  return {
    stdout,
    stderr: result.stderr,
    exitCode: toLegacyExitCode(result.termination),
    durationMs: result.durationMs,
    // Retained for wire compatibility. Always false: no result is ever replayed.
    cached: false,
    turtleData: result.graphics || null,
    blocked: result.blocked === true,
    phase: result.phase || 'run',

    // ── Additive, v1-safe ────────────────────────────────────────────────────
    terminationReason: result.termination.reason,
    outputTruncated: result.truncated === true,
    resolvedVersion: result.profile
      ? {
          requested: result.profile.requested,
          resolved: result.profile.versionId,
          resolution: result.profile.resolution,
          runtime: result.profile.runtimeNote,
        }
      : null,
    entryPoint: result.entryPoint ?? null,
  };
}

/** Turn a thrown pipeline refusal into its HTTP answer. */
function sendRefusal(res, error) {
  if (error instanceof ExecutionRefused) {
    const body = { error: error.message, code: error.code };
    if (error.blocked) body.blocked = true;
    if (error.status === 503) body.retryAfter = 5;
    if (error.details?.available) body.available = error.details.available;
    return res.status(error.status).json(body);
  }

  log('error', 'execution_error', { error: error.message });
  return res.status(500).json({ error: 'Execution failed', code: 'internal_error' });
}

/**
 * Announce "the program is waiting for you to type".
 *
 * Without a pseudo-terminal a blocked read(2) cannot be observed directly, so it
 * is inferred: a live process that has gone quiet is either waiting on input or
 * doing slow work, and in both cases the user may type.
 *
 * Two delays, because the situations differ. After some output the prompt has
 * already been printed, so a short pause feels instant. Before any output the
 * interpreter may still be starting, so waiting longer avoids revealing an input
 * box with no context - anything typed early would be echoed above the prompt.
 *
 * Note this is only about WHEN THE UI HINTS. It no longer decides whether input
 * is possible: every session accepts stdin regardless.
 *
 * The third delay exists because the IDE now streams EVERY run, not only ones a
 * regex thought would read input. A program that prints a line and then computes
 * for a second would otherwise be announced as waiting for input, which is simply
 * untrue and teaches the student to distrust the prompt.
 *
 * The signal that separates them is the trailing newline. A prompt is written
 * WITHOUT one - `input("Name: ")`, `printf("n? ")`, `Console.Write(...)` - because
 * the caret is meant to sit on the same line. Ordinary output ends with a newline.
 * So unterminated output is a strong prompt signal and gets the short delay, while
 * output that ended cleanly is probably just work in progress and waits longer.
 *
 * It is still a heuristic: without a pseudo-terminal a blocked read cannot be
 * observed. But it is right far more often than a flat timer, and being wrong is
 * harmless in both directions - typing into a program that is not reading merely
 * buffers, and a late hint still arrives.
 */
const WAITING_DELAY_AFTER_PROMPT_MS = 250;
const WAITING_DELAY_AFTER_LINE_MS = 1500;
const WAITING_DELAY_INITIAL_MS = 1200;
const PING_INTERVAL_MS = 15000;

export function registerRunRoutes(app, { pipeline, sessions, config, blobStore = null }) {
  /**
   * Turn any cached-asset digests in a payload into content.
   *
   * Answers 409 with the digests the cache does not have, which the client uploads
   * before retrying. Returns null when the caller should stop.
   *
   * A cold cache therefore costs ONE extra round trip, and a warm one saves the whole
   * asset - which for a 2 MiB image is 2.8 MB of base64 per run.
   */
  function resolveAssets(body, res) {
    const outcome = resolveBlobFiles(body.files, blobStore);
    if (!outcome.missing) return outcome.files;

    res.status(409).json({
      error: 'Some assets are not cached.',
      code: 'blob_missing',
      missing: outcome.missing,
    });
    return null;
  }

  // ── POST /api/run ─────────────────────────────────────────────────────────
  app.post('/api/run', async (req, res) => {
    const { language, version, code, entryPoint } = req.body || {};

    const files = resolveAssets(req.body || {}, res);
    if (files === null) return undefined;

    let handle;
    try {
      handle = await pipeline.start(
        { language, version, code, files, entryPoint },
        { jobKind: 'run' },
      );
    } catch (error) {
      return sendRefusal(res, error);
    }

    if (handle.kind === 'diagnostics') {
      return res.json(
        toLegacyResult({ ...handle.result, profile: handle.profile, entryPoint: handle.entryPoint }),
      );
    }

    // Buffered contract: stdin closes immediately, so a program that reads input
    // receives EOF instead of blocking until the wall-clock timeout.
    handle.closeStdin();

    // V-22: cancel real work when the caller goes away. Listens on the RESPONSE,
    // because for a POST whose body is already consumed `req` emits 'close' as
    // soon as the request completes - long before the client disappears.
    let clientGone = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        clientGone = true;
        handle.stop(TerminationReason.CANCELLED);
      }
    });

    try {
      const result = await handle.done;
      if (clientGone) return undefined;
      return res.json(
        toLegacyResult({ ...result, profile: handle.profile, entryPoint: handle.entryPoint }),
      );
    } catch (error) {
      if (clientGone) return undefined;
      return sendRefusal(res, error);
    }
  });

  // ── POST /api/run/interactive ─────────────────────────────────────────────
  app.post('/api/run/interactive', async (req, res) => {
    const { language, version, code, entryPoint } = req.body || {};
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    const files = resolveAssets(req.body || {}, res);
    if (files === null) return undefined;

    /*
     * Debugging is an additive flag on the existing route, not a new endpoint.
     *
     * A debug session IS an interactive session - a live process, streamed output,
     * stdin, the same idle and lifetime timers, the same concurrency accounting. A
     * parallel `/api/run/debug` would have been a second copy of all of that, and
     * the two would drift; V-40 and the stdin regex were both that shape.
     *
     * The frozen v1 surface is untouched: a client that never sends `debug` gets
     * byte-identical behaviour, and the extra event types only appear when asked for.
     */
    const wantsDebug = req.body?.debug === true;

    // Admission before preparation, so compilation cannot overrun the cap (V-27).
    const capacity = sessions.checkCapacity(ip);
    if (!capacity.ok) {
      const body = { error: capacity.error };
      if (capacity.retryAfter) body.retryAfter = capacity.retryAfter;
      return res.status(capacity.status).json(body);
    }

    // Streaming state, all per-session.
    const state = {
      finished: false,
      sawOutput: false,
      outputEndedMidLine: false,
      idleTimer: null,
      lifetimeTimer: null,
      waitingTimer: null,
      pingTimer: null,
      serviceReason: null,
    };

    let sessionId = null;
    let handle = null;

    const send = payload => {
      if (res.writableEnded) return;
      try {
        res.write(`${JSON.stringify(payload)}\n`);
        // compression() is bypassed via Cache-Control: no-transform, but it still
        // decorates res with flush(). Calling it keeps a tiny write - like a bare
        // "Enter number: " prompt with no trailing newline - from sitting in a
        // buffer instead of reaching the student.
        if (typeof res.flush === 'function') res.flush();
      } catch {
        /* client went away */
      }
    };

    const armWaiting = () => {
      if (state.finished) return;
      clearTimeout(state.waitingTimer);
      state.waitingTimer = setTimeout(
        () => {
          if (!state.finished) send({ type: 'waiting' });
        },
        !state.sawOutput
          ? WAITING_DELAY_INITIAL_MS
          : state.outputEndedMidLine
            ? WAITING_DELAY_AFTER_PROMPT_MS
            : WAITING_DELAY_AFTER_LINE_MS,
      );
    };

    const resetIdle = () => {
      if (state.finished) return;
      clearTimeout(state.idleTimer);
      state.idleTimer = setTimeout(() => {
        state.serviceReason = TerminationReason.IDLE_TIMEOUT;
        handle?.stop(TerminationReason.IDLE_TIMEOUT);
      }, config.execution.interactiveIdleTimeoutMs);
    };

    const onOutput = (type, text) => {
      if (state.finished || !text) return;
      send({ type, data: text });
      state.sawOutput = true;
      // Only stdout counts: a stderr warning ending mid-line is not a prompt.
      if (type === 'stdout') state.outputEndedMidLine = !text.endsWith('\n');
      resetIdle();
      armWaiting();
    };

    /*
     * Arm the disconnect handler BEFORE the compile, not after it.
     *
     * `pipeline.start()` runs the adapter's prepare step - javac, `dotnet build`,
     * `php -l`, `tsc` - which for Java and C# is seconds, and `res.on('close')` used
     * to be registered only once that had resolved. A student who closed the tab or
     * pressed Stop during a compile therefore disconnected before anything was
     * listening, and since 'close' fires once, the handler registered afterwards never
     * ran: the sandbox was left to be reaped by its own timer.
     *
     * Sessions leaked that way are what exhausts the concurrency cap and produce
     * "too many runs" for the next student - so the window has to be closed, not
     * shortened. The handle may not exist yet when this fires, hence the flag: stop it
     * the moment it does.
     */
    let clientGone = false;
    res.on('close', () => {
      /*
       * 'close' also fires when the response ENDS normally, which for this route
       * includes the compile-error branch below - and the handle there is a
       * diagnostics result with no `stop()`. Calling it threw from inside an event
       * listener, where Express cannot catch it, and an uncaught exception takes the
       * process down with every other student's run on it. Exactly the failure the
       * note on that branch already records, reached a different way.
       *
       * `writableEnded` is the same guard the /api/run handler uses, and for the same
       * reason.
       */
      if (res.writableEnded) return;

      clientGone = true;
      if (handle?.kind === 'session' && !state.finished) {
        handle.stop(TerminationReason.CANCELLED);
      }
    });

    try {
      handle = await pipeline.start(
        { language, version, code, files, entryPoint },
        {
          jobKind: 'session',
          // No wall-clock run timeout: an interactive program legitimately blocks
          // on input, and a run timer cannot tell waiting from looping. The idle
          // and lifetime timers are the guard, and they can.
          timeoutMs: 0,
          onStdout: text => onOutput('stdout', text),
          onStderr: text => onOutput('stderr', text),
          debug: wantsDebug,
          // Debug frames ride the SAME NDJSON stream as stdout. One ordered
          // transport means a `stopped` event cannot arrive before the output the
          // program printed just before pausing, which two channels could not
          // guarantee - and the student would see the pause before the print.
          onDebugEvent: event => {
            // Counts as activity: a program paused at a breakpoint is doing exactly
            // what it was asked to, and the idle timer must not reap it while the
            // student reads their variables.
            resetIdle();
            send(event);
          },
        },
      );
    } catch (error) {
      return sendRefusal(res, error);
    }

    /*
     * A compile failure never becomes a live session: it answers as JSON, which is the
     * frozen v1 shape the console UI already handles.
     *
     * This has to come BEFORE anything is written to the response. It did not, and the
     * consequence was not a wrong answer - it was the whole server process dying.
     *
     * The `debug:unsupported` notice below used to sit above this branch. `send()`
     * calls `res.write()`, and writing before `writeHead` makes Node commit default
     * headers; `res.json()` here then threw ERR_HTTP_HEADERS_SENT from an async
     * continuation, where Express cannot catch it, and an uncaught exception takes the
     * process down with every other student's run on it.
     *
     * Reaching it needed only a debug request whose code does not compile, in a
     * language the pipeline reports no adapter for - a student clicking Debug on a
     * program with a syntax error.
     */
    if (handle.kind === 'diagnostics') {
      return res.json({
        compile: {
          stdout: '',
          stderr: handle.result.stderr,
          exitCode: toLegacyExitCode(handle.result.termination),
          phase: 'compile',
          durationMs: handle.result.durationMs,
          blocked: handle.result.blocked === true,
        },
      });
    }

    /*
     * The client disconnected while we were still compiling.
     *
     * The handler above set the flag but had no handle to stop; now there is one, and
     * nobody is listening to the stream it would write to. Stopped HERE - before the
     * session is registered and before the timers are armed - so a run nobody is
     * watching never becomes a session that exists only to be timed out later.
     */
    if (clientGone) {
      handle.stop(TerminationReason.CANCELLED);
      return undefined;
    }

    sessionId = sessions.register({
      handle,
      ip,
      jobDir: handle.jobDir,
      finished: false,
      onActivity: () => {
        resetIdle();
        armWaiting();
      },
    });

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      // no-transform tells compression() to leave the stream alone, so small
      // writes are not held back waiting for a compression buffer to fill.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable nginx response buffering so output reaches the browser the
      // instant the program prints it.
      'X-Accel-Buffering': 'no',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    send({ type: 'session', sessionId });

    // Asked to debug a language with no adapter. Told plainly rather than running
    // anyway and ignoring every breakpoint.
    //
    // Sent from HERE, after the stream is committed, because it is a stream event -
    // see the note on the diagnostics branch above for what writing it earlier cost.
    if (wantsDebug && !handle.debugSupported) {
      send({
        type: 'debug:unsupported',
        message: `${language} cannot be debugged yet. The program will run normally.`,
      });
    }

    // The browser holds this connection open while the student thinks, which can
    // exceed a proxy's idle-read timeout. A periodic keep-alive proves the
    // connection is active.
    state.pingTimer = setInterval(() => send({ type: 'ping' }), PING_INTERVAL_MS);

    state.lifetimeTimer = setTimeout(() => {
      state.serviceReason = TerminationReason.LIFETIME_LIMIT;
      handle.stop(TerminationReason.LIFETIME_LIMIT);
    }, config.execution.interactiveMaxLifetimeMs);

    resetIdle();
    armWaiting();

    try {
      const result = await handle.done;
      state.finished = true;
      clearTimeout(state.idleTimer);
      clearTimeout(state.lifetimeTimer);
      clearTimeout(state.waitingTimer);
      clearInterval(state.pingTimer);

      // A service-initiated reason recorded here outranks what the OS reported,
      // for the same reason the process runner prefers it: "killed by SIGKILL" is
      // true but useless; "idle timeout" is what happened.
      const termination = state.serviceReason
        ? { ...result.termination, reason: state.serviceReason, succeeded: false }
        : result.termination;

      // v1 announced truncation as a stderr event before the exit event.
      if (result.truncated) {
        send({ type: 'stderr', data: `${TRUNCATION_NOTICE}
` });
      }

      send({
        type: 'exit',
        exitCode: toLegacyExitCode(termination),
        durationMs: result.durationMs,
        note: toLegacyNote(termination),
        turtleData: result.graphics || null,
        terminationReason: termination.reason,
      });
    } catch (error) {
      state.finished = true;
      clearInterval(state.pingTimer);
      send({ type: 'stderr', data: `\n[session failed: ${error.message}]\n` });
      send({ type: 'exit', exitCode: -1, durationMs: 0, note: null, turtleData: null });
    } finally {
      state.finished = true;
      clearTimeout(state.idleTimer);
      clearTimeout(state.lifetimeTimer);
      clearTimeout(state.waitingTimer);
      clearInterval(state.pingTimer);
      if (sessionId) sessions.remove(sessionId);
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          /* already closed */
        }
      }
    }
    return undefined;
  });

  /**
   * Commands for an existing session.
   *
   * A replica that does not own the session forwards to the one that does - see
   * server/execution/session-registry.mjs for why that is bounded to one hop and
   * to internal addresses only (V-08).
   */
  const sessionCommand = (routePath, apply, { idempotent = false } = {}) =>
    app.post(routePath, async (req, res) => {
      const { id } = req.params;

      const local = sessions.get(id);
      if (local) {
        // Wrapped, and this matters more than it looks. Express 4 does not catch a
        // rejection from an async handler, so a throw here would leave the request
        // hanging until the client gave up rather than answering. `apply` used to be
        // total - stdin and stop cannot fail - but the debug command below refuses
        // an unknown command and a session with no debugger, and both are throws.
        try {
          apply(id, req);
        } catch (error) {
          const status = Number(error?.statusCode) || 500;
          if (status >= 500) log('warn', 'session_command_failed', { error: error?.message });
          return res.status(status).json({ error: error?.message || 'Command failed' });
        }
        return res.json({ ok: true });
      }

      const owner = req.headers[FORWARDED_HEADER] ? null : sessions.ownerOf(id);
      if (owner) {
        try {
          const upstream = await fetch(
            `http://${owner.host}:${owner.port}${req.originalUrl}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                // Marks the hop so the receiving replica never forwards again.
                [FORWARDED_HEADER]: '1',
              },
              body: JSON.stringify(req.body || {}),
              signal: AbortSignal.timeout(5000),
            },
          );
          const text = await upstream.text();
          return res.status(upstream.status).type('application/json').send(text);
        } catch (error) {
          log('warn', 'session_forward_failed', { error: error.message });
          return idempotent
            ? res.json({ ok: true })
            : res.status(410).json({ error: 'Session is not running' });
        }
      }

      // An idempotent command reports success for a session that no longer
      // exists, because "already stopped" is the state the caller asked for.
      // stdin is NOT idempotent: silently accepting input that no program will
      // ever read would let the console show a line as delivered when it was
      // discarded.
      return idempotent
        ? res.json({ ok: true })
        : res.status(410).json({ error: 'Session is not running' });
    });

  sessionCommand('/api/run/interactive/:id/stdin', (id, req) => {
    sessions.writeStdin(id, req.body?.data);
  });

  // Frozen v1 behaviour: the client calls close on teardown - including for a
  // session that has already exited on its own - and must not see an error.
  sessionCommand(
    '/api/run/interactive/:id/close',
    id => sessions.stop(id, TerminationReason.CANCELLED),
    { idempotent: true },
  );

  /*
   * Debug control: one route, the command in the path.
   *
   * The command name is validated against an allowlist in server/debug/channel.mjs
   * and the body is rebuilt field by field, because `evaluate` runs an expression
   * inside the student's paused process - so a request body must never reach the
   * adapter unexamined.
   *
   * Routed through `sessionCommand`, so a debug command lands on the replica that
   * owns the session exactly as stdin does. Without that it would work about half
   * the time behind two replicas, which is V-08 again.
   */
  sessionCommand('/api/run/interactive/:id/debug/:command', (id, req) => {
    const session = sessions.get(id);
    const frame = buildDebugCommand(req.params.command, req.body);

    if (!frame) {
      // A refusal, not a silent drop: a UI sending a command the server does not
      // accept must find out now rather than waiting for a stop that never comes.
      throw Object.assign(new Error(`unknown debug command: ${req.params.command}`), {
        statusCode: 400,
      });
    }

    if (!session?.handle?.sendDebug?.(frame)) {
      throw Object.assign(new Error('this session has no debugger attached'), {
        statusCode: 409,
      });
    }
  });

  // EOF without termination, so `input()` past the end of input raises the way it
  // does in a terminal. Additive; harmless to a v1 client that never calls it.
  sessionCommand('/api/run/interactive/:id/eof', id => sessions.closeStdin(id), {
    idempotent: true,
  });
}
