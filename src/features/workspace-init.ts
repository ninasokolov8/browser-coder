import { getLanguage, getStarterAsync, preloadStarters } from '../languages';
import { runtime } from '../app/runtime';
import { appConfig, policyState } from '../app/config';
import { setStatus } from '../components/output';
import { applyTheme, configureMonacoForVersion, populateVersionDropdown } from '../components/monaco-config';
import { langSel, versionSel, themeSel, downloadBtn } from '../components/dom';
import { downloadFile } from '../components/download';
import { saveSettings } from '../components/settings';
import { getOrCreateModel, updateEmptyState } from './editor-core';
import { isAssetFile, showAssetViewer } from './asset-viewer.ts';
import { renderFileTree } from './explorer';

export async function initializeWorkspace(): Promise<void> {
const editor = runtime.editor;
const tabManager = runtime.tabManager;
if (!editor || !tabManager || !runtime.currentLang || !runtime.currentVersion) {
  throw new Error('Workspace initialization called before runtime dependencies were ready');
}
// Initialize tabs
setStatus("Loading files…");

if (appConfig.isEmbedded) {
  // The isolated database name and its cleanup are decided in main.ts, where the
  // workspace is constructed. Here we only start from a clean state: files arrive
  // from Step-Up via postMessage (stepup:init).
  await tabManager.initEmbedded();
  updateEmptyState(true);
  editor.setModel(null);
  setStatus("Waiting for content…");
} else {
  const initialTab = await tabManager.init(runtime.currentLang, runtime.currentVersion);

  if (initialTab && isAssetFile(initialTab.file)) {
    // A restored binary asset gets the viewer, not the editor - the same rule
    // `onTabSwitch` applies on every switch. Without it, reopening the IDE while an
    // image was the active tab threw out of `getOrCreateModel` (the registry refuses
    // a model for an asset, deliberately) and the rejection killed the whole of
    // bootstrap: no run panel, no palette, no layout, and a status line reading
    // "Initialization failed" that a student cannot recover from without clearing
    // site data. The most-recently-clicked file being an image is not an edge case.
    editor.setModel(null);
    showAssetViewer({
      name: initialTab.file.name,
      content: initialTab.file.content,
      path: initialTab.file.path,
    });
    updateEmptyState(false);
    setStatus(`${initialTab.file.name}`);
  } else if (initialTab) {
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
  // Re-checked inside the handler, not captured from the guard at the top of
  // initializeWorkspace: these fields are mutable and the handler runs much later.
  if (!runtime.currentLang) return;

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

// Version selector.
//
// Everything this handler needs is captured BEFORE the first await: the target
// document id, the language and the version. The previous version read
// `runtime.currentVersion` and `editor.getModel()` again *after* two awaits and
// wrote the starter template into whatever model was active by then - so a user
// who switched tabs while the starter was loading had the wrong file overwritten
// (V-11). Applying content through the service, addressed by document id, means
// the write cannot land anywhere else.
versionSel.addEventListener("change", async () => {
  const targetLang = runtime.currentLang;
  if (!targetLang) return;

  const targetVersion = targetLang.versions.find(candidate => candidate.id === versionSel.value);
  if (!targetVersion) return;

  runtime.currentVersion = targetVersion;
  configureMonacoForVersion(targetLang, targetVersion);

  const activeTab = tabManager.getActiveTab();
  if (!activeTab) return;
  const documentId = activeTab.file.id;

  // Replace the content only when the file still holds an untouched starter.
  const isModified = await tabManager.isTabUserModifiedAsync(documentId);
  const newContent = isModified
    ? undefined
    : await getStarterAsync(targetLang.id, targetVersion.id);

  await tabManager.updateTabLanguage(documentId, targetLang, targetVersion, newContent);

  setStatus(
    newContent !== undefined
      ? `${targetLang.name} ${targetVersion.name} - loaded starter template`
      : `${targetLang.name} ${targetVersion.name} - your code preserved`
  );
});

// Clear output button handled in VS Code UI section below

// Download file
downloadBtn.addEventListener("click", () => {
  const activeTab = tabManager.getActiveTab();
  if (!activeTab) return;

  // The FILE's content, never `editor.getValue()`. For an asset the editor does not
  // hold this file at all - `onTabSwitch` returns before `setModel` - so the old
  // version base64-decoded whichever source file was open last and saved 14 bytes of
  // noise as logo.png (or nothing at all, when the asset was the only tab). `file`
  // reads through to the live document buffer, so unsaved edits are still included.
  downloadFile(activeTab.file.name, activeTab.file.content);
  setStatus(`Downloaded ${activeTab.file.name}`);
});

// Run button
}
