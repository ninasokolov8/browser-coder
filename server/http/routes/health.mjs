/**
 * Liveness, readiness and the legacy health endpoint.
 *
 * V-29: /health was derived only from buffered `activeExecutions`, so interactive
 * sessions were invisible to it, and it returned 503 at 90% load. A container
 * healthcheck treats 503 as death, so heavy load caused restarts, which shed the
 * load, which made the instance look healthy again - a feedback loop rather than a
 * health signal.
 *
 * The three endpoints answer three different questions, and conflating them is the
 * defect:
 *
 *   /live    is this process working?       -> restart me if not
 *   /ready   may this instance take work?   -> stop sending me traffic if not
 *   /health  legacy. Kept 200-on-healthy because Step-Up's IdeHelper::isAvailable()
 *            requires exactly 200, and derived from the readiness components.
 */

/**
 * @param {import('express').Express} app
 * @param {object} deps
 * @param {object} deps.pipeline
 * @param {object} deps.sessions
 * @param {object} deps.config
 * @param {() => boolean} deps.isShuttingDown
 * @param {object} deps.hostInfo  { cpuCount, memoryMB }
 */
export function registerHealthRoutes(app, { pipeline, sessions, config, isShuttingDown, hostInfo }) {
  const executionLoad = () => ({
    ...pipeline.stats(),
    interactiveSessions: sessions.size,
    maxInteractiveSessions: config.execution.maxInteractiveSessions,
  });

  /** Saturated means "do not send more work", never "this process is broken". */
  const isSaturated = () =>
    pipeline.activeCount >= config.execution.maxConcurrent ||
    sessions.size >= config.execution.maxInteractiveSessions;

  app.get('/live', (req, res) => {
    // Deliberately unconditional: reaching this handler proves the event loop is
    // turning and the HTTP stack is intact, which is the entire question. Checking
    // dependencies or saturation here is what produces restart storms.
    res.status(200).json({ status: 'live', pid: process.pid });
  });

  app.get('/ready', (req, res) => {
    const draining = isShuttingDown();
    const saturated = isSaturated();
    const ready = !draining && !saturated;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : draining ? 'draining' : 'saturated',
      draining,
      saturated,
      ...executionLoad(),
    });
  });

  app.get('/health', (req, res) => {
    // Legacy shape. Saturation is reported as "degraded" with a 200, because a
    // saturated instance is working correctly - it is simply busy - and answering
    // 503 here is what made the healthcheck kill it.
    res.status(isShuttingDown() ? 503 : 200).json({
      status: isShuttingDown() ? 'draining' : isSaturated() ? 'degraded' : 'healthy',
      ...executionLoad(),
      config: {
        maxConcurrent: config.execution.maxConcurrent,
        cpuCount: hostInfo.cpuCount,
        memoryMB: hostInfo.memoryMB,
        // Additive, and the reason is operational: `memoryMB` is the HOST's memory,
        // so on a container it disagrees with the budget maxConcurrent was derived
        // from - which is exactly the confusion that let V-36 sit unnoticed. An
        // operator reading /health can now see both numbers and which one binds.
        memoryBudgetMB: hostInfo.memoryBudgetMB,
        memoryBudgetSource: hostInfo.memoryBudgetSource,
      },
    });
  });

  // Kept for compatibility. The payload is deliberately coarse - counts and
  // percentages, no identities, paths or source.
  app.get('/api/stats', (req, res) => {
    res.json(executionLoad());
  });

  return { executionLoad, isSaturated };
}
