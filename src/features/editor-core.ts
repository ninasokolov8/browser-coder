import * as monaco from 'monaco-editor';
import { getLanguage } from '../languages';
import { TabManager, type Tab } from '../tabs';
import { runtime } from '../app/runtime';
import { policyState } from '../app/config';
import { tabsEl, editorEmptyState, emptyStateNewFileBtn, statusLangEl, langSel, versionSel } from '../components/dom';
import { configureMonacoForVersion, populateVersionDropdown } from '../components/monaco-config';
import { setOutput, setStatus } from '../components/output';

export function updateEmptyState(show: boolean): void {
  editorEmptyState.classList.toggle('visible', show);
}

export function getOrCreateModel(tab: Tab): monaco.editor.ITextModel {
  let model = runtime.fileModels.get(tab.file.id);
  if (model && !model.isDisposed()) return model;

  const lang = getLanguage(tab.file.language);
  const monacoLang = lang?.monacoLanguage || 'plaintext';
  const ext = lang?.extension || 'txt';
  runtime.modelCounter += 1;
  const uri = monaco.Uri.parse(`file:///${tab.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}_${runtime.modelCounter}.${ext}`);
  model = monaco.editor.createModel(tab.file.content, monacoLang, uri);
  runtime.fileModels.set(tab.file.id, model);
  return model;
}

export function disposeModel(fileId: string): void {
  const model = runtime.fileModels.get(fileId);
  if (model && !model.isDisposed()) model.dispose();
  runtime.fileModels.delete(fileId);
}

export function applyFileLanguage(fileId: string): void {
  const tabManager = runtime.tabManager;
  if (!tabManager) return;
  const tab = tabManager.getTab(fileId);
  if (!tab) return;
  const lang = getLanguage(tab.file.language);
  if (!lang) return;

  const model = runtime.fileModels.get(fileId);
  if (model && !model.isDisposed() && model.getLanguageId() !== lang.monacoLanguage) {
    monaco.editor.setModelLanguage(model, lang.monacoLanguage);
  }

  const activeTab = tabManager.getActiveTab();
  if (activeTab?.file.id === fileId) {
    runtime.currentLang = lang;
    langSel.value = lang.id;
    runtime.currentVersion = populateVersionDropdown(lang, tab.file.version);
    configureMonacoForVersion(lang, runtime.currentVersion);
    statusLangEl.textContent = lang.name;
  }
}

export function createEditor(): monaco.editor.IStandaloneCodeEditor {
  const editor = monaco.editor.create(document.getElementById('editor')!, {
    theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false }, fontSize: 14,
    fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
    fontLigatures: true, tabSize: 2, insertSpaces: true, wordWrap: 'on', lineNumbers: 'on',
    renderWhitespace: 'selection', bracketPairColorization: { enabled: true }, autoClosingBrackets: 'always',
    autoClosingQuotes: 'always', formatOnPaste: true, formatOnType: true, suggestOnTriggerCharacters: true,
    quickSuggestions: { other: true, comments: false, strings: true }, acceptSuggestionOnEnter: 'on',
    parameterHints: { enabled: true }, hover: { enabled: true, delay: 300 }, folding: true,
    foldingHighlight: true, showFoldingControls: 'mouseover', matchBrackets: 'always', cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on', readOnly: policyState.readonly, smoothScrolling: true,
    contextmenu: !policyState.lockStructure, mouseWheelZoom: true, scrollBeyondLastLine: false,
    padding: { top: 10 },
    find: { addExtraSpaceOnTop: false, autoFindInSelection: 'multiline', seedSearchStringFromSelection: 'always' },
    suggest: {
      showMethods: true, showFunctions: true, showConstructors: true, showFields: true, showVariables: true,
      showClasses: true, showStructs: true, showInterfaces: true, showModules: true, showProperties: true,
      showEvents: true, showOperators: true, showUnits: true, showValues: true, showConstants: true,
      showEnums: true, showEnumMembers: true, showKeywords: true, showWords: true, showColors: true,
      showFiles: true, showReferences: true, showFolders: true, showTypeParameters: true, showSnippets: true,
    },
  });
  runtime.editor = editor;
  return editor;
}

export function createTabManager(hooks: {
  renderFileTree: () => void;
  refreshSearchHighlights: () => void;
}): TabManager {
  const editor = runtime.editor!;
  const manager = new TabManager(tabsEl, {
    onTabSwitch: (tab: Tab) => {
      editor.setModel(getOrCreateModel(tab));
      const lang = getLanguage(tab.file.language);
      if (lang) {
        runtime.currentLang = lang;
        langSel.value = lang.id;
        runtime.currentVersion = populateVersionDropdown(lang, tab.file.version);
        configureMonacoForVersion(lang, runtime.currentVersion);
        statusLangEl.textContent = lang.name;
      }
      setStatus(tab.file.name);
      setOutput('');
      hooks.renderFileTree();
      setTimeout(hooks.refreshSearchHighlights, 50);
    },
    onTabCreate: async (tab: Tab | null) => {
      if (tab === null && runtime.currentLang && runtime.currentVersion) {
        const newTab = await manager.createNewFile(runtime.currentLang, runtime.currentVersion);
        if (newTab) {
          editor.setModel(getOrCreateModel(newTab));
          setStatus(`Created ${newTab.file.name}`);
        }
      }
      hooks.renderFileTree();
    },
    onTabClose: (tab: Tab) => {
      disposeModel(tab.file.id);
      if (manager.getTabCount() === 0) {
        updateEmptyState(true);
        editor.setModel(null);
      }
      hooks.renderFileTree();
    },
    onTabUpdate: (tab: Tab) => {
      const activeTab = manager.getActiveTab();
      if (activeTab?.file.id === tab.file.id) setStatus(`${tab.file.name}${tab.isDirty ? ' •' : ''}`);
      applyFileLanguage(tab.file.id);
      hooks.renderFileTree();
      runtime.notifyWorkspaceChanged();
    },
    onTabsChange: (tabs: Tab[]) => {
      updateEmptyState(tabs.length === 0);
      hooks.renderFileTree();
    },
  });
  runtime.tabManager = manager;

  // Empty editor call-to-action: create a starter file for the language and
  // version currently selected in the toolbar. Assigning `onclick` keeps this
  // idempotent if the workspace is ever re-initialized.
  emptyStateNewFileBtn.onclick = async () => {
    if (policyState.lockStructure || emptyStateNewFileBtn.hasAttribute('disabled')) return;

    const selectedLang = getLanguage(langSel.value) || runtime.currentLang;
    if (!selectedLang) {
      setStatus('No language selected');
      return;
    }

    const selectedVersion =
      selectedLang.versions.find(version => version.id === versionSel.value) ||
      (selectedLang.id === runtime.currentLang?.id ? runtime.currentVersion : undefined) ||
      selectedLang.versions.find(version => version.default) ||
      selectedLang.versions[0];

    if (!selectedVersion) {
      setStatus(`No version available for ${selectedLang.name}`);
      return;
    }

    runtime.currentLang = selectedLang;
    runtime.currentVersion = selectedVersion;
    langSel.value = selectedLang.id;
    versionSel.value = selectedVersion.id;
    configureMonacoForVersion(selectedLang, selectedVersion);

    emptyStateNewFileBtn.setAttribute('disabled', '');
    try {
      // `emptyFile` intentionally stays false: the empty-state CTA restores
      // the original behavior and creates the selected language's starter.
      const newTab = await manager.createNewFile(selectedLang, selectedVersion);
      if (!newTab) {
        throw new Error('The file could not be created');
      }

      editor.setModel(getOrCreateModel(newTab));
      updateEmptyState(false);
      setStatus(`Created ${newTab.file.name}`);
      hooks.renderFileTree();
      runtime.notifyWorkspaceChanged();
      editor.focus();
    } catch (error) {
      console.error('[IDE] Failed to create file from empty state:', error);
      setStatus('Failed to create file');
    } finally {
      if (!policyState.lockStructure) {
        emptyStateNewFileBtn.removeAttribute('disabled');
      }
    }
  };

  return manager;
}
