/**
 * Tab Manager - Handles multi-file tab UI and state
 */

import { storage, StoredFile, WorkspaceState } from './storage';
import { getLanguage, getStarterAsync, LoadedLanguage, VersionConfig } from './languages';

export interface Tab {
  file: StoredFile;
  isDirty: boolean;  // Has unsaved changes
}

export interface TabManagerEvents {
  onTabSwitch?: (tab: Tab) => void;
  onTabCreate?: (tab: Tab) => void;
  onTabClose?: (tab: Tab) => void;
  onTabUpdate?: (tab: Tab) => void;
  onTabsChange?: (tabs: Tab[]) => void;
}

export class TabManager {
  private tabs: Tab[] = [];
  private activeTabId: string | null = null;
  private containerEl: HTMLElement;
  private events: TabManagerEvents;
  private autoSaveTimer: number | null = null;
  private autoSaveDelay = 1000; // 1 second debounce

  constructor(containerEl: HTMLElement, events: TabManagerEvents = {}) {
    this.containerEl = containerEl;
    this.events = events;
  }

  // ========== Initialization ==========

  /**
   * Initialize tab manager - load saved files or return null for empty state
   */
  async init(defaultLang: LoadedLanguage, defaultVersion: VersionConfig): Promise<Tab | null> {
    await storage.init();
    
    // Load existing files
    const files = await storage.getAllFiles();
    const state = await storage.getWorkspaceState();

    if (files.length > 0) {
      // Restore existing tabs
      this.tabs = files.map(file => ({ file, isDirty: false }));
      
      // Find active tab
      let activeTab = this.tabs.find(t => t.file.id === state.activeFileId);
      if (!activeTab) activeTab = this.tabs[0];
      
      this.activeTabId = activeTab.file.id;
      this.render();
      this.events.onTabsChange?.(this.tabs);
      
      return activeTab;
    } else {
      // No files - return null, let UI show empty state
      this.render();
      this.events.onTabsChange?.(this.tabs);
      return null;
    }
  }

  // ========== Tab Operations ==========

  /**
   * Create a new file/tab
   */
  async createNewFile(lang: LoadedLanguage, version: VersionConfig, name?: string, parentId: string | null = null): Promise<Tab | null> {
    const starterCode = await getStarterAsync(lang.id, version.id);
    
    // Generate unique name
    const baseName = name || `main.${lang.extension}`;
    const uniqueName = this.generateUniqueName(baseName);

    const file = await storage.createFile({
      name: uniqueName,
      parentId,
      language: lang.id,
      version: version.id,
      content: starterCode,
      isUserModified: false,
    });

    const tab: Tab = { file, isDirty: false };
    this.tabs.push(tab);
    
    // Switch to new tab
    await this.switchToTab(tab.file.id);
    
    this.events.onTabCreate?.(tab);
    this.events.onTabsChange?.(this.tabs);
    
    return tab;
  }

  /**
   * Generate a unique file name
   */
  private generateUniqueName(baseName: string): string {
    const existing = new Set(this.tabs.map(t => t.file.name));
    if (!existing.has(baseName)) return baseName;

    const dotIdx = baseName.lastIndexOf('.');
    const nameWithoutExt = dotIdx > 0 ? baseName.slice(0, dotIdx) : baseName;
    const ext = dotIdx > 0 ? baseName.slice(dotIdx) : '';

    let counter = 1;
    let newName = `${nameWithoutExt}_${counter}${ext}`;
    while (existing.has(newName)) {
      counter++;
      newName = `${nameWithoutExt}_${counter}${ext}`;
    }
    return newName;
  }

  /**
   * Switch to a tab
   */
  async switchToTab(fileId: string): Promise<Tab | null> {
    // Save current tab first
    if (this.activeTabId) {
      await this.saveCurrentTab();
    }

    const tab = this.tabs.find(t => t.file.id === fileId);
    if (!tab) return null;

    this.activeTabId = fileId;
    await this.saveWorkspaceState();
    
    this.render();
    this.events.onTabSwitch?.(tab);
    
    return tab;
  }

  /**
   * Close a tab
   */
  async closeTab(fileId: string): Promise<Tab | null> {
    const tabIndex = this.tabs.findIndex(t => t.file.id === fileId);
    if (tabIndex === -1) return null;

    const closedTab = this.tabs[tabIndex];

    // If closing unsaved tab, confirm (in real IDE, show dialog)
    // For now, auto-save
    if (closedTab.isDirty) {
      await this.saveTab(closedTab);
    }

    // Delete from storage
    await storage.deleteFile(fileId);

    // Remove from tabs
    this.tabs.splice(tabIndex, 1);

    // If we closed the active tab, switch to another
    if (this.activeTabId === fileId) {
      if (this.tabs.length > 0) {
        // Switch to neighbor tab
        const newIndex = Math.min(tabIndex, this.tabs.length - 1);
        await this.switchToTab(this.tabs[newIndex].file.id);
      } else {
        this.activeTabId = null;
      }
    }

    this.render();
    this.events.onTabClose?.(closedTab);
    this.events.onTabsChange?.(this.tabs);

    return closedTab;
  }

  /**
   * Close all tabs without saving or deleting files
   * Used when clearing cache
   */
  closeAllTabs(): void {
    this.tabs = [];
    this.activeTabId = null;
    this.render();
    this.events.onTabsChange?.(this.tabs);
  }

  /**
   * Rename a tab/file
   */
  async renameTab(fileId: string, newName: string): Promise<Tab | null> {
    const tab = this.tabs.find(t => t.file.id === fileId);
    if (!tab) return null;

    // Ensure unique name
    const uniqueName = this.generateUniqueName(newName);
    
    const updated = await storage.updateFile(fileId, { name: uniqueName });
    if (updated) {
      tab.file = updated;
      this.render();
      this.events.onTabUpdate?.(tab);
    }

    return tab;
  }

  // ========== Content Management ==========

  /**
   * Update tab content (called when editor content changes)
   */
  markDirty(fileId: string, content: string): void {
    const tab = this.tabs.find(t => t.file.id === fileId);
    if (!tab) return;

    tab.file.content = content;
    tab.file.isUserModified = true; // User has made changes
    tab.isDirty = true;
    this.render();

    // Schedule auto-save
    this.scheduleAutoSave(tab);
  }

  /**
   * Schedule auto-save with debounce
   */
  private scheduleAutoSave(tab: Tab): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    this.autoSaveTimer = window.setTimeout(async () => {
      await this.saveTab(tab);
    }, this.autoSaveDelay);
  }

  /**
   * Save a specific tab
   */
  async saveTab(tab: Tab): Promise<void> {
    const updated = await storage.updateFile(tab.file.id, {
      content: tab.file.content,
      language: tab.file.language,
      version: tab.file.version,
      isUserModified: tab.file.isUserModified,
    });

    if (updated) {
      tab.file = updated;
      tab.isDirty = false;
      this.render();
      this.events.onTabUpdate?.(tab);
    }
  }

  /**
   * Save current active tab
   */
  async saveCurrentTab(): Promise<void> {
    const tab = this.getActiveTab();
    if (tab && tab.isDirty) {
      await this.saveTab(tab);
    }
  }

  /**
   * Update language/version for a tab
   * @param newContent - If provided, replaces content (used when switching unmodified tabs)
   */
  async updateTabLanguage(
    fileId: string, 
    lang: LoadedLanguage, 
    version: VersionConfig,
    newContent?: string
  ): Promise<Tab | null> {
    const tab = this.tabs.find(t => t.file.id === fileId);
    if (!tab) return null;

    // Update extension in name
    const oldName = tab.file.name;
    const dotIdx = oldName.lastIndexOf('.');
    const baseName = dotIdx > 0 ? oldName.slice(0, dotIdx) : oldName;
    const newName = `${baseName}.${lang.extension}`;
    const uniqueName = this.generateUniqueName(newName);

    const updateData: Partial<StoredFile> = {
      language: lang.id,
      version: version.id,
      name: uniqueName,
    };

    // If new content provided (tab was unmodified), replace content and reset modified flag
    if (newContent !== undefined) {
      updateData.content = newContent;
      updateData.isUserModified = false;
    }

    const updated = await storage.updateFile(fileId, updateData);

    if (updated) {
      tab.file = updated;
      tab.isDirty = false; // Content just synced with storage
      this.render();
      this.events.onTabUpdate?.(tab);
    }

    return tab;
  }

  /**
   * Check if a tab has been modified by the user.
   * Compares current content against the starter template - if they match,
   * the file is considered "unmodified" even if isUserModified flag is set.
   */
  async isTabUserModifiedAsync(fileId: string): Promise<boolean> {
    const tab = this.tabs.find(t => t.file.id === fileId);
    if (!tab) return false;
    
    // If flag says not modified, definitely not modified
    if (!tab.file.isUserModified) return false;
    
    // Flag says modified, but let's check if content matches starter
    try {
      const starter = await getStarterAsync(tab.file.language, tab.file.version);
      const currentContent = tab.file.content.trim();
      const starterContent = starter.trim();
      
      // If content matches starter exactly, it's not really "modified"
      if (currentContent === starterContent) {
        // Reset the flag since it's not actually modified
        tab.file.isUserModified = false;
        return false;
      }
    } catch {
      // If we can't get starter, fall back to flag
    }
    
    return tab.file.isUserModified;
  }

  /**
   * Sync check if a tab has been modified (uses flag only, for backwards compatibility)
   */
  isTabUserModified(fileId: string): boolean {
    const tab = this.tabs.find(t => t.file.id === fileId);
    return tab?.file.isUserModified ?? false;
  }

  // ========== State Management ==========

  /**
   * Save workspace state
   */
  private async saveWorkspaceState(): Promise<void> {
    await storage.saveWorkspaceState({
      activeFileId: this.activeTabId,
      theme: 'vs-dark', // TODO: Get from actual theme selector
    });
  }

  // ========== Getters ==========

  getTab(fileId: string): Tab | null {
    return this.tabs.find(t => t.file.id === fileId) || null;
  }

  getActiveTab(): Tab | null {
    if (!this.activeTabId) return null;
    return this.tabs.find(t => t.file.id === this.activeTabId) || null;
  }

  getAllTabs(): Tab[] {
    return [...this.tabs];
  }

  getTabCount(): number {
    return this.tabs.length;
  }

  // ========== UI Rendering ==========

  /**
   * Render the tab bar
   */
  render(): void {
    this.containerEl.innerHTML = '';

    // Create tabs
    for (const tab of this.tabs) {
      const tabEl = this.createTabElement(tab);
      this.containerEl.appendChild(tabEl);
    }

    // Add "+" button
    const addBtn = document.createElement('button');
    addBtn.className = 'tab-add';
    addBtn.innerHTML = '+';
    addBtn.title = 'New file (Ctrl+N)';
    addBtn.onclick = () => this.events.onTabCreate?.(null as any); // Signal to create new
    this.containerEl.appendChild(addBtn);
  }

  /**
   * Create a single tab element
   */
  private createTabElement(tab: Tab): HTMLElement {
    const isActive = tab.file.id === this.activeTabId;

    const tabEl = document.createElement('div');
    tabEl.className = `tab ${isActive ? 'tab-active' : ''}`;
    tabEl.dataset.fileId = tab.file.id;

    // File icon based on language
    const iconEl = document.createElement('span');
    iconEl.className = 'tab-icon';
    iconEl.textContent = this.getLanguageIcon(tab.file.language);
    tabEl.appendChild(iconEl);

    // File name
    const nameEl = document.createElement('span');
    nameEl.className = 'tab-name';
    nameEl.textContent = tab.file.name;
    nameEl.ondblclick = (e) => {
      e.stopPropagation();
      this.startRename(tab, nameEl);
    };
    tabEl.appendChild(nameEl);

    // Dirty indicator
    if (tab.isDirty) {
      const dirtyEl = document.createElement('span');
      dirtyEl.className = 'tab-dirty';
      dirtyEl.textContent = '●';
      dirtyEl.title = 'Unsaved changes';
      tabEl.appendChild(dirtyEl);
    }

    // Close button
    const closeEl = document.createElement('button');
    closeEl.className = 'tab-close';
    closeEl.innerHTML = '×';
    closeEl.title = 'Close';
    closeEl.onclick = (e) => {
      e.stopPropagation();
      this.closeTab(tab.file.id);
    };
    tabEl.appendChild(closeEl);

    // Click to switch
    tabEl.onclick = () => this.switchToTab(tab.file.id);

    // Middle-click to close
    tabEl.onmousedown = (e) => {
      if (e.button === 1) { // Middle click
        e.preventDefault();
        this.closeTab(tab.file.id);
      }
    };

    return tabEl;
  }

  /**
   * Get language icon/emoji
   */
  private getLanguageIcon(langId: string): string {
    const icons: Record<string, string> = {
      javascript: '🟨',
      typescript: '🔷',
      python: '🐍',
      java: '☕',
      php: '🐘',
    };
    return icons[langId] || '📄';
  }

  /**
   * Start inline rename
   */
  private startRename(tab: Tab, nameEl: HTMLElement): void {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.value = tab.file.name;
    
    const finishRename = async () => {
      const newName = input.value.trim();
      if (newName && newName !== tab.file.name) {
        await this.renameTab(tab.file.id, newName);
      } else {
        this.render();
      }
    };

    input.onblur = finishRename;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = tab.file.name;
        input.blur();
      }
    };

    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();
  }
}
