/**
 * Ordered drain and process signal handling.
 *
 * V-30: the previous implementation closed the HTTP server and then exited.
 * Running jobs and live interactive sessions were neither terminated nor
 * reconciled, so every deploy left orphaned compilers and interpreters holding CPU
 * and memory until the container was destroyed - and left their job directories
 * behind, which the broken reaper (V-25) then never collected.
 *
 * The order is the design, not an implementation detail:
 *
 *   1. flip readiness false, so the load balancer stops sending new work while
 *      this instance can still finish what it already has
 *   2. stop the background timers
 *   3. terminate live sessions explicitly, so each client sees a real terminal
 *      event rather than a truncated stream
 *   4. stop accepting connections, then reap job directories
 *   5. exit
 *
 * Step 1 before step 4 is the part that is easy to get backwards, and getting it
 * backwards is what turns a rolling deploy into dropped requests.
 */

/** A connection that will not close must not hold a deploy open forever. */
const FORCE_EXIT_MS = 10_000;

/**
 * @param {object} deps
 * @param {import('node:http').Server} deps.server
 * @param {object} deps.pipeline
 * @param {object} deps.sessions
 * @param {Function} deps.log
 * @param {Array<{stop: () => void}>} [deps.stoppables]  timers and stores to halt
 * @param {() => void} [deps.finalSweep]                 last-chance cleanup
 */
export function createLifecycle({ server, pipeline, sessions, log, stoppables = [], finalSweep }) {
  let shuttingDown = false;

  /**
   * Exposed as a function rather than a boolean because the health routes are
   * registered before shutdown is ever triggered, and they need to read the CURRENT
   * value. Passing the boolean itself would capture `false` forever.
   */
  const isShuttingDown = () => shuttingDown;

  async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    // Readiness is already false by this line, because /ready calls isShuttingDown().
    // The drain window therefore begins before any connection is refused.
    log('info', 'shutdown_started', {
      signal,
      activeRuns: pipeline.activeCount,
      sessions: sessions.size,
    });

    for (const stoppable of stoppables) {
      try {
        stoppable.stop();
      } catch (error) {
        // A timer that will not stop must not prevent the rest of the drain.
        log('warn', 'shutdown_stop_failed', { error: error.message });
      }
    }

    const stopped = sessions.stopAll();
    if (stopped > 0) log('info', 'shutdown_sessions_terminated', { count: stopped });

    server.close(() => {
      // Best-effort final sweep. Live directories are empty by now, because every
      // session was terminated above.
      try {
        finalSweep?.();
      } catch {
        /* nothing more we can do while exiting */
      }
      log('info', 'shutdown_complete');
      process.exit(0);
    });

    // 10s is enough for a terminated session to flush its exit event, and short
    // enough that a stuck connection does not stall the deploy.
    setTimeout(() => {
      log('warn', 'shutdown_forced', { activeRuns: pipeline.activeCount });
      process.exit(1);
    }, FORCE_EXIT_MS).unref?.();
  }

  function install() {
    process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  }

  return { isShuttingDown, gracefulShutdown, install };
}
