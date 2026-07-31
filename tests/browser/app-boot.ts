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

/**
 * Multi-file TypeScript must resolve, and the reported diagnostics must match what
 * the server would say.
 *
 * Two properties are checked at once:
 *
 * - **Cross-file resolution (V-18 + eager models).** `main.ts` importing `./util`
 *   must NOT report "Cannot find module". Before real workspace URIs the TS worker
 *   was given a flat set of `file:///name_N.ts` models, so relative imports could
 *   not resolve even in principle; and a file the user has not opened has no model
 *   at all unless one is created eagerly.
 *
 * - **Diagnostics agree with the compiler (V-19).** A genuine type error must still
 *   be reported. A configuration that resolves everything by turning checking off
 *   would pass the first assertion and be useless.
 */
async function checkCrossFileTypeScript(frameWindow: Window): Promise<void> {
  const monacoApi = (frameWindow as unknown as { __bcMonaco?: typeof import('monaco-editor') })
    .__bcMonaco;
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!monacoApi || !runtime) {
    check('monaco and runtime are reachable for the diagnostics check', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
    getDocument(id: string): unknown;
  };
  const models = runtime.models as {
    peek(id: string): { uri: unknown } | null;
    ensureModelsFor(languageIds: readonly string[]): void;
  };

  const util = await workspace.createDocument({
    name: 'smoke-util.ts',
    language: 'typescript',
    version: 'ts5-strict',
    content: 'export function double(value: number): number {\n  return value * 2;\n}\n',
  });

  const main = await workspace.createDocument({
    name: 'smoke-main.ts',
    language: 'typescript',
    version: 'ts5-strict',
    // The second call is a real type error, so "no errors" cannot pass by accident.
    content:
      'import { double } from "./smoke-util";\n' +
      'console.log(double(21));\n' +
      'console.log(double("not a number"));\n',
  });

  models.ensureModelsFor(['typescript', 'javascript']);
  const mainModel = models.peek(main.id);
  check('the importing file has a model', mainModel !== null);
  check('the imported file has a model even though it was never opened', models.peek(util.id) !== null);
  if (!mainModel) return;

  const uri = mainModel.uri as { toString(): string };

  // The worker is asynchronous, so wait for it to produce anything at all.
  const gotMarkers = await waitFor(
    'the TypeScript worker to report diagnostics',
    () =>
      monacoApi.editor
        .getModelMarkers({})
        .some(marker => marker.resource.toString() === uri.toString()),
    30000,
  );
  check('the TypeScript worker produces diagnostics', gotMarkers);

  const markers = monacoApi.editor
    .getModelMarkers({})
    .filter(marker => marker.resource.toString() === uri.toString());
  const messages = markers.map(marker => marker.message);

  const unresolved = messages.filter(message => /Cannot find module/i.test(message));
  check(
    'a cross-file import resolves',
    unresolved.length === 0,
    unresolved.join(' | ') || undefined,
  );

  const caughtTypeError = messages.some(message => /not assignable to parameter of type/i.test(message));
  check(
    'a genuine type error is still reported',
    caughtTypeError,
    `markers: ${messages.join(' | ') || '(none)'}`,
  );

  // The lib names passed to Monaco must be ones its bundled TypeScript recognises.
  // An invalid name does not throw - it reports a diagnostic and silently leaves the
  // API surface undefined, so every later assertion would be measuring the wrong
  // configuration.
  const libProblems = messages.filter(message => /Cannot find lib definition|File .*lib\..*\.d\.ts.* not found/i.test(message));
  check('the configured lib set is valid', libProblems.length === 0, libProblems.join(' | ') || undefined);

  lines.push(`INFO diagnostics on the importing file: ${messages.join(' | ') || '(none)'}`);
}


/**
 * The Problems panel and the command palette, driven the way a user drives them.
 *
 * The cross-file check above deliberately leaves a real type error in the
 * workspace, so by the time this runs there is something for the panel to show.
 * Asserting on an empty panel would prove only that it rendered.
 */
async function checkProblemsAndPalette(frameWindow: Window): Promise<void> {
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  const frameDocument = frame.contentDocument!;
  if (!runtime) {
    check('runtime is reachable for the problems check', false);
    return;
  }

  const store = runtime.diagnostics as {
    counts(): { error: number; warning: number; total: number };
    all(): Array<{ message: string; path: string; line: number }>;
  } | null;
  check('the diagnostics store is constructed', store !== null);
  if (!store) return;

  // Monaco's worker is asynchronous, so the store fills in a moment after the
  // markers appear.
  const populated = await waitFor(
    'the diagnostics store to see the type error',
    () => store.counts().error > 0,
    30000,
  );
  check('a real type error reaches the diagnostics store', populated);
  lines.push(`INFO diagnostics: ${JSON.stringify(store.counts())}`);

  // The status bar used to be a hardcoded 0.
  const statusErrors = frameDocument.getElementById('status-errors');
  check(
    'the status bar reports the error count',
    (statusErrors?.textContent ?? '').replace(/[^0-9]/g, '') !== '0',
    `status bar read "${statusErrors?.textContent}"`,
  );

  // Open the panel the way a user does, by clicking the tab.
  const problemsTab = frameDocument.querySelector('.panel-tab[data-tab="problems"]') as HTMLElement | null;
  check('the Problems tab exists', problemsTab !== null);
  problemsTab?.click();

  const rows = frameDocument.querySelectorAll('#problems-content .problem-row');
  check('the Problems panel lists the problem', rows.length > 0, `${rows.length} rows`);

  const firstRow = rows[0] as HTMLElement | undefined;
  check(
    'a problem row is keyboard reachable',
    firstRow?.getAttribute('role') === 'button' && firstRow?.tabIndex === 0,
  );

  // A compiler message can contain a user identifier; it must render as text.
  check(
    'problem messages are rendered as text, not HTML',
    frameDocument.querySelector('#problems-content script') === null,
  );

  // ===== command palette =====

  frameDocument.dispatchEvent(
    new frameWindow.KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }),
  );

  const paletteOpen = await waitFor(
    'the command palette to open',
    () => frameDocument.getElementById('command-palette') !== null,
    5000,
  );
  check('Ctrl+Shift+P opens the command palette', paletteOpen);

  if (paletteOpen) {
    const paletteRows = frameDocument.querySelectorAll('#command-palette .palette-row');
    check('the palette lists registered commands', paletteRows.length > 0, `${paletteRows.length} rows`);

    const labels = [...paletteRows].map(row => row.textContent || '');
    check(
      'the palette includes the run command',
      labels.some(label => /run/i.test(label)),
      labels.slice(0, 6).join(' | '),
    );

    // Filtering by subsequence: "nf" should find "New file".
    const input = frameDocument.querySelector('#command-palette .palette-input') as HTMLInputElement;
    input.value = 'nf';
    input.dispatchEvent(new frameWindow.Event('input', { bubbles: true }));

    const filtered = [...frameDocument.querySelectorAll('#command-palette .palette-row')]
      .map(row => row.textContent || '');
    check(
      'subsequence filtering finds New file from "nf"',
      filtered.some(label => /new file/i.test(label)),
      filtered.join(' | '),
    );

    frameDocument.dispatchEvent(
      new frameWindow.KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }),
    );
    const closed = await waitFor(
      'the palette to close',
      () => frameDocument.getElementById('command-palette') === null,
      5000,
    );
    check('the palette toggles closed', closed);
  }
}


/**
 * Every run must stream, including one that never reads input.
 *
 * That case is the whole point: it used to take the buffered /api/run path and
 * show nothing until the program exited. If the transport regressed to buffering,
 * the first output arrives at roughly the same time as the exit - so this measures
 * the GAP between them rather than merely checking the output eventually appears.
 */
async function checkEveryRunStreams(frameWindow: Window): Promise<void> {
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!runtime) {
    check('runtime is reachable for the streaming check', false);
    return;
  }

  // Straight to the endpoint: this asserts the TRANSPORT, without depending on the
  // editor's current language or on driving the UI.
  const started = Date.now();
  const events: Array<{ type: string; at: number }> = [];

  const response = await frameWindow.fetch('/api/run/interactive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: 'javascript',
      version: 'es2022',
      // No stdin anywhere: the old regex would have sent this down the buffered
      // path. Prints, waits, prints again.
      code: 'console.log("FIRST");\nsetTimeout(() => console.log("SECOND"), 1200);',
    }),
  });

  check('a non-interactive run is accepted by the streaming route', response.ok);
  if (!response.ok || !response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstOutputAt: number | null = null;
  let exitAt: number | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let event: { type: string; data?: string };
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      events.push({ type: event.type, at: Date.now() - started });
      if (event.type === 'stdout' && /FIRST/.test(event.data || '') && firstOutputAt === null) {
        firstOutputAt = Date.now() - started;
      }
      if (event.type === 'exit') exitAt = Date.now() - started;
    }
  }

  lines.push(`INFO stream: ${events.map(e => `${e.type}@${e.at}ms`).join(' ')}`);

  check('the run produced output and exited', firstOutputAt !== null && exitAt !== null);
  if (firstOutputAt === null || exitAt === null) return;

  // The program sleeps 1.2s between the two prints, so a live stream delivers the
  // first line at least a second before the exit. Buffered, the gap collapses.
  const gap = exitAt - firstOutputAt;
  check(
    'output arrives DURING the run, not batched at the end',
    gap > 800,
    `first output at ${firstOutputAt}ms, exit at ${exitAt}ms, gap ${gap}ms`,
  );
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

  await checkCrossFileTypeScript(frameWindow);
  await checkProblemsAndPalette(frameWindow);
  await checkEveryRunStreams(frameWindow);

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
