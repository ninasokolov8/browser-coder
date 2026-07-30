import * as monaco from 'monaco-editor';
import { initI18n, setLanguage, getLanguage as getUILang } from './i18n';
import { getAllLanguages, getLanguage, preloadDefaultStarters } from './languages';
import { setWorkspaceService, storage } from './storage';
import { createWorkspace } from './workspace';
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

  // The workspace is created before anything can touch it, and the database name
  // is decided here because it depends on the embedding mode. Embedded IDEs get an
  // isolated database so several Step-Up parts on one page cannot overwrite each
  // other's files, and it is deleted on unload.
  const databaseName = appConfig.isEmbedded
    ? `BrowserCoderDB-embed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    : 'BrowserCoderDB';

  if (appConfig.isEmbedded) {
    window.addEventListener('beforeunload', () => {
      try {
        indexedDB.deleteDatabase(databaseName);
      } catch {
        /* best effort - the browser may already be tearing the page down */
      }
    });
  }

  const workspace = createWorkspace({
    databaseName,
    languages: {
      monacoLanguageFor: (languageId: string) =>
        getLanguage(languageId)?.monacoLanguage || 'plaintext',
    },
  });

  runtime.workspace = workspace.service;
  runtime.models = workspace.models;
  runtime.storage = storage;
  setWorkspaceService(workspace.service);

  // Test seam, development builds only. The app-boot smoke test loads the real IDE
  // in an iframe and needs to ask whether the workspace actually opened - a
  // question the DOM cannot answer. Guarded by import.meta.env.DEV so it is
  // dead-code-eliminated from the production bundle rather than shipping an
  // internals handle to every page that embeds the IDE.
  if (import.meta.env.DEV) {
    const seam = window as unknown as { __bcRuntime: unknown; __bcMonaco: unknown };
    seam.__bcRuntime = runtime;
    // Monaco too: cross-file diagnostics can only be checked through
    // `getModelMarkers`, and the test page runs in a different module realm, so it
    // cannot reach the app's Monaco instance any other way.
    seam.__bcMonaco = monaco;
  }

  createEditor();
  createTabManager({
    renderFileTree: () => { void renderFileTree(); },
    refreshSearchHighlights: highlightSearchMatchesInEditor,
  });

  // Keep a model for every TypeScript and JavaScript document, opened or not.
  // Monaco's TS worker only sees files that have models, so without this an import
  // of a module the user has not clicked on reports "Cannot find module" even
  // though the server compiles the project fine. Re-run on every structural change,
  // since a new or renamed file changes what the others can resolve.
  const COMPILED_IN_BROWSER = ['typescript', 'javascript'];
  const syncProjectModels = () => {
    try {
      workspace.models.ensureModelsFor(COMPILED_IN_BROWSER);
    } catch (error) {
      console.error('[IDE] Could not synchronize project models:', error);
    }
  };
  workspace.service.onDidChangeWorkspace(syncProjectModels);

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
