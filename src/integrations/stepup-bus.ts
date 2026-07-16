import { appConfig } from '../app/config';

const ALLOWED_ORIGINS = [
  'http://localhost:8000','http://localhost:8080','http://localhost:3000','http://localhost',
  'http://127.0.0.1:8000','http://127.0.0.1:3000','http://167.71.63.99',
  'https://stepup.school','https://step-up.co.il','https://www.stepup.school','https://www.step-up.co.il',
  'https://staging.stepup.school','https://stepup.zone','https://dev.stepup.zone','http://stepup.local',
  'https://arcacademy.co','https://www.arcacademy.co',
];
const ALLOWED_BASE_DOMAINS = ['stepup.school','step-up.co.il','stepup.zone','arcacademy.co'];
let parentOrigin: string | null = null;

export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const hostname = new URL(origin).hostname;
    return ALLOWED_BASE_DOMAINS.some(base => hostname === base || hostname.endsWith('.' + base));
  } catch { return false; }
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
