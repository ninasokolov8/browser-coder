/**
 * Boot the real IDE and assert it reaches a working state.
 *
 * This is the test that would have caught a broken composition root. The
 * workspace unit tests and the workspace smoke test both exercise the domain; a
 * mistake in `main.ts` wiring order, a facade method a consumer still calls, or a
 * write to a property that is now a getter would pass all of them and still leave
 * the application dead on arrival.
 *
 * Runs the app in a same-origin iframe so its DOM, its console and its uncaught
 * errors are all readable from here.
 */

const RECEIVER_PORT = 5200;
const BOOT_TIMEOUT_MS = 45000;

const lines: string[] = [];
let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    lines.push(`PASS ${name}`);
  } else {
    failures += 1;
    lines.push(`FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

const frame = document.getElementById('app') as HTMLIFrameElement;
const errors: string[] = [];

function watchForErrors(frameWindow: Window): void {
  frameWindow.addEventListener('error', event => {
    errors.push(`error: ${event.message} (${event.filename}:${event.lineno})`);
  });
  frameWindow.addEventListener('unhandledrejection', event => {
    const reason = (event as PromiseRejectionEvent).reason;
    errors.push(`unhandledrejection: ${reason?.stack || reason}`);
  });

  // console.error is separate from uncaught errors, and the app's bootstrap
  // catch-all reports failures through it - so a silent boot failure would be
  // invisible without this.
  const originalError = frameWindow.console.error;
  frameWindow.console.error = (...args: unknown[]) => {
    errors.push(`console.error: ${args.map(argument => String(argument)).join(' ')}`);
    originalError.apply(frameWindow.console, args as never);
  };
}

/** Wait until `predicate` holds, or give up. */
async function waitFor(
  description: string,
  predicate: () => boolean,
  timeoutMs = BOOT_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return true;
    } catch {
      /* the frame may still be navigating */
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  lines.push(`TIMEOUT waiting for ${description}`);
  return false;
}

async function run(): Promise<void> {
  await new Promise<void>(resolve => {
    if (frame.contentDocument?.readyState === 'complete') return resolve();
    frame.addEventListener('load', () => resolve(), { once: true });
  });

  const frameWindow = frame.contentWindow!;
  watchForErrors(frameWindow);

  const statusText = (): string =>
    frame.contentDocument?.getElementById('status')?.textContent ?? '';

  const reachedReady = await waitFor('the IDE to report Ready', () => /Ready/i.test(statusText()));
  check('the IDE boots to Ready', reachedReady, `status was "${statusText()}"`);
  check(
    'bootstrap did not report an initialization failure',
    !/Initialization failed/i.test(statusText()),
    statusText(),
  );

  // The workspace must be reachable and open, or every later command fails.
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  check('the app exposes its runtime for testing', runtime !== undefined);

  if (runtime) {
    const workspace = runtime.workspace as
      | { isOpen: boolean; allDocuments(): unknown[]; snapshotForExecution(): unknown[] }
      | null;
    check('the workspace service is constructed', workspace !== null);
    check('the workspace is open', workspace?.isOpen === true);
    check('the model registry is constructed', runtime.models !== null);
    check('the tab manager is constructed', runtime.tabManager !== null);

    // A default workspace should have produced one visible document and a model
    // for it, which means the whole create -> persist -> open -> render path ran.
    const tabManager = runtime.tabManager as { getAllTabs(): Array<{ file: { id: string; name: string; content: string } }> } | null;
    const tabs = tabManager?.getAllTabs() ?? [];
    lines.push(`INFO open tabs: ${tabs.length}, documents: ${workspace?.allDocuments().length ?? 0}`);

    if (tabs.length > 0) {
      const first = tabs[0];
      check('an open tab projects a name', typeof first.file.name === 'string' && first.file.name.length > 0);
      check('an open tab reads content through to its buffer', typeof first.file.content === 'string');

      const models = runtime.models as { peek(id: string): { uri: { toString(): string } } | null };
      const model = models.peek(first.file.id);
      check('the active document has a Monaco model', model !== null);
      check(
        'the model URI is a workspace path',
        model ? model.uri.toString().startsWith('file:///workspace/') : false,
        model?.uri.toString(),
      );
    }

    // The execution snapshot is what a run sends, so an empty or malformed one is
    // a broken Run button.
    const snapshot = workspace?.snapshotForExecution() ?? [];
    lines.push(`INFO execution snapshot entries: ${snapshot.length}`);
  }

  // A fresh browser profile has an empty IndexedDB, so an empty workspace is the
  // CORRECT state here: the IDE deliberately opens with no file rather than
  // inventing one, and `initializeWorkspace` calls `editor.setModel(null)`.
  //
  // Monaco tears its view down when it has no model, so `.monaco-editor` is
  // legitimately absent in this state - which is why Monaco is checked AFTER a
  // document exists, not before. Recorded rather than asserted, so a change in
  // this behaviour is visible in the log.
  lines.push(
    `INFO cold start - editor set: ${runtime ? runtime.editor !== null : 'no runtime'}` +
      `, monaco elements: ${frame.contentDocument?.querySelectorAll('[class*=monaco]').length ?? -1}` +
      `, explorer rows: ${frame.contentDocument?.querySelectorAll('#file-tree .tree-item').length ?? 0}`,
  );

  if (runtime) {
    const tabManager = runtime.tabManager as {
      createNewFile(lang: unknown, version: unknown): Promise<{ file: { id: string; name: string } } | null>;
      getAllTabs(): unknown[];
    } | null;

    const created = await tabManager?.createNewFile(runtime.currentLang, runtime.currentVersion);
    check('creating a file from a cold workspace works', !!created);

    if (created) {
      lines.push(`INFO created ${created.file.name}`);
      const rowsAfter = await waitFor(
        'the explorer to show the new file',
        () => (frame.contentDocument?.querySelectorAll('#file-tree .tree-item').length ?? 0) > 0,
        10000,
      );
      check('the explorer renders a newly created file', rowsAfter);

      const models = runtime.models as { peek(id: string): { uri: { toString(): string } } | null };
      const model = models.peek(created.file.id);
      check('the new document has a Monaco model', model !== null);
      check(
        'the new model URI is a workspace path',
        model ? model.uri.toString().startsWith('file:///workspace/') : false,
        model?.uri.toString(),
      );

      // Asserted as a delta, not an absolute count: the workspace may legitimately
      // already hold files, and pinning the number makes the test depend on how the
      // profile happened to be left.
      const workspaceApi = runtime.workspace as { snapshotForExecution(): Array<{ path: string }> };
      const snapshotAfter = workspaceApi.snapshotForExecution();
      check(
        'the new file appears in the execution snapshot',
        snapshotAfter.some(entry => entry.path === created.file.name),
        `snapshot: ${snapshotAfter.map(entry => entry.path).join(', ')}`,
      );

      // Now that a document is open, Monaco must have a view. This is the
      // assertion that proves the editor is genuinely usable.
      const editorMounted = await waitFor(
        'Monaco to mount once a document is open',
        () => (frame.contentDocument?.querySelectorAll('.monaco-editor').length ?? 0) > 0,
        15000,
      );
      check('Monaco mounts once a document is open', editorMounted);

      if (!editorMounted) {
        const container = frame.contentDocument?.getElementById('editor');
        lines.push(`DIAG #editor children: ${container?.children.length ?? -1}`);
        lines.push(`DIAG #editor html head: ${(container?.innerHTML ?? '').slice(0, 300)}`);
      }

      // Typing in the editor must reach the document, and autosave must persist it
      // without anyone calling save. This is the whole edit loop, end to end.
      const models2 = runtime.models as { peek(id: string): { setValue(value: string): void } | null };
      const liveModel = models2.peek(created.file.id);
      const documentApi = (runtime.workspace as {
        getDocument(id: string): { getContent(): string; isDirty: boolean } | null;
      }).getDocument(created.file.id);

      if (liveModel && documentApi) {
        liveModel.setValue('// typed by the boot smoke test\n');
        check('typing in the editor reaches the document', documentApi.getContent().includes('boot smoke test'));
        check('typing marks the document dirty', documentApi.isDirty);

        const saved = await waitFor('autosave to persist the edit', () => !documentApi.isDirty, 10000);
        check('autosave persists an editor edit with no explicit save', saved);
      } else {
        check('the live model and document are both reachable', false);
      }
    }
  }

  // Errors are checked last, so their content is reported alongside everything
  // else rather than aborting the run.
  check('no uncaught errors during boot', errors.length === 0, errors.slice(0, 6).join(' | '));
}

run()
  .catch(error => {
    failures += 1;
    lines.push(`FAIL threw: ${error?.stack || error}`);
  })
  .finally(async () => {
    lines.push(failures === 0 ? 'APP BOOT: ALL PASSED' : `APP BOOT: ${failures} FAILED`);
    document.getElementById('results')!.textContent = lines.join('\n');

    try {
      await fetch(`http://127.0.0.1:${RECEIVER_PORT}/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, failures }),
      });
    } catch {
      /* opened by hand - the DOM shows the results */
    }
  });
