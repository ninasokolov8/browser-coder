/**
 * The Problems panel and the status-bar problem count.
 *
 * Before this the IDE reported errors in exactly one place: a pre-run gate inside
 * `runCode` that inspected the ACTIVE model and refused to run. So a type error in
 * a file the student was not looking at was invisible until it broke a run they had
 * no obvious way to connect it to, and the status bar's error indicator was a
 * hardcoded `0`.
 *
 * Rendering reads the store and nothing else, so what the panel shows, what the
 * status bar counts, and what blocks a run cannot disagree.
 */

import { t } from '../i18n/index.ts';
import { runtime } from '../app/runtime';
import { panelEl, panelContentEl } from '../components/dom';
import type { Diagnostic, DiagnosticsStore } from '../diagnostics/store.ts';
import type { Disposable } from '../workspace/types.ts';

const SEVERITY_ICON: Record<Diagnostic['severity'], string> = {
  error: '✖',
  warning: '⚠',
  info: 'ⓘ',
};

let activeTab: 'output' | 'problems' = 'output';

function element<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Reveal a diagnostic: open its document, then put the cursor on it. */
async function revealDiagnostic(diagnostic: Diagnostic): Promise<void> {
  const tabManager = runtime.tabManager;
  const editor = runtime.editor;
  if (!tabManager || !editor) return;

  // The document may not be open - a problem in an unopened file is exactly the
  // case this panel exists to surface.
  const tab = await tabManager.switchToTab(diagnostic.documentId);
  if (!tab) return;

  const position = { lineNumber: diagnostic.line, column: diagnostic.column };
  editor.setPosition(position);
  editor.revealPositionInCenter(position);
  editor.focus();
}

function renderInto(container: HTMLElement, store: DiagnosticsStore): void {
  const groups = store.groupedByPath();
  container.textContent = '';

  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'problems-empty';
    empty.textContent = t('problems.none');
    container.appendChild(empty);
    return;
  }

  for (const group of groups) {
    const heading = document.createElement('div');
    heading.className = 'problem-file';
    heading.textContent = `${group.path} (${group.diagnostics.length})`;
    container.appendChild(heading);

    for (const diagnostic of group.diagnostics) {
      const row = document.createElement('div');
      row.className = `problem-row severity-${diagnostic.severity}`;
      // Keyboard reachable: a mouse-only problem list is unusable for anyone
      // navigating by keyboard, and this is a list you work down.
      row.tabIndex = 0;
      row.setAttribute('role', 'button');

      const icon = document.createElement('span');
      icon.className = 'problem-icon';
      icon.textContent = SEVERITY_ICON[diagnostic.severity];
      icon.setAttribute('aria-hidden', 'true');
      row.appendChild(icon);

      const message = document.createElement('span');
      message.className = 'problem-message';
      // textContent, not innerHTML: a compiler message can contain a user-supplied
      // identifier, and a `<` in it must render as a `<`.
      message.textContent = diagnostic.message;
      row.appendChild(message);

      const origin = document.createElement('span');
      origin.className = 'problem-source';
      origin.textContent = diagnostic.source;
      row.appendChild(origin);

      const location = document.createElement('span');
      location.className = 'problem-location';
      location.textContent = `${diagnostic.line}:${diagnostic.column}`;
      row.appendChild(location);

      row.setAttribute(
        'aria-label',
        t('problems.itemLabel', {
          severity: t(`problems.severity.${diagnostic.severity}`),
          message: diagnostic.message,
          path: group.path,
          line: diagnostic.line,
        }),
      );

      const open = () => void revealDiagnostic(diagnostic);
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });

      container.appendChild(row);
    }
  }
}

function renderStatusBar(store: DiagnosticsStore): void {
  const statusErrors = element('status-errors');
  if (!statusErrors) return;

  const counts = store.counts();
  statusErrors.textContent = '';

  const icon = document.createElement('span');
  icon.textContent = counts.error > 0 ? '✖' : '⚠';
  statusErrors.appendChild(icon);

  const label = document.createElement('span');
  label.textContent =
    counts.warning > 0 ? `${counts.error} / ${counts.warning}` : String(counts.error);
  statusErrors.appendChild(label);

  statusErrors.title =
    counts.total === 0
      ? t('problems.none')
      : t('problems.summary', { errors: counts.error, warnings: counts.warning });

  // Clicking the indicator is how most people open the panel.
  statusErrors.style.cursor = 'pointer';
}

export function showPanelTab(tab: 'output' | 'problems'): void {
  activeTab = tab;

  const problems = element('problems-content');
  if (!problems) return;

  problems.hidden = tab !== 'problems';
  panelContentEl.hidden = tab === 'problems';

  for (const tabElement of document.querySelectorAll('.panel-tab')) {
    tabElement.classList.toggle('active', (tabElement as HTMLElement).dataset.tab === tab);
  }

  // Opening a tab on a collapsed panel should show it, not silently switch a
  // surface the user cannot see.
  panelEl.classList.remove('collapsed');
}

export function initializeProblemsPanel(store: DiagnosticsStore): Disposable {
  const problems = element('problems-content');
  if (!problems) return { dispose: () => {} };

  const rerender = () => {
    renderInto(problems, store);
    renderStatusBar(store);
  };

  const subscription = store.onDidChange(rerender);
  window.addEventListener('languageChanged', rerender);

  for (const tabElement of document.querySelectorAll('.panel-tab')) {
    tabElement.addEventListener('click', () => {
      const target = (tabElement as HTMLElement).dataset.tab;
      if (target === 'problems' || target === 'output') showPanelTab(target);
    });
  }

  const statusErrors = element('status-errors');
  statusErrors?.addEventListener('click', () => showPanelTab('problems'));

  rerender();
  showPanelTab(activeTab);

  return {
    dispose: () => {
      subscription.dispose();
      window.removeEventListener('languageChanged', rerender);
    },
  };
}
