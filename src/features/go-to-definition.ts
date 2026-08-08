import * as monaco from 'monaco-editor';
import { requireModels, runtime } from '../app/runtime';
import { getAllLanguages } from '../languages';
import { maskCommentsAndStrings } from '../languages/syntax.ts';
import type { StoredFile } from '../storage';
import { isWorkspaceEntryHidden } from './workspace-visibility';
import { t } from '../i18n/index.ts';

interface SymbolDefinition {
  name: string;
  file: StoredFile;
  line: number;
  column: number;
  length: number;
  kind: 'function' | 'method' | 'class' | 'variable' | 'constant';
}

interface ImportHint {
  localName: string;
  importedName: string;
  moduleSpecifier: string;
}

let disposables: monaco.IDisposable[] = [];
let actionDisposable: monaco.IDisposable | null = null;
let languageHandler: (() => void) | null = null;
let navigationSequence = 0;

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function dirname(value: string): string {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf('/');
  return index < 0 ? '' : normalized.slice(0, index);
}

function removeExtension(value: string): string {
  return value.replace(/\.[^/.]+$/, '');
}

function joinPath(base: string, relative: string): string {
  const parts = `${base}/${relative}`.split('/');
  const output: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') output.pop();
    else output.push(part);
  }

  return output.join('/');
}

/**
 * The file's current text.
 *
 * `StoredFile.content` now reads through to the authoritative buffer, so the old
 * three-way hunt for the freshest copy - model, then tab, then record - has one
 * answer. Kept as a named function because the intent ("current, not persisted")
 * is worth stating at the call sites.
 */
function getLiveContent(file: StoredFile): string {
  return file.content;
}


function collectDefinitions(file: StoredFile): SymbolDefinition[] {
  const content = getLiveContent(file);
  // Keyed by the file's own language. The lexer this replaced took no language and
  // hardcoded C-like syntax plus a `#` case - so it masked Python line comments but
  // not Python docstrings, and applied `#` to languages where it means something
  // else. See src/languages/syntax.ts.
  const lines = maskCommentsAndStrings(file.language, content).split('\n');
  const definitions: SymbolDefinition[] = [];
  const seen = new Set<string>();

  const add = (name: string, lineIndex: number, sourceLine: string, kind: SymbolDefinition['kind']) => {
    if (!name) return;
    const column = Math.max(0, sourceLine.indexOf(name));
    const key = `${lineIndex}:${column}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    definitions.push({
      name,
      file,
      line: lineIndex + 1,
      column: column + 1,
      length: name.length,
      kind,
    });
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) continue;

    let match: RegExpMatchArray | null;

    // Python
    match = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
    if (match) { add(match[1], index, line, 'function'); continue; }
    match = trimmed.match(/^class\s+([A-Za-z_]\w*)\b/);
    if (match) { add(match[1], index, line, 'class'); continue; }

    // JavaScript / TypeScript
    match = trimmed.match(/^(?:export\s+(?:default\s+)?)?(?:async\s+)?function(?:\s*\*)?\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (match) { add(match[1], index, line, 'function'); continue; }
    match = trimmed.match(/^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
    if (match) { add(match[1], index, line, 'class'); continue; }
    match = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/);
    if (match) {
      add(match[1], index, line, /=>|function\b/.test(trimmed) ? 'function' : 'variable');
      continue;
    }

    // PHP
    match = trimmed.match(/^(?:(?:public|protected|private|static|abstract|final|readonly)\s+)*function\s+&?\s*([A-Za-z_]\w*)\s*\(/i);
    if (match) { add(match[1], index, line, 'function'); continue; }
    match = trimmed.match(/^(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)\b/i);
    if (match) { add(match[1], index, line, 'class'); continue; }

    // Java / C# declarations and methods.
    match = trimmed.match(/^(?:(?:public|protected|private|internal|static|final|abstract|virtual|override|sealed|async|partial|extern|unsafe|synchronized|native|default|readonly|ref)\s+)*(?:class|interface|record(?:\s+class|\s+struct)?|struct|enum)\s+([A-Za-z_$][\w$]*)\b/);
    if (match) { add(match[1], index, line, 'class'); continue; }
    match = trimmed.match(/^(?:(?:public|protected|private|internal|static|final|abstract|virtual|override|sealed|async|partial|extern|unsafe|synchronized|native|default|readonly|ref|new)\s+)*(?:[\w$.[\]<>?,]+\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:throws\s+[^;{]+)?(?:\{|=>|;|$)/);
    if (match && !['if', 'for', 'while', 'switch', 'catch', 'foreach', 'using', 'lock'].includes(match[1])) {
      add(match[1], index, line, 'method');
      continue;
    }

    // Common top-level constants/assignments.
    match = trimmed.match(/^(?:final\s+|static\s+|const\s+)?(?:[A-Za-z_$][\w$<>?[\].,]*\s+)?([A-Za-z_$][\w$]*)\s*=/);
    if (match) add(match[1], index, line, 'variable');
  }

  return definitions;
}

function parseImportHints(content: string, language: string): ImportHint[] {
  const hints: ImportHint[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    let match: RegExpMatchArray | null;

    if (language === 'python') {
      match = line.match(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+(.+)$/);
      if (match) {
        for (const item of match[2].split(',')) {
          const itemMatch = item.trim().match(/^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?/);
          if (itemMatch) hints.push({
            localName: itemMatch[2] || itemMatch[1],
            importedName: itemMatch[1],
            moduleSpecifier: match[1],
          });
        }
        continue;
      }

      match = line.match(/^\s*import\s+([A-Za-z_][\w.]*)(?:\s+as\s+([A-Za-z_]\w*))?/);
      if (match) hints.push({
        localName: match[2] || match[1].split('.').at(-1)!,
        importedName: match[1].split('.').at(-1)!,
        moduleSpecifier: match[1],
      });
      continue;
    }

    match = line.match(/^\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (match) {
      for (const item of match[1].split(',')) {
        const itemMatch = item.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/);
        if (itemMatch) hints.push({
          localName: itemMatch[2] || itemMatch[1],
          importedName: itemMatch[1],
          moduleSpecifier: match[2],
        });
      }
      continue;
    }

    match = line.match(/^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/);
    if (match) hints.push({ localName: match[1], importedName: 'default', moduleSpecifier: match[2] });
  }

  return hints;
}

function moduleMatchesFile(specifier: string, sourceFile: StoredFile, targetFile: StoredFile): boolean {
  const sourceDir = dirname(sourceFile.path);
  const targetNoExt = removeExtension(normalizePath(targetFile.path));
  const targetNameNoExt = removeExtension(targetFile.name);

  if (specifier.startsWith('.')) {
    return removeExtension(joinPath(sourceDir, specifier)) === targetNoExt ||
      joinPath(sourceDir, specifier) === normalizePath(targetFile.path);
  }

  const modulePath = specifier.replace(/\./g, '/');
  return targetNoExt === modulePath ||
    targetNoExt.endsWith(`/${modulePath}`) ||
    targetNameNoExt === modulePath.split('/').at(-1);
}

async function resolveDefinitions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): Promise<SymbolDefinition[]> {
  const word = model.getWordAtPosition(position)?.word;
  if (!word || !runtime.storage || !runtime.tabManager) return [];

  const activeTab = runtime.tabManager.getActiveTab();
  const allFiles = await runtime.storage.getAllFiles();
  const files = allFiles.filter(file => !isWorkspaceEntryHidden(file));
  const sourceFile = activeTab?.file ?? files.find(file => runtime.fileModels.get(file.id) === model);
  if (!sourceFile) return [];

  const sourceLanguage = sourceFile.language;
  const hints = parseImportHints(model.getValue(), sourceLanguage).filter(hint => hint.localName === word);
  const allDefinitions = files.flatMap(collectDefinitions);

  const matching = allDefinitions.filter(definition => {
    if (definition.name === word) return true;
    return hints.some(hint => hint.importedName === definition.name || hint.importedName === 'default');
  });

  matching.sort((left, right) => {
    const leftImported = hints.some(hint =>
      (hint.importedName === left.name || hint.importedName === 'default') &&
      moduleMatchesFile(hint.moduleSpecifier, sourceFile, left.file));
    const rightImported = hints.some(hint =>
      (hint.importedName === right.name || hint.importedName === 'default') &&
      moduleMatchesFile(hint.moduleSpecifier, sourceFile, right.file));

    if (leftImported !== rightImported) return leftImported ? -1 : 1;
    if ((left.file.id === sourceFile.id) !== (right.file.id === sourceFile.id)) {
      return left.file.id === sourceFile.id ? -1 : 1;
    }
    if ((left.file.language === sourceLanguage) !== (right.file.language === sourceLanguage)) {
      return left.file.language === sourceLanguage ? -1 : 1;
    }
    return left.file.path.localeCompare(right.file.path) || left.line - right.line;
  });

  return matching;
}

/**
 * The model a definition lives in, created on demand.
 *
 * This used to fabricate a throwaway `Tab` just to reach `getOrCreateModel`. The
 * model registry is addressed by document, so the detour is gone - and because the
 * URI is now the file's real workspace path, the location handed back to Monaco
 * identifies the target unambiguously even when two folders hold a file of the
 * same name (V-18).
 */
function ensureTargetModel(definition: SymbolDefinition): monaco.editor.ITextModel | null {
  const document = runtime.workspace?.getDocument(definition.file.id);
  if (!document) return null;
  return requireModels().acquire(document);
}

function toLocation(definition: SymbolDefinition): monaco.languages.Location | null {
  const model = ensureTargetModel(definition);
  if (!model) return null;
  return {
    uri: model.uri,
    range: new monaco.Range(
      definition.line,
      definition.column,
      definition.line,
      definition.column + definition.length,
    ),
  };
}

async function navigateToDefinition(position?: monaco.Position): Promise<void> {
  const editor = runtime.editor;
  const tabManager = runtime.tabManager;
  if (!editor || !tabManager) return;

  const model = editor.getModel();
  const targetPosition = position ?? editor.getPosition();
  if (!model || !targetPosition) return;

  const sequence = ++navigationSequence;
  const definitions = await resolveDefinitions(model, targetPosition);
  if (sequence !== navigationSequence || definitions.length === 0) return;

  const definition = definitions[0];
  await tabManager.switchToTab(definition.file.id);

  const targetEditor = runtime.editor;
  if (!targetEditor) return;

  targetEditor.setPosition({ lineNumber: definition.line, column: definition.column });
  targetEditor.revealPositionInCenter({ lineNumber: definition.line, column: definition.column });
  targetEditor.focus();
}

export function initializeGoToDefinition(): void {
  disposeGoToDefinition();

  const editor = runtime.editor;
  if (!editor) return;

  const languageIds = new Set<string>(
    getAllLanguages().map(language => language.monacoLanguage),
  );

  for (const languageId of languageIds) {
    disposables.push(monaco.languages.registerDefinitionProvider(languageId, {
      provideDefinition: async (model, position) => {
        const definitions = await resolveDefinitions(model, position);
        // A definition whose document has since been deleted yields no location
        // rather than a fabricated one.
        return definitions
          .map(toLocation)
          .filter((location): location is monaco.languages.Location => location !== null);
      },
    }));
  }

  // Monaco's built-in definition provider supplies the familiar Ctrl/Cmd-hover
  // underline. This explicit mouse handler keeps TabManager and the explorer in
  // sync when the target lives in another workspace file.
  disposables.push(editor.onMouseDown(event => {
    const browserEvent = event.event.browserEvent as MouseEvent;
    if ((!browserEvent.ctrlKey && !browserEvent.metaKey) || !event.target.position) return;
    browserEvent.preventDefault();
    browserEvent.stopPropagation();
    void navigateToDefinition(event.target.position);
  }));

  const registerAction = () => {
    actionDisposable?.dispose();
    actionDisposable = editor.addAction({
      id: 'browser-coder.go-to-definition',
      label: t('command.goToDefinition'),
      keybindings: [monaco.KeyCode.F12],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1,
      run: () => navigateToDefinition(),
    });
  };
  registerAction();
  languageHandler = registerAction;
  window.addEventListener('languageChanged', languageHandler);
}

export function disposeGoToDefinition(): void {
  for (const disposable of disposables) disposable.dispose();
  disposables = [];
  actionDisposable?.dispose();
  actionDisposable = null;
  if (languageHandler) window.removeEventListener('languageChanged', languageHandler);
  languageHandler = null;
}
