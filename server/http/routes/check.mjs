/**
 * POST /api/check - "would this compile?", asked while the student types.
 *
 * The compiler half of live error checking. The instant half runs in the browser and
 * finds what is knowable from the text alone; this one runs the real toolchain, so it
 * finds undefined names, type errors, missing methods - everything a scanner cannot.
 *
 * It reuses the run pipeline's `check()`, which is every adapter's existing `prepare()`
 * step with nothing after it. No language logic lives here, exactly as none lives in
 * the run routes.
 *
 * ## Why this returns compiler text rather than structured diagnostics
 *
 * Because the client already parses compiler text. `parseCompilerOutput` turns javac,
 * dotnet, python, php and tsc output into diagnostics for a failed RUN, and it is the
 * same output from the same tools. Parsing it a second time on the server, into a
 * second shape, would be two parsers to keep in agreement about the same text - and
 * they would drift, the way everything else in this codebase that was written twice
 * has drifted.
 *
 * ## Shedding, not queueing
 *
 * Checks are triggered by typing, so they arrive faster than they complete. A check
 * that has waited in a queue is answering a question about code the student has
 * already changed, so a busy server answers 429 immediately and the client simply
 * tries again after the next pause. Runs keep their own slots: `maxConcurrentChecks`
 * is deliberately below `maxConcurrent` so a class typing cannot stop anyone running.
 */

import { ExecutionRefused } from '../../execution/pipeline.mjs';
import { log } from '../../logging.mjs';

export function registerCheckRoutes(app, { pipeline, config }) {
  const limit = config.execution.maxConcurrentChecks;
  let inFlight = 0;

  app.post('/api/check', async (req, res) => {
    if (inFlight >= limit) {
      // Not an error the student should ever see. The client treats it as "no answer
      // this time" and keeps whatever the instant scanner found.
      return res.status(429).json({ error: 'Too many checks in flight', code: 'check_busy' });
    }

    const { language, version, code, files, entryPoint } = req.body || {};

    /*
     * The client went away - it navigated, or superseded this check with a newer one.
     *
     * Recorded rather than acted on: a compile cannot be interrupted usefully once
     * started, and the point is only to skip WRITING a response to a socket nobody is
     * reading. Armed before the await for the same reason it is on the run route -
     * `close` fires once, and a handler registered afterwards never runs.
     */
    let clientGone = false;
    res.on('close', () => { if (!res.writableEnded) clientGone = true; });

    inFlight += 1;
    try {
      const outcome = await pipeline.check({ language, version, code, files, entryPoint });
      if (clientGone) return undefined;

      return res.json({
        ok: outcome.ok,
        // Empty when it compiled. The client publishes an empty diagnostic list for
        // that case, which is what clears the previous squiggles.
        output: outcome.output,
        entryPoint: outcome.entryPoint,
        durationMs: outcome.durationMs,
      });
    } catch (error) {
      if (clientGone) return undefined;

      if (error instanceof ExecutionRefused) {
        // A refusal is about the REQUEST - unknown language, project too large, no
        // free slot. The student is mid-edit and has not asked for anything, so it is
        // reported as "no answer", never as a problem with their code.
        return res.status(error.status).json({ error: error.message, code: error.code });
      }

      log('error', 'check_failed', { language, error: error.message });
      return res.status(500).json({ error: 'Check failed', code: 'internal_error' });
    } finally {
      inFlight -= 1;
    }
  });
}
