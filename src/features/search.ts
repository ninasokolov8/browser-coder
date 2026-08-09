import * as monaco from 'monaco-editor';
import { getLanguage } from '../languages';
import {
  buildSearchPattern as buildPattern,
  findMatches,
  replaceInFile as coreReplaceInFile,
} from './search-core.ts';
import { runtime } from '../app/runtime';
import { policyState } from '../app/config';
import {
  searchInput, replaceInput, searchResultsEl, searchSummaryEl, searchCountEl,
  btnRegex, btnCase, btnWord, btnCodeOnly, btnClearSearch, btnReplaceAll, btnReplaceAllFiles,
} from '../components/dom';
import { setOutput } from '../components/output';
import { escapeHtml } from '../components/html-escape.ts';
import { isWorkspaceEntryHidden } from './workspace-visibility';
import { lazyRef } from '../app/lazy';
import { t, tn } from '../i18n/index.ts';

const editor = lazyRef(() => runtime.editor, 'editor');
const tabManager = lazyRef(() => runtime.tabManager, 'tabManager');
const storage = lazyRef(() => runtime.storage, 'storage');

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
  /**
   * Skip matches inside comments and string literals.
   *
   * The highest-value search feature the IDE was missing, and one that could not be
   * built before `src/languages/syntax.ts` existed: deciding whether an offset is
   * inside a comment needs a per-language lexer. Searching for a variable name and
   * getting every mention of it in prose is the common frustration this removes.
   */
  codeOnly: false,
};

let currentSearchResults: SearchResult[] = [];
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

let searchDecorations: string[] = [];  // Monaco decoration IDs for highlighting

/**
 * Return the newest content for a file.
 *
 * There is now one copy of a document's text, so there is nothing to prefer. The
 * previous implementation ranked model over tab over IndexedDB, which was correct
 * given three copies but only by convention - and search-and-replace across many
 * files is exactly where a mis-ranked read silently corrupts work.
 */
function getLiveFileContent(fileId: string, storedContent: string = ''): string {
  return runtime.workspace?.getDocument(fileId)?.getContent() ?? storedContent;
}

/**
 * Write replacement content into a document.
 *
 * One assignment to the working copy, then one revision-guarded flush. The old
 * version wrote to the model, wrote to storage, rebuilt `tab.file` from the
 * persisted row, and then set `isDirty = false` - the same shape as V-09, so a
 * keystroke arriving during a multi-file replace could be silently reverted.
 */
async function persistReplacedContent(fileId: string, newContent: string): Promise<void> {
  const workspace = runtime.workspace;
  const document = workspace?.getDocument(fileId);
  if (!workspace || !document) return;

  document.setContent(newContent);
  await workspace.flush(fileId);

  runtime.notifyWorkspaceChanged();
}

/*
 * Thin bindings over the pure scanner.
 *
 * The rules live in search-core.ts so they can be tested without a DOM; these carry the
 * current toggle state into them. Nothing here decides anything.
 */
function buildSearchPattern(query: string, global: boolean, language?: string): RegExp {
  return buildPattern(query, global, searchOptions, language);
}

function replaceInFile(
  content: string,
  query: string,
  language: string,
  replacement: string,
): { text: string; count: number } {
  return coreReplaceInFile(content, query, language, replacement, searchOptions);
}

// Function to highlight search matches in current editor
export function highlightSearchMatchesInEditor() {
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

  searchDecorations = editor.deltaDecorations(searchDecorations, newDecorations);
}

// Register globally once for the tab-switch callback.
(window as any).__refreshSearchHighlights = highlightSearchMatchesInEditor;

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

btnCodeOnly.addEventListener('click', () => {
  searchOptions.codeOnly = !searchOptions.codeOnly;
  btnCodeOnly.classList.toggle('active', searchOptions.codeOnly);
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
  if (!policyState.allowSearchReplace) return;

  const activeTab = tabManager.getActiveTab();
  const query = searchInput.value;
  if (!activeTab || !query) return;

  const storedFile = await storage.getFile(activeTab.file.id);
  const currentContent = getLiveFileContent(
    activeTab.file.id,
    storedFile?.content ?? activeTab.file.content ?? ''
  );

  // Through the shared helper, so this replaces exactly what the results list
  // showed - same language, same whole-word rule, same codeOnly filter.
  const { text: newContent, count: matchCount } = replaceInFile(
    currentContent,
    query,
    activeTab.file.language,
    replaceInput.value,
  );

  if (matchCount === 0) {
    setOutput(t('search.noMatchesCurrentFile'));
    return;
  }

  await persistReplacedContent(activeTab.file.id, newContent);
  await performSearch();

  setOutput(tn('search.replacedInFile', matchCount, { name: activeTab.file.name }));
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
    showSearchMessage('search.noResults');
    return;
  }

  const files = await storage.getAllFiles();
  currentSearchResults = [];

  for (const file of files) {
    if (isWorkspaceEntryHidden(file)) continue;

    const content = getLiveFileContent(file.id, file.content);
    const matches = searchInFile(content, query, file.id, file.name, file.language);
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
  // The same scan Replace All uses, placed on its lines and labelled with the file it
  // came from. The placement is in search-core.ts; this only adds the labels.
  return findMatches(content, query, language, searchOptions).map(match => ({
    fileId,
    fileName,
    language,
    line: match.line,
    column: match.column,
    text: match.text,
    matchStart: match.matchStart,
    matchEnd: match.matchEnd,
  }));
}

function renderSearchResults() {
  if (currentSearchResults.length === 0) {
    if (searchInput.value) {
      searchSummaryEl.classList.add('hidden');
      showSearchMessage('search.noneFound');
    }
    return;
  }

  // Calculate totals
  const totalMatches = currentSearchResults.reduce((sum, r) => sum + r.matches.length, 0);
  const totalFiles = currentSearchResults.length;

  searchCountEl.textContent = t('search.summary', {
    results: tn('search.resultCount', totalMatches),
    files: tn('search.fileCount', totalFiles),
  });
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
            <button class="search-match-btn" data-action="replace" title="${escapeHtml(t('search.replaceOne'))}">↻</button>
          </span>
        </div>
      `;
    }
  }

  searchResultsEl.innerHTML = html;
  attachSearchResultHandlers();
}

function showSearchMessage(key: string): void {
  searchResultsEl.textContent = '';
  const message = document.createElement('div');
  message.className = 'search-no-results';
  message.textContent = t(key);
  searchResultsEl.appendChild(message);
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

async function replaceSingleMatch(
  fileId: string,
  line: number,
  column: number,
  searchText: string,
  replaceText: string
) {
  const file = await storage.getFile(fileId);
  if (!file || isWorkspaceEntryHidden(file)) return;

  const currentContent = getLiveFileContent(fileId, file.content);
  const lines = currentContent.split('\n');
  const targetLine = lines[line - 1];
  if (targetLine === undefined) return;

  let searchPattern: RegExp;
  try {
    searchPattern = buildSearchPattern(searchText, false);
  } catch {
    setOutput(t('search.invalidPattern'));
    return;
  }

  const zeroBasedColumn = Math.max(0, column - 1);
  const before = targetLine.slice(0, zeroBasedColumn);
  const fromMatch = targetLine.slice(zeroBasedColumn);
  const match = searchPattern.exec(fromMatch);

  // The result list may have become stale after edits. Only replace when the
  // match still begins exactly at the clicked result's recorded column.
  if (!match || match.index !== 0) {
    await performSearch();
    setOutput(t('search.resultChanged'));
    return;
  }

  const replacement = fromMatch.replace(searchPattern, replaceText);
  lines[line - 1] = before + replacement;

  await persistReplacedContent(fileId, lines.join('\n'));
  await performSearch();
}

// Replace all matches in all files
btnReplaceAllFiles.addEventListener('click', async () => {
  if (!policyState.allowSearchReplace) return;

  const query = searchInput.value;
  if (!query || currentSearchResults.length === 0) return;

  const totalMatches = currentSearchResults.reduce(
    (sum, result) => sum + result.matches.length,
    0
  );

  const confirmed = confirm(t('search.confirmReplaceAll', {
    occurrences: tn('search.occurrenceCount', totalMatches),
    files: tn('search.fileCount', currentSearchResults.length),
  }));
  if (!confirmed) return;

  let replacedCount = 0;
  let changedFiles = 0;

  // Copy the result list because performSearch() replaces the global array.
  const resultsToReplace = [...currentSearchResults];

  for (const result of resultsToReplace) {
    const file = await storage.getFile(result.fileId);
    if (!file) continue;

    const currentContent = getLiveFileContent(result.fileId, file.content);

    // Per-file language, not a single pattern reused across the whole workspace:
    // a project can hold Python and CSS, and their word boundaries differ.
    const { text: newContent, count: fileMatchCount } = replaceInFile(
      currentContent,
      query,
      file.language,
      replaceInput.value,
    );
    if (fileMatchCount === 0) continue;

    await persistReplacedContent(result.fileId, newContent);
    replacedCount += fileMatchCount;
    changedFiles++;
  }

  await performSearch();
  setOutput(t('search.replacedAcrossFiles', {
    occurrences: tn('search.occurrenceCount', replacedCount),
    files: tn('search.fileCount', changedFiles),
  }));
});

window.addEventListener('languageChanged', () => {
  if (searchInput.value.trim()) renderSearchResults();
  else showSearchMessage('search.noResults');
});
