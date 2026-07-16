// @ts-nocheck
import * as monaco from 'monaco-editor';
import { getLanguage } from '../languages';
import { runtime } from '../app/runtime';
import { policyState } from '../app/config';
import {
  searchInput, replaceInput, searchResultsEl, searchSummaryEl, searchCountEl,
  btnRegex, btnCase, btnWord, btnClearSearch, btnReplaceAll, btnReplaceAllFiles,
} from '../components/dom';
import { setOutput } from '../components/output';

const editor = new Proxy({} as any, { get: (_t, p) => (runtime.editor as any)[p] });
const tabManager = new Proxy({} as any, { get: (_t, p) => (runtime.tabManager as any)[p] });
const storage = new Proxy({} as any, { get: (_t, p) => (runtime.storage as any)[p] });
const fileModels = runtime.fileModels;

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

/**
 * Return the newest content for a file.
 *
 * Storage can lag behind an open Monaco model while the user is typing, so
 * search/replace must prefer the model, then the open tab, then IndexedDB.
 */
function getLiveFileContent(fileId: string, storedContent: string = ''): string {
  const model = fileModels.get(fileId);
  if (model && !model.isDisposed()) {
    return model.getValue();
  }

  const tab = tabManager.getTab(fileId);
  if (tab) {
    return tab.file.content ?? storedContent;
  }

  return storedContent;
}

/**
 * Apply replacement content consistently to every representation of a file:
 * Monaco model, open tab metadata, and persistent storage.
 */
async function persistReplacedContent(fileId: string, newContent: string): Promise<void> {
  const model = fileModels.get(fileId);
  if (model && !model.isDisposed() && model.getValue() !== newContent) {
    model.setValue(newContent);
  }

  const updatedFile = await storage.updateFile(fileId, { content: newContent });
  const tab = tabManager.getTab(fileId);

  if (tab) {
    tab.file = updatedFile
      ? { ...updatedFile, content: newContent }
      : { ...tab.file, content: newContent };

    // Replacement is persisted immediately, so the tab should not retain a
    // stale dirty flag from Monaco's synchronous change event.
    tab.isDirty = false;
  }

  runtime.notifyWorkspaceChanged();
}

function buildSearchPattern(query: string, global: boolean): RegExp {
  const flags = `${global ? 'g' : ''}${searchOptions.caseSensitive ? '' : 'i'}`;

  if (searchOptions.regex) {
    return new RegExp(query, flags);
  }

  let escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (searchOptions.wholeWord) {
    escapedQuery = `\\b${escapedQuery}\\b`;
  }

  return new RegExp(escapedQuery, flags);
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

  let searchPattern: RegExp;
  try {
    searchPattern = buildSearchPattern(query, true);
  } catch {
    setOutput('Invalid search pattern');
    return;
  }

  const storedFile = await storage.getFile(activeTab.file.id);
  const currentContent = getLiveFileContent(
    activeTab.file.id,
    storedFile?.content ?? activeTab.file.content ?? ''
  );

  const matches = currentContent.match(searchPattern);
  const matchCount = matches?.length ?? 0;

  if (matchCount === 0) {
    setOutput('No matches to replace in current file');
    return;
  }

  // Rebuild because RegExp instances with the global flag are stateful.
  const replacementPattern = buildSearchPattern(query, true);
  const newContent = currentContent.replace(replacementPattern, replaceInput.value);

  await persistReplacedContent(activeTab.file.id, newContent);
  await performSearch();

  setOutput(
    `Replaced ${matchCount} occurrence${matchCount === 1 ? '' : 's'} in ${activeTab.file.name}`
  );
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
  const matches: SearchMatch[] = [];
  const lines = content.split('\n');
  
  let searchPattern: RegExp;
  try {
    searchPattern = buildSearchPattern(query, true);
  } catch {
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

async function replaceSingleMatch(
  fileId: string,
  line: number,
  column: number,
  searchText: string,
  replaceText: string
) {
  const file = await storage.getFile(fileId);
  if (!file) return;

  const currentContent = getLiveFileContent(fileId, file.content);
  const lines = currentContent.split('\n');
  const targetLine = lines[line - 1];
  if (targetLine === undefined) return;

  let searchPattern: RegExp;
  try {
    searchPattern = buildSearchPattern(searchText, false);
  } catch {
    setOutput('Invalid search pattern');
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
    setOutput('That search result changed. Search results were refreshed.');
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

  const confirmed = confirm(
    `Replace ${totalMatches} occurrences in ${currentSearchResults.length} files?`
  );
  if (!confirmed) return;

  let replacedCount = 0;
  let changedFiles = 0;

  // Copy the result list because performSearch() replaces the global array.
  const resultsToReplace = [...currentSearchResults];

  for (const result of resultsToReplace) {
    const file = await storage.getFile(result.fileId);
    if (!file) continue;

    const currentContent = getLiveFileContent(result.fileId, file.content);

    let searchPattern: RegExp;
    try {
      searchPattern = buildSearchPattern(query, true);
    } catch {
      setOutput('Invalid search pattern');
      return;
    }

    const matches = currentContent.match(searchPattern);
    const fileMatchCount = matches?.length ?? 0;
    if (fileMatchCount === 0) continue;

    const replacementPattern = buildSearchPattern(query, true);
    const newContent = currentContent.replace(
      replacementPattern,
      replaceInput.value
    );

    await persistReplacedContent(result.fileId, newContent);
    replacedCount += fileMatchCount;
    changedFiles++;
  }

  await performSearch();
  setOutput(
    `Replaced ${replacedCount} occurrence${replacedCount === 1 ? '' : 's'} in ${changedFiles} file${changedFiles === 1 ? '' : 's'}`
  );
});

