/**
 * The tab bar: which documents are open, which one is showing, and its rendering.
 *
 * This used to be the workspace. It held every open file's text in
 * `tab.file.content`, wrote to IndexedDB, debounced autosaves on a single shared
 * timer, and rendered the tab strip - which is why the data-loss defects lived
 * here. It is now a **view**: it owns the open-tab list and the DOM, and asks
 * `WorkspaceService` for everything else.
 *
 * `Tab.file` is deliberately still shaped like the old `StoredFile`, but it is now
 * a **live projection** rather than a snapshot: `content` reads the document's
 * buffer on every access and `path` is derived from the folder tree. That keeps the
 * existing call sites working while making them correct - the several places that
 * did "check the model, then the tab, then the record" to find the freshest copy
 * now get the same answer whichever they ask.
 */

import { getAllLanguages, getLanguage, getStarterAsync, LoadedLanguage, VersionConfig } from './languages';
import { isWorkspaceEntryHidden } from './features/workspace-visibility';
import type { StoredFile } from './storage';
import type { WorkspaceDocument, WorkspaceService } from './workspace';

export interface Tab {
  /** A live view of the document. Not a copy - `content` reads the buffer. */
  readonly file: StoredFile;
  readonly isDirty: boolean;
  readonly document: WorkspaceDocument;
}

export interface TabManagerEvents {
  onTabSwitch?: (tab: Tab) => void;
  onTabCreate?: (tab: Tab | null) => void;
  onTabClose?: (tab: Tab) => void;
  onTabUpdate?: (tab: Tab) => void;
  onTabsChange?: (tabs: Tab[]) => void;
}

/**
 * Project a document as the legacy `StoredFile` shape, reading through to the
 * live buffer and the derived path.
 *
 * Getters rather than a spread: a spread would snapshot `content`, and a
 * snapshot of content is precisely what every data-loss defect was made of.
 */
function projectDocument(document: WorkspaceDocument, service: WorkspaceService): StoredFile {
  return {
    id: document.id,
    get name() {
      return document.metadata.name;
    },
    get path() {
      return service.pathOf(document.id) ?? document.metadata.name;
    },
    get parentId() {
      return document.metadata.parentId;
    },
    get language() {
      return document.metadata.language;
    },
    get version() {
      return document.metadata.version;
    },
    get content() {
      return document.getContent();
    },
    get createdAt() {
      return document.metadata.createdAt;
    },
    get updatedAt() {
      return document.metadata.updatedAt;
    },
    get order() {
      return document.metadata.order;
    },
    get isUserModified() {
      return document.metadata.isUserModified;
    },
  } as StoredFile;
}

export class TabManager {
  #service: WorkspaceService;
  #containerEl: HTMLElement;
  #events: TabManagerEvents;

  /** Open document ids, in tab-strip order. */
  #openIds: string[] = [];
  #activeId: string | null = null;
  #views = new Map<string, Tab>();

  constructor(containerEl: HTMLElement, service: WorkspaceService, events: TabManagerEvents = {}) {
    this.#containerEl = containerEl;
    this.#service = service;
    this.#events = events;

    // A rename or language change must redraw the strip. Previously each call site
    // remembered to do this itself, and the ones that forgot showed a stale name.
    this.#service.onDidChangeWorkspace(event => {
      if (event.reason === 'delete' || event.reason === 'clear' || event.reason === 'replace-all') {
        this.#dropClosedDocuments();
      }
      this.render();
    });
  }

  // ========== Initialization ==========

  /** Open the persisted workspace and return the tab to show, if any. */
  async init(_defaultLang?: LoadedLanguage, _defaultVersion?: VersionConfig): Promise<Tab | null> {
    if (!this.#service.isOpen) await this.#service.open();

    const visible = this.#service
      .allDocuments()
      .filter(document => !isWorkspaceEntryHidden(this.#legacyShape(document)));

    const restored =
      visible.find(document => document.id === this.#service.state.activeFileId) ?? visible[0] ?? null;

    if (!restored) {
      // A workspace containing only hidden support files opens with no visible
      // tab. The files stay available to imports and execution.
      this.#openIds = [];
      this.#activeId = null;
      this.render();
      this.#events.onTabsChange?.(this.getAllTabs());
      return null;
    }

    this.#openIds = [restored.id];
    this.#activeId = restored.id;
    this.render();
    this.#events.onTabsChange?.(this.getAllTabs());
    return this.#viewOf(restored);
  }

  /** Embedded mode: no restore, because the host supplies content on every load. */
  async initEmbedded(): Promise<void> {
    await this.#service.openEmpty();
    this.#openIds = [];
    this.#activeId = null;
    this.render();
    this.#events.onTabsChange?.(this.getAllTabs());
  }

  /**
   * Replace every file with a host-supplied project.
   *
   * The atomicity, validation and identity preservation all live in
   * `WorkspaceService.replaceAll`; this only decides which tab ends up showing.
   */
  async replaceAllFiles(
    files: Array<{ path: string; content: string; language?: string }>,
    defaultLang: LoadedLanguage,
    defaultVersion: VersionConfig,
  ): Promise<Tab | null> {
    const previousActivePath = this.#activeId ? this.#service.pathOf(this.#activeId) : null;

    const result = await this.#service.replaceAll(files, {
      resolve: (fileName, explicitLanguage) => {
        const explicit = explicitLanguage ? getLanguage(explicitLanguage) : undefined;
        const language = explicit || this.detectLanguageByExtension(fileName) || defaultLang;
        // The version must belong to the language that was actually chosen.
        // Resolving them independently is how an explicit `python` file could be
        // given a JavaScript version id.
        const version =
          language.id === defaultLang.id
            ? defaultVersion
            : language.versions.find(candidate => candidate.default) || language.versions[0];
        return { id: language.id, version: version.id };
      },
    });

    this.#views.clear();
    const visible = result.documents.filter(
      document => !isWorkspaceEntryHidden(this.#legacyShape(document)),
    );

    const toOpen =
      (previousActivePath
        ? visible.find(document => this.#service.pathOf(document.id) === previousActivePath)
        : undefined) ??
      visible[0] ??
      null;

    this.#openIds = toOpen ? [toOpen.id] : [];
    this.#activeId = toOpen?.id ?? null;
    await this.#service.setActiveDocument(this.#activeId);

    this.render();
    this.#events.onTabsChange?.(this.getAllTabs());
    return toOpen ? this.#viewOf(toOpen) : null;
  }

  /**
   * Resolve a language by file extension, e.g. "Hello.cs" -> csharp.
   *
   * Aliases are checked as well as the primary extension, and only after every
   * primary has been tried: a language must never lose its own extension to
   * another language's alias list, whatever order the registry happens to be in.
   */
  detectLanguageByExtension(fileName: string): LoadedLanguage | undefined {
    const dot = fileName.lastIndexOf('.');
    if (dot <= 0) return undefined;
    const extension = fileName.slice(dot + 1).toLowerCase();

    const all = getAllLanguages();
    return (
      all.find(language => language.extension.toLowerCase() === extension) ??
      all.find(language =>
        (language.extensions ?? []).some(alias => alias.toLowerCase() === extension),
      )
    );
  }

  // ========== Tab operations ==========

  async createNewFile(
    lang: LoadedLanguage,
    version: VersionConfig,
    name?: string,
    parentId: string | null = null,
    emptyFile = false,
  ): Promise<Tab | null> {
    const content = emptyFile ? '' : await getStarterAsync(lang.id, version.id);

    const document = await this.#service.createDocument({
      name: name || `main.${lang.extension}`,
      parentId,
      language: lang.id,
      version: version.id,
      content,
      isUserModified: false,
    });

    const tab = this.#viewOf(document);
    await this.switchToTab(document.id);
    this.#events.onTabCreate?.(tab);
    this.#events.onTabsChange?.(this.getAllTabs());
    return tab;
  }

  /**
   * Open the clean starter file for a language, or create one.
   *
   * If a file for that language exists whose content is byte-for-byte the starter,
   * focus it. If every one has been changed even by a single character, create a
   * new starter instead - so the language selector can never rewrite the file the
   * user is looking at.
   */
  async openLanguageTemplateFile(
    lang: LoadedLanguage,
    version: VersionConfig,
    parentId?: string | null,
  ): Promise<{ tab: Tab; created: boolean } | null> {
    const targetParentId =
      parentId !== undefined ? parentId : (this.getActiveTab()?.file.parentId ?? null);

    const candidates = this.#service
      .allDocuments()
      .filter(document => !isWorkspaceEntryHidden(this.#legacyShape(document)))
      .filter(document => document.language === lang.id);

    // Same folder first, so the selector prefers a file the user can already see.
    const ordered = [
      ...candidates.filter(document => document.parentId === targetParentId),
      ...candidates.filter(document => document.parentId !== targetParentId),
    ];

    const starterCache = new Map<string, string>();
    const starterFor = async (versionId: string): Promise<string> => {
      const cached = starterCache.get(versionId);
      if (cached !== undefined) return cached;
      const starter = await getStarterAsync(lang.id, versionId);
      starterCache.set(versionId, starter);
      return starter;
    };

    for (const document of ordered) {
      const documentVersion = lang.versions.find(candidate => candidate.id === document.version) || version;
      const starter = await starterFor(documentVersion.id);

      // Exact comparison: no trim, no normalization, no modified-flag shortcut.
      if (document.getContent() === starter) {
        const tab = await this.switchToTab(document.id);
        return tab ? { tab, created: false } : null;
      }
    }

    const starter = await starterFor(version.id);
    const created = await this.#service.createDocument({
      name: `main.${lang.extension}`,
      parentId: targetParentId,
      language: lang.id,
      version: version.id,
      content: starter,
      isUserModified: false,
    });

    const tab = await this.switchToTab(created.id);
    if (!tab) return null;

    this.#events.onTabCreate?.(tab);
    this.#events.onTabsChange?.(this.getAllTabs());
    return { tab, created: true };
  }

  async switchToTab(fileId: string): Promise<Tab | null> {
    const document = this.#service.getDocument(fileId);
    if (!document) return null;
    if (isWorkspaceEntryHidden(this.#legacyShape(document))) return null;

    // Flush the outgoing tab rather than relying on its debounce, so switching
    // away is a durability point.
    if (this.#activeId && this.#activeId !== fileId) {
      await this.#service.flush(this.#activeId);
    }

    if (!this.#openIds.includes(fileId)) {
      this.#openIds.push(fileId);
      this.#events.onTabsChange?.(this.getAllTabs());
    }

    this.#activeId = fileId;
    await this.#service.setActiveDocument(fileId);

    const tab = this.#viewOf(document);
    this.render();
    this.#events.onTabSwitch?.(tab);
    return tab;
  }

  /**
   * Close a tab. The file stays in storage and in the explorer (VS Code
   * semantics); deleting is a separate, explicit explorer action.
   */
  async closeTab(fileId: string): Promise<Tab | null> {
    const index = this.#openIds.indexOf(fileId);
    if (index === -1) return null;

    const document = this.#service.getDocument(fileId);
    const closed = document ? this.#viewOf(document) : null;

    if (document?.isDirty) await this.#service.flush(fileId);

    this.#openIds.splice(index, 1);

    if (this.#activeId === fileId) {
      if (this.#openIds.length > 0) {
        const neighbour = this.#openIds[Math.min(index, this.#openIds.length - 1)];
        await this.switchToTab(neighbour);
      } else {
        this.#activeId = null;
        await this.#service.setActiveDocument(null);
      }
    }

    this.#views.delete(fileId);
    this.render();
    if (closed) this.#events.onTabClose?.(closed);
    this.#events.onTabsChange?.(this.getAllTabs());
    return closed;
  }

  /**
   * Close every tab without deleting files.
   *
   * Deliberately does NOT touch persistence. The previous implementation cleared
   * its single autosave timer here, because its one caller is Clear Cache and a
   * debounced save landing after the database was emptied would recreate a file the
   * user had just deleted. That hazard now belongs to `WorkspaceService.clearAll`,
   * which suspends the writers, unregisters every document and resumes - so the
   * protection travels with the operation that needs it instead of depending on
   * two calls happening in the right order.
   */
  closeAllTabs(): void {
    const closed = this.getAllTabs();
    this.#openIds = [];
    this.#activeId = null;
    this.#views.clear();

    this.render();
    for (const tab of closed) this.#events.onTabClose?.(tab);
    this.#events.onTabsChange?.([]);
  }

  /** Rename. Metadata only - the working copy is never touched. */
  async renameTab(fileId: string, newName: string): Promise<Tab | null> {
    const document = await this.#service.renameDocument(fileId, newName);
    if (!document) return null;

    const detected = this.detectLanguageByExtension(document.name);
    if (detected && detected.id !== document.language) {
      const version = detected.versions.find(candidate => candidate.default) || detected.versions[0];
      await this.#service.setDocumentLanguage(fileId, detected.id, version.id);
    }

    // Renaming a visible file to the hidden prefix removes it from the student's
    // UI immediately, without deleting it from storage.
    if (isWorkspaceEntryHidden(this.#legacyShape(document))) {
      await this.#service.flush(fileId);
      const tab = this.#viewOf(document);
      const index = this.#openIds.indexOf(fileId);
      const wasActive = this.#activeId === fileId;
      if (index !== -1) this.#openIds.splice(index, 1);

      if (wasActive) {
        this.#activeId = null;
        const next = this.#openIds[Math.min(index, this.#openIds.length - 1)] ?? this.#openIds[0] ?? null;
        if (next) await this.switchToTab(next);
        else await this.#service.setActiveDocument(null);
      }

      this.#views.delete(fileId);
      this.render();
      this.#events.onTabClose?.(tab);
      this.#events.onTabsChange?.(this.getAllTabs());
      return null;
    }

    const tab = this.#viewOf(document);
    this.render();
    this.#events.onTabUpdate?.(tab);
    return tab;
  }

  // ========== Content ==========

  /**
   * Retained for callers that still push editor text in explicitly.
   *
   * Once a document's buffer IS the Monaco model, edits are observed directly and
   * this is a no-op for the active document - which is why it no longer schedules
   * anything itself. The coordinator is already subscribed.
   */
  markDirty(fileId: string, content: string): void {
    const document = this.#service.getDocument(fileId);
    if (!document) return;

    if (document.getContent() !== content) document.setContent(content);
    if (!document.metadata.isUserModified) {
      void this.#service.setDocumentUserModified(fileId, true);
    }
    this.render();
  }

  async saveTab(tab: Tab): Promise<void> {
    await this.#service.flush(tab.file.id);
    this.render();
    this.#events.onTabUpdate?.(tab);
  }

  async saveCurrentTab(): Promise<void> {
    if (this.#activeId) await this.#service.flush(this.#activeId);
  }

  /** Change a document's language and version, optionally replacing content. */
  async updateTabLanguage(
    fileId: string,
    lang: LoadedLanguage,
    version: VersionConfig,
    newContent?: string,
  ): Promise<Tab | null> {
    const document = this.#service.getDocument(fileId);
    if (!document) return null;

    const dot = document.name.lastIndexOf('.');
    const stem = dot > 0 ? document.name.slice(0, dot) : document.name;

    const updated = await this.#service.setDocumentLanguage(fileId, lang.id, version.id, {
      name: `${stem}.${lang.extension}`,
      ...(newContent !== undefined ? { content: newContent, isUserModified: false } : {}),
    });
    if (!updated) return null;

    const tab = this.#viewOf(updated);
    this.render();
    this.#events.onTabUpdate?.(tab);
    return tab;
  }

  /**
   * Has the user really changed this file?
   *
   * Compares content against the starter **exactly**. The previous version
   * trimmed both sides (V-12), so adding a trailing newline - or deleting one -
   * counted as unmodified, and the version selector would then overwrite it.
   */
  async isTabUserModifiedAsync(fileId: string): Promise<boolean> {
    const document = this.#service.getDocument(fileId);
    if (!document) return false;
    if (!document.metadata.isUserModified) return false;

    try {
      const starter = await getStarterAsync(document.language, document.version);
      if (document.getContent() === starter) {
        await this.#service.setDocumentUserModified(fileId, false);
        return false;
      }
    } catch {
      // Starter unavailable: fall back to the stored flag rather than guessing
      // that the file is untouched, which would risk discarding real work.
    }

    return document.metadata.isUserModified;
  }

  isTabUserModified(fileId: string): boolean {
    return this.#service.getDocument(fileId)?.metadata.isUserModified ?? false;
  }

  // ========== Getters ==========

  getTab(fileId: string): Tab | null {
    const document = this.#service.getDocument(fileId);
    return document ? this.#viewOf(document) : null;
  }

  getActiveTab(): Tab | null {
    if (!this.#activeId) return null;
    const document = this.#service.getDocument(this.#activeId);
    return document ? this.#viewOf(document) : null;
  }

  getAllTabs(): Tab[] {
    const tabs: Tab[] = [];
    for (const id of this.#openIds) {
      const document = this.#service.getDocument(id);
      if (document) tabs.push(this.#viewOf(document));
    }
    return tabs;
  }

  getTabCount(): number {
    return this.getAllTabs().length;
  }

  get activeDocumentId(): string | null {
    return this.#activeId;
  }

  // ========== Rendering ==========

  render(): void {
    this.#containerEl.innerHTML = '';

    for (const tab of this.getAllTabs()) {
      this.#containerEl.appendChild(this.#createTabElement(tab));
    }

    const addButton = document.createElement('button');
    addButton.className = 'tab-add';
    addButton.textContent = '+';
    addButton.title = 'New file (Ctrl+N)';
    addButton.onclick = () => {
      if (document.body.classList.contains('structure-locked')) return;
      this.#events.onTabCreate?.(null);
    };
    this.#containerEl.appendChild(addButton);
  }

  #createTabElement(tab: Tab): HTMLElement {
    const isActive = tab.file.id === this.#activeId;

    const tabEl = document.createElement('div');
    tabEl.className = `tab ${isActive ? 'tab-active' : ''}`;
    tabEl.dataset.fileId = tab.file.id;

    const iconEl = document.createElement('span');
    iconEl.className = 'tab-icon';
    iconEl.textContent = this.#languageIcon(tab.file.language);
    tabEl.appendChild(iconEl);

    const nameEl = document.createElement('span');
    nameEl.className = 'tab-name';
    nameEl.textContent = tab.file.name;
    nameEl.ondblclick = event => {
      event.stopPropagation();
      this.#startRename(tab, nameEl);
    };
    tabEl.appendChild(nameEl);

    if (tab.isDirty) {
      const dirtyEl = document.createElement('span');
      dirtyEl.className = 'tab-dirty';
      dirtyEl.textContent = '●';
      dirtyEl.title = 'Unsaved changes';
      tabEl.appendChild(dirtyEl);
    }

    const closeEl = document.createElement('button');
    closeEl.className = 'tab-close';
    closeEl.textContent = '×';
    closeEl.title = 'Close';
    closeEl.onclick = event => {
      event.stopPropagation();
      if (document.body.classList.contains('structure-locked')) return;
      void this.closeTab(tab.file.id);
    };
    tabEl.appendChild(closeEl);

    tabEl.onclick = () => void this.switchToTab(tab.file.id);
    tabEl.onmousedown = event => {
      if (event.button !== 1) return; // middle click
      event.preventDefault();
      if (document.body.classList.contains('structure-locked')) return;
      void this.closeTab(tab.file.id);
    };

    return tabEl;
  }

  #languageIcon(languageId: string): string {
    const icons: Record<string, string> = {
      javascript: '🟨',
      typescript: '🔷',
      python: '🐍',
      java: '☕',
      php: '🐘',
      csharp: '🟦',
    };
    return icons[languageId] || '📄';
  }

  #startRename(tab: Tab, nameEl: HTMLElement): void {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.value = tab.file.name;

    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      const newName = input.value.trim();
      if (newName && newName !== tab.file.name) await this.renameTab(tab.file.id, newName);
      else this.render();
    };

    input.onblur = () => void finish();
    input.onkeydown = event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      } else if (event.key === 'Escape') {
        input.value = tab.file.name;
        input.blur();
      }
    };

    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();
  }

  // ========== internals ==========

  /** One stable view object per document, so identity comparisons keep working. */
  #viewOf(document: WorkspaceDocument): Tab {
    const existing = this.#views.get(document.id);
    if (existing && existing.document === document) return existing;

    const file = projectDocument(document, this.#service);
    const view: Tab = {
      file,
      document,
      get isDirty() {
        return document.isDirty;
      },
    };
    this.#views.set(document.id, view);
    return view;
  }

  #legacyShape(document: WorkspaceDocument): StoredFile {
    return projectDocument(document, this.#service);
  }

  #dropClosedDocuments(): void {
    this.#openIds = this.#openIds.filter(id => this.#service.getDocument(id) !== null);
    for (const id of [...this.#views.keys()]) {
      if (!this.#service.getDocument(id)) this.#views.delete(id);
    }
    if (this.#activeId && !this.#service.getDocument(this.#activeId)) {
      this.#activeId = this.#openIds[0] ?? null;
    }
  }
}
