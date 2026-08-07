/**
 * Refuse a large run body before it is buffered.
 *
 * `/api/run` accepts a whole multi-file project as JSON, and the transport limit is
 * derived from the size policy - several megabytes once escaping and base64 assets are
 * counted. That body is parsed by `express.json` BEFORE any route handler runs, so at
 * capacity the server read and buffered the entire upload into memory and only then
 * answered 503.
 *
 * Under the load this is sized for, that is the wrong order: the moment the run slots
 * are full is exactly the moment a burst of students press Run, and every one of those
 * requests would take a multi-megabyte buffer before being told no. The refusal is the
 * cheap part; the buffer is the expensive part.
 *
 * ## Why only large bodies
 *
 * A small request costs almost nothing to buffer, and buffering it leaves the run a
 * chance of finding a freed slot by the time the handler runs - runs are short, so that
 * happens. So the gate applies only above a threshold, where the memory saved is worth
 * losing that chance. Below it, behaviour is exactly as before.
 *
 * ## Why the header can be trusted here
 *
 * `Content-Length` is written by the client and could lie, but a lie can only make this
 * MORE permissive - a body declared small and sent large is still bounded by the
 * transport limit, which is the control that actually protects memory. Nothing security
 * relevant is decided here; this is a scheduling hint.
 */

/** Bodies at or above this are refused rather than buffered when at capacity. */
export const LARGE_BODY_BYTES = 256 * 1024;

/**
 * @param {object} options
 * @param {{activeCount: number}} options.pipeline
 * @param {{execution: {maxConcurrent: number}}} options.config
 * @param {(level: string, event: string, detail: object) => void} [options.log]
 * @param {number} [options.largeBodyBytes]
 */
export function createCapacityGate({
  pipeline,
  config,
  log,
  largeBodyBytes = LARGE_BODY_BYTES,
}) {
  return (req, res, next) => {
    if (req.method !== 'POST') return next();

    const declared = Number.parseInt(req.headers['content-length'] || '0', 10);
    if (!Number.isFinite(declared) || declared < largeBodyBytes) return next();

    if (pipeline.activeCount < config.execution.maxConcurrent) return next();

    log?.('warn', 'capacity_gate_refused', {
      bytes: declared,
      active: pipeline.activeCount,
      max: config.execution.maxConcurrent,
    });

    // The same envelope the pipeline's own refusal produces, so a client cannot tell
    // the two apart and needs no new handling.
    res.status(503).json({
      error: 'Server at capacity - please try again',
      code: 'at_capacity',
    });
  };
}
