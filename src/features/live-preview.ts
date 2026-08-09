import { runtime } from '../app/runtime';
import { normalizeProjectPath } from '../components/project-path';
import { setOutput, setStatus } from '../components/output';
import { collectWorkspaceSnapshot, type WorkspaceFile } from './workspace';
import { markdownToPage } from './markdown';
import { t, tn } from '../i18n/index.ts';

const PREVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function dirname(filePath: string): string {
  const parts = normalizeProjectPath(filePath).split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function resolvePath(fromPath: string, specifier: string): string | null {
  if (!specifier || /^(?:[a-z]+:|#|\/\/)/i.test(specifier)) return null;

  const base = specifier.startsWith('/')
    ? []
    : dirname(fromPath).split('/').filter(Boolean);

  const parts = specifier.replace(/[?#].*$/, '').split('/');
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }

  return normalizeProjectPath(base.join('/'));
}

export function isHtmlFile(
  file: { language?: string; name?: string; path?: string } | null | undefined,
): boolean {
  if (!file) return false;
  return file.language === 'html' || /\.html?$/i.test(file.path || file.name || '');
}

export function isCssFile(
  file: { language?: string; name?: string; path?: string } | null | undefined,
): boolean {
  if (!file) return false;
  return file.language === 'css' || /\.css$/i.test(file.path || file.name || '');
}

export function isSvgFile(
  file: { language?: string; name?: string; path?: string } | null | undefined,
): boolean {
  if (!file) return false;
  return file.language === 'svg' || /\.svg$/i.test(file.path || file.name || '');
}

export function isMarkdownFile(
  file: { language?: string; name?: string; path?: string } | null | undefined,
): boolean {
  if (!file) return false;
  return (
    file.language === 'markdown' ||
    /\.(?:md|markdown|mdown|mkd)$/i.test(file.path || file.name || '')
  );
}

/** Every file the Open Preview button can act on. */
export function isPreviewable(
  file: { language?: string; name?: string; path?: string } | null | undefined,
): boolean {
  return isHtmlFile(file) || isCssFile(file) || isMarkdownFile(file);
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

/**
 * Return the public directory from which Browser Coder was loaded.
 *
 * Arc Academy exposes the app below /coder/, while the inner Browser Coder
 * server receives paths without that prefix. Resolving API and preview URLs
 * relative to the loaded document keeps the public /coder/ mount intact.
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

  throw new Error(t('preview.invalidId'));
}

function preparePreviewFiles(files: WorkspaceFile[]): WorkspaceFile[] {
  const byPath = new Map<string, WorkspaceFile>();

  for (const file of files) {
    const normalizedPath = normalizeProjectPath(file.path);
    if (!normalizedPath) continue;

    byPath.set(normalizedPath, {
      path: normalizedPath,
      content: typeof file.content === 'string' ? file.content : '',
      language: file.language,
    });
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function publishPreview(
  files: WorkspaceFile[],
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
    body: JSON.stringify({
      entryPath,
      files: files.map(file => ({
        path: file.path,
        content: file.content,
        language: file.language,
      })),
    }),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    // The status-based fallback below remains available.
  }

  if (!response.ok) {
    throw new Error(
      payload?.error || t('preview.publishHttpError', { status: response.status }),
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
  if (!tabManager || !storage) throw new Error(t('error.ideNotReady'));

  const activeTab = tabManager.getActiveTab();
  if (!activeTab || !isPreviewable(activeTab.file)) {
    throw new Error(t('preview.openPreviewableFirst'));
  }

  // Open synchronously so browser popup blockers do not block the preview tab
  // while the workspace snapshot is saved and published.
  const previewWindow = window.open('', '_blank');
  if (!previewWindow) {
    throw new Error(t('preview.popupBlocked'));
  }

  previewWindow.opener = null;
  previewWindow.document.open();
  previewWindow.document.write(
    `<!doctype html><title>${t('preview.publishing')}</title>` +
    `<p style="font:16px system-ui;padding:24px">${t('preview.publishingShareable')}</p>`,
  );
  previewWindow.document.close();

  try {
    await tabManager.saveCurrentTab();

    const files = preparePreviewFiles(await collectWorkspaceSnapshot());
    const storedActiveFile = await storage.getFile(activeTab.file.id);
    const activePath = normalizeProjectPath(
      storedActiveFile?.path || activeTab.file.path || activeTab.file.name,
    );

    let entry: WorkspaceFile | undefined;

    if (isMarkdownFile(activeTab.file)) {
      // Rendered to a real page and published alongside the workspace, so relative
      // images in the notes - `![maze](maze.svg)` - resolve against the same files
      // the HTML preview would see.
      const source = files.find(file => file.path === activePath);
      if (!source) throw new Error(t('preview.markdownNotFound', { path: activePath }));

      const renderedPath = `${activePath.replace(/\.[^./]+$/, '')}.preview.html`;
      const rendered: WorkspaceFile = {
        path: renderedPath,
        language: 'html',
        // The IDE's theme, not the machine's: a light IDE on a dark laptop used to
        // render the notes dark beside a light editor.
        content: markdownToPage(
          source.content,
          activePath.split('/').pop() || activePath,
          document.body.classList.contains('dark-theme'),
        ),
      };
      files.push(rendered);
      entry = rendered;
    } else if (isHtmlFile(activeTab.file)) {
      entry = files.find(file => file.path === activePath);
    } else {
      const htmlEntries = findHtmlEntriesUsingCss(files, activePath);

      if (htmlEntries.length === 0) {
        throw new Error(
          [
            t('preview.cssCannotRunAlone'),
            t('preview.cssNotLinked', { path: activePath }),
            t('preview.addToHtml'),
            `<link rel="stylesheet" href="./${activePath.split('/').pop()}">`,
            t('preview.runHtmlOrCssAgain'),
          ].join('\n'),
        );
      }

      if (htmlEntries.length > 1) {
        throw new Error(
          [
            t('preview.cssUsedByMany'),
            t('preview.chooseHtmlPage'),
            ...htmlEntries.map(file => `- ${normalizeProjectPath(file.path)}`),
          ].join('\n'),
        );
      }

      entry = htmlEntries[0];
    }

    if (!entry) {
      throw new Error(t('preview.htmlEntryNotFound', { path: activePath }));
    }

    const entryPath = normalizeProjectPath(entry.path);
    const published = await publishPreview(files, entryPath);

    previewWindow.location.replace(published.previewUrl);

    setStatus(t('preview.opened'));
    setOutput(
      [
        t('preview.shareableUrl', { url: published.previewUrl }),
        t('preview.entryPage', { path: entryPath }),
        tn('preview.publishedFiles', files.length),
        isCssFile(activeTab.file) ? t('preview.stylesheet', { path: activePath }) : '',
        published.expiresAt ? t('preview.expires', { time: published.expiresAt }) : '',
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
  button.title = t('preview.openHint');
  button.innerHTML = `🌐 <span>${t('preview.open')}</span>`;
  button.addEventListener('click', () => {
    void openWebPreview().catch(error => {
      setStatus(t('preview.failed'));
      setOutput(`${t('error.label')}: ${error instanceof Error ? error.message : String(error)}`);
    });
  });
  runButton.insertAdjacentElement('afterend', button);

  const updateVisibility = () => {
    const active = runtime.tabManager?.getActiveTab();
    const label = button.querySelector('span');
    if (label) label.textContent = t('preview.open');
    button.hidden = !isPreviewable(active?.file);
    button.title = isCssFile(active?.file)
      ? t('preview.openStylesheetPage')
      : isMarkdownFile(active?.file)
        ? t('preview.openMarkdown')
        : t('preview.openHtml');
  };

  updateVisibility();
  new MutationObserver(updateVisibility).observe(document.getElementById('tabs')!, {
    childList: true,
    subtree: true,
    attributes: true,
  });
  window.addEventListener('languageChanged', updateVisibility);
}
