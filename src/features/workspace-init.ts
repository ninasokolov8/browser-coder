// @ts-nocheck
import { getLanguage, getStarterAsync, preloadStarters } from '../languages';
import { runtime } from '../app/runtime';
import { appConfig, policyState } from '../app/config';
import { setStatus } from '../components/output';
import { applyTheme, configureMonacoForVersion, populateVersionDropdown } from '../components/monaco-config';
import { langSel, versionSel, themeSel, downloadBtn } from '../components/dom';
import { downloadFile } from '../components/download';
import { saveSettings } from '../components/settings';
import { getOrCreateModel, updateEmptyState } from './editor-core';
import { renderFileTree } from './explorer';
import { getDbName, setDbName } from '../storage';

export async function initializeWorkspace(): Promise<void> {
const editor = runtime.editor;
const tabManager = runtime.tabManager;
if (!editor || !tabManager || !runtime.currentLang || !runtime.currentVersion) {
  throw new Error('Workspace initialization called before runtime dependencies were ready');
}
// Initialize tabs
setStatus("Loading files…");

if (appConfig.isEmbedded) {
  // Embedded mode: isolate this iframe's IndexedDB so multiple parts on the
  // same Step-Up page don't share/overwrite each other's files. Each iframe
  // gets a unique DB that's deleted on unload.
  const isolatedDb = `BrowserCoderDB-embed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  setDbName(isolatedDb);
  const dbToDelete = getDbName();
  window.addEventListener('beforeunload', () => {
    try { indexedDB.deleteDatabase(dbToDelete); } catch (_) { /* best effort */ }
  });
  // Start with clean state - files will be provided by Step-Up via postMessage (stepup:init).
  await tabManager.initEmbedded();
  updateEmptyState(true);
  editor.setModel(null);
  setStatus("Waiting for content…");
} else {
  const initialTab = await tabManager.init(runtime.currentLang, runtime.currentVersion);

  if (initialTab) {
    const lang = getLanguage(initialTab.file.language);
    if (lang) {
      runtime.currentLang = lang;
      langSel.value = lang.id;
      runtime.currentVersion = populateVersionDropdown(lang, initialTab.file.version);
      configureMonacoForVersion(lang, runtime.currentVersion);
    }

    const model = getOrCreateModel(initialTab);
    editor.setModel(model);
    updateEmptyState(false);
    setStatus(`${initialTab.file.name}`);
  } else {
    // No files - show empty state
    updateEmptyState(true);
    editor.setModel(null);
    setStatus("Ready");
  }
}

// Listen to editor content changes for auto-save
editor.onDidChangeModelContent(() => {
  const activeTab = tabManager.getActiveTab();
  if (activeTab) {
    tabManager.markDirty(activeTab.file.id, editor.getValue());
  }
});

// Theme selector
themeSel.addEventListener("change", () => {
  applyTheme(themeSel.value);
  saveSettings();
});

// Language selector - open/focus a template file for the selected language.
// Important: this must never rewrite the currently active file. If a clean
// starter file for the selected language already exists, focus it. If that
// language file exists but was changed even by one character, create a new
// clean starter file instead.
langSel.addEventListener("change", async () => {
  if (policyState.lockStructure) {
    langSel.value = runtime.currentLang.id;
    return;
  }

  const newLang = getLanguage(langSel.value);
  if (!newLang) return;

  const targetVersion = populateVersionDropdown(newLang);
  configureMonacoForVersion(newLang, targetVersion);

  try {
    const result = await tabManager.openLanguageTemplateFile(newLang, targetVersion);
    if (result) {
      updateEmptyState(false);
      setStatus(result.created
        ? `Created ${result.tab.file.name}`
        : `Opened ${result.tab.file.name}`
      );
      if (result.created) {
        runtime.notifyWorkspaceChanged();
      }
      renderFileTree(tabManager);
    }
  } catch (err) {
    console.error('Failed to open language template file:', err);
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      const activeLang = getLanguage(activeTab.file.language);
      if (activeLang) {
        runtime.currentLang = activeLang;
        langSel.value = activeLang.id;
        runtime.currentVersion = populateVersionDropdown(activeLang, activeTab.file.version);
        configureMonacoForVersion(activeLang, runtime.currentVersion);
      }
    }
    setStatus('Failed to open language file');
  }

  // Preload all versions in background for this language
  preloadStarters(newLang.id).catch(() => {});
});

// Version selector
versionSel.addEventListener("change", async () => {
  const version = runtime.currentLang.versions.find((v: VersionConfig) => v.id === versionSel.value);
  if (!version) return;

  runtime.currentVersion = version;
  configureMonacoForVersion(runtime.currentLang, runtime.currentVersion);

  const activeTab = tabManager.getActiveTab();
  if (activeTab) {
    // Smart content update: only replace if user hasn't modified the code
    // Uses async check that compares content against starter template
    let newContent: string | undefined = undefined;
    const isModified = await tabManager.isTabUserModifiedAsync(activeTab.file.id);
    if (!isModified) {
      // Tab has default content - replace with new version's starter
      newContent = await getStarterAsync(runtime.currentLang.id, runtime.currentVersion.id);
    }

    await tabManager.updateTabLanguage(activeTab.file.id, runtime.currentLang, runtime.currentVersion, newContent);

    // Update model content if changed
    if (newContent !== undefined) {
      const model = editor.getModel();
      if (model) {
        model.setValue(newContent);
      }
      setStatus(`${runtime.currentLang.name} ${runtime.currentVersion.name} - loaded starter template`);
    } else {
      setStatus(`${runtime.currentLang.name} ${runtime.currentVersion.name} - your code preserved`);
    }
  }
});

// Clear output button handled in VS Code UI section below

// Download file
downloadBtn.addEventListener("click", () => {
  const activeTab = tabManager.getActiveTab();
  if (activeTab) {
    downloadFile(activeTab.file.name, editor.getValue());
    setStatus(`Downloaded ${activeTab.file.name}`);
  }
});

// Run button
}
