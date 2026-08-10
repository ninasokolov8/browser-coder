/** Output-to-source attribution and the small navigation surface around it. */

import { runtime } from '../app/runtime.ts';
import type { Disposable } from '../workspace/types.ts';

export interface OutputLocation { readonly file: string; readonly line: number }

interface PrintSite extends OutputLocation { readonly anchor: string | null }

const PRINT_PATTERNS: Record<string, RegExp> = {
  python: /\bprint\s*\((.*)$/,
  javascript: /\bconsole\.(?:log|info|warn|error)\s*\((.*)$/,
  typescript: /\bconsole\.(?:log|info|warn|error)\s*\((.*)$/,
  php: /(?:\becho\b|\bprint\s*\(?|\bprintf\s*\()(.*)$/,
  java: /\bSystem\.(?:out|err)\.print(?:ln)?\s*\((.*)$/,
  csharp: /\bConsole\.(?:Write|WriteLine)\s*\((.*)$/,
};

function firstTextAnchor(argumentsText: string): string | null {
  const text = argumentsText.trim();
  const opening = text.match(/^(?:[rubf]{1,3}|\$)?(["'`])/i);
  if (!opening) return null;

  const quote = opening[1];
  const interpolated = quote === '`' || /^[rubf]*f/i.test(text) || text.startsWith('$');
  let raw = '';
  let escaped = false;
  for (let index = opening[0].length; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1] ?? '';
    if (escaped) {
      raw += `\\${character}`;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (
      character === quote
      || (interpolated && character === '{')
      || (interpolated && character === '$' && nextCharacter === '{')
    ) break;
    raw += character;
  }

  const anchor = raw
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\([\\"'])/g, '$1');
  return anchor || null;
}

export function findPrintSites(source: string, language: string, file = ''): PrintSite[] {
  const pattern = PRINT_PATTERNS[language];
  if (!pattern) return [];
  const sites: PrintSite[] = [];
  source.split(/\r?\n/).forEach((text, index) => {
    const match = text.match(pattern);
    if (match) sites.push({ file, line: index + 1, anchor: firstTextAnchor(match[1] ?? '') });
  });
  return sites;
}

/**
 * Maps lines as they arrive. Literal prints are anchors; a non-literal site keeps
 * receiving lines until a later literal appears, which makes a print inside a loop
 * correctly own all of its iterations without executing the student's program twice.
 */
export class OutputTraceMapper {
  readonly sites: readonly PrintSite[];
  #cursor = 0;
  #lastAnchored = -1;

  constructor(source: string, language: string, file = '', lineOffset = 0) {
    this.sites = findPrintSites(source, language, file).map(site => ({
      ...site,
      line: site.line + Math.max(0, Math.trunc(lineOffset)),
    }));
  }

  locationFor(outputLine: string): OutputLocation | null {
    const text = outputLine.replace(/\r?\n$/, '');
    if (this.sites.length === 0) return null;

    const anchoredAt = this.sites.findIndex((site, index) =>
      index >= this.#cursor && site.anchor !== null && text.startsWith(site.anchor));
    if (anchoredAt >= 0) {
      this.#cursor = anchoredAt + 1;
      this.#lastAnchored = anchoredAt;
      return this.sites[anchoredAt];
    }

    // A formatted print in a loop keeps producing the same stable prefix. Once
    // later anchored statements have been ruled out, prefer the last matched site
    // over consuming an unrelated dynamic print that merely follows it in source.
    const repeated = this.sites[this.#lastAnchored];
    if (repeated?.anchor && text.startsWith(repeated.anchor)) return repeated;

    const dynamicAt = this.sites.findIndex((site, index) => index >= this.#cursor && site.anchor === null);
    if (dynamicAt >= 0) {
      this.#cursor = dynamicAt;
      return this.sites[dynamicAt];
    }

    const fallback = this.sites[Math.min(this.#cursor, this.sites.length - 1)];
    this.#cursor = Math.min(this.#cursor + 1, this.sites.length);
    return fallback;
  }
}

export function initializeOutputTracing(): Disposable {
  const panel = document.getElementById('panel-content');
  const editor = runtime.editor;
  if (!panel || !editor) return { dispose: () => {} };
  const highlight = editor.createDecorationsCollection([]);

  const locationOf = (target: EventTarget | null) => {
    const button = (target as HTMLElement | null)?.closest<HTMLElement>('.output-trace-line');
    if (!button) return null;
    const line = Number(button.dataset.outputLine);
    return Number.isInteger(line) && line > 0
      ? { button, file: button.dataset.outputFile ?? '', line }
      : null;
  };

  const show = (line: number) => {
    const model = editor.getModel();
    if (!model || line > model.getLineCount()) return;
    highlight.set([{
      range: {
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: model.getLineMaxColumn(line),
      },
      options: { isWholeLine: true, className: 'output-trace-code-line' },
    }]);
  };

  const onOver = (event: MouseEvent) => {
    const location = locationOf(event.target);
    if (!location) return;
    const activePath = runtime.tabManager?.getActiveTab()?.file.path ?? '';
    if (!location.file || location.file === activePath) show(location.line);
  };
  const onOut = (event: MouseEvent) => {
    if (locationOf(event.target)) highlight.clear();
  };
  const onClick = async (event: MouseEvent) => {
    const location = locationOf(event.target);
    if (!location) return;
    const workspace = runtime.workspace;
    const document = location.file ? workspace?.findByPath(location.file) : null;
    if (document) await runtime.tabManager?.switchToTab(document.id);
    const model = editor.getModel();
    if (!model || location.line > model.getLineCount()) return;
    editor.revealLineInCenter(location.line);
    editor.setPosition({ lineNumber: location.line, column: 1 });
    show(location.line);
    editor.focus();
  };

  panel.addEventListener('mouseover', onOver);
  panel.addEventListener('mouseout', onOut);
  panel.addEventListener('click', onClick);
  return { dispose: () => {
    panel.removeEventListener('mouseover', onOver);
    panel.removeEventListener('mouseout', onOut);
    panel.removeEventListener('click', onClick);
    highlight.clear();
  } };
}
