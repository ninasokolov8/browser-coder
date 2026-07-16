// @ts-nocheck
import { runtime } from '../app/runtime';
import { appConfig, policyState, normalizePanels, type IdePanel } from '../app/config';
import {
  sidebarEl, activityIcons, sidebarPanels, btnNewFile, btnNewFolder,
  emptyStateNewFileBtn, searchInput,
} from '../components/dom';
import { saveSettings } from '../components/settings';

const editor = new Proxy({} as any, { get: (_t, p) => (runtime.editor as any)[p] });

// ===== SIDEBAR PANEL SWITCHING =====
function panelIsVisible(panelName: string): boolean {
  return policyState.visiblePanels.includes(panelName as IdePanel);
}

export function applyIdePolicy() {
  document.body.classList.toggle('readonly', policyState.readonly);
  document.body.classList.toggle('structure-locked', policyState.lockStructure);
  document.body.classList.toggle('run-disabled', !policyState.allowRun);
  document.body.classList.toggle('search-replace-disabled', !policyState.allowSearchReplace);
  document.body.classList.toggle('hide-explorer-panel', !panelIsVisible('explorer'));
  document.body.classList.toggle('hide-search-panel', !panelIsVisible('search'));
  document.body.classList.toggle('hide-run-panel', !panelIsVisible('run'));

  const activeIcon = document.querySelector('.activity-icon.active') as HTMLElement | null;
  const activePanel = activeIcon?.dataset.panel || '';
  const firstVisiblePanel = policyState.visiblePanels[0] || null;

  btnNewFile.toggleAttribute('disabled', policyState.lockStructure);
  btnNewFolder.toggleAttribute('disabled', policyState.lockStructure);
  emptyStateNewFileBtn.toggleAttribute('disabled', policyState.lockStructure);

  if (appConfig.ideMode === 'full') {
    if (!firstVisiblePanel) {
      sidebarEl.classList.add('collapsed');
    } else if (!panelIsVisible(activePanel)) {
      sidebarEl.classList.remove('collapsed');
      switchSidebarPanel(firstVisiblePanel);
    }
  }
}

export function applyPolicyFromMessage(data: { readonly?: boolean; lockStructure?: boolean; allowRun?: boolean; panels?: string[]; allowSearchReplace?: boolean }) {
  if (typeof data.readonly === 'boolean') policyState.readonly = data.readonly;
  if (typeof data.lockStructure === 'boolean') policyState.lockStructure = data.lockStructure;
  if (typeof data.allowRun === 'boolean') policyState.allowRun = data.allowRun;
  if (typeof data.allowSearchReplace === 'boolean') policyState.allowSearchReplace = data.allowSearchReplace;
  if (Array.isArray(data.panels)) policyState.visiblePanels = normalizePanels(data.panels, policyState.visiblePanels);

  editor.updateOptions({ 
    readOnly: policyState.readonly,
    domReadOnly: policyState.readonly,
    renderLineHighlight: policyState.readonly ? 'none' : 'line',
    contextmenu: !policyState.lockStructure,
  });

  applyIdePolicy();
}

export function switchSidebarPanel(panelName: string) {
  if (!panelIsVisible(panelName)) return;

  // Update activity icons
  activityIcons.forEach(icon => {
    icon.classList.toggle('active', (icon as HTMLElement).dataset.panel === panelName);
  });

  // Update sidebar panels
  sidebarPanels.forEach(panel => {
    panel.classList.toggle('active', panel.id === `${panelName}-panel`);
  });

  // Focus search input when switching to search
  if (panelName === 'search') {
    setTimeout(() => searchInput.focus(), 50);
  }

  // Refresh function list when switching to run panel
  if (panelName === 'run') {
    void import('./run-panel').then(({ renderFunctionList }) => renderFunctionList());
  }

  saveSettings();
}

// Activity bar click handlers
activityIcons.forEach(icon => {
  icon.addEventListener('click', () => {
    const panelName = (icon as HTMLElement).dataset.panel;
    if (panelName) {
      // Toggle sidebar if clicking the active panel
      if (icon.classList.contains('active')) {
        sidebarEl.classList.toggle('collapsed');
      } else {
        sidebarEl.classList.remove('collapsed');
        switchSidebarPanel(panelName);
      }
      saveSettings();
      setTimeout(() => editor.layout(), 100);
    }
  });
});

// ===== Global Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
  // Ctrl+Shift+F - Open search
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f') {
    e.preventDefault();
    sidebarEl.classList.remove('collapsed');
    switchSidebarPanel('search');
  }
  // Ctrl+Shift+E - Open explorer
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'e') {
    e.preventDefault();
    sidebarEl.classList.remove('collapsed');
    switchSidebarPanel('explorer');
  }
  // Ctrl+B - Toggle sidebar
  if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !e.shiftKey) {
    e.preventDefault();
    sidebarEl.classList.toggle('collapsed');
    saveSettings();
    setTimeout(() => editor.layout(), 100);
  }
  // Escape - Close search results, go back to editor
  if (e.key === 'Escape' && document.activeElement === searchInput) {
    editor.focus();
  }
});
