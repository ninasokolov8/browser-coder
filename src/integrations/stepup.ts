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

/**
 * Resolves once the workspace has finished initializing.
 *
 * The IDE used to announce `ide:ready` at the end of `setupStepUpIntegration()`,
 * which runs BEFORE `await initializeWorkspace()`. A host that answered promptly
 * therefore delivered its project into a workspace that was about to be emptied:
 * embedded initialization calls `clearAll()` to avoid restoring an unrelated
 * previous session, so the files were silently discarded and the student saw an
 * empty editor.
 *
 * Step-Up has probably been getting away with it because readiness is re-announced
 * at +100ms and +500ms and its own round trip is slower than initialization - which
 * is luck, not a contract. Found by the embedded browser suite, which answers
 * `ide:ready` immediately and so lost every file.
 *
 * Two things now guarantee it: readiness is not announced until initialization
 * completes, and any message arriving before then is queued rather than dropped -
 * because a host is free to post without waiting to be asked.
 */
let signalWorkspaceReady: () => void = () => {};
const workspaceReady = new Promise<void>(resolve => {
  signalWorkspaceReady = resolve;
});

/** Called by the bootstrap once the workspace is open and the editor is mounted. */
export function markWorkspaceReady(): void {
  signalWorkspaceReady();
}

export function setupStepUpIntegration(): void {
  const editor = runtime.editor!;
  const tabManager = runtime.tabManager!;

  async function handleSetFilesAsync(data: { files: Array<{ path: string; content: string; language?: string }> }) {
    if (!Array.isArray(data.files) || data.files.length === 0) return;

    // Models are deliberately NOT disposed here any more. `replaceAll` keeps the
    // document for a path that still exists, so a host re-sending the same project
    // preserves the editor model, its undo history and the user's scroll position.
    // Disposing them up front threw all of that away on every host update, which
    // is what made a Step-Up autosave feel like the editor was resetting.

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
          // `replaceAllFiles` already stored this content. Acquiring the model
          // makes it the document's buffer, so there is nothing further to assign -
          // and `tab.file.content` is now a read-through view of that buffer, so
          // writing to it would throw rather than silently do the wrong thing.
          const model = getOrCreateModel(tab);

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

    if (data.autoRun) {
      // The registry decides whether it is allowed; autoRun only says the host
      // wants it. Checking the policy here as well would be a second copy of the
      // rule that can drift from the first.
      setTimeout(() => void runtime.commands?.execute('workspace.run', { source: 'host' }), 200);
    }
  }

  /**
   * Host messages are handled one at a time, in arrival order, and never before
   * the workspace is ready.
   *
   * Serialising also removes a latent hazard the previous fire-and-forget
   * `void handleInit(data)` had: two `set-files` messages arriving close together
   * could interleave inside `replaceAll`, and the one that finished last won
   * regardless of which the host sent last.
   */
  let messageQueue: Promise<void> = workspaceReady;

  window.addEventListener('message', event => {
    if (!isAllowedOrigin(event.origin)) return;

    setParentOrigin(event.origin);

    const { type, ...data } = event.data || {};

    messageQueue = messageQueue
      .then(() => handleHostMessage(type, data))
      .catch(error => {
        // One malformed message must not wedge the queue for every later one.
        console.error(`[IDE] Failed to handle host message "${type}":`, error);
      });
  });

  async function handleHostMessage(type: string, data: any): Promise<void> {
    switch (type) {
      // Awaited, not fired and forgotten. `void handleInit(data)` returned before
      // the project had loaded, so the next message could start against a
      // half-replaced workspace.
      case 'stepup:init':
        await handleInit(data);
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
        await handleSetFilesAsync(data);
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
          // Awaited so that a get immediately following a set observes the set.
          const files = await collectWorkspaceSnapshot();
          if (!files.length) {
            files.push({
              path: 'main',
              content: editor.getValue(),
              language: appConfig.urlLanguage,
            });
          }

          sendToParent('ide:files', { files });
        }

        break;
      }

      case 'stepup:run':
        // Through the registry rather than synthesising a click. The old form
        // checked `policyState.allowRun` here, at the caller - which is precisely
        // the shape that left every OTHER caller unchecked (V-17). One enforcement
        // point, and the host is just another source.
        await runtime.commands?.execute('workspace.run', { source: 'host' });
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

        if (data.turtleData?.shapes?.length || data.turtleData?.cursors?.length) {
          renderTurtle(data.turtleData);
        }

        break;
      }

      case 'stepup:clear-output':
        setOutput('');
        clearTurtleCanvas();
        break;
    }
  }

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

    // Announced only once the workspace is genuinely usable. Announcing it here
    // directly - as this did - invited the host to deliver a project that embedded
    // initialization then wiped. The repeats stay, because a host that mounts the
    // iframe and attaches its listener late can miss a single message.
    void workspaceReady.then(() => {
      notifyParentReady(policyState.readonly);
      setTimeout(() => notifyParentReady(policyState.readonly), 100);
      setTimeout(() => notifyParentReady(policyState.readonly), 500);
    });
  }
}