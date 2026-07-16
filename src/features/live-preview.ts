import { runtime } from '../app/runtime';
import { normalizeProjectPath } from '../components/project-path';
import { setOutput, setStatus } from '../components/output';
import { collectWorkspaceSnapshot, type WorkspaceFile } from './workspace';

const TEXT_MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  ts: 'text/plain', tsx: 'text/plain', jsx: 'text/javascript',
  json: 'application/json', svg: 'image/svg+xml', txt: 'text/plain',
};

function extension(path: string): string {
  const name = path.split('/').pop() || '';
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toLowerCase() : '';
}

function dirname(path: string): string {
  const parts = normalizeProjectPath(path).split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function resolvePath(fromPath: string, specifier: string): string | null {
  if (!specifier || /^(?:[a-z]+:|#|\/\/)/i.test(specifier)) return null;
  const base = specifier.startsWith('/') ? [] : dirname(fromPath).split('/').filter(Boolean);
  const parts = specifier.replace(/[?#].*$/, '').split('/');
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return normalizeProjectPath(base.join('/'));
}

function escapeSrcdoc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function dataUrl(path: string, content: string): string {
  const mime = TEXT_MIME[extension(path)] || 'text/plain';
  return `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
}

function findWorkspaceFile(
  files: Map<string, WorkspaceFile>,
  importerPath: string,
  specifier: string,
  extensions: string[] = [],
): WorkspaceFile | null {
  const resolved = resolvePath(importerPath, specifier);
  if (!resolved) return null;
  const candidates = [resolved];
  if (!extension(resolved)) {
    for (const ext of extensions) {
      candidates.push(`${resolved}.${ext}`, `${resolved}/index.${ext}`);
    }
  }
  for (const candidate of candidates) {
    const file = files.get(candidate);
    if (file) return file;
  }
  return null;
}

function rewriteCss(
  css: string,
  cssPath: string,
  files: Map<string, WorkspaceFile>,
  warnings: Set<string>,
  stack = new Set<string>(),
): string {
  if (stack.has(cssPath)) {
    warnings.add(`Circular CSS import skipped: ${cssPath}`);
    return css;
  }
  const nextStack = new Set(stack).add(cssPath);

  let updated = css.replace(
    /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?\s*;/gi,
    (full, _quote: string, specifier: string) => {
      const target = findWorkspaceFile(files, cssPath, specifier, ['css']);
      if (!target || extension(target.path) !== 'css') return full;
      return rewriteCss(target.content, target.path, files, warnings, nextStack);
    },
  );

  updated = updated.replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi, (full, _q, specifier) => {
    const target = findWorkspaceFile(files, cssPath, specifier);
    if (!target) return full;
    return `url("${dataUrl(target.path, target.content)}")`;
  });

  return updated;
}

function buildModuleDataUrl(
  file: WorkspaceFile,
  files: Map<string, WorkspaceFile>,
  warnings: Set<string>,
  cache: Map<string, string>,
  stack = new Set<string>(),
): string {
  const cached = cache.get(file.path);
  if (cached) return cached;
  if (stack.has(file.path)) {
    warnings.add(`Circular JavaScript module import could not be bundled: ${file.path}`);
    return dataUrl(file.path, file.content);
  }

  const nextStack = new Set(stack).add(file.path);
  const rewrite = (specifier: string): string => {
    const target = findWorkspaceFile(files, file.path, specifier, ['js', 'mjs', 'cjs', 'jsx']);
    if (!target) return specifier;
    return buildModuleDataUrl(target, files, warnings, cache, nextStack);
  };

  let code = file.content;
  const patterns = [
    /(\bfrom\s*)(['"])([^'"]+)(\2)/g,
    /(\bimport\s*)(['"])([^'"]+)(\2)/g,
    /(\bimport\s*\(\s*)(['"])([^'"]+)(\2\s*\))/g,
  ];
  for (const pattern of patterns) {
    code = code.replace(pattern, (_full, prefix, quote, specifier, suffix) =>
      `${prefix}${quote}${rewrite(specifier)}${suffix}`,
    );
  }

  const url = dataUrl(file.path, code);
  cache.set(file.path, url);
  return url;
}

function bundleHtml(entry: WorkspaceFile, allFiles: WorkspaceFile[]): { html: string; warnings: string[] } {
  const files = new Map(allFiles.map(file => [normalizeProjectPath(file.path), {
    ...file,
    path: normalizeProjectPath(file.path),
  }]));
  const warnings = new Set<string>();
  const moduleCache = new Map<string, string>();
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(entry.content, 'text/html');

  documentNode.querySelectorAll('link[rel~="stylesheet"][href]').forEach(link => {
    const specifier = link.getAttribute('href') || '';
    const target = findWorkspaceFile(files, entry.path, specifier, ['css']);
    if (!target) return;
    const style = documentNode.createElement('style');
    style.textContent = rewriteCss(target.content, target.path, files, warnings);
    link.replaceWith(style);
  });

  documentNode.querySelectorAll('script[src]').forEach(script => {
    const specifier = script.getAttribute('src') || '';
    const target = findWorkspaceFile(files, entry.path, specifier, ['js', 'mjs', 'cjs']);
    if (!target) return;
    const replacement = documentNode.createElement('script');
    for (const attribute of Array.from(script.attributes)) {
      if (attribute.name !== 'src') replacement.setAttribute(attribute.name, attribute.value);
    }
    if ((script.getAttribute('type') || '').toLowerCase() === 'module') {
      replacement.setAttribute('src', buildModuleDataUrl(target, files, warnings, moduleCache));
    } else {
      replacement.textContent = `${target.content}\n//# sourceURL=${target.path}`;
    }
    script.replaceWith(replacement);
  });

  documentNode.querySelectorAll<HTMLElement>('[src], [href], [poster]').forEach(element => {
    for (const attributeName of ['src', 'href', 'poster']) {
      const specifier = element.getAttribute(attributeName);
      if (!specifier) continue;
      if (element.tagName === 'SCRIPT' || (element.tagName === 'LINK' && attributeName === 'href')) continue;
      const target = findWorkspaceFile(files, entry.path, specifier);
      if (target) element.setAttribute(attributeName, dataUrl(target.path, target.content));
    }
  });

  const serialized = '<!doctype html>\n' + documentNode.documentElement.outerHTML;
  return { html: serialized, warnings: [...warnings] };
}

export function isHtmlFile(file: { language?: string; name?: string; path?: string } | null | undefined): boolean {
  if (!file) return false;
  return file.language === 'html' || /\.html?$/i.test(file.path || file.name || '');
}

export function isCssFile(file: { language?: string; name?: string; path?: string } | null | undefined): boolean {
  if (!file) return false;
  return file.language === 'css' || /\.css$/i.test(file.path || file.name || '');
}

function findHtmlEntriesUsingCss(
  allFiles: WorkspaceFile[],
  cssPath: string,
): WorkspaceFile[] {
  const normalizedCssPath = normalizeProjectPath(cssPath);
  const parser = new DOMParser();

  return allFiles.filter(file => {
    if (!isHtmlFile(file)) return false;

    const htmlPath = normalizeProjectPath(file.path);
    const documentNode = parser.parseFromString(file.content, 'text/html');

    return Array.from(
      documentNode.querySelectorAll('link[rel~="stylesheet"][href]'),
    ).some(link => {
      const href = link.getAttribute('href') || '';
      return resolvePath(htmlPath, href) === normalizedCssPath;
    });
  });
}

const PREVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * Returns the public directory from which the IDE document was loaded.
 *
 * In production Arc Academy mounts Browser Coder at `/coder/`. The API itself
 * still receives `/api/...` and `/preview/...` after the outer reverse proxy
 * strips that mount prefix. Building browser URLs from the document directory
 * keeps requests inside `/coder/` publicly while remaining `/` in local or
 * standalone deployments.
 */
function getPublicAppBaseUrl(): URL {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';

  if (!url.pathname.endsWith('/')) {
    const lastSegment = url.pathname.split('/').pop() || '';
    if (lastSegment.includes('.')) {
      url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
    } else {
      url.pathname += '/';
    }
  }

  return url;
}

function readPreviewId(payload: any): string {
  if (typeof payload?.id === 'string' && PREVIEW_ID_PATTERN.test(payload.id)) {
    return payload.id;
  }

  // Backward compatibility with API versions that returned only a path/URL.
  for (const value of [payload?.previewPath, payload?.previewUrl]) {
    if (typeof value !== 'string' || !value) continue;

    try {
      const parsed = new URL(value, window.location.origin);
      const candidate = parsed.pathname.split('/').filter(Boolean).pop() || '';
      if (PREVIEW_ID_PATTERN.test(candidate)) return candidate;
    } catch {
      // Continue to the validation error below.
    }
  }

  throw new Error('The preview server returned an invalid short preview ID.');
}

async function publishPreview(
  html: string,
  entryPath: string,
): Promise<{ previewUrl: string; expiresAt?: string }> {
  const publicBaseUrl = getPublicAppBaseUrl();
  const publishUrl = new URL('./api/previews', publicBaseUrl);

  const response = await fetch(publishUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Browser-Coder-Preview': '1',
    },
    body: JSON.stringify({ html, entryPath }),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    // The status-based fallback below remains available.
  }

  if (!response.ok) {
    throw new Error(
      payload?.error || `Preview publishing failed with HTTP ${response.status}`,
    );
  }

  const previewId = readPreviewId(payload);
  const previewUrl = new URL(`./preview/${previewId}`, publicBaseUrl);

  return {
    previewUrl: previewUrl.toString(),
    expiresAt: payload?.expiresAt,
  };
}

export async function openWebPreview(): Promise<void> {
  const tabManager = runtime.tabManager;
  const storage = runtime.storage;
  if (!tabManager || !storage) throw new Error('IDE is not ready');

  const activeTab = tabManager.getActiveTab();
  if (!activeTab || (!isHtmlFile(activeTab.file) && !isCssFile(activeTab.file))) {
    throw new Error('Open an HTML or CSS file before starting the web preview.');
  }

  // Opening synchronously keeps browser popup blockers satisfied while the
  // workspace is collected and, for CSS, its owning HTML page is resolved.
  const previewWindow = window.open('', '_blank');
  if (!previewWindow) {
    throw new Error('The browser blocked the preview tab. Allow popups for this site.');
  }

  previewWindow.opener = null;
  previewWindow.document.open();
  previewWindow.document.write(
    '<!doctype html><title>Publishing preview…</title>' +
    '<p style="font:16px system-ui;padding:24px">Publishing shareable preview…</p>',
  );
  previewWindow.document.close();

  try {
    await tabManager.saveCurrentTab();

    const files = await collectWorkspaceSnapshot();
    const storedActiveFile = await storage.getFile(activeTab.file.id);
    const activePath = normalizeProjectPath(
      storedActiveFile?.path || activeTab.file.path || activeTab.file.name,
    );

    let entry: WorkspaceFile | undefined;

    if (isHtmlFile(activeTab.file)) {
      entry = files.find(
        file => normalizeProjectPath(file.path) === activePath,
      );
    } else {
      const htmlEntries = findHtmlEntriesUsingCss(files, activePath);

      if (htmlEntries.length === 0) {
        throw new Error(
          [
            'CSS files cannot run by themselves.',
            `"${activePath}" is not linked from any HTML file in the workspace.`,
            'Add it to an HTML file with:',
            `<link rel="stylesheet" href="./${activePath.split('/').pop()}">`,
            'Then run the HTML file, or run this CSS file again.',
          ].join('\n'),
        );
      }

      if (htmlEntries.length > 1) {
        throw new Error(
          [
            'This CSS file is used by more than one HTML page.',
            'Open and run the page you want to preview:',
            ...htmlEntries.map(file => `- ${normalizeProjectPath(file.path)}`),
          ].join('\n'),
        );
      }

      entry = htmlEntries[0];
    }

    if (!entry) {
      throw new Error(`HTML entry file was not found for: ${activePath}`);
    }

    const entryPath = normalizeProjectPath(entry.path);
    const bundled = bundleHtml({ ...entry, path: entryPath }, files);
    const published = await publishPreview(bundled.html, entryPath);

    previewWindow.location.replace(published.previewUrl);

    setStatus('Shareable preview opened ✅');
    setOutput(
      [
        `Shareable preview: ${published.previewUrl}`,
        `Entry page: ${entryPath}`,
        isCssFile(activeTab.file) ? `Stylesheet: ${activePath}` : '',
        published.expiresAt ? `Expires: ${published.expiresAt}` : '',
        bundled.warnings.length
          ? `Warnings:\n- ${bundled.warnings.join('\n- ')}`
          : '',
      ].filter(Boolean).join('\n\n'),
    );
  } catch (error) {
    previewWindow.close();
    throw error;
  }
}

export function initializeWebPreview(): void {
  const runButton = document.getElementById('run');
  if (!runButton || document.getElementById('open-web-preview')) return;

  const button = document.createElement('button');
  button.id = 'open-web-preview';
  button.className = 'btn btn-secondary';
  button.type = 'button';
  button.title = 'Open the current HTML page, or the HTML page using this CSS file';
  button.innerHTML = '🌐 <span>Open Preview</span>';
  button.addEventListener('click', () => {
    void openWebPreview().catch(error => {
      setStatus('Preview failed');
      setOutput(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    });
  });
  runButton.insertAdjacentElement('afterend', button);

  const updateVisibility = () => {
    const active = runtime.tabManager?.getActiveTab();
    const canPreview = isHtmlFile(active?.file) || isCssFile(active?.file);
    button.hidden = !canPreview;
    button.title = isCssFile(active?.file)
      ? 'Open the HTML page that uses this stylesheet'
      : 'Open the current HTML file in a new browser tab';
  };
  updateVisibility();
  new MutationObserver(updateVisibility).observe(document.getElementById('tabs')!, {
    childList: true,
    subtree: true,
    attributes: true,
  });
}
