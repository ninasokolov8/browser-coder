/**
 * Which origins are Step-Up.
 *
 * ## Why this is one file
 *
 * "Do we trust this origin" was written twice - once in server/http/middleware/cors.mjs
 * for credentialed cross-origin requests, once in src/integrations/stepup-bus.ts for
 * postMessage - and the two copies had already drifted in both directions:
 *
 *   only the client trusted  stepup.zone (and *.stepup.zone), localhost:8080, and
 *                            167.71.63.99
 *   only the server trusted  arc.co and www.arc.co
 *
 * So an embedded IDE would talk to a parent the API would refuse, and the API would
 * accept credentialed requests from a domain the IDE would not speak to. Neither
 * failure is visible from the file you happen to be reading, which is the whole
 * argument for not having two files.
 *
 * Step-Up's own deploy script is the authority on what is live: `deploy/deploy.sh`
 * sets DOMAIN=arcacademy.co for production and dev.arcacademy.co for dev, and its
 * `.env.example` uses APP_URL=http://localhost:8080 locally - which the server did not
 * accept. That gap is why the list below is the UNION of the two: every entry was put
 * there by somebody, on a side that works today, and quietly dropping one to tidy up
 * would break an environment this repository cannot see.
 *
 * Two entries look stale and are kept only for that reason - `arc.co`, which nothing in
 * either repository references and which reads like an early name for arcacademy.co,
 * and `stepup.zone`, which no Step-Up deployment mentions. Pruning them is a decision
 * for whoever owns the DNS.
 *
 * ## What this does NOT decide
 *
 * Only membership. The server additionally refuses a subdomain grant over plain HTTP
 * outside development, because a credentialed CORS grant and a postMessage target are
 * not the same risk. That rule stays with the server.
 */

/** Exact origins, matched whole. */
export const STEPUP_ORIGINS = [
  // Local development. :8080 is what Step-Up's own .env.example uses.
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:8000',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8000',
  'http://stepup.local',

  // The host this IDE is served from, which is also a parent origin when the IDE is
  // embedded by a Step-Up instance running on the same box.
  'http://167.71.63.99',

  // Live.
  'https://arcacademy.co',
  'https://www.arcacademy.co',
  'https://stepup.school',
  'https://www.stepup.school',
  'https://staging.stepup.school',
  'https://step-up.co.il',
  'https://www.step-up.co.il',
  'https://stepup.zone',
  'https://dev.stepup.zone',

  // Stale-looking; see the header.
  'https://arc.co',
  'https://www.arc.co',
];

/**
 * Domains whose subdomains are also Step-Up.
 *
 * Matched against the parsed HOSTNAME rather than with `endsWith` on the raw origin
 * string. Comparing a string that also carries the scheme and the port means reasoning
 * about URL syntax at every call site; parsing removes that class of mistake, because a
 * hostname either equals the domain or ends with a dot and the domain, and nothing else
 * can be constructed to look like it. `notstepup.school` is not a subdomain of
 * `stepup.school`, and this is what makes that true.
 */
export const STEPUP_BASE_DOMAINS = [
  'arcacademy.co',
  'stepup.school',
  'step-up.co.il',
  'stepup.zone',
];

/**
 * Is this origin Step-Up, by either rule?
 *
 * Returns the reason as well as the answer, so a caller that applies extra policy to
 * subdomain grants - the server does - can tell which rule matched without parsing the
 * origin a second time.
 *
 * @param {string} origin
 * @returns {{ allowed: boolean, via: 'exact' | 'subdomain' | null, hostname: string | null,
 *   protocol: string | null }}
 */
export function classifyOrigin(origin) {
  const miss = { allowed: false, via: null, hostname: null, protocol: null };
  if (!origin) return miss;

  let hostname;
  let protocol;
  try {
    const url = new URL(origin);
    hostname = url.hostname.toLowerCase();
    protocol = url.protocol;
  } catch {
    return miss;
  }

  if (STEPUP_ORIGINS.includes(origin)) {
    return { allowed: true, via: 'exact', hostname, protocol };
  }

  const isSubdomain = STEPUP_BASE_DOMAINS.some(
    base => hostname === base || hostname.endsWith(`.${base}`),
  );

  return isSubdomain
    ? { allowed: true, via: 'subdomain', hostname, protocol }
    : { ...miss, hostname, protocol };
}

/** Membership alone, for callers with no extra policy of their own. */
export function isStepUpOrigin(origin) {
  return classifyOrigin(origin).allowed;
}
