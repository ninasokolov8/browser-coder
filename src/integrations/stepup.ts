// @ts-nocheck
import * as monaco from 'monaco-editor';
import { appConfig, policyState } from '../app/config';
import { runtime } from '../app/runtime';
import { getLanguage } from '../languages';
import { langSel, versionSel, statusLangEl, runBtn } from '../components/dom';
import { setOutput } from '../components/output';
import { clearTurtleCanvas, renderTurtle } from '../components/turtle';
import { populateVersionDropdown, configureMonacoForVersion } from '../components/monaco-config';
import { getOrCreateModel, disposeModel, updateEmptyState } from '../features/editor-core';
import { renderFileTree, setExpandedFolders } from '../features/explorer';
import { collectWorkspaceSnapshot } from '../features/workspace';
import { applyPolicyFromMessage } from '../features/sidebar';
import {
  deriveInitialParentOrigin, isAllowedOrigin, notifyCodeChange, notifyParentReady,
  sendToParent, setParentOrigin,
} from './stepup-bus';

export function setupStepUpIntegration(): void {
  const editor = runtime.editor!;
  const tabManager = runtime.tabManager!;

  async function handleSetFilesAsync(data: { files: Array<{ path: string; content: string; language?: string }> }) {
    if (!Array.isArray(data.files) || data.files.length === 0) return;

    for (const [id] of runtime.fileModels) {
      disposeModel(id);
    }

    const activeTab = await tabManager.replaceAllFiles(
      data.files,
      runtime.currentLang!,
      runtime.currentVersion!
    );

    if (activeTab) {
      editor.setModel(getOrCreateModel(activeTab));
      updateEmptyState(false);

      const activeFileLang = getLanguage(activeTab.file.language);

      if (activeFileLang) {
        runtime.currentLang = activeFileLang;
        langSel.value = activeFileLang.id;
        runtime.currentVersion = populateVersionDropdown(
          activeFileLang,
          activeTab.file.version
        );
        configureMonacoForVersion(
          activeFileLang,
          runtime.currentVersion
        );
        statusLangEl.textContent = activeFileLang.name;
      }
    }

    // Always open embedded projects with every folder collapsed.
    // replaceAllFiles() recreates folder IDs, so old expansion state must
    // also be removed whenever new project files are received.
    setExpandedFolders(new Set());

    renderFileTree();
  }

  async function handleInit(data: any) {
    applyPolicyFromMessage(data);

    if (
      Array.isArray(data.files) &&
      data.files.length > 0 &&
      appConfig.ideMode !== 'snippet'
    ) {
      await handleSetFilesAsync({ files: data.files });
    } else if (typeof data.code === 'string') {
      if (appConfig.isEmbedded) {
        const fileName = `main.${runtime.currentLang!.extension}`;

        const tab = await tabManager.replaceAllFiles(
          [{
            path: fileName,
            content: data.code,
            language: runtime.currentLang!.id,
          }],
          runtime.currentLang!,
          runtime.currentVersion!
        );

        if (tab) {
          tab.file.content = data.code;

          const model = getOrCreateModel(tab);
          model.setValue(data.code);

          editor.setModel(model);
          updateEmptyState(false);
          renderFileTree();
        } else {
          const uri = monaco.Uri.parse(`inmemory:///${fileName}`);
          const model =
            monaco.editor.getModel(uri) ||
            monaco.editor.createModel(
              data.code,
              runtime.currentLang!.id,
              uri
            );

          model.setValue(data.code);
          editor.setModel(model);
          updateEmptyState(false);
        }

        requestAnimationFrame(() => editor.layout());
        setTimeout(() => editor.layout(), 100);
      } else {
        editor.setValue(data.code);
      }
    }

    if (typeof data.output === 'string') {
      setOutput(data.output);
    }

    notifyParentReady(policyState.readonly);

    if (data.autoRun && policyState.allowRun) {
      setTimeout(() => runBtn.click(), 200);
    }
  }

  window.addEventListener('message', event => {
    if (!isAllowedOrigin(event.origin)) return;

    setParentOrigin(event.origin);

    const { type, ...data } = event.data || {};

    switch (type) {
      case 'stepup:init':
        void handleInit(data);
        break;

      case 'stepup:set-code':
        if (typeof data.code === 'string') {
          editor.setValue(data.code);
        }
        break;

      case 'stepup:get-code':
        sendToParent('ide:code-response', {
          code: editor.getValue(),
          language: appConfig.urlLanguage,
          version: appConfig.urlVersion,
        });
        break;

      case 'stepup:set-files':
        void handleSetFilesAsync(data);
        break;

      case 'stepup:get-files': {
        if (appConfig.ideMode === 'snippet') {
          sendToParent('ide:files', {
            files: [{
              path: 'main',
              content: editor.getValue(),
              language: appConfig.urlLanguage,
            }],
          });
        } else {
          void collectWorkspaceSnapshot().then(files => {
            if (!files.length) {
              files.push({
                path: 'main',
                content: editor.getValue(),
                language: appConfig.urlLanguage,
              });
            }

            sendToParent('ide:files', { files });
          });
        }

        break;
      }

      case 'stepup:run':
        if (policyState.allowRun) {
          runBtn.click();
        }
        break;

      case 'stepup:set-readonly':
        applyPolicyFromMessage(data);
        break;

      case 'stepup:show-output': {
        clearTurtleCanvas();

        let text = typeof data.output === 'string'
          ? data.output
          : '';

        if (typeof data.output !== 'string') {
          if (data.stdout) {
            text += data.stdout;
          }

          if (data.stderr) {
            text += `${text ? '\n' : ''}[stderr]\n${data.stderr}`;
          }

          if (typeof data.exitCode === 'number') {
            text += `\n[exit code: ${data.exitCode}]`;
          }
        }

        setOutput(text);

        if (data.turtleData?.shapes?.length) {
          renderTurtle(data.turtleData);
        }

        break;
      }

      case 'stepup:clear-output':
        setOutput('');
        clearTurtleCanvas();
        break;
    }
  });

  let filesSnapshotTimeout: ReturnType<typeof setTimeout> | null = null;

  runtime.notifyWorkspaceChanged = () => {
    if (
      !appConfig.isEmbedded ||
      appConfig.ideMode === 'snippet' ||
      policyState.readonly
    ) {
      return;
    }

    if (filesSnapshotTimeout) {
      clearTimeout(filesSnapshotTimeout);
    }

    filesSnapshotTimeout = setTimeout(async () => {
      sendToParent('ide:files', {
        files: await collectWorkspaceSnapshot(),
      });
    }, 500);
  };

  let codeChangeTimeout: ReturnType<typeof setTimeout> | null = null;

  editor.onDidChangeModelContent(() => {
    const activeTab = tabManager.getActiveTab();

    if (activeTab) {
      tabManager.markDirty(
        activeTab.file.id,
        editor.getValue()
      );
    }

    if (appConfig.isEmbedded && !policyState.readonly) {
      if (codeChangeTimeout) {
        clearTimeout(codeChangeTimeout);
      }

      codeChangeTimeout = setTimeout(() => {
        notifyCodeChange(editor.getValue());
      }, 300);

      runtime.notifyWorkspaceChanged();
    }
  });

  if (appConfig.isEmbedded) {
    const initialOrigin = deriveInitialParentOrigin();

    if (initialOrigin) {
      setParentOrigin(initialOrigin);
    }

    notifyParentReady(policyState.readonly);
    setTimeout(() => notifyParentReady(policyState.readonly), 100);
    setTimeout(() => notifyParentReady(policyState.readonly), 500);
  }
}