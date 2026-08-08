/** Deliberately tiny, unambiguous source fixes for beginner errors. */

import type * as Monaco from 'monaco-editor';
import { runtime } from '../app/runtime.ts';
import { escapeHtml } from '../components/html-escape.ts';
import type { Disposable } from '../workspace/types.ts';

export interface SafeFix {
  readonly id: string;
  readonly title: string;
  readonly line: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly text: string;
}

const PYTHON_HEADER = /^\s*(?:async\s+)?(?:if|elif|else|for|while|def|class|try|except|finally|with|match|case)\b/;

function missingPythonColon(source: string, line: number, message: string): SafeFix | null {
  if (!/(?:expected\s*['"]?:|invalid syntax|SyntaxError)/i.test(message)) return null;
  const text = source.split(/\r?\n/)[line - 1] ?? '';
  const code = text.replace(/\s*(#.*)?$/, '').trimEnd();
  if (!PYTHON_HEADER.test(code) || code.endsWith(':')) return null;
  const column = code.length + 1;
  return { id: 'python-add-colon', title: 'Add the missing :', line, startColumn: column, endColumn: column, text: ':' };
}

function pythonPrintTypo(source: string, line: number, message: string): SafeFix | null {
  if (!/(?:prnt.*(?:not defined|undefined)|NameError)/i.test(message)) return null;
  const text = source.split(/\r?\n/)[line - 1] ?? '';
  const match = /\bprnt\b/.exec(text);
  if (!match) return null;
  return {
    id: 'python-print-typo', title: 'Change prnt to print', line,
    startColumn: match.index + 1, endColumn: match.index + 5, text: 'print',
  };
}

function unmatchedDelimiter(source: string, diagnosticLine: number, message: string): SafeFix | null {
  if (!/(?:never closed|unclosed|expected|unterminated|CS1026|TS1005|syntax error)/i.test(message)) return null;
  // Curly braces describe blocks in JS/PHP/Java/C#. Their closing line is a
  // structural choice, so adding one can never be an unambiguous safe repair.
  const pairs: Record<string, string> = { '(': ')', '[': ']' };
  const closing = new Set(Object.values(pairs));
  const stack: Array<{ char: string; line: number; column: number }> = [];
  let quote = '';
  let escaped = false;
  let line = 1;
  let column = 0;

  for (const char of source) {
    if (char === '\n') { line++; column = 0; continue; }
    column++;
    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (pairs[char]) stack.push({ char, line, column });
    else if (closing.has(char)) {
      const top = stack[stack.length - 1];
      if (!top || pairs[top.char] !== char) return null;
      stack.pop();
    }
  }
  if (stack.length !== 1 || quote) return null;

  const opening = stack[0];
  if (opening.line !== diagnosticLine) return null;
  const lineText = source.split(/\r?\n/)[opening.line - 1] ?? '';
  // Restrict this fix to a single-line construct. Guessing where a multi-line call
  // ends is exactly the sort of ambiguous rewrite first-aid promises never to make.
  const after = lineText.slice(opening.column);
  if (after.includes('//') || after.includes('#')) return null;
  const semicolon = lineText.match(/;\s*$/)?.index;
  const at = semicolon === undefined ? lineText.trimEnd().length : semicolon;
  return {
    id: `close-${opening.char}`, title: `Add the missing ${pairs[opening.char]}`,
    line: opening.line, startColumn: at + 1, endColumn: at + 1, text: pairs[opening.char],
  };
}

export function safeFixFor(language: string, source: string, line: number, message: string): SafeFix | null {
  if (!Number.isInteger(line) || line < 1) return null;
  if (language === 'python') {
    const colon = missingPythonColon(source, line, message);
    if (colon) return colon;
    const typo = pythonPrintTypo(source, line, message);
    if (typo) return typo;
  }
  return unmatchedDelimiter(source, line, message);
}

export function firstAidButtonHtml(fix: SafeFix, message: string, file = ''): string {
  return `<button type="button" class="error-first-aid" data-fix-id="${escapeHtml(fix.id)}" `
    + `data-fix-message="${escapeHtml(message)}" data-fix-file="${escapeHtml(file)}" `
    + `data-fix-line="${fix.line}">${escapeHtml(fix.title)} for me</button>`;
}

export function initializeErrorFirstAid(monaco: typeof Monaco): Disposable {
  const subscriptions: Monaco.IDisposable[] = [];
  const languages = ['python', 'javascript', 'typescript', 'php', 'java', 'csharp'];

  const apply = (model: Monaco.editor.ITextModel, fix: SafeFix) => {
    model.pushEditOperations([], [{
      range: new monaco.Range(fix.line, fix.startColumn, fix.line, fix.endColumn),
      text: fix.text,
    }], () => null);
    runtime.editor?.setPosition({ lineNumber: fix.line, column: fix.startColumn + fix.text.length });
    runtime.editor?.focus();
  };

  for (const language of languages) {
    subscriptions.push(monaco.languages.registerCodeActionProvider(language, {
      provideCodeActions(model, _range, context) {
        const actions: Monaco.languages.CodeAction[] = [];
        for (const marker of context.markers) {
          const fix = safeFixFor(language, model.getValue(), marker.startLineNumber, marker.message);
          if (!fix) continue;
          actions.push({
            title: fix.title,
            kind: 'quickfix',
            isPreferred: true,
            diagnostics: [marker],
            edit: { edits: [{
              resource: model.uri,
              versionId: model.getVersionId(),
              textEdit: {
                range: new monaco.Range(fix.line, fix.startColumn, fix.line, fix.endColumn),
                text: fix.text,
              },
            }] },
          });
        }
        return { actions, dispose: () => {} };
      },
    }));
  }

  const panel = document.getElementById('panel-content');
  const onClick = async (event: MouseEvent) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('.error-first-aid');
    if (!button) return;
    const file = button.dataset.fixFile ?? '';
    const document = file ? runtime.workspace?.findByPath(file) : null;
    if (document) await runtime.tabManager?.switchToTab(document.id);
    const model = runtime.editor?.getModel();
    if (!model) return;
    const line = Number(button.dataset.fixLine);
    const fix = safeFixFor(model.getLanguageId(), model.getValue(), line, button.dataset.fixMessage ?? '');
    if (!fix || fix.id !== button.dataset.fixId) return;
    apply(model, fix);
    button.textContent = 'Fixed ✓';
    (button as HTMLButtonElement).disabled = true;
  };
  panel?.addEventListener('click', onClick);

  return { dispose: () => {
    for (const subscription of subscriptions) subscription.dispose();
    panel?.removeEventListener('click', onClick);
  } };
}
