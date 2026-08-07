import { appConfig } from '../app/config';
import { isStepUpOrigin } from '../../server/domain/stepup-origins.mjs';

let parentOrigin: string | null = null;

/**
 * Which parent this embedded IDE will speak to.
 *
 * The list is shared with the server's CORS middleware. It used to be a second copy
 * here, and the two had drifted: this side trusted `stepup.zone`, `localhost:8080` and
 * `167.71.63.99` and the server did not, while the server trusted `arc.co` and this
 * side did not - so the IDE would postMessage a parent whose API calls the same server
 * would refuse.
 */
export function isAllowedOrigin(origin: string): boolean {
  return isStepUpOrigin(origin);
}

export function deriveInitialParentOrigin(): string | null {
  try {
    if (!document.referrer) return null;
    const origin = new URL(document.referrer).origin;
    return isAllowedOrigin(origin) ? origin : null;
  } catch { return null; }
}

export function setParentOrigin(origin: string): void {
  if (origin !== window.location.origin && isAllowedOrigin(origin)) parentOrigin = origin;
}

export function sendToParent(type: string, data: Record<string, unknown> = {}): void {
  if (window.parent === window) return;
  try { window.parent.postMessage({ type, ...data }, parentOrigin || '*'); }
  catch (error) { console.warn('[IDE] postMessage failed:', error); }
}

export function notifyParentReady(readonly: boolean): void {
  sendToParent('ide:ready', {
    mode: appConfig.ideMode,
    language: appConfig.urlLanguage,
    version: appConfig.urlVersion,
    readonly,
    embedded: appConfig.isEmbedded,
  });
}

export function notifyCodeChange(code: string): void {
  sendToParent('ide:code-change', {
    code,
    language: appConfig.urlLanguage,
    version: appConfig.urlVersion,
  });
}

export function notifyRunResult(result: { stdout: string; stderr: string; exitCode: number; durationMs: number }): void {
  sendToParent('ide:run-result', result);
}
