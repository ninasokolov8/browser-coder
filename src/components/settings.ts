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

/**
 * The theme to use when nothing has been chosen yet.
 *
 * Follows the operating system, which is what every other editor does and what a
 * student expects. The pre-paint script in index.html makes the same decision from
 * the same inputs, so the two cannot disagree - it publishes its answer on
 * `__bcInitialTheme`, and that is preferred here so a single read of matchMedia
 * decides the whole session.
 */
export function preferredTheme(): string {
  const decidedBeforePaint = (window as unknown as { __bcInitialTheme?: string }).__bcInitialTheme;
  if (decidedBeforePaint === 'vs' || decidedBeforePaint === 'vs-dark') return decidedBeforePaint;

  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'vs'
    : 'vs-dark';
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
  // The OS preference is the default, and a stored choice overrides it. Spread in
  // this order so a student who has never touched the selector follows their system
  // and one who has keeps what they picked.
  const defaults: IDESettings = { ...DEFAULT_SETTINGS, theme: preferredTheme() };

  try {
    const saved = localStorage.getItem('browser-coder-settings');
    if (saved) {
      return { ...defaults, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }
  return defaults;
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

