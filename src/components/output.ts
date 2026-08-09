import {
  statusEl,
  panelContentEl,
} from "./dom";
import { escapeHtml } from './html-escape.ts';
import { getLanguageConfig, t } from '../i18n/index.ts';

const OUTPUT_STATE_ATTRIBUTE = 'outputState';

/** Render the translated empty-panel prompt without treating it as program output. */
export function showOutputPlaceholder(): void {
  panelContentEl.dataset[OUTPUT_STATE_ATTRIBUTE] = 'placeholder';
  panelContentEl.dir = getLanguageConfig().dir;
  panelContentEl.textContent = t('panel.placeholder');
}

/** Whether a locale change may safely replace the panel's current text. */
export function isOutputPlaceholderVisible(): boolean {
  return panelContentEl.dataset[OUTPUT_STATE_ATTRIBUTE] === 'placeholder';
}

function markProgramOutput(): void {
  delete panelContentEl.dataset[OUTPUT_STATE_ATTRIBUTE];
  panelContentEl.dir = 'ltr';
}

/**
 * Escape a plain string for safe insertion as HTML content.
 * Used internally and exported so callers building HTML output can escape
 * user-controlled strings (stdout, stderr, filenames, error messages).
 */
export function escHtml(text: string): string {
  // Delegates to the one escaper. Kept as a named export because the output panel
  // is the main consumer and the name reads well at those call sites; the previous
  // body escaped only three characters.
  return escapeHtml(text);
}

export function setStatus(s: string) {
  statusEl.textContent = s;
}

export function setOutput(text: string) {
  // Output is always raw program stdout/stderr/exit-code text - never
  // translated - so it must stay LTR even if the element previously held a
  // translated (and possibly RTL) placeholder via data-i18n.
  markProgramOutput();
  // Use innerHTML so formatted output (spans with CSS classes) can coexist
  // with plain-text output. All content is HTML-escaped to prevent injection.
  panelContentEl.innerHTML = escHtml(text || '');
  panelContentEl.scrollTop = panelContentEl.scrollHeight;
}

/**
 * Append pre-formatted HTML after whatever the panel already holds.
 *
 * Same contract as `setOutputHtml`: the CALLER escapes every user-controlled string.
 * Appending rather than replacing is what lets the error explanation sit UNDER the
 * program's own output and its exit line, instead of taking their place - a student
 * has to learn to read the real message eventually, so it stays on screen.
 */
export function appendOutputHtml(html: string) {
  markProgramOutput();
  panelContentEl.innerHTML = panelContentEl.innerHTML + (html || '');
  panelContentEl.scrollTop = panelContentEl.scrollHeight;
}

/**
 * Set pre-formatted HTML output in the panel.
 * The CALLER is responsible for HTML-escaping every user-controlled string
 * using escHtml() before embedding it in the html argument.
 */
export function setOutputHtml(html: string) {
  markProgramOutput();
  panelContentEl.innerHTML = html || '';
  panelContentEl.scrollTop = panelContentEl.scrollHeight;
}
