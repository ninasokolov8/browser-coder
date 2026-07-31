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

export const ALLOWED_ORIGINS = [
  'http://localhost:8000',
  'http://localhost:3000',
  'http://localhost',
  'http://127.0.0.1:8000',
  'http://127.0.0.1:3000',
  'https://stepup.school',
  'https://step-up.co.il',
  'https://www.stepup.school',
  'https://www.step-up.co.il',
  'https://arc.co',
  'https://www.arc.co',
  // Development / staging
  'http://stepup.local',
  'https://staging.stepup.school',
];

export const ALLOWED_BASE_DOMAINS = ['stepup.school', 'step-up.co.il', 'arcacademy.co'];

/**
 * Is this origin allowed to make credentialed cross-origin requests?
 *
 * The subdomain rule is written against the parsed HOSTNAME rather than with
 * `endsWith` on the raw origin string. Comparing a string that also contains the
 * scheme and the port means reasoning about URL syntax at every call site; parsing
 * removes that class of mistake, because a hostname either equals the domain or
 * ends with a dot and the domain, and nothing else can be constructed to look
 * like it.
 */
export function isAllowedOrigin(origin, { isDev }) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;

  let hostname;
  let protocol;
  try {
    const url = new URL(origin);
    hostname = url.hostname.toLowerCase();
    protocol = url.protocol;
  } catch {
    return false;
  }

  // A subdomain grant must not be reachable over plain HTTP in production.
  if (!isDev && protocol !== 'https:') return false;

  return ALLOWED_BASE_DOMAINS.some(
    domain => hostname === domain || hostname.endsWith(`.${domain}`),
  );
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
