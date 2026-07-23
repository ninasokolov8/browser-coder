// @ts-nocheck
import {
  runtime,
  requireEditor,
  requireTabManager,
} from '../app/runtime';
import { appConfig } from '../app/config';
import {
  togglePanelBtn,
  panelEl,
  clearOutputBtn,
  panelResizeEl,
  sidebarResizeEl,
  sidebarEl,
  statusLineEl,
  statusLangEl,
  activityIcons,
  themeSel,
} from '../components/dom';
import {
  saveSettings,
  loadSettings,
} from '../components/settings';
import { setOutput } from '../components/output';
import { clearTurtleCanvas } from '../components/turtle';
import { applyTheme } from '../components/monaco-config';
import { t } from '../i18n';
import { updateGridForRTL } from './ui-layout';
import { renderFileTree } from './explorer';
import {
  applyIdePolicy,
  switchSidebarPanel,
} from './sidebar';

export function initializeLayout(): void {
  const editor = requireEditor();
  const tabManager = requireTabManager();

  // ===== Panel toggle =====

  togglePanelBtn.addEventListener('click', () => {
    const isCollapsed = panelEl.classList.toggle('collapsed');

    togglePanelBtn.textContent = isCollapsed
      ? '⌄'
      : '⌃';

    saveSettings();

    setTimeout(() => {
      editor.layout();
    }, 50);
  });

  // ===== Clear output =====

  clearOutputBtn.addEventListener('click', () => {
    setOutput('');
    clearTurtleCanvas();
  });

  // ===== Panel tabs =====

  const panelTabs = document.querySelectorAll('.panel-tab');

  panelTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      panelTabs.forEach(panelTab => {
        panelTab.classList.remove('active');
      });

      tab.classList.add('active');
    });
  });

  // Snippet mode CSS previously hid the output resize handle.
  // Force the splitter to remain available inside embedded snippets.
  const isEmbeddedSnippet =
    appConfig.isEmbedded &&
    appConfig.ideMode === 'snippet';

  if (isEmbeddedSnippet && !appConfig.noOutput) {
    panelResizeEl.style.setProperty(
      'display',
      'block',
      'important'
    );

    panelResizeEl.style.setProperty(
      'visibility',
      'visible',
      'important'
    );

    panelResizeEl.style.setProperty(
      'pointer-events',
      'auto',
      'important'
    );

    panelResizeEl.style.setProperty(
      'cursor',
      'ns-resize',
      'important'
    );

    panelResizeEl.style.setProperty(
      'touch-action',
      'none',
      'important'
    );

    panelResizeEl.style.setProperty(
      'height',
      '6px',
      'important'
    );

    panelResizeEl.style.setProperty(
      'min-height',
      '6px',
      'important'
    );

    panelResizeEl.style.setProperty(
      'flex',
      '0 0 6px',
      'important'
    );
  }

  // ===== Output panel resize =====

  let isResizing = false;
  let panelPointerId: number | null = null;
  let startY = 0;
  let startHeight = 0;
  let layoutFrame = 0;

  const scheduleEditorLayout = () => {
    if (layoutFrame) {
      cancelAnimationFrame(layoutFrame);
    }

    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      editor.layout();
    });
  };

  const setPanelHeight = (height: number) => {
    panelEl.style.height = `${Math.round(height)}px`;
    scheduleEditorLayout();
  };

  const beginPanelResize = (
    clientY: number,
    pointerId: number | null = null
  ) => {
    if (
      appConfig.noOutput ||
      panelEl.classList.contains('collapsed')
    ) {
      return;
    }

    isResizing = true;
    panelPointerId = pointerId;
    startY = clientY;

    startHeight =
      panelEl.getBoundingClientRect().height ||
      panelEl.offsetHeight;

    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  };

  const resizePanel = (clientY: number) => {
    if (!isResizing) return;

    const delta = startY - clientY;

    const viewportHeight =
      document.documentElement.clientHeight ||
      window.innerHeight;

    // Leave enough room for the editor and toolbar.
    const maxHeight = Math.max(
      100,
      viewportHeight - 120
    );

    const newHeight = Math.max(
      100,
      Math.min(
        startHeight + delta,
        maxHeight
      )
    );

    setPanelHeight(newHeight);
  };

  const finishPanelResize = () => {
    if (!isResizing) return;

    isResizing = false;
    panelPointerId = null;

    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    saveSettings();
    scheduleEditorLayout();
  };

  if ('PointerEvent' in window) {
    panelResizeEl.addEventListener(
      'pointerdown',
      (event: PointerEvent) => {
        if (event.button !== 0) return;

        beginPanelResize(
          event.clientY,
          event.pointerId
        );

        if (!isResizing) return;

        try {
          panelResizeEl.setPointerCapture(
            event.pointerId
          );
        } catch (_) {
          // Best effort.
        }

        event.preventDefault();
      }
    );

    panelResizeEl.addEventListener(
      'pointermove',
      (event: PointerEvent) => {
        if (
          !isResizing ||
          (
            panelPointerId !== null &&
            event.pointerId !== panelPointerId
          )
        ) {
          return;
        }

        resizePanel(event.clientY);
        event.preventDefault();
      }
    );

    const endPointerResize = (
      event: PointerEvent
    ) => {
      if (
        panelPointerId !== null &&
        event.pointerId !== panelPointerId
      ) {
        return;
      }

      try {
        if (
          panelResizeEl.hasPointerCapture(
            event.pointerId
          )
        ) {
          panelResizeEl.releasePointerCapture(
            event.pointerId
          );
        }
      } catch (_) {
        // Best effort.
      }

      finishPanelResize();
    };

    panelResizeEl.addEventListener(
      'pointerup',
      endPointerResize
    );

    panelResizeEl.addEventListener(
      'pointercancel',
      endPointerResize
    );

    panelResizeEl.addEventListener(
      'lostpointercapture',
      finishPanelResize
    );
  } else {
    // Fallback for older browsers.
    panelResizeEl.addEventListener(
      'mousedown',
      (event: MouseEvent) => {
        if (event.button !== 0) return;

        beginPanelResize(event.clientY);

        if (isResizing) {
          event.preventDefault();
        }
      }
    );

    document.addEventListener(
      'mousemove',
      (event: MouseEvent) => {
        resizePanel(event.clientY);
      }
    );

    document.addEventListener(
      'mouseup',
      finishPanelResize
    );
  }

  // ===== Sidebar resize =====

  let isSidebarResizing = false;
  let sidebarStartX = 0;
  let sidebarStartWidth = 0;

  sidebarResizeEl.addEventListener(
    'mousedown',
    (event: MouseEvent) => {
      isSidebarResizing = true;
      sidebarStartX = event.clientX;
      sidebarStartWidth = sidebarEl.offsetWidth;

      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      event.preventDefault();
    }
  );

  document.addEventListener(
    'mousemove',
    (event: MouseEvent) => {
      if (!isSidebarResizing) return;

      const delta =
        event.clientX - sidebarStartX;

      const newWidth = Math.max(
        150,
        Math.min(
          sidebarStartWidth + delta,
          500
        )
      );

      sidebarEl.style.width = `${newWidth}px`;

      const appEl =
        document.getElementById('app')!;

      appEl.style.setProperty(
        '--sidebar-width',
        `${newWidth}px`
      );

      appEl.style.gridTemplateColumns =
        `48px ${newWidth}px 1fr`;

      scheduleEditorLayout();
    }
  );

  document.addEventListener(
    'mouseup',
    () => {
      if (isResizing) {
        finishPanelResize();
      }

      if (isSidebarResizing) {
        isSidebarResizing = false;

        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        saveSettings();

        setTimeout(() => {
          editor.layout();
        }, 50);
      }
    }
  );

  // ===== Status bar =====

  editor.onDidChangeCursorPosition(event => {
    statusLineEl.textContent = t(
      'status.line',
      {
        line: event.position.lineNumber,
        col: event.position.column,
      }
    );
  });

  statusLangEl.textContent =
    runtime.currentLang?.name ?? '';

  // ===== Initial layout =====

  updateGridForRTL();

  void renderFileTree(tabManager);

  const savedSettings = loadSettings();

  // Theme
  if (savedSettings.theme) {
    themeSel.value = savedSettings.theme;
    applyTheme(savedSettings.theme);
  }

  // Sidebar state
  if (!savedSettings.sidebarVisible) {
    sidebarEl.classList.add('collapsed');

    activityIcons.forEach(icon => {
      icon.classList.remove('active');
    });
  } else if (savedSettings.sidebarPanel) {
    switchSidebarPanel(
      savedSettings.sidebarPanel
    );
  }

  // Sidebar width
  if (
    savedSettings.sidebarWidth &&
    savedSettings.sidebarWidth >= 150
  ) {
    sidebarEl.style.width =
      `${savedSettings.sidebarWidth}px`;

    const appEl =
      document.getElementById('app')!;

    appEl.style.setProperty(
      '--sidebar-width',
      `${savedSettings.sidebarWidth}px`
    );

    appEl.style.gridTemplateColumns =
      `48px ${savedSettings.sidebarWidth}px 1fr`;
  }

  // Output panel state
  if (savedSettings.panelCollapsed) {
    panelEl.classList.add('collapsed');
    togglePanelBtn.textContent = '⌄';
  }

  if (
    savedSettings.panelHeight &&
    savedSettings.panelHeight > 100
  ) {
    setPanelHeight(
      savedSettings.panelHeight
    );
  }

  applyIdePolicy();
}