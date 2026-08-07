/**
 * CORS for the Step-Up integration.
 *
 * V-46: the previous implementation logged a disallowed origin as "cors_rejected"
 * and then, for every non-preflight request, sent it straight back:
 *
 *     res.setHeader("Access-Control-Allow-Origin", origin);   // the rejected one
 *     res.setHeader("Access-Control-Allow-Credentials", "true");
 *
 * which is not a rejection, it is a grant. Any site could read credentialed
 * responses from this API; only the preflight was refused, and a simple request
 * does not send one.
 */

import { classifyOrigin, STEPUP_BASE_DOMAINS, STEPUP_ORIGINS } from '../../domain/stepup-origins.mjs';

/*
 * The list moved to server/domain/stepup-origins.mjs, where the client reads it too.
 *
 * It was written twice - here and in src/integrations/stepup-bus.ts - and the two had
 * drifted: only this side trusted `arc.co`, and only the client trusted `stepup.zone`,
 * `localhost:8080` (which is the APP_URL in Step-Up's own .env.example) and
 * `167.71.63.99`. Re-exported so existing importers and tests are unaffected.
 */
export const ALLOWED_ORIGINS = STEPUP_ORIGINS;
export const ALLOWED_BASE_DOMAINS = STEPUP_BASE_DOMAINS;

/**
 * Is this origin allowed to make credentialed cross-origin requests?
 *
 * Membership is the shared rule. The extra condition is this side's alone: a
 * SUBDOMAIN grant must not be reachable over plain HTTP in production, because a
 * credentialed CORS grant to an attacker-controlled subdomain over http is a
 * different risk from a postMessage target. An origin listed exactly is trusted as
 * written, http included - that is what naming it means.
 */
export function isAllowedOrigin(origin, { isDev }) {
  const match = classifyOrigin(origin);
  if (!match.allowed) return false;
  if (match.via === 'subdomain' && !isDev && match.protocol !== 'https:') return false;
  return true;
}

export function createCorsMiddleware({ isDev, log }) {
  return (req, res, next) => {
    const origin = req.headers.origin;

    // Origin-dependent responses must not be served from a shared cache to a
    // different origin.
    res.setHeader('Vary', 'Origin');

    if (!origin) {
      // No Origin header: a same-origin navigation or a server-to-server call.
      // There is no browser to protect, and `*` cannot be combined with credentials.
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (isAllowedOrigin(origin, { isDev })) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      log('warn', 'cors_rejected', { origin, path: req.path, method: req.method });
      if (req.method === 'OPTIONS') {
        return res.status(403).json({ error: 'Origin not allowed' });
      }
      // Deliberately falls through with NO allow-origin header. The request is still
      // processed - a cross-origin request that reaches us has already been sent -
      // but the browser will not expose the response to the caller.
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  };
}
