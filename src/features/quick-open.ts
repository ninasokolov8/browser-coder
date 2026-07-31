/**
 * Quick-open (Ctrl/Cmd+P): jump to any file by typing part of its name.
 *
 * The explorer tree is fine for a handful of files and useless for fifty. Every
 * real IDE has this, and without it the only way to reach a file in a nested
 * folder is to expand the path by hand every time.
 *
 * Ranking is deliberate rather than incidental:
 *
 *  - a match on the file NAME beats a match on the path, so typing "main" finds
 *    `main.py` before `main/helper.py`
 *  - with no query, the most recently opened files come first, because the file
 *    you want next is usually one you were just looking at
 *  - hidden workspace entries are excluded, matching what the explorer shows
 *
 * The overlay is `picker.ts`, shared with the command palette.
 */

import { runtime } from '../app/runtime';
import { t } from '../i18n';
import { createPicker, type PickerItem } from './picker.ts';
import { isWorkspaceEntryHidden } from './workspace-visibility';
import type { Disposable } from '../workspace/types.ts';

const OVERLAY_ID = 'quick-open';

/**
 * Files in the order they were last opened, most recent first.
 *
 * Kept here rather than in the workspace service: it is a UI affordance, and the
 * service deliberately does not model "recency" - a document's revision changes
 * when it is edited, which is not the same thing as being looked at.
 */
const recentlyOpened: string[] = [];
const MAX_RECENT = 50;

export function noteFileOpened(documentId: string): void {
  const existing = recentlyOpened.indexOf(documentId);
  if (existing !== -1) recentlyOpened.splice(existing, 1);
  recentlyOpened.unshift(documentId);
  if (recentlyOpened.length > MAX_RECENT) recentlyOpened.length = MAX_RECENT;
}

export function initializeQuickOpen(): Disposable {
  const picker = createPicker({
    overlayId: OVERLAY_ID,
    placeholder: t('quickOpen.placeholder'),
    ariaLabel: t('quickOpen.label'),
    emptyText: t('quickOpen.empty'),

    items: (): PickerItem[] => {
      const workspace = runtime.workspace;
      if (!workspace) return [];

      return workspace
        .allDocuments()
        .filter(document => !isWorkspaceEntryHidden({
          name: document.name,
          path: workspace.pathOf(document.id) ?? document.name,
        }))
        .map(document => {
          const path = workspace.pathOf(document.id) ?? document.name;
          const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
          return {
            id: document.id,
            label: document.name,
            // Only the folder, not the whole path: repeating the file name in the
            // detail column is noise on every single row.
            detail: folder || undefined,
          };
        });
    },

    // Most recent first for an empty query. Files never opened sort after all of
    // them, in the alphabetical order the picker falls back to.
    initialOrder: item => {
      const index = recentlyOpened.indexOf(item.id);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    },

    onPick: async item => {
      await runtime.tabManager?.switchToTab(item.id);
    },
  });

  const onKeyDown = (event: KeyboardEvent): void => {
    // Shift is excluded so this never swallows Ctrl+Shift+P, which is the command
    // palette - the two would otherwise both fire on the same chord.
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      picker.toggle();
    }
  };

  document.addEventListener('keydown', onKeyDown);

  return {
    dispose: () => {
      document.removeEventListener('keydown', onKeyDown);
      picker.dispose();
    },
  };
}
