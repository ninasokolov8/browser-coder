import * as monaco from 'monaco-editor';
import { initI18n, setLanguage, getLanguage as getUILang } from './i18n';
import { getAllLanguages, getLanguage, preloadDefaultStarters } from './languages';
import { setWorkspaceService, storage } from './storage';
import { createWorkspace } from './workspace';
import { createCommandRegistry } from './commands';
import { DiagnosticsStore } from './diagnostics/store';
import { connectMonacoDiagnostics } from './diagnostics/monaco-source';
import { connectRunMarkers } from './diagnostics/server-source';
import { initializeProblemsPanel, showPanelTab } from './features/problems-panel';
import { initializeCommandPalette } from './features/command-palette';
import { initializeQuickOpen } from './features/quick-open';
import { initializeBreadcrumbs } from './features/breadcrumbs';
import { appConfig, applyModeClasses } from './app/config';
import { runtime } from './app/runtime';
import { createEditor, createTabManager } from './features/editor-core';
import { renderFileTree } from './features/explorer';
import { highlightSearchMatchesInEditor } from './features/search';
import { initializeWorkspace } from './features/workspace-init';
import { initializeLayout } from './features/layout';
import { markWorkspaceReady, setupStepUpIntegration } from './integrations/stepup';
import { populateLanguageDropdown, populateVersionDropdown, configureMonacoForVersion } from './components/monaco-config';
import { uiLangSel, langSel } from './components/dom';
import { setStatus } from './components/output';
import { updateGridForRTL } from './features/ui-layout';
import { initializeGoToDefinition } from './features/go-to-definition';
import { initializeWebPreview } from './features/live-preview';
import { initializeFormatting } from './features/formatting';

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

  // One enforcement point for user actions. Created before any feature module
  // registers a command or binds a control (V-17).
  runtime.commands = createCommandRegistry();

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

  // Keep a model for every document a Monaco language service can analyse, opened
  // or not.
  //
  // A service only sees files that have models. For TypeScript that is what makes
  // an import of a file the user has not clicked on resolve, instead of reporting
  // "Cannot find module" for code the server compiles fine. For css, html and json
  // it is what puts their errors in the Problems panel project-wide rather than
  // only in the focused tab - the same rule, so the panel means the same thing
  // whatever the language.
  //
  // Re-run on every structural change, since a new or renamed file changes what
  // the others can resolve.
  const ANALYSED_IN_BROWSER = ['typescript', 'javascript', 'css', 'html', 'json'];
  const syncProjectModels = () => {
    try {
      workspace.models.ensureModelsFor(ANALYSED_IN_BROWSER);
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
  // Before the editor features load, so `Format document` is enabled correctly on
  // the very first document rather than after the first language switch.
  initializeFormatting();

  // Execution and run-panel handlers depend on the initialized editor. Load
  // them only after initializeWorkspace() has completed. Sidebar handlers are
  // already part of the statically imported layout/policy modules.
  // execution.ts was one 528-line module doing four unrelated jobs. It is now
  // three, and they are imported HERE, explicitly and in order, rather than
  // chaining imports between themselves.
  //
  // That order matters and is easy to break silently: `editor-commands` and
  // `editor-context-menu` register everything as a side effect of being imported -
  // there is no exported initialiser to call - and both read `runtime.editor` at
  // module scope. Importing either before `initializeWorkspace()` has run throws.
  await import('./features/execution');
  await import('./features/editor-commands');
  await import('./features/editor-context-menu');
  const { initializeRunPanel } = await import('./features/run-panel');
  initializeRunPanel();

  // Problems: one store, fed by Monaco's markers, read by the panel, the status
  // bar and the run gate - so those three cannot disagree about what is wrong.
  const diagnostics = new DiagnosticsStore();
  runtime.diagnostics = diagnostics;
  connectMonacoDiagnostics({
    store: diagnostics,
    models: workspace.models,
    service: workspace.service,
  });
  // Squiggles for compiler errors. Driven by the store rather than written at
  // publish time, so a stale result being discarded also clears its marker.
  connectRunMarkers({ store: diagnostics, models: workspace.models, service: workspace.service });

  initializeProblemsPanel(diagnostics);

  runtime.commands!.register({
    id: 'workspace.showProblems',
    title: 'command.showProblems',
    run: () => showPanelTab('problems'),
  });

  // The palette is the registry's list filtered by isEnabled. Registering it
  // last means every command exists by the time it can be opened.
  initializeCommandPalette(runtime.commands!);
  // Ctrl+P and the breadcrumb bar. Both are navigation aids that need the
  // workspace and the editor, so they go here rather than in workspace-init.
  initializeQuickOpen();
  initializeBreadcrumbs(runtime.editor!);

  initializeLayout();
  setStatus('Ready ✅ (Ctrl+Enter to run)');

  // Only now is it true. Host messages that arrived earlier were queued and are
  // released by this call; readiness is announced to the host from here too, so a
  // host that answers instantly cannot have its project discarded by the
  // initialization that used to follow the announcement.
  markWorkspaceReady();
}

bootstrap().catch(error => {
  console.error('[IDE] Fatal initialization error:', error);
  setStatus('Initialization failed');
});
