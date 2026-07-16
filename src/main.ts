import { initI18n, setLanguage, getLanguage as getUILang } from './i18n';
import { getAllLanguages, getLanguage, preloadDefaultStarters } from './languages';
import { storage } from './storage';
import { appConfig, applyModeClasses } from './app/config';
import { runtime } from './app/runtime';
import { createEditor, createTabManager } from './features/editor-core';
import { renderFileTree } from './features/explorer';
import { highlightSearchMatchesInEditor } from './features/search';
import { initializeWorkspace } from './features/workspace-init';
import { initializeLayout } from './features/layout';
import { setupStepUpIntegration } from './integrations/stepup';
import { populateLanguageDropdown, populateVersionDropdown, configureMonacoForVersion } from './components/monaco-config';
import { uiLangSel, langSel } from './components/dom';
import { setStatus } from './components/output';
import { updateGridForRTL } from './features/ui-layout';
import { initializeGoToDefinition } from './features/go-to-definition';
import { initializeWebPreview } from './features/live-preview';

async function bootstrap(): Promise<void> {
  setStatus('Loading languages…');
  applyModeClasses();

  await initI18n();
  if (appConfig.urlUiLang && appConfig.urlUiLang !== getUILang()) {
    await setLanguage(appConfig.urlUiLang);
  }
  uiLangSel.value = getUILang();
  uiLangSel.addEventListener('change', async () => {
    await setLanguage(uiLangSel.value);
    updateGridForRTL();
  });

  await preloadDefaultStarters();
  const languages = getAllLanguages();
  if (!languages.length) {
    setStatus('Error: No languages loaded');
    return;
  }

  populateLanguageDropdown();
  runtime.currentLang = getLanguage(appConfig.urlLanguage) || languages[0];
  langSel.value = runtime.currentLang.id;
  runtime.currentVersion = populateVersionDropdown(runtime.currentLang, appConfig.urlVersion || undefined);
  configureMonacoForVersion(runtime.currentLang, runtime.currentVersion);

  runtime.storage = storage;
  createEditor();
  createTabManager({
    renderFileTree: () => { void renderFileTree(); },
    refreshSearchHighlights: highlightSearchMatchesInEditor,
  });

  // Initialize the workspace first so the editor, TabManager, active model,
  // language selector, version selector, and autosave handlers are ready before
  // feature modules register any editor-dependent listeners.
  setupStepUpIntegration();
  await initializeWorkspace();
  initializeGoToDefinition();
  initializeWebPreview();

  // Execution and run-panel handlers depend on the initialized editor. Load
  // them only after initializeWorkspace() has completed. Sidebar handlers are
  // already part of the statically imported layout/policy modules.
  await import('./features/execution');
  const { initializeRunPanel } = await import('./features/run-panel');
  initializeRunPanel();

  initializeLayout();
  setStatus('Ready ✅ (Ctrl+Enter to run)');
}

bootstrap().catch(error => {
  console.error('[IDE] Fatal initialization error:', error);
  setStatus('Initialization failed');
});
