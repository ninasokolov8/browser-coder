// @ts-nocheck
import { runtime, requireEditor, requireTabManager } from '../app/runtime';
import { appConfig } from '../app/config';
import {
  togglePanelBtn, panelEl, clearOutputBtn, panelResizeEl, sidebarResizeEl,
  sidebarEl, statusLineEl, statusLangEl, activityIcons, themeSel,
} from '../components/dom';
import { saveSettings, loadSettings } from '../components/settings';
import { setOutput } from '../components/output';
import { clearTurtleCanvas } from '../components/turtle';
import { applyTheme } from '../components/monaco-config';
import { t } from '../i18n';
import { updateGridForRTL } from './ui-layout';
import { renderFileTree } from './explorer';
import { applyIdePolicy, switchSidebarPanel } from './sidebar';

export function initializeLayout(): void {
  const editor = requireEditor();
  const tabManager = requireTabManager();
// ===== VS Code-like UI Features =====

// Panel toggle
togglePanelBtn.addEventListener("click", () => {
  const isCollapsed = panelEl.classList.toggle("collapsed");
  togglePanelBtn.textContent = isCollapsed ? "⌄" : "⌃";
  saveSettings();
  setTimeout(() => editor.layout(), 50);
});

// Clear output
clearOutputBtn.addEventListener("click", () => { setOutput(""); clearTurtleCanvas(); });

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
statusLangEl.textContent = runtime.currentLang?.name ?? '';

// Apply initial RTL if needed
updateGridForRTL();

// Initial file tree render
void renderFileTree(tabManager);

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
}
