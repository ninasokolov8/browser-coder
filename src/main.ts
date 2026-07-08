import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import JSZip from "jszip";
import { getAllLanguages, getLanguage, getKeywordExplanation, getStarterAsync, preloadDefaultStarters, preloadStarters } from "./languages";
import type { LoadedLanguage, VersionConfig } from "./languages";
import { TabManager, Tab } from "./tabs";
import { initI18n, setLanguage, t, getLanguage as getUILang, languages as uiLanguages } from "./i18n";

// ═══════════════════════════════════════════════════════════════════
// STEP-UP INTEGRATION - URL Parameters & PostMessage API
// ═══════════════════════════════════════════════════════════════════

// URL Parameter Parsing
const urlParams = new URLSearchParams(window.location.search);
const isEmbedded = urlParams.get('embed') === '1';
const rawMode = (urlParams.get('mode') || 'snippet').toLowerCase();
const ideMode = (rawMode === 'full' || rawMode === 'project') ? 'full' : 'snippet';
const noOutput = urlParams.get('nooutput') === '1';
const urlLanguage = urlParams.get('lang') || 'javascript';
const urlVersion = urlParams.get('version') || '';
const urlUiLang = urlParams.get('uilang') || 'en';

type IdePanel = 'explorer' | 'search' | 'run';

function normalizePanels(rawPanels: unknown, fallback: IdePanel[]): IdePanel[] {
  if (!Array.isArray(rawPanels)) return [...fallback];
  const allowed: IdePanel[] = ['explorer', 'search', 'run'];
  const unique = new Set<IdePanel>();
  for (const panel of rawPanels) {
    if (typeof panel === 'string' && allowed.includes(panel as IdePanel)) {
      unique.add(panel as IdePanel);
    }
  }
  return unique.size > 0 ? Array.from(unique) : [...fallback];
}

let currentReadonly = urlParams.get('readonly') === '1';
let currentLockStructure = currentReadonly;
let currentAllowRun = !currentReadonly && !noOutput;
let currentAllowSearchReplace = !currentReadonly;
let currentVisiblePanels: IdePanel[] = ideMode === 'full' ? ['explorer', 'search', 'run'] : [];

// Allowed origins for postMessage (Step-Up domains)
// Exact origin matches OR any subdomain of these base domains
const ALLOWED_ORIGINS: string[] = [
  'http://localhost:8000',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://localhost',
  'http://127.0.0.1:8000',
  'http://127.0.0.1:3000',
  'http://167.71.63.99',
  'https://stepup.school',
  'https://step-up.co.il',
  'https://www.stepup.school',
  'https://www.step-up.co.il',
  'https://staging.stepup.school',
  'https://stepup.zone',
  'https://dev.stepup.zone',
  'http://stepup.local',
  'https://arcacademy.co',
  'https://www.arcacademy.co',
];

// Base domains that allow any subdomain match
const ALLOWED_BASE_DOMAINS: string[] = [
  'stepup.school',
  'step-up.co.il',
  'stepup.zone',
  'arcacademy.co',
];

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  // Exact match
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) return true;
  // Subdomain match (e.g. https://app.stepup.school)
  try {
    const hostname = new URL(origin).hostname;
    for (const base of ALLOWED_BASE_DOMAINS) {
      if (hostname === base || hostname.endsWith('.' + base)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

// State for parent communication
let parentOrigin: string | null = null;

// Try to derive initial parent origin from document.referrer so the
// initial `ide:ready` handshake can be sent BEFORE parent posts to us.
function deriveInitialParentOrigin(): string | null {
  try {
    if (!document.referrer) return null;
    const ref = new URL(document.referrer);
    const refOrigin = ref.origin;
    if (isAllowedOrigin(refOrigin)) return refOrigin;
  } catch {
    /* ignore */
  }
  return null;
}

// Apply mode classes to body
function applyModeClasses(): void {
  // Remove existing mode classes
  document.body.classList.remove('mode-snippet', 'mode-project', 'mode-full', 'embedded', 'readonly', 'nooutput');
  
  // Apply mode
  document.body.classList.add(`mode-${ideMode}`);
  
  // Apply flags
  if (isEmbedded) document.body.classList.add('embedded');
  if (currentReadonly) document.body.classList.add('readonly');
  if (noOutput) document.body.classList.add('nooutput');
  
}

// Send message to parent window (Step-Up).
// Falls back to '*' for the initial `ide:ready` handshake when we don't yet
// know the parent's origin (Step-Up will validate origin on its side).
function sendToParent(type: string, data: Record<string, unknown> = {}): void {
  if (window.parent === window) return;
  const target = parentOrigin || '*';
  try {
    window.parent.postMessage({ type, ...data }, target);
  } catch (e) {
    console.warn('[IDE] postMessage failed:', e);
  }
}

// Notify parent that IDE is ready
function notifyParentReady(): void {
  sendToParent('ide:ready', { 
    mode: ideMode, 
    language: urlLanguage, 
    version: urlVersion,
    readonly: currentReadonly,
    embedded: isEmbedded,
  });
}

// Notify parent of code changes (snippet mode)
function notifyCodeChange(code: string): void {
  sendToParent('ide:code-change', { 
    code,
    language: urlLanguage,
    version: urlVersion,
  });
}

// Notify parent of run results
function notifyRunResult(result: { stdout: string; stderr: string; exitCode: number; durationMs: number }): void {
  sendToParent('ide:run-result', result);
}

// PostMessage handler for incoming messages from Step-Up
window.addEventListener('message', (event) => {
  // Security: Validate origin
  if (!isAllowedOrigin(event.origin)) {
    console.warn('[IDE] Blocked message from unauthorized origin:', event.origin);
    return;
  }
  
  // Store parent origin for responses (overrides referrer-derived value).
  // Never overwrite with the IDE's own origin — same-origin messages come
  // from Monaco's fallback worker and are not from the parent frame.
  if (event.origin !== window.location.origin) {
    parentOrigin = event.origin;
  }
  
  const { type, ...data } = event.data || {};
  if (!type || typeof type !== 'string') return;
  
  switch (type) {
    case 'stepup:init':
      // Initialize with code/files/output from Step-Up
      handleStepUpInit(data as { code?: string; output?: string; autoRun?: boolean; files?: Array<{ path: string; content: string; language?: string }>; readonly?: boolean; lockStructure?: boolean; allowRun?: boolean; panels?: string[]; allowSearchReplace?: boolean });
      break;
    case 'stepup:set-code':
      // Update editor content (snippet mode)
      handleSetCode(data as { code: string });
      break;
    case 'stepup:get-code':
      // Return current code (legacy single-file)
      handleGetCode();
      break;
    case 'stepup:set-files':
      // Replace files (project mode)
      handleSetFiles(data as { files: Array<{ path: string; content: string; language?: string }> });
      break;
    case 'stepup:get-files':
      // Return all files (project mode)
      handleGetFiles();
      break;
    case 'stepup:run':
      // Trigger code execution inside the IDE
      handleRun();
      break;
    case 'stepup:set-readonly':
      // Toggle readonly mode at runtime
      handleSetReadonly(data as { readonly: boolean; lockStructure?: boolean; allowRun?: boolean; panels?: string[]; allowSearchReplace?: boolean });
      break;
    case 'stepup:show-output':
      // CRITICAL for fill_blanks: parent computed output, just display it.
      // The IDE itself does NOT execute; Step-Up POSTs to /api/run and
      // streams the result here for the readonly view.
      handleShowOutput(data as { output?: string; stdout?: string; stderr?: string; exitCode?: number });
      break;
    case 'stepup:clear-output':
      // Clear the output panel
      handleClearOutput();
      break;
    default:
      console.warn('[IDE] Unknown message type:', type);
  }
});

// Handler placeholders - will be connected to editor in main()
let handleStepUpInit: (data: { code?: string; output?: string; autoRun?: boolean; files?: Array<{ path: string; content: string; language?: string }>; readonly?: boolean; lockStructure?: boolean; allowRun?: boolean; panels?: string[]; allowSearchReplace?: boolean }) => void | Promise<void> = () => {};
let handleSetCode: (data: { code: string }) => void = () => {};
let handleGetCode: () => void = () => {};
let handleSetFiles: (data: { files: Array<{ path: string; content: string; language?: string }> }) => void = () => {};
let handleGetFiles: () => void = () => {};
let handleRun: () => void = () => {};
let handleSetReadonly: (data: { readonly: boolean; lockStructure?: boolean; allowRun?: boolean; panels?: string[]; allowSearchReplace?: boolean }) => void = () => {};
let handleShowOutput: (data: { output?: string; stdout?: string; stderr?: string; exitCode?: number }) => void = () => {};
let handleClearOutput: () => void = () => {};
// Set once the editor is up: pushes a debounced full `ide:files` snapshot to
// the parent after structural workspace changes (create/rename/delete).
let notifyWorkspaceChanged: () => void = () => {};

// ═══════════════════════════════════════════════════════════════════
// END STEP-UP INTEGRATION
// ═══════════════════════════════════════════════════════════════════

// Configure Monaco workers for syntax highlighting and IntelliSense
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "typescript" || label === "javascript") {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

// DOM elements
const statusEl = document.getElementById("status")!;
const langSel = document.getElementById("lang") as HTMLSelectElement;
const versionSel = document.getElementById("version") as HTMLSelectElement;
const themeSel = document.getElementById("theme") as HTMLSelectElement;
const runBtn = document.getElementById("run") as HTMLButtonElement;
const downloadBtn = document.getElementById("download") as HTMLButtonElement;
const clearOutputBtn = document.getElementById("clearOutput") as HTMLButtonElement;
const togglePanelBtn = document.getElementById("togglePanel") as HTMLButtonElement;
const panelEl = document.getElementById("panel")!;
const panelContentEl = document.getElementById("panel-content")!;
const panelResizeEl = document.getElementById("panel-resize")!;
const tabsEl = document.getElementById("tabs")!;
const fileTreeEl = document.getElementById("file-tree")!;
const sidebarEl = document.getElementById("sidebar")!;
const statusLangEl = document.getElementById("status-lang")!;
const statusLineEl = document.getElementById("status-line")!;
const contextMenuEl = document.getElementById("context-menu")!;
const btnNewFile = document.getElementById("btn-new-file")!;
const btnNewFolder = document.getElementById("btn-new-folder")!;
const btnRefresh = document.getElementById("btn-refresh")!;
const btnDownloadProject = document.getElementById("btn-download-project")!;
const btnClearCache = document.getElementById("btn-clear-cache")!;
const editorEmptyState = document.getElementById("editor-empty-state")!;
const emptyStateNewFileBtn = document.getElementById("empty-state-new-file")!;
const uiLangSel = document.getElementById("ui-lang") as HTMLSelectElement;

// Search panel elements
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const replaceInput = document.getElementById("replace-input") as HTMLInputElement;
const searchResultsEl = document.getElementById("search-results")!;
const searchSummaryEl = document.getElementById("search-summary")!;
const searchCountEl = document.getElementById("search-count")!;
const btnRegex = document.getElementById("btn-regex")!;
const btnCase = document.getElementById("btn-case")!;
const btnWord = document.getElementById("btn-word")!;
const btnClearSearch = document.getElementById("btn-clear-search")!;
const btnReplaceAll = document.getElementById("btn-replace-all")!;
const btnReplaceAllFiles = document.getElementById("btn-replace-all-files")!;

// Sidebar panels
const sidebarPanels = document.querySelectorAll('.sidebar-panel');
const sidebarResizeEl = document.getElementById("sidebar-resize")!;

// Activity bar icons
const activityIcons = document.querySelectorAll('.activity-icon[data-panel]');

// ===== Settings Management (localStorage) =====
interface IDESettings {
  theme: string;
  sidebarVisible: boolean;
  sidebarPanel: string;
  sidebarWidth: number;
  panelHeight: number;
  panelCollapsed: boolean;
}

const DEFAULT_SETTINGS: IDESettings = {
  theme: 'vs-dark',
  sidebarVisible: true,
  sidebarPanel: 'explorer',
  sidebarWidth: 220,
  panelHeight: 200,
  panelCollapsed: false,
};

function loadSettings(): IDESettings {
  try {
    const saved = localStorage.getItem('browser-coder-settings');
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(): void {
  try {
    const settings: IDESettings = {
      theme: themeSel.value,
      sidebarVisible: !sidebarEl.classList.contains('collapsed'),
      sidebarPanel: (document.querySelector('.activity-icon.active') as HTMLElement)?.dataset.panel || 'explorer',
      sidebarWidth: sidebarEl.offsetWidth || 220,
      panelHeight: panelEl.offsetHeight,
      panelCollapsed: panelEl.classList.contains('collapsed'),
    };
    localStorage.setItem('browser-coder-settings', JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save settings:', e);
  }
}

// Utility functions
function setStatus(s: string) {
  statusEl.textContent = s;
}

function setOutput(text: string) {
  // Output is always raw program stdout/stderr/exit-code text - never
  // translated - so it must stay LTR even if the element previously held a
  // translated (and possibly RTL) placeholder via data-i18n.
  panelContentEl.dir = "ltr";
  panelContentEl.textContent = text || "";
  panelContentEl.scrollTop = panelContentEl.scrollHeight;
}

function appendOutput(text: string) {
  panelContentEl.dir = "ltr";
  panelContentEl.textContent += (panelContentEl.textContent ? "\n" : "") + text;
  panelContentEl.scrollTop = panelContentEl.scrollHeight;
}

// ===== Keyword help popup ("Explain this keyword") =====
let keywordPopupEl: HTMLDivElement | null = null;

function closeKeywordHelpPopup() {
  if (keywordPopupEl) {
    keywordPopupEl.remove();
    keywordPopupEl = null;
    document.removeEventListener("mousedown", onKeywordPopupOutsideClick, true);
    document.removeEventListener("keydown", onKeywordPopupEscape, true);
  }
}

function onKeywordPopupOutsideClick(e: MouseEvent) {
  if (keywordPopupEl && !keywordPopupEl.contains(e.target as Node)) {
    closeKeywordHelpPopup();
  }
}

function onKeywordPopupEscape(e: KeyboardEvent) {
  if (e.key === "Escape") closeKeywordHelpPopup();
}

// Formats a snake_case/underscore type tag (e.g. "control_flow") into a
// friendlier display label (e.g. "Control Flow") for the popup badge.
function formatKeywordTypeTag(type: string): string {
  return type
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function showKeywordHelpPopup(keyword: string, type: string | undefined, explanation: string, example: string, rtl: boolean, x: number, y: number) {
  closeKeywordHelpPopup();

  const popup = document.createElement("div");
  popup.className = "keyword-help-popup";

  const header = document.createElement("div");
  header.className = "kw-help-header";
  const titleGroup = document.createElement("span");
  titleGroup.className = "kw-help-title-group";
  const title = document.createElement("span");
  title.className = "kw-help-title";
  title.textContent = keyword;
  titleGroup.appendChild(title);
  if (type) {
    const tag = document.createElement("span");
    tag.className = "kw-help-tag";
    tag.textContent = formatKeywordTypeTag(type);
    titleGroup.appendChild(tag);
  }
  const closeBtn = document.createElement("button");
  closeBtn.className = "kw-help-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", closeKeywordHelpPopup);
  header.appendChild(titleGroup);
  header.appendChild(closeBtn);
  popup.appendChild(header);

  // Only the explanation text is ever translated (Hebrew), so only it gets
  // dir="rtl" - the keyword name, type tag, and example code always stay LTR.
  const desc = document.createElement("div");
  desc.className = "kw-help-desc";
  desc.textContent = explanation;
  if (rtl) {
    desc.dir = "rtl";
    desc.classList.add("kw-help-desc-rtl");
  }
  popup.appendChild(desc);

  const exampleLabel = document.createElement("div");
  exampleLabel.className = "kw-help-example-label";
  exampleLabel.textContent = t("editor.example") || "Example:";
  popup.appendChild(exampleLabel);

  const code = document.createElement("pre");
  code.className = "kw-help-code";
  code.textContent = example;
  popup.appendChild(code);

  document.body.appendChild(popup);

  // Position near the clicked word, then clamp so it never renders off-screen
  const rect = popup.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 12;
  const maxY = window.innerHeight - rect.height - 12;
  popup.style.left = `${Math.max(8, Math.min(x, Math.max(8, maxX)))}px`;
  popup.style.top = `${Math.max(8, Math.min(y, Math.max(8, maxY)))}px`;

  keywordPopupEl = popup;

  // Defer listener attachment so the same click/context-menu selection that
  // opened the popup doesn't immediately close it again.
  setTimeout(() => {
    document.addEventListener("mousedown", onKeywordPopupOutsideClick, true);
    document.addEventListener("keydown", onKeywordPopupEscape, true);
  }, 0);
}

// ===== Run loader (VSCode-style "busy" feedback) =====
let runLoaderTimer: number | null = null;
// Captured fresh in startRunLoader() (not once at page load) so it always
// reflects the button's current label - including after a UI language
// switch, which rewrites this HTML via translatePage().
let runBtnRestoreHTML = runBtn.innerHTML;

function startRunLoader() {
  runBtnRestoreHTML = runBtn.innerHTML;
  runBtn.disabled = true;
  runBtn.innerHTML = `<span class="btn-spinner"></span>${t("titlebar.running") || "Running"}`;

  let dots = 0;
  setOutput("Running");
  runLoaderTimer = window.setInterval(() => {
    dots = (dots + 1) % 4; // 0 -> 1 -> 2 -> 3 -> 0 (dots gone) -> ...
    panelContentEl.textContent = "Running" + ".".repeat(dots);
  }, 400);
}

function stopRunLoader() {
  if (runLoaderTimer !== null) {
    window.clearInterval(runLoaderTimer);
    runLoaderTimer = null;
  }
  runBtn.disabled = false;
  runBtn.innerHTML = runBtnRestoreHTML;
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Sidebar-width resize handling. Kept as a named function (not inlined at
// each call site) since the sidebar resize handler also needs to reapply it.
// NOTE: layout never mirrors for RTL/Hebrew - every element stays in the
// exact same position as English (product decision), so this always uses
// the same LTR column order regardless of UI language.
function updateGridForRTL() {
  // In embedded mode, grid is fully controlled by mode-specific CSS - never override
  if (isEmbedded) return;
  const appEl = document.getElementById("app")!;
  const sidebarWidth = sidebarEl.offsetWidth || 220;
  appEl.style.gridTemplateColumns = `48px ${sidebarWidth}px 1fr`;
}

// Monaco target mapping
const MONACO_TARGETS: Record<string, monaco.languages.typescript.ScriptTarget> = {
  ES5: monaco.languages.typescript.ScriptTarget.ES5,
  ES2015: monaco.languages.typescript.ScriptTarget.ES2015,
  ES2016: monaco.languages.typescript.ScriptTarget.ES2016,
  ES2017: monaco.languages.typescript.ScriptTarget.ES2017,
  ES2018: monaco.languages.typescript.ScriptTarget.ES2018,
  ES2019: monaco.languages.typescript.ScriptTarget.ES2019,
  ES2020: monaco.languages.typescript.ScriptTarget.ES2020,
  ES2021: monaco.languages.typescript.ScriptTarget.ES2020, // Fallback
  ES2022: monaco.languages.typescript.ScriptTarget.ESNext,
  ESNext: monaco.languages.typescript.ScriptTarget.ESNext,
};

// Configure Monaco for a specific language version
function configureMonacoForVersion(lang: LoadedLanguage, version: VersionConfig) {
  if (lang.id === "typescript" || lang.id === "javascript") {
    const targetStr = version.monacoTarget || "ES2022";
    const target = MONACO_TARGETS[targetStr] ?? monaco.languages.typescript.ScriptTarget.ESNext;
    const strict = version.strict ?? (lang.id === "typescript");

    if (lang.id === "typescript") {
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        allowNonTsExtensions: true,
        strict,
        noEmit: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        skipLibCheck: true,
        lib: ["ES2020", "DOM", "DOM.Iterable"],
      });
    } else {
      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        allowNonTsExtensions: true,
        allowJs: true,
        checkJs: true,
        noEmit: true,
      });
    }
  }
}

// Enable diagnostics
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
});

monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
});

// Populate language dropdown from loaded configs
function populateLanguageDropdown() {
  langSel.innerHTML = "";
  for (const lang of getAllLanguages()) {
    const opt = document.createElement("option");
    opt.value = lang.id;
    opt.textContent = lang.name;
    langSel.appendChild(opt);
  }
}

// Populate version dropdown for a language
function populateVersionDropdown(lang: LoadedLanguage, selectedVersionId?: string): VersionConfig {
  versionSel.innerHTML = "";
  let defaultVersion = lang.versions[0];

  for (const v of lang.versions) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.name;
    
    if (selectedVersionId && v.id === selectedVersionId) {
      opt.selected = true;
      defaultVersion = v;
    } else if (!selectedVersionId && v.default) {
      opt.selected = true;
      defaultVersion = v;
    }
    versionSel.appendChild(opt);
  }

  return defaultVersion;
}

// Apply theme to body class
function applyTheme(theme: string) {
  if (theme === "vs-dark") {
    document.body.classList.add("dark-theme");
  } else {
    document.body.classList.remove("dark-theme");
  }
  monaco.editor.setTheme(theme);
}

// Main application
(async function main() {
  setStatus("Loading languages…");

  // Apply mode classes immediately for CSS to take effect
  applyModeClasses();

  // Initialize i18n (UI languages: English, Hebrew, etc.)
  await initI18n();
  
  // Override UI language from URL param if provided
  if (urlUiLang && urlUiLang !== getUILang()) {
    await setLanguage(urlUiLang);
  }
  
  // Set UI language selector to current language
  uiLangSel.value = getUILang();
  
  // Handle UI language change
  uiLangSel.addEventListener('change', async () => {
    await setLanguage(uiLangSel.value);
    // Update grid template for RTL
    updateGridForRTL();
  });

  // Preload only default starters for fast initial load
  await preloadDefaultStarters();

  // Load languages and populate dropdowns
  const languages = getAllLanguages();
  if (languages.length === 0) {
    setStatus("Error: No languages loaded");
    return;
  }

  populateLanguageDropdown();

  // Initialize with the language requested in the URL (?lang=...) so embedded
  // snippet mode actually renders / IntelliSenses / validates the right language.
  // Falls back to the first registered language when the URL value is unknown.
  let currentLang = getLanguage(urlLanguage) || languages[0];
  langSel.value = currentLang.id;
  let currentVersion = populateVersionDropdown(currentLang, urlVersion || undefined);
  configureMonacoForVersion(currentLang, currentVersion);

  // Model management for tabs
  const fileModels = new Map<string, monaco.editor.ITextModel>();
  let modelCounter = 0;

  // Create or get model for a tab
  function getOrCreateModel(tab: Tab): monaco.editor.ITextModel {
    let model = fileModels.get(tab.file.id);
    if (model && !model.isDisposed()) {
      return model;
    }

    const lang = getLanguage(tab.file.language);
    const monacoLang = lang?.monacoLanguage || "plaintext";
    const ext = lang?.extension || "txt";
    
    modelCounter++;
    const uri = monaco.Uri.parse(`file:///${tab.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}_${modelCounter}.${ext}`);
    
    model = monaco.editor.createModel(tab.file.content, monacoLang, uri);
    fileModels.set(tab.file.id, model);
    
    return model;
  }

  // Dispose model for a tab
  function disposeModel(fileId: string) {
    const model = fileModels.get(fileId);
    if (model && !model.isDisposed()) {
      model.dispose();
    }
    fileModels.delete(fileId);
  }

  // Create editor
  const editor = monaco.editor.create(document.getElementById("editor")!, {
    theme: "vs-dark",
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
    fontLigatures: true,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: "on",
    lineNumbers: "on",
    renderWhitespace: "selection",
    bracketPairColorization: { enabled: true },
    autoClosingBrackets: "always",
    autoClosingQuotes: "always",
    formatOnPaste: true,
    formatOnType: true,
    suggestOnTriggerCharacters: true,
    quickSuggestions: {
      other: true,
      comments: false,
      strings: true,
    },
    acceptSuggestionOnEnter: "on",
    parameterHints: { enabled: true },
    hover: { enabled: true, delay: 300 },
    folding: true,
    foldingHighlight: true,
    showFoldingControls: "mouseover",
    matchBrackets: "always",
    cursorBlinking: "smooth",
    cursorSmoothCaretAnimation: "on",
    // Step-Up integration: runtime policy state
    readOnly: currentReadonly,
    smoothScrolling: true,
    contextmenu: !currentLockStructure,
    mouseWheelZoom: true,
    scrollBeyondLastLine: false,
    padding: { top: 10 },
    find: {
      addExtraSpaceOnTop: false,
      autoFindInSelection: "multiline",
      seedSearchStringFromSelection: "always",
    },
    suggest: {
      showMethods: true,
      showFunctions: true,
      showConstructors: true,
      showFields: true,
      showVariables: true,
      showClasses: true,
      showStructs: true,
      showInterfaces: true,
      showModules: true,
      showProperties: true,
      showEvents: true,
      showOperators: true,
      showUnits: true,
      showValues: true,
      showConstants: true,
      showEnums: true,
      showEnumMembers: true,
      showKeywords: true,
      showWords: true,
      showColors: true,
      showFiles: true,
      showReferences: true,
      showFolders: true,
      showTypeParameters: true,
      showSnippets: true,
    },
  });

  // Initialize Tab Manager
  const tabManager = new TabManager(tabsEl, {
    onTabSwitch: (tab: Tab) => {
      // Update editor model
      const model = getOrCreateModel(tab);
      editor.setModel(model);

      // Update language/version selectors
      const lang = getLanguage(tab.file.language);
      if (lang) {
        currentLang = lang;
        langSel.value = lang.id;
        currentVersion = populateVersionDropdown(lang, tab.file.version);
        configureMonacoForVersion(lang, currentVersion);
        statusLangEl.textContent = lang.name;
      }

      setStatus(`${tab.file.name}`);
      setOutput("");
      renderFileTree(tabManager);
      
      // Refresh search highlights after tab switch (deferred since function defined later)
      setTimeout(() => {
        if (typeof (window as any).__refreshSearchHighlights === 'function') {
          (window as any).__refreshSearchHighlights();
        }
      }, 50);
    },

    onTabCreate: async (tab: Tab | null) => {
      if (tab === null) {
        // "+" button clicked - create new file with current language
        const newTab = await tabManager.createNewFile(currentLang, currentVersion);
        if (newTab) {
          const model = getOrCreateModel(newTab);
          editor.setModel(model);
          setStatus(`Created ${newTab.file.name}`);
        }
      }
      renderFileTree(tabManager);
    },

    onTabClose: (tab: Tab) => {
      disposeModel(tab.file.id);
      
      // If no tabs left, show empty state
      if (tabManager.getTabCount() === 0) {
        updateEmptyState(true);
        editor.setModel(null);
      }
      renderFileTree(tabManager);
    },

    onTabUpdate: (tab: Tab) => {
      // Tab was renamed or saved
      const activeTab = tabManager.getActiveTab();
      if (activeTab && activeTab.file.id === tab.file.id) {
        setStatus(`${tab.file.name}${tab.isDirty ? ' •' : ''}`);
      }
      // Keep Monaco model + toolbar in sync if a rename changed the language
      applyFileLanguage(tab.file.id);
      renderFileTree(tabManager);
      notifyWorkspaceChanged();
    },

    onTabsChange: (tabs: Tab[]) => {
      updateEmptyState(tabs.length === 0);
      renderFileTree(tabManager);
    },
  });

  // ===== Empty State Management =====
  function updateEmptyState(show: boolean) {
    if (show) {
      editorEmptyState.classList.add('visible');
    } else {
      editorEmptyState.classList.remove('visible');
    }
  }

  // Empty state "New File" button handler
  emptyStateNewFileBtn.addEventListener('click', async () => {
    if (currentLockStructure) return;
    const newTab = await tabManager.createNewFile(currentLang, currentVersion);
    if (newTab) {
      const model = getOrCreateModel(newTab);
      editor.setModel(model);
      setStatus(`Created ${newTab.file.name}`);
      updateEmptyState(false);
    }
  });

  // ===== File Explorer State =====
  let expandedFolders = new Set<string>();
  let selectedItemId: string | null = null;
  let selectedItemType: 'file' | 'folder' | null = null;
  let renamingItemId: string | null = null;
  // Multi-select (VS Code-style: Ctrl/Cmd toggle, Shift range) + drag-and-drop
  let selectedIds = new Set<string>();
  let lastClickedId: string | null = null;
  let draggingIds: string[] = [];
  // Flattened order of currently visible tree nodes, for Shift-range selection
  let visibleNodeOrder: string[] = [];

  // Import storage for folder operations
  const { storage } = await import('./storage');

  // Sync Monaco model + toolbar/status bar with a file's language.
  // Called after renames that change the extension (main.js -> main.php).
  function applyFileLanguage(fileId: string): void {
    const tab = tabManager.getTab(fileId);
    if (!tab) return;
    const lang = getLanguage(tab.file.language);
    if (!lang) return;

    const model = fileModels.get(fileId);
    if (model && !model.isDisposed() && model.getLanguageId() !== lang.monacoLanguage) {
      monaco.editor.setModelLanguage(model, lang.monacoLanguage);
    }

    const activeTab = tabManager.getActiveTab();
    if (activeTab && activeTab.file.id === fileId) {
      currentLang = lang;
      langSel.value = lang.id;
      currentVersion = populateVersionDropdown(lang, tab.file.version);
      configureMonacoForVersion(lang, currentVersion);
      statusLangEl.textContent = lang.name;
    }
  }

  // ===== File Explorer Rendering =====
  async function renderFileTree(tm: TabManager) {
    const tabs = tm.getAllTabs();
    const activeTab = tm.getActiveTab();
    const folders = await storage.getAllFolders();
    const files = await storage.getAllFiles();

    // Build tree structure
    interface TreeNode {
      id: string;
      name: string;
      type: 'file' | 'folder';
      parentId: string | null;
      language?: string;
      children?: TreeNode[];
      tab?: typeof tabs[0];
      folder?: typeof folders[0];
    }

    const folderMap = new Map<string, TreeNode>();
    const rootNodes: TreeNode[] = [];

    // Create folder nodes
    for (const folder of folders) {
      folderMap.set(folder.id, {
        id: folder.id,
        name: folder.name,
        type: 'folder',
        parentId: folder.parentId,
        folder,
        children: [],
      });
    }

    // Assign folder children
    for (const folder of folders) {
      const node = folderMap.get(folder.id)!;
      if (folder.parentId && folderMap.has(folder.parentId)) {
        folderMap.get(folder.parentId)!.children!.push(node);
      } else {
        rootNodes.push(node);
      }
    }

    // Create file nodes and assign to folders or root
    for (const file of files) {
      const tab = tabs.find(t => t.file.id === file.id);
      const fileNode: TreeNode = {
        id: file.id,
        name: file.name,
        type: 'file',
        parentId: file.parentId,
        language: file.language,
        tab,
      };

      if (file.parentId && folderMap.has(file.parentId)) {
        folderMap.get(file.parentId)!.children!.push(fileNode);
      } else {
        rootNodes.push(fileNode);
      }
    }

    // Sort: folders first, then files, both alphabetically
    const sortNodes = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const node of nodes) {
        if (node.children) sortNodes(node.children);
      }
    };
    sortNodes(rootNodes);

    // Render HTML
    function renderNode(node: TreeNode, depth: number = 0): string {
      const indent = depth * 12;
      const isActive = node.type === 'file' && activeTab?.file.id === node.id;
      const isExpanded = node.type === 'folder' && expandedFolders.has(node.id);
      const isDirty = node.tab?.isDirty;
      const isRenaming = renamingItemId === node.id;
      const isSelected = selectedIds.has(node.id);

      // Track visible order for Shift-range selection
      visibleNodeOrder.push(node.id);

      if (node.type === 'folder') {
        const childrenHtml = isExpanded && node.children
          ? node.children.map(c => renderNode(c, depth + 1)).join('')
          : '';
        
        return `
          <div class="tree-item${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}" 
               draggable="true"
               data-id="${node.id}" data-type="folder" data-parent="${node.parentId ?? ''}"
               style="padding-left: ${8 + indent}px">
            <span class="tree-item-chevron ${isExpanded ? 'expanded' : ''}">▶</span>
            <span class="tree-item-icon">📁</span>
            ${isRenaming 
              ? `<input class="tree-item-input" type="text" value="${node.name}" data-id="${node.id}" data-type="folder">`
              : `<span class="tree-item-name">${node.name}</span>`
            }
          </div>
          ${isExpanded ? `<div class="tree-children">${childrenHtml}</div>` : ''}
        `;
      } else {
        // Icon reflects the file's own language, whether or not a tab is open
        const lang = getLanguage(node.tab?.file.language || node.language || '');
        const icon = lang?.icon || '📄';
        
        return `
          <div class="tree-item${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}" 
               draggable="true"
               data-id="${node.id}" data-type="file" data-parent="${node.parentId ?? ''}"
               style="padding-left: ${8 + indent + 16}px">
            <span class="tree-item-icon">${icon}</span>
            ${isRenaming 
              ? `<input class="tree-item-input" type="text" value="${node.name}" data-id="${node.id}" data-type="file">`
              : `<span class="tree-item-name">${node.name}</span>`
            }
            ${isDirty ? '<span class="tree-item-badge">M</span>' : ''}
          </div>
        `;
      }
    }

    if (rootNodes.length === 0) {
      visibleNodeOrder = [];
      fileTreeEl.innerHTML = '<div class="tree-empty">No files yet. Click + to create one.</div>';
    } else {
      visibleNodeOrder = [];
      fileTreeEl.innerHTML = rootNodes.map(n => renderNode(n)).join('');
    }

    // Attach event handlers
    attachTreeEventHandlers(tm);
  }

  function attachTreeEventHandlers(tm: TabManager) {
    // Click handlers
    fileTreeEl.querySelectorAll('.tree-item').forEach(el => {
      const itemEl = el as HTMLElement;
      const id = itemEl.dataset.id!;
      const type = itemEl.dataset.type as 'file' | 'folder';

      // Single click - select / open file / toggle folder.
      // Ctrl/Cmd toggles a file in the multi-selection; Shift selects a range.
      itemEl.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('tree-item-input')) return;

        selectedItemId = id;
        selectedItemType = type;

        // Ctrl/Cmd-click: toggle this item in the selection set
        if (e.ctrlKey || e.metaKey) {
          if (selectedIds.has(id)) selectedIds.delete(id);
          else selectedIds.add(id);
          lastClickedId = id;
          renderFileTree(tm);
          return;
        }

        // Shift-click: select the visible range between last click and this one
        if (e.shiftKey && lastClickedId) {
          const start = visibleNodeOrder.indexOf(lastClickedId);
          const end = visibleNodeOrder.indexOf(id);
          if (start !== -1 && end !== -1) {
            const [lo, hi] = start < end ? [start, end] : [end, start];
            selectedIds = new Set(visibleNodeOrder.slice(lo, hi + 1));
            renderFileTree(tm);
            return;
          }
        }

        // Plain click: single selection + open/toggle
        selectedIds = new Set([id]);
        lastClickedId = id;

        if (type === 'file') {
          tm.switchToTab(id);
        } else {
          // Toggle folder expansion
          if (expandedFolders.has(id)) {
            expandedFolders.delete(id);
          } else {
            expandedFolders.add(id);
          }
          renderFileTree(tm);
        }
      });

      // Right-click - context menu
      itemEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (currentLockStructure) return;
        selectedItemId = id;
        selectedItemType = type;
        // Keep an existing multi-selection if the right-clicked item is part of
        // it; otherwise reset selection to just this item.
        if (!selectedIds.has(id)) {
          selectedIds = new Set([id]);
          renderFileTree(tm);
        }
        showContextMenu(e.clientX, e.clientY, type);
      });

      // ===== Drag and drop (VS Code-style file management) =====
      itemEl.addEventListener('dragstart', (e) => {
        if (currentLockStructure) { e.preventDefault(); return; }
        // Drag the whole selection when the grabbed item is part of it,
        // otherwise drag just this item (and make it the selection).
        if (!selectedIds.has(id)) {
          selectedIds = new Set([id]);
          renderFileTree(tm);
        }
        draggingIds = Array.from(selectedIds);
        e.dataTransfer?.setData('text/plain', draggingIds.join(','));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        itemEl.classList.add('dragging');
      });

      itemEl.addEventListener('dragend', () => {
        draggingIds = [];
        clearDropHighlights();
        itemEl.classList.remove('dragging');
      });

      // Every item is a drop target:
      //  - drop on a FOLDER  -> move into that folder
      //  - drop on a FILE    -> move into that file's parent (VS Code behaviour),
      //                         so dropping on a root-level file lands in root
      itemEl.addEventListener('dragover', (e) => {
        if (draggingIds.length === 0) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        clearDropHighlights();
        if (type === 'folder') {
          itemEl.classList.add('drop-target');
        } else {
          // Highlight the destination: parent folder, or the whole root zone
          const parentId = itemEl.dataset.parent || '';
          if (parentId) {
            const parentEl = fileTreeEl.querySelector(`.tree-item[data-id="${parentId}"]`);
            parentEl?.classList.add('drop-target');
          } else {
            fileTreeEl.classList.add('root-drop-target');
          }
        }
      });
      itemEl.addEventListener('dragleave', () => {
        itemEl.classList.remove('drop-target');
      });
      itemEl.addEventListener('drop', async (e) => {
        if (draggingIds.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        clearDropHighlights();
        if (type === 'folder') {
          await moveItemsInto(id);
        } else {
          const parentId = itemEl.dataset.parent || null;
          await moveItemsInto(parentId);
        }
      });
    });

    // Handle rename input
    const renameInput = fileTreeEl.querySelector('.tree-item-input') as HTMLInputElement;
    if (renameInput) {
      renameInput.focus();
      renameInput.select();

      const commitRename = async () => {
        const newName = renameInput.value.trim();
        const id = renameInput.dataset.id!;
        const type = renameInput.dataset.type as 'file' | 'folder';

        if (newName) {
          if (type === 'folder') {
            await storage.updateFolder(id, { name: newName });
          } else {
            // Re-detect language from the new extension (e.g. "main.php")
            const detected = tabManager.detectLanguageByExtension(newName);
            const langUpdates = detected
              ? {
                  language: detected.id,
                  version: (detected.versions.find(v => v.default) || detected.versions[0]).id,
                }
              : {};
            await storage.updateFile(id, { name: newName, ...langUpdates });
            // Update tab if open
            const tab = tm.getTab(id);
            if (tab) {
              tab.file.name = newName;
              if (detected) {
                tab.file.language = detected.id;
                tab.file.version = (detected.versions.find(v => v.default) || detected.versions[0]).id;
              }
              applyFileLanguage(id);
            }
          }
          notifyWorkspaceChanged();
        }
        renamingItemId = null;
        renderFileTree(tm);
      };

      renameInput.addEventListener('blur', commitRename);
      renameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          commitRename();
        } else if (e.key === 'Escape') {
          renamingItemId = null;
          renderFileTree(tm);
        }
      });
    }
  }

  // ===== Context Menu =====
  function showContextMenu(x: number, y: number, type: 'file' | 'folder') {
    if (currentLockStructure) return;
    contextMenuEl.style.left = `${x}px`;
    contextMenuEl.style.top = `${y}px`;
    contextMenuEl.classList.remove('hidden');

    // Adjust position if off-screen
    const rect = contextMenuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      contextMenuEl.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      contextMenuEl.style.top = `${y - rect.height}px`;
    }
  }

  function hideContextMenu() {
    contextMenuEl.classList.add('hidden');
  }

  // Close context menu on click outside
  document.addEventListener('click', hideContextMenu);
  document.addEventListener('contextmenu', (e) => {
    if (!contextMenuEl.contains(e.target as Node) && !fileTreeEl.contains(e.target as Node)) {
      hideContextMenu();
    }
  });

  // Context menu actions
  contextMenuEl.querySelectorAll('.context-menu-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = (item as HTMLElement).dataset.action;
      hideContextMenu();

      switch (action) {
        case 'new-file':
          await createNewFileInExplorer(selectedItemType === 'folder' ? selectedItemId : null);
          break;
        case 'new-folder':
          await createNewFolder(selectedItemType === 'folder' ? selectedItemId : null);
          break;
        case 'rename':
          if (selectedItemId) {
            renamingItemId = selectedItemId;
            renderFileTree(tabManager);
          }
          break;
        case 'delete':
          if (selectedItemId && selectedItemType) {
            await deleteItem(selectedItemId, selectedItemType);
          }
          break;
      }
    });
  });

  // ===== File/Folder Operations =====
  async function createNewFileInExplorer(parentId: string | null) {
    if (currentLockStructure) return;
    // Create with empty file by default when user manually creates a file (not loading from storage)
    const newTab = await tabManager.createNewFile(currentLang, currentVersion, undefined, parentId, true);
    if (newTab) {
      const model = getOrCreateModel(newTab);
      editor.setModel(model);
      updateEmptyState(false);
      // Start renaming immediately
      renamingItemId = newTab.file.id;
      if (parentId) expandedFolders.add(parentId);
      renderFileTree(tabManager);
      notifyWorkspaceChanged();
    }
  }

  async function createNewFolder(parentId: string | null) {
    if (currentLockStructure) return;
    const folder = await storage.createFolder({ name: 'New Folder', parentId });
    if (parentId) expandedFolders.add(parentId);
    expandedFolders.add(folder.id);
    renamingItemId = folder.id;
    renderFileTree(tabManager);
    notifyWorkspaceChanged();
  }

  async function deleteItem(id: string, type: 'file' | 'folder') {
    if (currentLockStructure) return;
    const confirmed = confirm(`Are you sure you want to delete this ${type}?`);
    if (!confirmed) return;

    if (type === 'folder') {
      await storage.deleteFolder(id);
      expandedFolders.delete(id);
    } else {
      // Close tab if open
      const tab = tabManager.getTab(id);
      if (tab) {
        await tabManager.closeTab(id);
      }
      await storage.deleteFile(id);
    }
    renderFileTree(tabManager);
    notifyWorkspaceChanged();
  }

  // ===== Sidebar Toolbar Buttons =====
  btnNewFile.addEventListener('click', () => {
    if (currentLockStructure) return;
    createNewFileInExplorer(null);
  });
  btnNewFolder.addEventListener('click', () => {
    if (currentLockStructure) return;
    createNewFolder(null);
  });
  btnRefresh.addEventListener('click', () => renderFileTree(tabManager));

  // Clear Cache - clears ALL user data (files, folders, settings, localStorage)
  btnClearCache.addEventListener('click', async () => {
    const confirmed = confirm('Are you sure you want to clear ALL cached data? This will reset the app to its initial state and cannot be undone.');
    if (!confirmed) return;

    try {
      // Clear IndexedDB storage
      await storage.clearAll();
      
      // Clear localStorage settings
      localStorage.removeItem('browser-coder-settings');
      
      // Clear all Monaco models
      tabManager.getAllTabs().forEach(tab => {
        disposeModel(tab.file.id);
      });
      
      // Close all tabs
      tabManager.closeAllTabs();
      
      // Clear editor
      editor.setModel(null);
      
      // Show empty state
      updateEmptyState(true);
      
      // Clear UI
      renderFileTree(tabManager);
      setOutput('All cache cleared successfully. App reset to initial state.');
      setStatus('Ready');
    } catch (e) {
      setOutput(`Error clearing cache: ${e}`);
      setStatus('Error ❌');
    }
  });

  // Download Project - downloads all files as a proper ZIP
  btnDownloadProject.addEventListener('click', async () => {
    try {
      setStatus('Preparing ZIP...');
      setOutput('Creating ZIP file...');
      
      const files = await storage.getAllFiles();
      const folders = await storage.getAllFolders();
      
      if (files.length === 0) {
        setOutput('No files to download');
        setStatus('No files');
        return;
      }

      const zip = new JSZip();

      // Create folder structure in ZIP
      for (const folder of folders) {
        // Remove leading slash for ZIP paths
        const zipPath = folder.path.startsWith('/') ? folder.path.slice(1) : folder.path;
        zip.folder(zipPath);
      }

      // Add all files to ZIP
      for (const file of files) {
        // Remove leading slash for ZIP paths
        const zipPath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
        zip.file(zipPath, file.content);
      }

      // Generate ZIP blob
      const zipBlob = await zip.generateAsync({ 
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      // Download the ZIP
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-${new Date().toISOString().slice(0,10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setOutput(`Downloaded ${files.length} files in ${folders.length} folders as ZIP`);
      setStatus('Downloaded ✅');
    } catch (e) {
      setOutput(`Error downloading project: ${e}`);
      setStatus('Error ❌');
    }
  });

  // Right-click on empty area of file tree
  fileTreeEl.addEventListener('contextmenu', (e) => {
    if (currentLockStructure) return;
    if (e.target === fileTreeEl) {
      e.preventDefault();
      selectedItemId = null;
      selectedItemType = null;
      showContextMenu(e.clientX, e.clientY, 'folder');
    }
  });

  // Dropping onto empty explorer space moves items to the workspace root.
  fileTreeEl.addEventListener('dragover', (e) => {
    if (draggingIds.length === 0) return;
    // Only treat blank area / the container itself as a root drop target
    const overItem = (e.target as HTMLElement).closest('.tree-item');
    if (!overItem) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      clearDropHighlights();
      fileTreeEl.classList.add('root-drop-target');
    }
  });
  fileTreeEl.addEventListener('dragleave', (e) => {
    if (e.target === fileTreeEl) fileTreeEl.classList.remove('root-drop-target');
  });
  fileTreeEl.addEventListener('drop', async (e) => {
    const overItem = (e.target as HTMLElement).closest('.tree-item');
    fileTreeEl.classList.remove('root-drop-target');
    if (draggingIds.length === 0 || overItem) return; // item drops handled per-folder
    e.preventDefault();
    await moveItemsInto(null);
  });

  // Clear every drop-target visual state (folders + root zone)
  function clearDropHighlights() {
    fileTreeEl.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
    fileTreeEl.classList.remove('root-drop-target');
  }

  // Move the current drag selection into a target folder (or root when null).
  // Skips no-op moves and invalid folder-into-descendant moves (storage guards).
  async function moveItemsInto(targetFolderId: string | null) {
    if (currentLockStructure) return;
    const ids = [...draggingIds];
    draggingIds = [];
    if (ids.length === 0) return;

    let movedAny = false;
    for (const id of ids) {
      // Don't drop a folder onto itself
      if (id === targetFolderId) continue;
      const folder = await storage.getFolder(id);
      if (folder) {
        const res = await storage.moveFolder(id, targetFolderId);
        if (res) movedAny = true;
      } else {
        const res = await storage.moveFile(id, targetFolderId);
        if (res) movedAny = true;
        // Keep any open tab's cached path/name in sync
        const tab = tabManager.getTab(id);
        if (tab && res) tab.file = res;
      }
    }

    if (movedAny) {
      if (targetFolderId) expandedFolders.add(targetFolderId);
      renderFileTree(tabManager);
      notifyWorkspaceChanged();
    }
  }

  // ===== SEARCH FUNCTIONALITY =====
  interface SearchMatch {
    fileId: string;
    fileName: string;
    language: string;
    line: number;
    column: number;
    text: string;
    matchStart: number;
    matchEnd: number;
  }

  interface SearchResult {
    fileId: string;
    fileName: string;
    language: string;
    matches: SearchMatch[];
  }

  let searchOptions = {
    regex: false,
    caseSensitive: false,
    wholeWord: false,
  };

  let currentSearchResults: SearchResult[] = [];
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let searchDecorations: string[] = [];  // Monaco decoration IDs for highlighting

  // Function to highlight search matches in current editor
  function highlightSearchMatchesInEditor() {
    const activeTab = tabManager.getActiveTab();
    if (!activeTab || !searchInput.value) {
      searchDecorations = editor.deltaDecorations(searchDecorations, []);
      return;
    }

    const fileResult = currentSearchResults.find(r => r.fileId === activeTab.file.id);
    if (!fileResult || fileResult.matches.length === 0) {
      searchDecorations = editor.deltaDecorations(searchDecorations, []);
      return;
    }

    const newDecorations: monaco.editor.IModelDeltaDecoration[] = fileResult.matches.map(match => ({
      range: new monaco.Range(match.line, match.column, match.line, match.column + (match.matchEnd - match.matchStart)),
      options: {
        className: 'search-highlight-match',
        overviewRuler: {
          color: '#ffc800',
          position: monaco.editor.OverviewRulerLane.Center,
        },
      },
    }));
  
  // Register globally for tab switch callback
  (window as any).__refreshSearchHighlights = highlightSearchMatchesInEditor;

    searchDecorations = editor.deltaDecorations(searchDecorations, newDecorations);
  }

  // Toggle search option buttons
  btnRegex.addEventListener('click', () => {
    searchOptions.regex = !searchOptions.regex;
    btnRegex.classList.toggle('active', searchOptions.regex);
    performSearch();
  });

  btnCase.addEventListener('click', () => {
    searchOptions.caseSensitive = !searchOptions.caseSensitive;
    btnCase.classList.toggle('active', searchOptions.caseSensitive);
    performSearch();
  });

  btnWord.addEventListener('click', () => {
    searchOptions.wholeWord = !searchOptions.wholeWord;
    btnWord.classList.toggle('active', searchOptions.wholeWord);
    performSearch();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    replaceInput.value = '';
    currentSearchResults = [];
    renderSearchResults();
    highlightSearchMatchesInEditor();  // Clear highlights
  });

  // Replace all in current file (small button next to replace input)
  btnReplaceAll.addEventListener('click', async () => {
    if (!currentAllowSearchReplace) return;
    const activeTab = tabManager.getActiveTab();
    if (!activeTab || !searchInput.value) return;

    const file = activeTab.file;
    let searchPattern: RegExp;
    try {
      if (searchOptions.regex) {
        const flags = searchOptions.caseSensitive ? 'g' : 'gi';
        searchPattern = new RegExp(searchInput.value, flags);
      } else {
        let escapedQuery = searchInput.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (searchOptions.wholeWord) {
          escapedQuery = `\\b${escapedQuery}\\b`;
        }
        const flags = searchOptions.caseSensitive ? 'g' : 'gi';
        searchPattern = new RegExp(escapedQuery, flags);
      }
    } catch (e) {
      return;
    }

    const newContent = file.content.replace(searchPattern, replaceInput.value);
    const matchCount = (file.content.match(searchPattern) || []).length;
    
    if (matchCount === 0) {
      setOutput('No matches to replace in current file');
      return;
    }

    await storage.updateFile(file.id, { content: newContent });
    file.content = newContent;
    
    const model = editor.getModel();
    if (model) {
      model.setValue(newContent);
    }

    performSearch();
    setOutput(`Replaced ${matchCount} occurrence${matchCount !== 1 ? 's' : ''} in ${file.name}`);
  });

  // Debounced search on input
  searchInput.addEventListener('input', () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(performSearch, 200);
  });

  async function performSearch() {
    const query = searchInput.value;
    
    if (!query || query.length < 1) {
      currentSearchResults = [];
      searchSummaryEl.classList.add('hidden');
      searchResultsEl.innerHTML = '<div class="search-no-results">Type to search across all files</div>';
      return;
    }

    const files = await storage.getAllFiles();
    currentSearchResults = [];

    for (const file of files) {
      const matches = searchInFile(file.content, query, file.id, file.name, file.language);
      if (matches.length > 0) {
        currentSearchResults.push({
          fileId: file.id,
          fileName: file.name,
          language: file.language,
          matches,
        });
      }
    }

    renderSearchResults();
    highlightSearchMatchesInEditor();
  }

  function searchInFile(content: string, query: string, fileId: string, fileName: string, language: string): SearchMatch[] {
    const matches: SearchMatch[] = [];
    const lines = content.split('\n');
    
    let searchPattern: RegExp;
    try {
      if (searchOptions.regex) {
        const flags = searchOptions.caseSensitive ? 'g' : 'gi';
        searchPattern = new RegExp(query, flags);
      } else {
        let escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (searchOptions.wholeWord) {
          escapedQuery = `\\b${escapedQuery}\\b`;
        }
        const flags = searchOptions.caseSensitive ? 'g' : 'gi';
        searchPattern = new RegExp(escapedQuery, flags);
      }
    } catch (e) {
      // Invalid regex, return empty
      return matches;
    }

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      let match: RegExpExecArray | null;
      
      // Reset regex lastIndex
      searchPattern.lastIndex = 0;
      
      while ((match = searchPattern.exec(line)) !== null) {
        matches.push({
          fileId,
          fileName,
          language,
          line: lineNum + 1,
          column: match.index + 1,
          text: line,
          matchStart: match.index,
          matchEnd: match.index + match[0].length,
        });
        
        // Prevent infinite loop for zero-length matches
        if (match[0].length === 0) {
          searchPattern.lastIndex++;
        }
      }
    }

    return matches;
  }

  function renderSearchResults() {
    if (currentSearchResults.length === 0) {
      if (searchInput.value) {
        searchSummaryEl.classList.add('hidden');
        searchResultsEl.innerHTML = '<div class="search-no-results">No results found</div>';
      }
      return;
    }

    // Calculate totals
    const totalMatches = currentSearchResults.reduce((sum, r) => sum + r.matches.length, 0);
    const totalFiles = currentSearchResults.length;
    
    searchCountEl.textContent = `${totalMatches} result${totalMatches !== 1 ? 's' : ''} in ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`;
    searchSummaryEl.classList.remove('hidden');

    // Render file results
    let html = '';
    for (const result of currentSearchResults) {
      const lang = getLanguage(result.language);
      const icon = lang?.icon || '📄';
      
      html += `
        <div class="search-file" data-file-id="${result.fileId}">
          <span class="search-file-icon">${icon}</span>
          <span class="search-file-name">${escapeHtml(result.fileName)}</span>
          <span class="search-file-count">${result.matches.length}</span>
        </div>
      `;

      for (const match of result.matches) {
        const beforeMatch = match.text.substring(0, match.matchStart);
        const matchText = match.text.substring(match.matchStart, match.matchEnd);
        const afterMatch = match.text.substring(match.matchEnd);
        
        html += `
          <div class="search-match" data-file-id="${match.fileId}" data-line="${match.line}" data-column="${match.column}">
            <span class="search-match-line">${match.line}</span>
            <span class="search-match-text">
              ${escapeHtml(beforeMatch.slice(-30))}<span class="search-match-highlight">${escapeHtml(matchText)}</span>${escapeHtml(afterMatch.slice(0, 50))}
            </span>
            <span class="search-match-actions">
              <button class="search-match-btn" data-action="replace" title="Replace">↻</button>
            </span>
          </div>
        `;
      }
    }

    searchResultsEl.innerHTML = html;
    attachSearchResultHandlers();
  }

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function attachSearchResultHandlers() {
    // Click on file to open it
    searchResultsEl.querySelectorAll('.search-file').forEach(el => {
      el.addEventListener('click', () => {
        const fileId = (el as HTMLElement).dataset.fileId!;
        tabManager.switchToTab(fileId);
      });
    });

    // Click on match to go to line
    searchResultsEl.querySelectorAll('.search-match').forEach(el => {
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).dataset.action === 'replace') return;
        
        const fileId = (el as HTMLElement).dataset.fileId!;
        const line = parseInt((el as HTMLElement).dataset.line!);
        const column = parseInt((el as HTMLElement).dataset.column!);
        
        // Switch to file and go to position
        tabManager.switchToTab(fileId);
        setTimeout(() => {
          editor.revealLineInCenter(line);
          editor.setPosition({ lineNumber: line, column });
          editor.focus();
        }, 50);
      });

      // Replace single match button
      el.querySelector('.search-match-btn[data-action="replace"]')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const fileId = (el as HTMLElement).dataset.fileId!;
        const line = parseInt((el as HTMLElement).dataset.line!);
        const column = parseInt((el as HTMLElement).dataset.column!);
        
        await replaceSingleMatch(fileId, line, column, searchInput.value, replaceInput.value);
      });
    });
  }

  async function replaceSingleMatch(fileId: string, line: number, column: number, searchText: string, replaceText: string) {
    const file = await storage.getFile(fileId);
    if (!file) return;

    const lines = file.content.split('\n');
    const targetLine = lines[line - 1];
    
    // Find the match at the specified position
    let searchPattern: RegExp;
    try {
      if (searchOptions.regex) {
        searchPattern = new RegExp(searchText, searchOptions.caseSensitive ? '' : 'i');
      } else {
        let escapedQuery = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (searchOptions.wholeWord) {
          escapedQuery = `\\b${escapedQuery}\\b`;
        }
        searchPattern = new RegExp(escapedQuery, searchOptions.caseSensitive ? '' : 'i');
      }
    } catch (e) {
      return;
    }

    // Replace at the specific position
    const before = targetLine.substring(0, column - 1);
    const after = targetLine.substring(column - 1);
    const newAfter = after.replace(searchPattern, replaceText);
    lines[line - 1] = before + newAfter;
    
    const newContent = lines.join('\n');
    await storage.updateFile(fileId, { content: newContent });
    
    // Update editor model directly from our fileModels map
    const tab = tabManager.getTab(fileId);
    if (tab) {
      tab.file.content = newContent;
      const model = fileModels.get(fileId);
      if (model && !model.isDisposed()) {
        // Use pushEditOperations to properly update the model
        model.setValue(newContent);
      }
    }

    // Re-run search
    performSearch();
  }

  // Replace all matches in all files
  btnReplaceAllFiles.addEventListener('click', async () => {
    if (!currentAllowSearchReplace) return;
    if (!replaceInput.value && replaceInput.value !== '') {
      return;
    }

    const confirmed = confirm(`Replace ${currentSearchResults.reduce((sum, r) => sum + r.matches.length, 0)} occurrences in ${currentSearchResults.length} files?`);
    if (!confirmed) return;

    for (const result of currentSearchResults) {
      const file = await storage.getFile(result.fileId);
      if (!file) continue;

      let newContent = file.content;
      
      let searchPattern: RegExp;
      try {
        if (searchOptions.regex) {
          const flags = searchOptions.caseSensitive ? 'g' : 'gi';
          searchPattern = new RegExp(searchInput.value, flags);
        } else {
          let escapedQuery = searchInput.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (searchOptions.wholeWord) {
            escapedQuery = `\\b${escapedQuery}\\b`;
          }
          const flags = searchOptions.caseSensitive ? 'g' : 'gi';
          searchPattern = new RegExp(escapedQuery, flags);
        }
      } catch (e) {
        continue;
      }

      newContent = newContent.replace(searchPattern, replaceInput.value);
      await storage.updateFile(result.fileId, { content: newContent });
      
      // Update tab if open
      const tab = tabManager.getTab(result.fileId);
      if (tab) {
        tab.file.content = newContent;
        const model = monaco.editor.getModel(monaco.Uri.parse(`file:///${result.fileId}`));
        if (model) {
          model.setValue(newContent);
        }
      }
    }

    // Re-run search
    performSearch();
    setOutput(`Replaced all occurrences`);
  });

  // ===== FUNCTION PARSER & RUN PANEL =====
  const functionListEl = document.getElementById('function-list')!;
  const runAllCodeEl = document.getElementById('run-all-code')!;
  const btnRefreshFunctions = document.getElementById('btn-refresh-functions')!;

  interface ParsedFunction {
    name: string;
    type: 'function' | 'method' | 'class' | 'arrow';
    line: number;
    params: string;
  }

  // Language-specific function parsers
  function parseJavaScriptFunctions(code: string): ParsedFunction[] {
    const functions: ParsedFunction[] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Regular function: function name(params)
      const funcMatch = line.match(/function\s+(\w+)\s*\(([^)]*)\)/);
      if (funcMatch) {
        functions.push({ name: funcMatch[1], type: 'function', line: lineNum, params: funcMatch[2] });
        continue;
      }

      // Arrow function: const/let/var name = (params) => or name = (params) =>
      const arrowMatch = line.match(/(?:const|let|var)?\s*(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
      if (arrowMatch) {
        functions.push({ name: arrowMatch[1], type: 'arrow', line: lineNum, params: arrowMatch[2] });
        continue;
      }

      // Class method: name(params) { inside a class
      const methodMatch = line.match(/^\s+(\w+)\s*\(([^)]*)\)\s*\{/);
      if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[1])) {
        functions.push({ name: methodMatch[1], type: 'method', line: lineNum, params: methodMatch[2] });
        continue;
      }

      // Class declaration
      const classMatch = line.match(/class\s+(\w+)/);
      if (classMatch) {
        functions.push({ name: classMatch[1], type: 'class', line: lineNum, params: '' });
      }
    }

    return functions;
  }

  function parsePythonFunctions(code: string): ParsedFunction[] {
    const functions: ParsedFunction[] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Function: def name(params):
      const funcMatch = line.match(/def\s+(\w+)\s*\(([^)]*)\)\s*:/);
      if (funcMatch) {
        functions.push({ name: funcMatch[1], type: 'function', line: lineNum, params: funcMatch[2] });
        continue;
      }

      // Class: class Name:
      const classMatch = line.match(/class\s+(\w+)/);
      if (classMatch) {
        functions.push({ name: classMatch[1], type: 'class', line: lineNum, params: '' });
      }
    }

    return functions;
  }

  function parseJavaFunctions(code: string): ParsedFunction[] {
    const functions: ParsedFunction[] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Method: modifier type name(params) {
      const methodMatch = line.match(/(?:public|private|protected|static|\s)+\s+\w+\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+\w+\s*)?\{?/);
      if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[1])) {
        functions.push({ name: methodMatch[1], type: 'method', line: lineNum, params: methodMatch[2] });
        continue;
      }

      // Class: class Name
      const classMatch = line.match(/class\s+(\w+)/);
      if (classMatch) {
        functions.push({ name: classMatch[1], type: 'class', line: lineNum, params: '' });
      }
    }

    return functions;
  }

  function parsePHPFunctions(code: string): ParsedFunction[] {
    const functions: ParsedFunction[] = [];
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Function: function name(params)
      const funcMatch = line.match(/function\s+(\w+)\s*\(([^)]*)\)/);
      if (funcMatch) {
        functions.push({ name: funcMatch[1], type: 'function', line: lineNum, params: funcMatch[2] });
        continue;
      }

      // Class: class Name
      const classMatch = line.match(/class\s+(\w+)/);
      if (classMatch) {
        functions.push({ name: classMatch[1], type: 'class', line: lineNum, params: '' });
      }
    }

    return functions;
  }

  function parseFunctions(code: string, language: string): ParsedFunction[] {
    switch (language) {
      case 'javascript':
      case 'typescript':
        return parseJavaScriptFunctions(code);
      case 'python':
        return parsePythonFunctions(code);
      case 'java':
        return parseJavaFunctions(code);
      case 'php':
        return parsePHPFunctions(code);
      case 'csharp':
        return parseCSharpFunctions(code);
      default:
        return parseJavaScriptFunctions(code);
    }
  }

  function parseCSharpFunctions(code: string): ParsedFunction[] {
    const functions: ParsedFunction[] = [];
    const lines = code.split('\n');
    const reserved = new Set(['if', 'for', 'while', 'switch', 'catch', 'foreach', 'using', 'lock', 'fixed', 'unsafe', 'return']);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Method: [modifiers] returnType Name(params)
      const methodMatch = line.match(/^\s*(?:public|private|protected|internal|static|virtual|override|sealed|async|partial|extern|unsafe|\s)+\s+[\w<>?\[\],\s]+\s+(\w+)\s*\(([^)]*)\)/);
      if (methodMatch && !reserved.has(methodMatch[1])) {
        functions.push({ name: methodMatch[1], type: 'method', line: lineNum, params: methodMatch[2] });
        continue;
      }

      // Local function: returnType Name(params) {
      const localFunc = line.match(/^\s+(?:static\s+)?[\w<>?\[\]]+\s+(\w+)\s*\(([^)]*)\)\s*(?:=>|\{)/);
      if (localFunc && !reserved.has(localFunc[1])) {
        functions.push({ name: localFunc[1], type: 'function', line: lineNum, params: localFunc[2] });
        continue;
      }

      // Class / record / struct / interface
      const classMatch = line.match(/(?:class|record|struct|interface)\s+(\w+)/);
      if (classMatch) {
        functions.push({ name: classMatch[1], type: 'class', line: lineNum, params: '' });
      }
    }

    return functions;
  }

  function renderFunctionList() {
    const activeTab = tabManager.getActiveTab();
    if (!activeTab) {
      functionListEl.innerHTML = '<div class="tree-empty">No file open</div>';
      return;
    }

    const code = editor.getValue();
    const language = activeTab.file.language;
    const functions = parseFunctions(code, language);

    if (functions.length === 0) {
      functionListEl.innerHTML = '<div class="tree-empty">No functions detected</div>';
      return;
    }

    const icons: Record<string, string> = {
      function: '𝑓',
      arrow: '→',
      method: '𝑚',
      class: '𝐶',
    };

    // Helper to escape HTML
    const escapeHtml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    functionListEl.innerHTML = functions.map(fn => {
      const hasParams = fn.params && fn.params.trim().length > 0;
      const isClass = fn.type === 'class';
      const placeholder = isClass 
        ? 'constructor args (e.g., "value", 42)' 
        : `args: ${fn.params || 'none'}`;
      
      return `
        <div class="run-item-container">
          <div class="run-item" data-function="${escapeHtml(fn.name)}" data-line="${fn.line}" data-type="${fn.type}" data-params="${escapeHtml(fn.params)}">
            <span class="run-item-icon">${icons[fn.type] || '𝑓'}</span>
            <span class="run-item-name">${escapeHtml(fn.name)}(${hasParams || isClass ? '...' : ''})</span>
            <span class="run-item-type">${fn.type}</span>
            <button class="run-btn" title="Run ${escapeHtml(fn.name)}">▶</button>
          </div>
          ${hasParams || isClass ? `
            <div class="run-item-args">
              <span class="run-item-args-label">Args:</span>
              <input type="text" class="run-item-args-input" placeholder="${escapeHtml(placeholder)}" data-fn="${escapeHtml(fn.name)}" />
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    // Attach handlers
    functionListEl.querySelectorAll('.run-item-container').forEach(container => {
      const itemEl = container.querySelector('.run-item') as HTMLElement;
      const argsInput = container.querySelector('.run-item-args-input') as HTMLInputElement | null;
      
      const fnName = itemEl.dataset.function!;
      const fnLine = parseInt(itemEl.dataset.line!);
      const fnType = itemEl.dataset.type!;

      // Click on name to go to line
      itemEl.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('run-btn')) return;
        editor.revealLineInCenter(fnLine);
        editor.setPosition({ lineNumber: fnLine, column: 1 });
        editor.focus();
      });

      // Click run button
      itemEl.querySelector('.run-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const args = argsInput ? argsInput.value.trim() : '';
        runFunction(fnName, fnType, args);
      });

      // Press Enter in args input to run
      argsInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          runFunction(fnName, fnType, argsInput.value.trim());
        }
      });
    });
  }

  // Extract only function/class definitions, excluding top-level execution
  function extractDefinitionsOnly(code: string, language: string): string {
    const lines = code.split('\n');
    const definitions: string[] = [];
    let inDefinition = false;
    let braceCount = 0;
    let defStartLine = 0;

    // Python uses indentation, not braces
    if (language === 'python') {
      let defIndent = 0;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        const currentIndent = line.length - line.trimStart().length;
        
        // Check if this line starts a function/class definition
        const startsFunc = /^(async\s+)?def\s+\w+/.test(trimmedLine) ||
                          /^class\s+\w+/.test(trimmedLine);
        
        if (startsFunc && !inDefinition) {
          inDefinition = true;
          defStartLine = i;
          defIndent = currentIndent;
        } else if (inDefinition) {
          // End of definition: non-empty line with same or less indentation
          if (trimmedLine !== '' && currentIndent <= defIndent) {
            definitions.push(lines.slice(defStartLine, i).join('\n'));
            inDefinition = false;
            // Check if this line starts a new definition
            if (startsFunc) {
              inDefinition = true;
              defStartLine = i;
              defIndent = currentIndent;
            }
          }
        }
      }
      
      // If still in definition at end of file, include it
      if (inDefinition) {
        definitions.push(lines.slice(defStartLine).join('\n'));
      }
      
      return definitions.join('\n\n');
    }

    if (language === 'javascript' || language === 'typescript' || language === 'php') {
      // For PHP, we need to keep the <?php tag
      let phpOpening = '';
      let startIdx = 0;
      if (language === 'php') {
        if (lines[0]?.trim().startsWith('<?php') || lines[0]?.trim().startsWith('<?')) {
          phpOpening = lines[0];
          startIdx = 1;
        }
      }

      for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        // Skip closing PHP tag
        if (language === 'php' && trimmedLine === '?>') continue;
        
        // Check if this line starts a function/class definition
        let startsFunc = false;
        
        if (language === 'php') {
          startsFunc = /^(public\s+|private\s+|protected\s+|static\s+)*function\s+\w+/.test(trimmedLine) ||
                      /^(abstract\s+|final\s+)?class\s+\w+/.test(trimmedLine);
        } else {
          startsFunc = /^(async\s+)?function\s+\w+/.test(trimmedLine) ||
                      /^class\s+\w+/.test(trimmedLine) ||
                      /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/.test(trimmedLine) ||
                      /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\w+\s*=>/.test(trimmedLine);
        }
        
        if (startsFunc && !inDefinition) {
          inDefinition = true;
          defStartLine = i;
          braceCount = 0;
        }

        if (inDefinition) {
          // Count braces
          for (const char of line) {
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;
          }
          
          // Check for arrow function on single line (JS/TS only)
          if (language !== 'php' && line.includes('=>') && !line.includes('{')) {
            // Single-line arrow function
            definitions.push(lines.slice(defStartLine, i + 1).join('\n'));
            inDefinition = false;
          } else if (braceCount === 0 && line.includes('}')) {
            // End of multi-line definition
            definitions.push(lines.slice(defStartLine, i + 1).join('\n'));
            inDefinition = false;
          }
        }
      }
      
      // If still in definition at end of file, include it
      if (inDefinition) {
        definitions.push(lines.slice(defStartLine).join('\n'));
      }
      
      // For PHP, prepend the <?php tag
      if (language === 'php' && phpOpening) {
        return phpOpening + '\n' + definitions.join('\n\n');
      }
      
      return definitions.join('\n\n');
    }

    // For other languages, return as-is
    return code;
  }

  async function runFunction(fnName: string, fnType: string, args: string = '') {
    const activeTab = tabManager.getActiveTab();
    if (!activeTab) return;

    const code = editor.getValue();
    const language = activeTab.file.language;
    const version = activeTab.file.version;

    // Format args for display
    const argsDisplay = args ? `(${args})` : '()';
    
    // Extract only function/class definitions for JS/TS to prevent top-level execution
    let runCode = '';

    switch (language) {
      case 'javascript':
      case 'typescript': {
        const defsOnly = extractDefinitionsOnly(code, language);
        if (fnType === 'class') {
          runCode = `${defsOnly}\n\n// Run specific class\nconsole.log('--- Running new ${fnName}${argsDisplay} ---');\nconst __instance = new ${fnName}(${args});\nconsole.log('Created instance:', __instance);`;
        } else {
          runCode = `${defsOnly}\n\n// Run specific function\nconsole.log('--- Running ${fnName}${argsDisplay} ---');\nconst __result = ${fnName}(${args});\nif (__result !== undefined) console.log('Returned:', __result);`;
        }
        break;
      }

      case 'python': {
        // Extract only function/class definitions, not top-level execution code
        const defsOnly = extractDefinitionsOnly(code, 'python');
        if (fnType === 'class') {
          runCode = `${defsOnly}\n\n# Run specific class\nprint('--- Running ${fnName}${argsDisplay} ---')\n__instance = ${fnName}(${args})\nprint('Created instance:', __instance)`;
        } else {
          runCode = `${defsOnly}\n\n# Run specific function\nprint('--- Running ${fnName}${argsDisplay} ---')\n__result = ${fnName}(${args})\nif __result is not None:\n    print('Returned:', __result)`;
        }
        break;
      }

      case 'java':
        // Java: replace main method body to only call the target function
        if (fnType === 'class') {
          runCode = code;
        } else {
          runCode = code.replace(
            /public\s+static\s+void\s+main\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/,
            `public static void main(String[] args) {\n        System.out.println("--- Running ${fnName}${argsDisplay} ---");\n        ${fnName}(${args});\n    }`
          );
        }
        break;

      case 'csharp':
        // C#: best-effort replacement of the Main method body, falling back to top-level statements
        if (fnType === 'class') {
          runCode = code;
        } else if (/static\s+(?:async\s+)?(?:void|int|Task|Task<int>)\s+Main\s*\(/.test(code)) {
          runCode = code.replace(
            /static\s+(?:async\s+)?(?:void|int|Task|Task<int>)\s+Main\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/,
            `static void Main(string[] args) {\n        System.Console.WriteLine("--- Running ${fnName}${argsDisplay} ---");\n        ${fnName}(${args});\n    }`
          );
        } else {
          // Top-level statements: append a call at the end of the file
          runCode = `${code}\n\nSystem.Console.WriteLine("--- Running ${fnName}${argsDisplay} ---");\n${fnName}(${args});\n`;
        }
        break;

      case 'php': {
        // Extract only function/class definitions, not top-level execution code
        const defsOnly = extractDefinitionsOnly(code, 'php');
        
        if (fnType === 'class') {
          runCode = `${defsOnly}\n\n// Run specific class\necho "--- Running new ${fnName}${argsDisplay} ---\\n";\n$__instance = new ${fnName}(${args});\nvar_dump($__instance);`;
        } else {
          runCode = `${defsOnly}\n\n// Run specific function\necho "--- Running ${fnName}${argsDisplay} ---\\n";\n$__result = ${fnName}(${args});\nif ($__result !== null) { var_dump($__result); }`;
        }
        break;
      }

      default:
        runCode = code;
    }

    // Show running state
    setOutput(`Running ${fnName}${argsDisplay}...`);
    setStatus(`Running ${fnName}...`);

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: runCode, language, version }),
      });

      const data = await res.json();

      if (!res.ok) {
        setOutput(`Error: ${data.error || "Unknown error"}`);
        setStatus("Error ❌");
        return;
      }

      let output = "";
      if (data.stdout) output += data.stdout;
      if (data.stderr) output += (output ? "\n" : "") + data.stderr;
      if (!output && data.exitCode === 0) output = `${fnName}${argsDisplay} completed successfully (no output)`;
      
      setOutput(output);
      setStatus(`${fnName}${argsDisplay} ✅`);
    } catch (e) {
      setOutput(`Network error: ${e}`);
      setStatus("Error ❌");
    }
  }

  // Run all code button
  runAllCodeEl.addEventListener('click', () => {
    runBtn.click();
  });

  // Refresh function list
  btnRefreshFunctions.addEventListener('click', renderFunctionList);

  // Update function list when editor content changes (debounced)
  let functionListDebounce: ReturnType<typeof setTimeout> | null = null;
  editor.onDidChangeModelContent(() => {
    if (functionListDebounce) clearTimeout(functionListDebounce);
    functionListDebounce = setTimeout(renderFunctionList, 500);
  });

  // Update function list when switching tabs
  const originalSwitchToTab = tabManager.switchToTab.bind(tabManager);
  tabManager.switchToTab = async (fileId: string) => {
    const result = await originalSwitchToTab(fileId);
    setTimeout(renderFunctionList, 100);
    return result;
  };

  // ===== SIDEBAR PANEL SWITCHING =====
  function panelIsVisible(panelName: string): boolean {
    return currentVisiblePanels.includes(panelName as IdePanel);
  }

  function applyIdePolicy() {
    document.body.classList.toggle('readonly', currentReadonly);
    document.body.classList.toggle('structure-locked', currentLockStructure);
    document.body.classList.toggle('run-disabled', !currentAllowRun);
    document.body.classList.toggle('search-replace-disabled', !currentAllowSearchReplace);
    document.body.classList.toggle('hide-explorer-panel', !panelIsVisible('explorer'));
    document.body.classList.toggle('hide-search-panel', !panelIsVisible('search'));
    document.body.classList.toggle('hide-run-panel', !panelIsVisible('run'));

    const activeIcon = document.querySelector('.activity-icon.active') as HTMLElement | null;
    const activePanel = activeIcon?.dataset.panel || '';
    const firstVisiblePanel = currentVisiblePanels[0] || null;

    btnNewFile.toggleAttribute('disabled', currentLockStructure);
    btnNewFolder.toggleAttribute('disabled', currentLockStructure);
    emptyStateNewFileBtn.toggleAttribute('disabled', currentLockStructure);

    if (ideMode === 'full') {
      if (!firstVisiblePanel) {
        sidebarEl.classList.add('collapsed');
      } else if (!panelIsVisible(activePanel)) {
        sidebarEl.classList.remove('collapsed');
        switchSidebarPanel(firstVisiblePanel);
      }
    }
  }

  function applyPolicyFromMessage(data: { readonly?: boolean; lockStructure?: boolean; allowRun?: boolean; panels?: string[]; allowSearchReplace?: boolean }) {
    if (typeof data.readonly === 'boolean') currentReadonly = data.readonly;
    if (typeof data.lockStructure === 'boolean') currentLockStructure = data.lockStructure;
    if (typeof data.allowRun === 'boolean') currentAllowRun = data.allowRun;
    if (typeof data.allowSearchReplace === 'boolean') currentAllowSearchReplace = data.allowSearchReplace;
    if (Array.isArray(data.panels)) currentVisiblePanels = normalizePanels(data.panels, currentVisiblePanels);

    editor.updateOptions({ 
      readOnly: currentReadonly,
      domReadOnly: currentReadonly,
      renderLineHighlight: currentReadonly ? 'none' : 'line',
      contextmenu: !currentLockStructure,
    });

    applyIdePolicy();
  }

  function switchSidebarPanel(panelName: string) {
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
      renderFunctionList();
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

  // Initialize tabs
  setStatus("Loading files…");
  
  if (isEmbedded) {
    // Embedded mode: isolate this iframe's IndexedDB so multiple parts on the
    // same Step-Up page don't share/overwrite each other's files. Each iframe
    // gets a unique DB that's deleted on unload.
    const { setDbName, getDbName } = await import('./storage');
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
    const initialTab = await tabManager.init(currentLang, currentVersion);
  
    if (initialTab) {
      const lang = getLanguage(initialTab.file.language);
      if (lang) {
        currentLang = lang;
        langSel.value = lang.id;
        currentVersion = populateVersionDropdown(lang, initialTab.file.version);
        configureMonacoForVersion(lang, currentVersion);
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

  // Language selector - change language for active tab
  langSel.addEventListener("change", async () => {
    const newLang = getLanguage(langSel.value);
    if (!newLang) return;

    currentLang = newLang;
    currentVersion = populateVersionDropdown(currentLang);
    configureMonacoForVersion(currentLang, currentVersion);

    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      // Smart content update: only replace if user hasn't modified the code
      // Uses async check that compares content against starter template
      let newContent: string | undefined = undefined;
      const isModified = await tabManager.isTabUserModifiedAsync(activeTab.file.id);
      if (!isModified) {
        // Tab has default content - replace with new language's starter
        newContent = await getStarterAsync(currentLang.id, currentVersion.id);
      }

      // Update tab language (and content if unmodified)
      await tabManager.updateTabLanguage(activeTab.file.id, currentLang, currentVersion, newContent);
      
      // Recreate model with new language
      disposeModel(activeTab.file.id);
      const updatedTab = tabManager.getActiveTab();
      if (updatedTab) {
        const model = getOrCreateModel(updatedTab);
        editor.setModel(model);
        
        // Show helpful status
        if (newContent !== undefined) {
          setStatus(`Switched to ${currentLang.name} - loaded starter template`);
        } else {
          setStatus(`Switched to ${currentLang.name} - your code preserved`);
        }
      }
    }

    // Preload all versions in background for this language
    preloadStarters(currentLang.id).catch(() => {});
  });

  // Version selector
  versionSel.addEventListener("change", async () => {
    const version = currentLang.versions.find((v: VersionConfig) => v.id === versionSel.value);
    if (!version) return;

    currentVersion = version;
    configureMonacoForVersion(currentLang, currentVersion);

    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      // Smart content update: only replace if user hasn't modified the code
      // Uses async check that compares content against starter template
      let newContent: string | undefined = undefined;
      const isModified = await tabManager.isTabUserModifiedAsync(activeTab.file.id);
      if (!isModified) {
        // Tab has default content - replace with new version's starter
        newContent = await getStarterAsync(currentLang.id, currentVersion.id);
      }

      await tabManager.updateTabLanguage(activeTab.file.id, currentLang, currentVersion, newContent);

      // Update model content if changed
      if (newContent !== undefined) {
        const model = editor.getModel();
        if (model) {
          model.setValue(newContent);
        }
        setStatus(`${currentLang.name} ${currentVersion.name} - loaded starter template`);
      } else {
        setStatus(`${currentLang.name} ${currentVersion.name} - your code preserved`);
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
  async function runCode(code: string) {
    const activeTab = tabManager.getActiveTab();
    if (!activeTab) return;

    const lang = getLanguage(activeTab.file.language);
    if (!lang) return;

    setStatus("Running…");
    startRunLoader();

    try {
      const resp = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: lang.id,
          version: activeTab.file.version,
          code,
        }),
      });

      const raw = await resp.text();
      let data: any = null;

      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      stopRunLoader();
      setOutput("");

      if (!resp.ok) {
        appendOutput(`HTTP ${resp.status}\n${raw || "(empty response)"}`);
        setStatus("Run failed");
        return;
      }

      if (!data) {
        appendOutput(`ERROR: Server returned no JSON.\n${raw || "(empty response)"}`);
        setStatus("Run failed");
        return;
      }

      if (data.stdout) appendOutput(data.stdout);
      if (data.stderr) appendOutput(`[stderr]\n${data.stderr}`);
      appendOutput(`\n[exit code: ${data.exitCode}]`);
      setStatus(data.exitCode === 0 ? "Ready ✅" : "Run completed with errors");
      
      // Notify parent of run result (Step-Up integration)
      if (isEmbedded) {
        notifyRunResult({
          stdout: data.stdout || '',
          stderr: data.stderr || '',
          exitCode: data.exitCode ?? -1,
          durationMs: data.durationMs || 0
        });
      }
    } catch (e: any) {
      stopRunLoader();
      setOutput("");
      appendOutput(`ERROR: ${e?.message || String(e)}`);
      setStatus("Run failed");
      
      // Notify parent of error
      if (isEmbedded) {
        notifyRunResult({
          stdout: '',
          stderr: e?.message || String(e),
          exitCode: -1,
          durationMs: 0
        });
      }
    } finally {
      // Safety net: guarantees the button is never left stuck in a disabled/spinning state
      stopRunLoader();
    }
  }

  runBtn.addEventListener("click", () => runCode(editor.getValue()));

  // Keyboard shortcuts
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
    runBtn.click();
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    // Save current tab
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      tabManager.saveCurrentTab();
      setStatus(`Saved ${activeTab.file.name}`);
    }
  });

  // Ctrl+N - New file
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, async () => {
    const newTab = await tabManager.createNewFile(currentLang, currentVersion);
    if (newTab) {
      const model = getOrCreateModel(newTab);
      editor.setModel(model);
      setStatus(`Created ${newTab.file.name}`);
    }
  });

  // Ctrl+W - Close current tab
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, async () => {
    const activeTab = tabManager.getActiveTab();
    if (activeTab && tabManager.getTabCount() > 1) {
      await tabManager.closeTab(activeTab.file.id);
    }
  });

  // Format document
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
    editor.getAction("editor.action.formatDocument")?.run();
  });

  // "Explain this keyword" — right-click a keyword to see a plain-English
  // explanation + example, backed by languages/*/keywords.json.
  //
  // The menu item only appears when the word under the cursor/selection is
  // actually present in the active language's keyword dictionary - driven by
  // a Monaco context key kept in sync on every cursor/selection/model change,
  // so adding a new entry to keywords.json makes it "just work" with no other
  // code changes, and it stays hidden for anything not in the file.
  function resolveKeywordAtCursor(ed: monaco.editor.IStandaloneCodeEditor): string {
    const position = ed.getPosition();
    const model = ed.getModel();
    if (!position || !model) return "";

    const wordInfo = model.getWordAtPosition(position);
    if (wordInfo) return wordInfo.word;

    const selection = ed.getSelection();
    if (selection && !selection.isEmpty()) {
      return model.getValueInRange(selection).trim();
    }
    return "";
  }

  const keywordHelpAvailable = editor.createContextKey<boolean>("keywordHelpAvailable", false);

  function updateKeywordHelpAvailability() {
    const word = resolveKeywordAtCursor(editor);
    if (!word) {
      keywordHelpAvailable.set(false);
      return;
    }
    const activeTab = tabManager.getActiveTab();
    const langId = activeTab ? activeTab.file.language : currentLang.id;
    keywordHelpAvailable.set(!!getKeywordExplanation(langId, word));
  }

  editor.onDidChangeCursorSelection(updateKeywordHelpAvailability);
  editor.onDidChangeModel(updateKeywordHelpAvailability);

  editor.addAction({
    id: "explainKeyword",
    label: t("editor.explainKeyword") || "💡 Explain this keyword",
    contextMenuGroupId: "9_cutcopypaste",
    contextMenuOrder: 1.5,
    precondition: "keywordHelpAvailable",
    run: (ed) => {
      const position = ed.getPosition();
      const model = ed.getModel();
      if (!position || !model) return;

      const wordInfo = model.getWordAtPosition(position);
      const word = wordInfo?.word || resolveKeywordAtCursor(ed);
      if (!word) return;

      const activeTab = tabManager.getActiveTab();
      const langId = activeTab ? activeTab.file.language : currentLang.id;
      const entry = getKeywordExplanation(langId, word, getUILang());
      if (!entry) return;

      // Position the popup near the clicked word on screen
      const coords = wordInfo
        ? ed.getScrolledVisiblePosition({ lineNumber: position.lineNumber, column: wordInfo.startColumn })
        : ed.getScrolledVisiblePosition(position);
      const editorDomNode = ed.getDomNode();
      const editorRect = editorDomNode?.getBoundingClientRect();
      const x = (editorRect?.left || 0) + (coords?.left || 0);
      const y = (editorRect?.top || 0) + (coords?.top || 0) + (coords?.height || 18);

      showKeywordHelpPopup(word, entry.type, entry.explanation, entry.example, entry.rtl, x, y);
    },
  });

  // "Run Selected" — right-click a selection to execute just those lines.
  // Only appears when the selection covers at least one full line: either a
  // multi-line selection, or a single line selected in its entirety (e.g.
  // triple-click, or Home then Shift+End) - not for a plain cursor or a
  // partial in-line text selection like a variable name.
  const runSelectionAvailable = editor.createContextKey<boolean>("runSelectionAvailable", false);

  function updateRunSelectionAvailability() {
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || !model || selection.isEmpty()) {
      runSelectionAvailable.set(false);
      return;
    }
    if (selection.startLineNumber !== selection.endLineNumber) {
      runSelectionAvailable.set(true);
      return;
    }
    // Single line selected - only counts if the whole line is covered
    const lineMaxColumn = model.getLineMaxColumn(selection.startLineNumber);
    runSelectionAvailable.set(selection.startColumn === 1 && selection.endColumn === lineMaxColumn);
  }

  editor.onDidChangeCursorSelection(updateRunSelectionAvailability);
  editor.onDidChangeModel(updateRunSelectionAvailability);

  editor.addAction({
    id: "runSelectedLines",
    label: t("editor.runSelected") || "▶ Run Selected",
    contextMenuGroupId: "1_run",
    contextMenuOrder: 1,
    precondition: "runSelectionAvailable",
    run: (ed) => {
      const selection = ed.getSelection();
      const model = ed.getModel();
      if (!selection || !model) return;

      // Always execute the FULL lines touched by the selection, not just the
      // exact (possibly partial-column) selected text - matches how the
      // context menu becomes available in the first place.
      const startLine = selection.startLineNumber;
      const endLine = selection.endLineNumber;
      const code = model.getValueInRange(
        new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine))
      );
      if (!code.trim()) return;

      runCode(code);
    },
  });


  // ===== VS Code-like UI Features =====

  // Panel toggle
  togglePanelBtn.addEventListener("click", () => {
    const isCollapsed = panelEl.classList.toggle("collapsed");
    togglePanelBtn.textContent = isCollapsed ? "⌄" : "⌃";
    saveSettings();
    setTimeout(() => editor.layout(), 50);
  });

  // Clear output
  clearOutputBtn.addEventListener("click", () => setOutput(""));

  // Panel tabs
  const panelTabs = document.querySelectorAll('.panel-tab');
  panelTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      panelTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // Panel resize. In embedded snippet/project modes the handle is hidden by
  // CSS (parent controls sizing); in embedded FULL mode it's visible and
  // draggable, same as the standalone IDE.
  let isResizing = false;
  let startY = 0;
  let startHeight = 0;

  panelResizeEl.addEventListener("mousedown", (e: MouseEvent) => {
    isResizing = true;
    startY = e.clientY;
    startHeight = panelEl.offsetHeight;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (!isResizing) return;
    const delta = startY - e.clientY;
    const newHeight = Math.max(100, Math.min(startHeight + delta, window.innerHeight * 0.6));
    panelEl.style.height = `${newHeight}px`;
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      saveSettings();
    }
    if (isSidebarResizing) {
      isSidebarResizing = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      saveSettings();
      setTimeout(() => editor.layout(), 50);
    }
  });

  // Sidebar resize. Hidden by CSS in embedded snippet/project modes;
  // enabled in embedded FULL mode, same as the standalone IDE.
  let isSidebarResizing = false;
  let sidebarStartX = 0;
  let sidebarStartWidth = 0;

  sidebarResizeEl.addEventListener("mousedown", (e: MouseEvent) => {
    isSidebarResizing = true;
    sidebarStartX = e.clientX;
    sidebarStartWidth = sidebarEl.offsetWidth;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (isSidebarResizing) {
      const delta = e.clientX - sidebarStartX;
      const newWidth = Math.max(150, Math.min(sidebarStartWidth + delta, 500));
      sidebarEl.style.width = `${newWidth}px`;
      // Update grid template columns (CSS var wins over the !important
      // mode-full grid rules; the inline fallback covers other modes)
      const appEl = document.getElementById("app")!;
      appEl.style.setProperty('--sidebar-width', `${newWidth}px`);
      appEl.style.gridTemplateColumns = `48px ${newWidth}px 1fr`;
    }
  });

  // Status bar - cursor position
  editor.onDidChangeCursorPosition((e) => {
    statusLineEl.textContent = t('status.line', { line: e.position.lineNumber, col: e.position.column });
  });

  // Update status bar language
  statusLangEl.textContent = currentLang.name;
  
  // Apply initial RTL if needed
  updateGridForRTL();

  // Initial file tree render
  renderFileTree(tabManager);

  // ===== Apply Saved Settings =====
  const savedSettings = loadSettings();
  
  // Apply theme
  if (savedSettings.theme) {
    themeSel.value = savedSettings.theme;
    applyTheme(savedSettings.theme);
  }
  
  // Apply sidebar state
  if (!savedSettings.sidebarVisible) {
    sidebarEl.classList.add('collapsed');
    activityIcons.forEach(i => i.classList.remove('active'));
  } else if (savedSettings.sidebarPanel) {
    switchSidebarPanel(savedSettings.sidebarPanel);
  }
  
  // Apply sidebar width
  if (savedSettings.sidebarWidth && savedSettings.sidebarWidth >= 150) {
    sidebarEl.style.width = `${savedSettings.sidebarWidth}px`;
    const appEl = document.getElementById("app")!;
    appEl.style.setProperty('--sidebar-width', `${savedSettings.sidebarWidth}px`);
    appEl.style.gridTemplateColumns = `48px ${savedSettings.sidebarWidth}px 1fr`;
  }
  
  // Apply panel state
  if (savedSettings.panelCollapsed) {
    panelEl.classList.add('collapsed');
    togglePanelBtn.textContent = '⌄';
  }
  if (savedSettings.panelHeight && savedSettings.panelHeight > 100) {
    panelEl.style.height = `${savedSettings.panelHeight}px`;
  }

  applyIdePolicy();

  // ═══════════════════════════════════════════════════════════════════
  // STEP-UP INTEGRATION: Connect PostMessage Handlers
  // ═══════════════════════════════════════════════════════════════════
  
  // Handle init message from Step-Up.
  // Supported payload:
  //   - code:    string (snippet mode starter / readonly content)
  //   - files:   FileEntry[] (project mode - first file becomes active)
  //   - output:  string (pre-populated output, e.g. for fill_blanks)
  //   - autoRun: boolean (trigger run after init - free_code only)
  handleStepUpInit = async (data) => {
    console.log('[IDE] handleStepUpInit:', data);
    applyPolicyFromMessage(data);
    
    // Project mode with files takes precedence
    if (data.files && Array.isArray(data.files) && data.files.length > 0 && ideMode !== 'snippet') {
      await handleSetFilesAsync({ files: data.files });
    } else if (typeof data.code === 'string') {
      // Snippet mode - single code blob: create a single tab or set editor directly
      if (isEmbedded) {
        // In embedded snippet mode, create one tab with the code
        const fileName = `main.${currentLang.extension}`;
        const tab = await tabManager.replaceAllFiles(
          [{ path: fileName, content: data.code, language: currentLang.id }],
          currentLang, currentVersion
        );
        if (tab) {
          tab.file.content = data.code;
          const model = getOrCreateModel(tab);
          model.setValue(data.code);
          editor.setModel(model);
          updateEmptyState(false);
          setStatus(tab.file.name);
          renderFileTree(tabManager);
        } else {
          const uri = monaco.Uri.parse(`inmemory:///${fileName}`);
          const model = monaco.editor.getModel(uri) || monaco.editor.createModel(data.code, currentLang.id, uri);
          model.setValue(data.code);
          editor.setModel(model);
          updateEmptyState(false);
          setStatus(fileName);
        }
        // Force layout after CSS grid settles so Monaco sizes correctly in snippet/nooutput modes
        requestAnimationFrame(() => editor.layout());
        setTimeout(() => editor.layout(), 100);
      } else {
        editor.setValue(data.code);
      }
    }
    
    // Pre-populated output (used by fill_blanks)
    if (typeof data.output === 'string') {
      setOutput(data.output);
    }
    
    // Re-broadcast ready so parent knows init was applied
    notifyParentReady();
    
    // Auto-run if requested (free_code "run on load" workflows)
    if (data.autoRun && currentAllowRun) {
      setTimeout(() => runBtn.click(), 200);
    }
  };
  
  // Async helper for setting files via TabManager
  async function handleSetFilesAsync(data: { files: Array<{ path: string; content: string; language?: string }> }) {
    if (!data.files || !Array.isArray(data.files) || data.files.length === 0) return;
    
    // Dispose all existing models
    for (const [id] of fileModels) {
      disposeModel(id);
    }
    
    // Replace all tabs with the new files
    const activeTab = await tabManager.replaceAllFiles(data.files, currentLang, currentVersion);
    
    if (activeTab) {
      const model = getOrCreateModel(activeTab);
      editor.setModel(model);
      updateEmptyState(false);
      setStatus(activeTab.file.name);

      // Reflect the active file's language in the toolbar + status bar
      const activeFileLang = getLanguage(activeTab.file.language);
      if (activeFileLang) {
        currentLang = activeFileLang;
        langSel.value = activeFileLang.id;
        currentVersion = populateVersionDropdown(activeFileLang, activeTab.file.version);
        configureMonacoForVersion(activeFileLang, currentVersion);
        statusLangEl.textContent = activeFileLang.name;
      }
    }
    
    // Expand the whole folder hierarchy so the lesson structure is visible at a glance
    const allFolders = await storage.getAllFolders();
    expandedFolders = new Set(allFolders.map(f => f.id));
    
    renderFileTree(tabManager);
  }
  
  // Build the full workspace snapshot from storage (source of truth),
  // overlaying live (possibly unsaved) content from open Monaco models.
  // Paths are relative POSIX paths that preserve the folder hierarchy.
  async function collectWorkspaceSnapshot(): Promise<Array<{ path: string; content: string; language?: string }>> {
    const storedFiles = await storage.getAllFiles();
    return storedFiles.map(f => ({
      path: f.path.replace(/^\/+/, ''),
      content: fileModels.get(f.id)?.getValue() ?? f.content ?? '',
      language: f.language,
    }));
  }
  
  // Push-based sync: emit the full `ide:files` snapshot (debounced) on any
  // file create/edit/delete so the parent can persist the workspace.
  let filesSnapshotTimeout: ReturnType<typeof setTimeout> | null = null;
  function scheduleFilesSnapshot() {
    if (!isEmbedded || ideMode === 'snippet' || currentReadonly) return;
    if (filesSnapshotTimeout) clearTimeout(filesSnapshotTimeout);
    filesSnapshotTimeout = setTimeout(async () => {
      const files = await collectWorkspaceSnapshot();
      sendToParent('ide:files', { files });
    }, 500);
  }
  notifyWorkspaceChanged = scheduleFilesSnapshot;
  
  // Handle set code message (snippet mode)
  handleSetCode = (data) => {
    if (typeof data.code === 'string') {
      editor.setValue(data.code);
    }
  };
  
  // Handle get code request - responds with `ide:code-response`
  // (matches the legacy contract used by step-up TaskController fallback)
  handleGetCode = () => {
    sendToParent('ide:code-response', { 
      code: editor.getValue(),
      language: urlLanguage,
      version: urlVersion,
    });
  };
  
  // Handle set files (project mode) - replaces all files via TabManager.
  handleSetFiles = (data) => {
    if (!data.files || !Array.isArray(data.files)) return;
    handleSetFilesAsync(data);
  };
  
  // Handle get files request (project mode)
  handleGetFiles = () => {
    // Snippet mode: return the single editor buffer as one file
    if (ideMode === 'snippet') {
      sendToParent('ide:files', { 
        files: [{ path: 'main', content: editor.getValue(), language: urlLanguage }] 
      });
      return;
    }
    // Project/full mode: full workspace snapshot from storage with real paths
    collectWorkspaceSnapshot().then(files => {
      if (files.length === 0) {
        // Fallback to current editor content
        files.push({ path: 'main', content: editor.getValue(), language: urlLanguage });
      }
      sendToParent('ide:files', { files });
    });
  };
  
  // Handle run request from parent (free_code workflows)
  handleRun = () => {
    if (!currentAllowRun) {
      console.warn('[IDE] Run requested but current policy forbids execution');
      return;
    }
    runBtn.click();
  };
  
  // Handle readonly toggle at runtime
  handleSetReadonly = (data) => {
    applyPolicyFromMessage(data);
  };
  
  // Handle pre-computed output from parent (CRITICAL for fill_blanks).
  // Step-Up POSTs filled code to /api/run, then pushes result here for display.
  handleShowOutput = (data) => {
    let text = '';
    if (typeof data.output === 'string') {
      text = data.output;
    } else {
      if (data.stdout) text += data.stdout;
      if (data.stderr) text += (text ? '\n' : '') + '[stderr]\n' + data.stderr;
      if (typeof data.exitCode === 'number') text += `\n[exit code: ${data.exitCode}]`;
    }
    setOutput(text);
  };
  
  // Handle clear output request
  handleClearOutput = () => {
    setOutput('');
  };
  
  // Notify parent of code changes (throttled)
  let codeChangeTimeout: ReturnType<typeof setTimeout> | null = null;
  editor.onDidChangeModelContent(() => {
    // Existing auto-save logic...
    const activeTab = tabManager.getActiveTab();
    if (activeTab) {
      tabManager.markDirty(activeTab.file.id, editor.getValue());
    }
    
    // Notify parent of code change (throttled to avoid flooding)
    if (isEmbedded && !currentReadonly) {
      if (codeChangeTimeout) clearTimeout(codeChangeTimeout);
      codeChangeTimeout = setTimeout(() => {
        notifyCodeChange(editor.getValue());
      }, 300);
      // Full/project mode: also push the whole workspace snapshot
      scheduleFilesSnapshot();
    }
  });
  
  // Notify parent that IDE is ready (after initialization).
  // We send TWO ready signals to handle both timing scenarios:
  //   1. Immediately with '*' (or referrer-derived origin) so parents that
  //      attach a listener and wait for ready get it ASAP.
  //   2. After a short delay, in case the first one races the parent's
  //      listener registration.
  if (isEmbedded) {
    // Try referrer-derived origin first
    const initialOrigin = deriveInitialParentOrigin();
    if (initialOrigin && !parentOrigin) {
      parentOrigin = initialOrigin;
    }
    notifyParentReady();
    setTimeout(() => notifyParentReady(), 100);
    setTimeout(() => notifyParentReady(), 500);
  }

  setStatus("Ready ✅ (Ctrl+Enter to run)");
})().catch((err) => {
  console.error('[IDE] Fatal initialization error:', err);
  // Still try to notify parent so the loading overlay can be handled
  notifyParentReady();
});
