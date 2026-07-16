// DOM elements
export const statusEl = document.getElementById("status")!;
export const langSel = document.getElementById("lang") as HTMLSelectElement;
export const versionSel = document.getElementById("version") as HTMLSelectElement;
export const themeSel = document.getElementById("theme") as HTMLSelectElement;
export const runBtn = document.getElementById("run") as HTMLButtonElement;
export const downloadBtn = document.getElementById("download") as HTMLButtonElement;
export const clearOutputBtn = document.getElementById("clearOutput") as HTMLButtonElement;
export const togglePanelBtn = document.getElementById("togglePanel") as HTMLButtonElement;
export const panelEl = document.getElementById("panel")!;
export const panelContentEl = document.getElementById("panel-content")!;
export const panelResizeEl = document.getElementById("panel-resize")!;
// Turtle graphics elements
export const turtleOutputEl = document.getElementById("turtle-output") as HTMLElement | null;
export const turtleCanvasEl = document.getElementById("turtle-canvas") as HTMLCanvasElement | null;
export const tabsEl = document.getElementById("tabs")!;
export const fileTreeEl = document.getElementById("file-tree")!;
export const sidebarEl = document.getElementById("sidebar")!;
export const statusLangEl = document.getElementById("status-lang")!;
export const statusLineEl = document.getElementById("status-line")!;
export const contextMenuEl = document.getElementById("context-menu")!;
export const btnNewFile = document.getElementById("btn-new-file")!;
export const btnNewFolder = document.getElementById("btn-new-folder")!;
export const btnRefresh = document.getElementById("btn-refresh")!;
export const btnDownloadProject = document.getElementById("btn-download-project")!;
export const btnClearCache = document.getElementById("btn-clear-cache")!;
export const editorEmptyState = document.getElementById("editor-empty-state")!;
export const emptyStateNewFileBtn = document.getElementById("empty-state-new-file")!;
export const uiLangSel = document.getElementById("ui-lang") as HTMLSelectElement;

// Search panel elements
export const searchInput = document.getElementById("search-input") as HTMLInputElement;
export const replaceInput = document.getElementById("replace-input") as HTMLInputElement;
export const searchResultsEl = document.getElementById("search-results")!;
export const searchSummaryEl = document.getElementById("search-summary")!;
export const searchCountEl = document.getElementById("search-count")!;
export const btnRegex = document.getElementById("btn-regex")!;
export const btnCase = document.getElementById("btn-case")!;
export const btnWord = document.getElementById("btn-word")!;
export const btnClearSearch = document.getElementById("btn-clear-search")!;
export const btnReplaceAll = document.getElementById("btn-replace-all")!;
export const btnReplaceAllFiles = document.getElementById("btn-replace-all-files")!;

// Sidebar panels
export const sidebarPanels = document.querySelectorAll('.sidebar-panel');
export const sidebarResizeEl = document.getElementById("sidebar-resize")!;

// Activity bar icons
export const activityIcons = document.querySelectorAll('.activity-icon[data-panel]');

