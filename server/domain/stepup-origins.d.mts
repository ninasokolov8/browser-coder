/**
 * Types for the Step-Up origin allowlist, so the embedded IDE can import the SAME
 * module the server's CORS middleware enforces instead of carrying a second copy.
 *
 * The second copy is not hypothetical: it existed, and the two had already drifted in
 * both directions - the client trusted `stepup.zone`, `localhost:8080` and
 * `167.71.63.99` and the server did not, while the server trusted `arc.co` and the
 * client did not. The failure that produces is invisible from either file on its own.
 *
 * Hand-written rather than generated, for the same reason as paths.d.mts: the module
 * must stay plain ESM so the server imports it without a build step.
 */

export declare const STEPUP_ORIGINS: readonly string[];
export declare const STEPUP_BASE_DOMAINS: readonly string[];

export interface OriginClassification {
  readonly allowed: boolean;
  /** Which rule matched: an exact listing, or a subdomain of a listed base domain. */
  readonly via: 'exact' | 'subdomain' | null;
  readonly hostname: string | null;
  readonly protocol: string | null;
}

export declare function classifyOrigin(origin: string): OriginClassification;

export declare function isStepUpOrigin(origin: string): boolean;
