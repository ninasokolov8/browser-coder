import { runtime } from '../../app/runtime';
import type { StoredFile } from '../../storage';

export type WorkspacePathSnapshot = Map<string, string>;

interface RewriteResult {
  content: string;
  replacements: number;
  warnings: string[];
}

type SupportedImportLanguage =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'php'
  | 'java'
  | 'csharp'
  | 'html'
  | 'css'
  | 'unknown';

const JS_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json'];
const JAVA_EXTENSIONS = ['.java'];
const CSHARP_EXTENSIONS = ['.cs'];
const PYTHON_EXTENSIONS = ['.py'];
const PHP_EXTENSIONS = ['.php'];
const HTML_EXTENSIONS = ['.html', '.htm'];
const CSS_EXTENSIONS = ['.css'];

const storage = new Proxy({} as any, {
  get: (_target, property) => (runtime.storage as any)[property],
});

const tabManager = new Proxy({} as any, {
  get: (_target, property) => (runtime.tabManager as any)[property],
});

function splitPath(value: string): string[] {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
}

function normalizePosix(value: string): string {
  const output: string[] = [];

  for (const segment of splitPath(value)) {
    if (segment === '.') continue;
    if (segment === '..') {
      output.pop();
      continue;
    }
    output.push(segment);
  }

  return output.join('/');
}

function normalizeWorkspacePath(value: string): string {
  return normalizePosix(String(value || '').replace(/^\/+/, '')).replace(/^\.\//, '');
}

function dirname(value: string): string {
  const segments = splitPath(normalizeWorkspacePath(value));
  segments.pop();
  return segments.join('/');
}

function basename(value: string): string {
  const segments = splitPath(value);
  return segments[segments.length - 1] ?? '';
}

function extname(value: string): string {
  const base = basename(value);
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index).toLowerCase() : '';
}

function removeExtension(value: string): string {
  const extension = extname(value);
  return extension ? value.slice(0, -extension.length) : value;
}

function joinPath(...parts: string[]): string {
  return normalizePosix(parts.join('/'));
}

function relativePath(fromDirectory: string, targetPath: string): string {
  const from = splitPath(normalizeWorkspacePath(fromDirectory));
  const to = splitPath(normalizeWorkspacePath(targetPath));

  let common = 0;
  while (
    common < from.length &&
    common < to.length &&
    from[common] === to[common]
  ) {
    common++;
  }

  return [
    ...Array(from.length - common).fill('..'),
    ...to.slice(common),
  ].join('/') || '.';
}

function relativeSpecifier(importerPath: string, targetPath: string): string {
  let relative = relativePath(dirname(importerPath), normalizeWorkspacePath(targetPath));
  if (!relative.startsWith('.')) relative = `./${relative}`;
  return relative;
}

function getLiveContent(file: StoredFile): string {
  const model = runtime.fileModels.get(file.id);
  if (model && !model.isDisposed()) return model.getValue();

  const tab = tabManager.getTab(file.id);
  if (tab) return tab.file.content ?? file.content;

  return file.content;
}

async function persistContent(file: StoredFile, content: string): Promise<void> {
  const model = runtime.fileModels.get(file.id);
  if (model && !model.isDisposed() && model.getValue() !== content) {
    model.setValue(content);
  }

  const updated = await storage.updateFile(file.id, {
    content,
    isUserModified: true,
  });

  const tab = tabManager.getTab(file.id);
  if (tab) {
    tab.file = updated
      ? { ...updated, content }
      : { ...tab.file, content };
    tab.isDirty = false;
  }
}

export async function captureWorkspacePaths(): Promise<WorkspacePathSnapshot> {
  const files: StoredFile[] = await storage.getAllFiles();
  return new Map(
    files.map(file => [file.id, normalizeWorkspacePath(file.path)]),
  );
}

function detectImportLanguage(file: StoredFile, filePath: string): SupportedImportLanguage {
  const language = String(file.language || '').toLowerCase();
  const extension = extname(filePath);

  if (
    language === 'javascript' ||
    language === 'typescript' ||
    ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(extension)
  ) {
    return language === 'typescript' || ['.ts', '.tsx'].includes(extension)
      ? 'typescript'
      : 'javascript';
  }

  if (language === 'python' || PYTHON_EXTENSIONS.includes(extension)) return 'python';
  if (language === 'php' || PHP_EXTENSIONS.includes(extension)) return 'php';
  if (language === 'html' || HTML_EXTENSIONS.includes(extension)) return 'html';
  if (language === 'css' || CSS_EXTENSIONS.includes(extension)) return 'css';
  if (language === 'java' || JAVA_EXTENSIONS.includes(extension)) return 'java';
  if (
    language === 'csharp' ||
    language === 'c#' ||
    language === 'cs' ||
    CSHARP_EXTENSIONS.includes(extension)
  ) {
    return 'csharp';
  }

  return 'unknown';
}

function buildPathToIdMap(paths: WorkspacePathSnapshot): Map<string, string> {
  const result = new Map<string, string>();
  for (const [id, filePath] of paths) {
    result.set(normalizeWorkspacePath(filePath), id);
  }
  return result;
}

function candidatePathsForRelativeSpecifier(
  importerPath: string,
  specifier: string,
  extensions: string[],
): string[] {
  if (!specifier.startsWith('.')) return [];

  const resolved = normalizeWorkspacePath(joinPath(dirname(importerPath), specifier));
  const candidates = new Set<string>([resolved]);

  if (!extname(resolved)) {
    for (const extension of extensions) {
      candidates.add(`${resolved}${extension}`);
      candidates.add(`${resolved}/index${extension}`);
    }
  }

  return [...candidates];
}

function formatJsSpecifier(
  importerNewPath: string,
  targetOldPath: string,
  targetNewPath: string,
  originalSpecifier: string,
): string {
  let targetForSpecifier = targetNewPath;
  const originalHadExtension = Boolean(extname(originalSpecifier));

  if (!originalHadExtension) {
    const targetExtension = extname(targetForSpecifier);
    if (targetExtension) {
      targetForSpecifier = targetForSpecifier.slice(0, -targetExtension.length);
    }

    const oldWithoutExtension = removeExtension(targetOldPath);
    if (
      /\/index$/.test(oldWithoutExtension) &&
      !/\/index$/.test(originalSpecifier)
    ) {
      targetForSpecifier = dirname(targetForSpecifier);
    }
  }

  return relativeSpecifier(importerNewPath, targetForSpecifier);
}

function rewriteJavaScriptImports(
  content: string,
  importerOldPath: string,
  importerNewPath: string,
  oldPathToId: Map<string, string>,
  newPathById: Map<string, string>,
): RewriteResult {
  let replacements = 0;
  const warnings: string[] = [];

  const rewriteSpecifier = (specifier: string): string => {
    if (!specifier.startsWith('.')) return specifier;

    const targetOldPath = candidatePathsForRelativeSpecifier(
      importerOldPath,
      specifier,
      JS_EXTENSIONS,
    ).find(candidate => oldPathToId.has(candidate));

    if (!targetOldPath) return specifier;

    const targetId = oldPathToId.get(targetOldPath);
    const targetNewPath = targetId ? newPathById.get(targetId) : undefined;
    if (!targetNewPath) return specifier;

    const next = formatJsSpecifier(
      importerNewPath,
      targetOldPath,
      targetNewPath,
      specifier,
    );

    if (next !== specifier) replacements++;
    return next;
  };

  let updated = content;

  const patterns = [
    /(\bfrom\s*)(['"])([^'"]+)(\2)/g,
    /(\bimport\s*)(['"])([^'"]+)(\2)/g,
    /(\brequire\s*\(\s*)(['"])([^'"]+)(\2\s*\))/g,
    /(\bimport\s*\(\s*)(['"])([^'"]+)(\2\s*\))/g,
    /(\brequire\.resolve\s*\(\s*)(['"])([^'"]+)(\2\s*\))/g,
  ];

  for (const pattern of patterns) {
    updated = updated.replace(
      pattern,
      (
        _full,
        prefix: string,
        quote: string,
        specifier: string,
        suffix: string,
      ) => `${prefix}${quote}${rewriteSpecifier(specifier)}${suffix}`,
    );
  }

  return { content: updated, replacements, warnings };
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_]\w*$/.test(value);
}

function pythonModuleForPath(filePath: string): string | null {
  const withoutExtension = removeExtension(normalizeWorkspacePath(filePath));
  const segments = splitPath(withoutExtension);

  if (segments.length === 0 || segments.some(segment => !isIdentifier(segment))) {
    return null;
  }

  if (segments[segments.length - 1] === '__init__') {
    segments.pop();
  }

  return segments.join('.');
}

function buildUniqueModuleMap(
  paths: WorkspacePathSnapshot,
  extension: string,
  pathToModule: (path: string) => string | null,
): Map<string, string> {
  const candidateToIds = new Map<string, Set<string>>();

  for (const [id, filePath] of paths) {
    if (extname(filePath) !== extension) continue;

    const fullModule = pathToModule(filePath);
    const stem = basename(removeExtension(filePath));
    const candidates = new Set<string>();

    if (fullModule) candidates.add(fullModule);
    if (isIdentifier(stem)) candidates.add(stem);

    for (const candidate of candidates) {
      if (!candidateToIds.has(candidate)) candidateToIds.set(candidate, new Set());
      candidateToIds.get(candidate)!.add(id);
    }
  }

  const unique = new Map<string, string>();
  for (const [candidate, ids] of candidateToIds) {
    if (ids.size === 1) unique.set(candidate, [...ids][0]);
  }

  return unique;
}

function buildUniquePythonStemMap(
  pathsById: Map<string, string>,
): Map<string, string> {
  const stemToIds = new Map<string, Set<string>>();

  for (const [id, filePath] of pathsById) {
    if (extname(filePath) !== '.py') continue;

    const stem = basename(removeExtension(filePath));
    if (!isIdentifier(stem) || stem === '__init__') continue;

    if (!stemToIds.has(stem)) stemToIds.set(stem, new Set());
    stemToIds.get(stem)!.add(id);
  }

  const unique = new Map<string, string>();
  for (const [stem, ids] of stemToIds) {
    if (ids.size === 1) unique.set(stem, [...ids][0]);
  }

  return unique;
}

function resolvePythonRelativeModule(
  importerOldPath: string,
  moduleName: string,
  oldModuleToId: Map<string, string>,
): string | null {
  const dotMatch = moduleName.match(/^(\.+)(.*)$/);
  if (!dotMatch) return oldModuleToId.get(moduleName) ? moduleName : null;

  const dots = dotMatch[1].length;
  const suffix = dotMatch[2];
  const importerModule = pythonModuleForPath(importerOldPath);
  if (!importerModule) return null;

  const parts = importerModule.split('.');
  parts.pop();

  const levelsUp = Math.max(0, dots - 1);
  if (levelsUp > parts.length) return null;

  const base = parts.slice(0, parts.length - levelsUp);
  if (suffix) base.push(...suffix.split('.'));

  const absolute = base.join('.');
  return oldModuleToId.has(absolute) ? absolute : null;
}

function formatPythonModule(
  importerNewPath: string,
  targetNewPath: string,
  originalModule: string,
): string | null {
  const targetAbsolute = pythonModuleForPath(targetNewPath);
  if (!targetAbsolute) return null;

  if (!originalModule.startsWith('.')) return targetAbsolute;

  const importerModule = pythonModuleForPath(importerNewPath);
  if (!importerModule) return targetAbsolute;

  const importerPackage = importerModule.split('.');
  importerPackage.pop();
  const targetParts = targetAbsolute.split('.');

  let common = 0;
  while (
    common < importerPackage.length &&
    common < targetParts.length &&
    importerPackage[common] === targetParts[common]
  ) {
    common++;
  }

  const upwardLevels = importerPackage.length - common;
  const suffix = targetParts.slice(common).join('.');
  return `${'.'.repeat(upwardLevels + 1)}${suffix}`;
}

function rewritePythonImports(
  content: string,
  importerOldPath: string,
  importerNewPath: string,
  oldModuleToId: Map<string, string>,
  newPathById: Map<string, string>,
  uniqueNewPythonStemToId: Map<string, string>,
): RewriteResult {
  let replacements = 0;
  const warnings: string[] = [];

  const rewriteModule = (moduleName: string): string => {
    const resolvedOldModule =
      resolvePythonRelativeModule(importerOldPath, moduleName, oldModuleToId) ??
      (oldModuleToId.has(moduleName) ? moduleName : null);

    if (!resolvedOldModule) return moduleName;

    const targetId = oldModuleToId.get(resolvedOldModule);
    const targetNewPath = targetId ? newPathById.get(targetId) : undefined;
    if (!targetNewPath) return moduleName;

    const nextModule = formatPythonModule(
      importerNewPath,
      targetNewPath,
      moduleName,
    );

    if (!nextModule) {
      const targetStem = basename(removeExtension(targetNewPath));
      const uniqueStemTargetId = uniqueNewPythonStemToId.get(targetStem);

      // Browser Coder's Python runner adds every workspace folder to sys.path.
      // Therefore a uniquely named module can still be imported by its bare
      // filename even when one of its parent folders contains spaces, dashes,
      // or other characters that cannot appear in a dotted Python package.
      // Keep/rewrite to that stable bare module name instead of generating an
      // invalid dotted import such as `New Folder.module`.
      if (isIdentifier(targetStem) && uniqueStemTargetId === targetId) {
        if (targetStem !== moduleName) replacements++;
        return targetStem;
      }

      warnings.push(
        `Could not safely rewrite Python import for "${targetNewPath}". ` +
        `The module filename must be a valid identifier and unique across the workspace, ` +
        `or every folder in its package path must be a valid Python identifier.`,
      );
      return moduleName;
    }

    if (nextModule !== moduleName) replacements++;
    return nextModule;
  };

  let updated = content.replace(
    /(^|\n)([ \t]*from[ \t]+)(\.*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)([ \t]+import[ \t]+)/g,
    (
      _full,
      lineStart: string,
      prefix: string,
      moduleName: string,
      suffix: string,
    ) => `${lineStart}${prefix}${rewriteModule(moduleName)}${suffix}`,
  );

  updated = updated.replace(
    /(^|\n)([ \t]*import[ \t]+)([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?=\s*(?:as\s+[A-Za-z_]\w*)?(?:,|\n|$))/g,
    (
      _full,
      lineStart: string,
      prefix: string,
      moduleName: string,
    ) => `${lineStart}${prefix}${rewriteModule(moduleName)}`,
  );

  return { content: updated, replacements, warnings };
}

function rewritePhpImports(
  content: string,
  importerOldPath: string,
  importerNewPath: string,
  oldPathToId: Map<string, string>,
  newPathById: Map<string, string>,
): RewriteResult {
  let replacements = 0;
  const warnings: string[] = [];

  const rewriteSpecifier = (specifier: string): string => {
    const normalizedSpecifier = specifier.replace(/\\/g, '/');
    if (!normalizedSpecifier.startsWith('.')) return specifier;

    const targetOldPath = candidatePathsForRelativeSpecifier(
      importerOldPath,
      normalizedSpecifier,
      PHP_EXTENSIONS,
    ).find(candidate => oldPathToId.has(candidate));

    if (!targetOldPath) return specifier;

    const targetId = oldPathToId.get(targetOldPath);
    const targetNewPath = targetId ? newPathById.get(targetId) : undefined;
    if (!targetNewPath) return specifier;

    const next = relativeSpecifier(importerNewPath, targetNewPath);
    if (next !== normalizedSpecifier) replacements++;
    return next;
  };

  let updated = content.replace(
    /(\b(?:require|require_once|include|include_once)\s*(?:\(\s*)?)(['"])([^'"]+)(\2\s*\)?)/gi,
    (
      full,
      prefix: string,
      quote: string,
      specifier: string,
      suffix: string,
    ) => {
      const next = rewriteSpecifier(specifier);
      return next === specifier ? full : `${prefix}${quote}${next}${suffix}`;
    },
  );

  updated = updated.replace(
    /(\b(?:require|require_once|include|include_once)\s*(?:\(\s*)?__DIR__\s*\.\s*)(['"])([^'"]+)(\2\s*\)?)/gi,
    (
      full,
      prefix: string,
      quote: string,
      suffixPath: string,
      suffix: string,
    ) => {
      const specifier = `.${suffixPath.startsWith('/') ? '' : '/'}${suffixPath}`;
      const next = rewriteSpecifier(specifier);
      if (next === specifier) return full;
      return `${prefix}${quote}/${next.replace(/^\.\//, '')}${suffix}`;
    },
  );

  return { content: updated, replacements, warnings };
}

function rewriteWebAssetSpecifier(
  specifier: string,
  importerOldPath: string,
  importerNewPath: string,
  oldPathToId: Map<string, string>,
  newPathById: Map<string, string>,
): string {
  if (!specifier || /^(?:[a-z]+:|#|\/\/)/i.test(specifier)) return specifier;

  const suffixMatch = specifier.match(/([?#].*)$/);
  const suffix = suffixMatch?.[1] ?? '';
  const cleanSpecifier = suffix ? specifier.slice(0, -suffix.length) : specifier;
  const resolved = normalizeWorkspacePath(joinPath(dirname(importerOldPath), cleanSpecifier));
  const candidates = new Set<string>([resolved]);

  if (!extname(resolved)) {
    for (const extension of [
      ...HTML_EXTENSIONS,
      ...CSS_EXTENSIONS,
      ...JS_EXTENSIONS,
      '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.json', '.txt',
    ]) {
      candidates.add(`${resolved}${extension}`);
      candidates.add(`${resolved}/index${extension}`);
    }
  }

  const targetOldPath = [...candidates].find(candidate => oldPathToId.has(candidate));
  if (!targetOldPath) return specifier;

  const targetId = oldPathToId.get(targetOldPath);
  const targetNewPath = targetId ? newPathById.get(targetId) : undefined;
  if (!targetNewPath) return specifier;

  return `${relativeSpecifier(importerNewPath, targetNewPath)}${suffix}`;
}

function rewriteHtmlReferences(
  content: string,
  importerOldPath: string,
  importerNewPath: string,
  oldPathToId: Map<string, string>,
  newPathById: Map<string, string>,
): RewriteResult {
  let replacements = 0;
  const updated = content.replace(
    /(\b(?:src|href|poster|action|formaction)\s*=\s*)(['"])([^'"]+)(\2)/gi,
    (_full, prefix: string, quote: string, specifier: string, suffix: string) => {
      const next = rewriteWebAssetSpecifier(
        specifier,
        importerOldPath,
        importerNewPath,
        oldPathToId,
        newPathById,
      );
      if (next !== specifier) replacements++;
      return `${prefix}${quote}${next}${suffix}`;
    },
  );

  return { content: updated, replacements, warnings: [] };
}

function rewriteCssReferences(
  content: string,
  importerOldPath: string,
  importerNewPath: string,
  oldPathToId: Map<string, string>,
  newPathById: Map<string, string>,
): RewriteResult {
  let replacements = 0;
  let updated = content.replace(
    /(@import\s+(?:url\(\s*)?)(['"])([^'"]+)(\2\s*\)?)/gi,
    (_full, prefix: string, quote: string, specifier: string, suffix: string) => {
      const next = rewriteWebAssetSpecifier(
        specifier,
        importerOldPath,
        importerNewPath,
        oldPathToId,
        newPathById,
      );
      if (next !== specifier) replacements++;
      return `${prefix}${quote}${next}${suffix}`;
    },
  );

  updated = updated.replace(
    /(url\(\s*)(['"]?)([^'"\)]+)(\2\s*\))/gi,
    (_full, prefix: string, quote: string, specifier: string, suffix: string) => {
      const next = rewriteWebAssetSpecifier(
        specifier.trim(),
        importerOldPath,
        importerNewPath,
        oldPathToId,
        newPathById,
      );
      if (next !== specifier.trim()) replacements++;
      return `${prefix}${quote}${next}${suffix}`;
    },
  );

  return { content: updated, replacements, warnings: [] };
}

function javaPackageForPath(filePath: string): string | null {
  const segments = splitPath(dirname(filePath));
  return segments.every(isIdentifier) ? segments.join('.') : null;
}

function javaQualifiedName(filePath: string): string | null {
  const packageName = javaPackageForPath(filePath);
  const className = basename(removeExtension(filePath));
  if (!isIdentifier(className)) return null;
  return packageName ? `${packageName}.${className}` : className;
}

function rewriteJavaImports(
  content: string,
  importerNewPath: string,
  oldQualifiedToId: Map<string, string>,
  newPathById: Map<string, string>,
): RewriteResult {
  let replacements = 0;
  const warnings: string[] = [];
  const newPackage = javaPackageForPath(importerNewPath);

  let updated = content.replace(
    /(^|\n)([ \t]*package[ \t]+)([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)([ \t]*;)/g,
    (
      _full,
      lineStart: string,
      prefix: string,
      oldPackage: string,
      suffix: string,
    ) => {
      if (newPackage === null) {
        warnings.push(
          `Could not update Java package for "${importerNewPath}". Folder names must be valid Java identifiers.`,
        );
        return `${lineStart}${prefix}${oldPackage}${suffix}`;
      }

      if (newPackage !== oldPackage) replacements++;
      return newPackage
        ? `${lineStart}${prefix}${newPackage}${suffix}`
        : '';
    },
  );

  if (!/(^|\n)[ \t]*package[ \t]+/.test(updated) && newPackage) {
    updated = `package ${newPackage};\n\n${updated}`;
    replacements++;
  }

  updated = updated.replace(
    /(^|\n)([ \t]*import[ \t]+(?:static[ \t]+)?)([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)([ \t]*;)/g,
    (
      _full,
      lineStart: string,
      prefix: string,
      importedName: string,
      suffix: string,
    ) => {
      let targetId = oldQualifiedToId.get(importedName);

      if (!targetId && importedName.endsWith('.*')) {
        const packagePrefix = importedName.slice(0, -2);
        const matchingIds = [...oldQualifiedToId.entries()]
          .filter(([qualified]) => qualified.startsWith(`${packagePrefix}.`))
          .map(([, id]) => id);

        if (matchingIds.length > 0) {
          const newPackages = new Set(
            matchingIds
              .map(id => newPathById.get(id))
              .filter(Boolean)
              .map(path => javaPackageForPath(path!))
              .filter(Boolean),
          );

          if (newPackages.size === 1) {
            const next = `${[...newPackages][0]}.*`;
            if (next !== importedName) replacements++;
            return `${lineStart}${prefix}${next}${suffix}`;
          }
        }

        return `${lineStart}${prefix}${importedName}${suffix}`;
      }

      if (!targetId) return `${lineStart}${prefix}${importedName}${suffix}`;

      const targetNewPath = newPathById.get(targetId);
      if (!targetNewPath) return `${lineStart}${prefix}${importedName}${suffix}`;

      const next = javaQualifiedName(targetNewPath);
      if (!next) {
        warnings.push(
          `Could not rewrite Java import for "${targetNewPath}". Folder and class names must be valid Java identifiers.`,
        );
        return `${lineStart}${prefix}${importedName}${suffix}`;
      }

      if (next !== importedName) replacements++;
      return `${lineStart}${prefix}${next}${suffix}`;
    },
  );

  return { content: updated, replacements, warnings };
}

function csharpNamespaceForPath(filePath: string): string | null {
  const segments = splitPath(dirname(filePath));
  return segments.every(isIdentifier) ? segments.join('.') : null;
}

function rewriteCSharpImports(
  content: string,
  importerOldPath: string,
  importerNewPath: string,
  oldNamespaceToIds: Map<string, Set<string>>,
  newPathById: Map<string, string>,
): RewriteResult {
  let replacements = 0;
  const warnings: string[] = [];

  const oldImporterNamespace = csharpNamespaceForPath(importerOldPath);
  const newImporterNamespace = csharpNamespaceForPath(importerNewPath);

  let updated = content;

  if (oldImporterNamespace !== newImporterNamespace) {
    updated = updated.replace(
      /(^|\n)([ \t]*namespace[ \t]+)([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)([ \t]*(?:;|\{))/g,
      (
        _full,
        lineStart: string,
        prefix: string,
        oldNamespace: string,
        suffix: string,
      ) => {
        if (!newImporterNamespace) {
          warnings.push(
            `Could not update C# namespace for "${importerNewPath}". Folder names must be valid C# identifiers.`,
          );
          return `${lineStart}${prefix}${oldNamespace}${suffix}`;
        }

        replacements++;
        return `${lineStart}${prefix}${newImporterNamespace}${suffix}`;
      },
    );
  }

  updated = updated.replace(
    /(^|\n)([ \t]*(?:global[ \t]+)?using[ \t]+(?:static[ \t]+)?)([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)([ \t]*;)/g,
    (
      _full,
      lineStart: string,
      prefix: string,
      namespaceName: string,
      suffix: string,
    ) => {
      const ids = oldNamespaceToIds.get(namespaceName);
      if (!ids || ids.size === 0) {
        return `${lineStart}${prefix}${namespaceName}${suffix}`;
      }

      const newNamespaces = new Set(
        [...ids]
          .map(id => newPathById.get(id))
          .filter(Boolean)
          .map(path => csharpNamespaceForPath(path!))
          .filter(Boolean),
      );

      if (newNamespaces.size !== 1) {
        if (newNamespaces.size > 1) {
          warnings.push(
            `Could not safely rewrite C# using "${namespaceName}" because its files moved into multiple namespaces.`,
          );
        }
        return `${lineStart}${prefix}${namespaceName}${suffix}`;
      }

      const next = [...newNamespaces][0];
      if (next !== namespaceName) replacements++;
      return `${lineStart}${prefix}${next}${suffix}`;
    },
  );

  return { content: updated, replacements, warnings };
}

function buildQualifiedNameMap(
  paths: WorkspacePathSnapshot,
  extension: string,
  formatter: (filePath: string) => string | null,
): Map<string, string> {
  const candidates = new Map<string, Set<string>>();

  for (const [id, filePath] of paths) {
    if (extname(filePath) !== extension) continue;
    const qualified = formatter(filePath);
    if (!qualified) continue;

    if (!candidates.has(qualified)) candidates.set(qualified, new Set());
    candidates.get(qualified)!.add(id);
  }

  const unique = new Map<string, string>();
  for (const [qualified, ids] of candidates) {
    if (ids.size === 1) unique.set(qualified, [...ids][0]);
  }

  return unique;
}

function buildNamespaceMap(
  paths: WorkspacePathSnapshot,
  extension: string,
  formatter: (filePath: string) => string | null,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  for (const [id, filePath] of paths) {
    if (extname(filePath) !== extension) continue;
    const namespaceName = formatter(filePath);
    if (!namespaceName) continue;

    if (!result.has(namespaceName)) result.set(namespaceName, new Set());
    result.get(namespaceName)!.add(id);
  }

  return result;
}

function rewriteImportsForFile(
  file: StoredFile,
  content: string,
  importerOldPath: string,
  importerNewPath: string,
  oldPathToId: Map<string, string>,
  oldPythonModuleToId: Map<string, string>,
  oldJavaQualifiedToId: Map<string, string>,
  oldCSharpNamespaceToIds: Map<string, Set<string>>,
  newPathById: Map<string, string>,
  uniqueNewPythonStemToId: Map<string, string>,
): RewriteResult {
  switch (detectImportLanguage(file, importerNewPath)) {
    case 'javascript':
    case 'typescript':
      return rewriteJavaScriptImports(
        content,
        importerOldPath,
        importerNewPath,
        oldPathToId,
        newPathById,
      );

    case 'python':
      return rewritePythonImports(
        content,
        importerOldPath,
        importerNewPath,
        oldPythonModuleToId,
        newPathById,
        uniqueNewPythonStemToId,
      );

    case 'php':
      return rewritePhpImports(
        content,
        importerOldPath,
        importerNewPath,
        oldPathToId,
        newPathById,
      );

    case 'html':
      return rewriteHtmlReferences(
        content,
        importerOldPath,
        importerNewPath,
        oldPathToId,
        newPathById,
      );

    case 'css':
      return rewriteCssReferences(
        content,
        importerOldPath,
        importerNewPath,
        oldPathToId,
        newPathById,
      );

    case 'java':
      return rewriteJavaImports(
        content,
        importerNewPath,
        oldJavaQualifiedToId,
        newPathById,
      );

    case 'csharp':
      return rewriteCSharpImports(
        content,
        importerOldPath,
        importerNewPath,
        oldCSharpNamespaceToIds,
        newPathById,
      );

    default:
      return { content, replacements: 0, warnings: [] };
  }
}

/**
 * Rewrites workspace-local imports after any file/folder move or rename.
 *
 * Supported:
 * - JavaScript/TypeScript: import, export-from, side-effect import, require,
 *   require.resolve, dynamic import, extensionless/index resolution.
 * - Python: absolute and relative from-import/import statements.
 * - PHP: require/include variants, including __DIR__ concatenation.
 * - Java: package statements, explicit imports, and package wildcards when
 *   every affected class still resolves to one package.
 * - C#: namespace declarations and using/global using directives when the
 *   affected namespace remains unambiguous.
 *
 * Unknown/external/package imports are intentionally left untouched.
 */
export async function refactorWorkspaceImports(
  beforePaths: WorkspacePathSnapshot,
): Promise<{ replacements: number; changedFiles: number; warnings: string[] }> {
  const files: StoredFile[] = await storage.getAllFiles();
  const newPathById = new Map(
    files.map(file => [file.id, normalizeWorkspacePath(file.path)]),
  );

  const pathChanged = files.some(
    file => beforePaths.get(file.id) !== newPathById.get(file.id),
  );

  if (!pathChanged) {
    return { replacements: 0, changedFiles: 0, warnings: [] };
  }

  const oldPathToId = buildPathToIdMap(beforePaths);
  const oldPythonModuleToId = buildUniqueModuleMap(
    beforePaths,
    '.py',
    pythonModuleForPath,
  );
  const oldJavaQualifiedToId = buildQualifiedNameMap(
    beforePaths,
    '.java',
    javaQualifiedName,
  );
  const oldCSharpNamespaceToIds = buildNamespaceMap(
    beforePaths,
    '.cs',
    csharpNamespaceForPath,
  );
  const uniqueNewPythonStemToId = buildUniquePythonStemMap(newPathById);

  let replacements = 0;
  let changedFiles = 0;
  const warnings = new Set<string>();

  for (const file of files) {
    const importerOldPath =
      beforePaths.get(file.id) ?? newPathById.get(file.id) ?? '';
    const importerNewPath = newPathById.get(file.id) ?? importerOldPath;
    const currentContent = getLiveContent(file);

    const result = rewriteImportsForFile(
      file,
      currentContent,
      importerOldPath,
      importerNewPath,
      oldPathToId,
      oldPythonModuleToId,
      oldJavaQualifiedToId,
      oldCSharpNamespaceToIds,
      newPathById,
      uniqueNewPythonStemToId,
    );

    for (const warning of result.warnings) warnings.add(warning);

    if (result.content !== currentContent) {
      await persistContent(file, result.content);
      replacements += result.replacements;
      changedFiles++;
    }
  }

  if (changedFiles > 0) runtime.notifyWorkspaceChanged();

  return {
    replacements,
    changedFiles,
    warnings: [...warnings],
  };
}
