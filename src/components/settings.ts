import {
  themeSel,
  sidebarEl,
  panelEl,
} from "./dom";

// ===== Settings Management (localStorage) =====
export interface IDESettings {
  theme: string;
  sidebarVisible: boolean;
  sidebarPanel: string;
  sidebarWidth: number;
  panelHeight: number;
  panelCollapsed: boolean;
}

export const DEFAULT_SETTINGS: IDESettings = {
  theme: 'vs-dark',
  sidebarVisible: true,
  sidebarPanel: 'explorer',
  sidebarWidth: 220,
  panelHeight: 200,
  panelCollapsed: false,
};

export function loadSettings(): IDESettings {
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

export function saveSettings(): void {
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

