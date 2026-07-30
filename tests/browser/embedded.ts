/**
 * The Step-Up embedding contract, exercised end to end.
 *
 * Step-Up is the only consumer of the postMessage surface, and the workspace
 * refactor changed the code behind it in two ways that only show up when a real
 * host drives a real IDE:
 *
 * - `replaceAllFiles` became atomic and **identity-preserving**, so re-sending the
 *   same project keeps each document, its Monaco model and its undo history.
 * - `stepup.ts` stopped disposing every model before each update, which was
 *   defeating that preservation and made a host autosave feel like the editor was
 *   resetting itself.
 *
 * Neither is observable from node. So this posts the messages Step-Up posts and
 * asserts on what the IDE does with them.
 */

const RECEIVER_PORT = 5200;
const TIMEOUT_MS = 45000;

const lines: string[] = [];
let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) lines.push(`PASS ${name}`);
  else {
    failures += 1;
    lines.push(`FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function equal(name: string, actual: unknown, expected: unknown): void {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const frame = document.getElementById('ide') as HTMLIFrameElement;
const errors: string[] = [];

/** Messages the IDE posted back to us, in order. */
const fromIde: Array<Record<string, unknown>> = [];
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow) return;
  if (event.data && typeof event.data === 'object') fromIde.push(event.data as Record<string, unknown>);
});

function post(message: Record<string, unknown>): void {
  frame.contentWindow!.postMessage(message, '*');
}

async function waitFor(description: string, predicate: () => boolean, timeoutMs = TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return true;
    } catch {
      /* the frame may still be initializing */
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  lines.push(`TIMEOUT waiting for ${description}`);
  return false;
}

interface RuntimeSeam {
  workspace: {
    allDocuments(): Array<{ id: string; name: string; getContent(): string }>;
    snapshotForExecution(): Array<{ path: string; content: string }>;
    findByPath(path: string): { id: string; getContent(): string } | null;
  };
  models: { peek(id: string): { isDisposed(): boolean } | null };
  tabManager: { getAllTabs(): Array<{ file: { id: string; name: string } }> };
}

function seam(): RuntimeSeam | undefined {
  return (frame.contentWindow as unknown as { __bcRuntime?: RuntimeSeam }).__bcRuntime;
}

const PROJECT = [
  { path: 'main.py', content: 'from lib.util import greet\nprint(greet("world"))\n' },
  { path: 'lib/util.py', content: 'def greet(name):\n    return f"hello {name}"\n' },
  { path: 'notes.py', content: '# scratch\n' },
];

async function run(): Promise<void> {
  await new Promise<void>(resolve => {
    if (frame.contentDocument?.readyState === 'complete') return resolve();
    frame.addEventListener('load', () => resolve(), { once: true });
  });

  // Error capture is attached FIRST, before anything is posted, so a failure during
  // the IDE's own initialization is recorded rather than missed.
  const frameWindow = frame.contentWindow!;
  frameWindow.addEventListener('error', event => errors.push(`error: ${event.message}`));
  frameWindow.addEventListener('unhandledrejection', event =>
    errors.push(`rejection: ${(event as PromiseRejectionEvent).reason?.stack || (event as PromiseRejectionEvent).reason}`),
  );
  const originalError = frameWindow.console.error;
  frameWindow.console.error = (...args: unknown[]) => {
    errors.push(`console.error: ${args.map(String).join(' ')}`);
    originalError.apply(frameWindow.console, args as never);
  };

  const statusText = (): string =>
    frame.contentDocument?.getElementById('status')?.textContent ?? '';

  // The IDE announces itself. If this never arrives the origin allowlist rejected
  // us and nothing below would mean anything.
  const ready = await waitFor(
    'the IDE to announce ide:ready',
    () => fromIde.some(message => message.type === 'ide:ready'),
  );
  check('the IDE announces ide:ready to its host', ready);

  const runtime = await waitFor('the runtime seam', () => seam() !== undefined);
  check('the embedded IDE exposes its runtime', runtime);
  if (!runtime) return;

  // `ide:ready` must mean the workspace is actually usable.
  //
  // It did not. Readiness was announced before `initializeWorkspace()` ran, and
  // embedded initialization then calls `clearAll()` to avoid restoring an unrelated
  // previous session - so a host answering promptly had its project silently
  // discarded. This suite found it by answering immediately. Checked with no wait,
  // deliberately: waiting would paper over the very race being asserted.
  check(
    'ide:ready means initialization has already finished',
    /Waiting for content|Ready/i.test(statusText()),
    `status when ide:ready arrived was "${statusText()}"`,
  );

  lines.push(
    `INFO body classes: ${frame.contentDocument?.body.className} | status: ${statusText()}`,
  );
  if (errors.length > 0) lines.push(`DIAG errors so far: ${errors.slice(0, 5).join(' | ')}`);

  // Embedded mode must start empty rather than restoring a previous session, or a
  // student sees files from an unrelated task.
  equal('an embedded IDE starts with no documents', seam()!.workspace.allDocuments().length, 0);

  // ===== stepup:init delivers a project =====

  post({ type: 'stepup:init', files: PROJECT, mode: 'full' });

  const loaded = await waitFor(
    'the project to load',
    () => seam()!.workspace.allDocuments().length === PROJECT.length,
  );
  check('stepup:init loads every file', loaded, `documents: ${seam()!.workspace.allDocuments().length}`);

  const paths = seam()!.workspace.snapshotForExecution().map(file => file.path);
  check(
    'nested paths are preserved',
    JSON.stringify(paths) === JSON.stringify(['lib/util.py', 'main.py', 'notes.py']),
    paths.join(', '),
  );
  equal(
    'file content arrives intact',
    seam()!.workspace.findByPath('lib/util.py')?.getContent(),
    PROJECT[1].content,
  );

  // Exactly one visible tab, not one per file.
  equal('exactly one tab is opened', seam()!.tabManager.getAllTabs().length, 1);

  // ===== re-sending the project preserves identity =====

  const before = seam()!.workspace.allDocuments().map(document => document.id).sort();
  const mainDocument = seam()!.workspace.findByPath('main.py')!;
  const mainModelBefore = seam()!.models.peek(mainDocument.id);
  check('the open document has a model', mainModelBefore !== null);

  const updated = PROJECT.map(file =>
    file.path === 'main.py' ? { ...file, content: `${file.content}print("updated")\n` } : file,
  );
  post({ type: 'stepup:set-files', files: updated });

  const applied = await waitFor(
    'the updated content to apply',
    () => seam()!.workspace.findByPath('main.py')?.getContent().includes('updated') === true,
  );
  check('stepup:set-files applies new content', applied);

  const after = seam()!.workspace.allDocuments().map(document => document.id).sort();
  check(
    'document identity survives a host update',
    JSON.stringify(before) === JSON.stringify(after),
    `${before.length} before, ${after.length} after`,
  );
  check(
    'the open model is NOT disposed by a host update',
    mainModelBefore ? !mainModelBefore.isDisposed() : false,
  );

  // ===== the host can read the workspace back =====

  fromIde.length = 0;
  post({ type: 'stepup:get-files' });

  const answered = await waitFor(
    'ide:files in response to stepup:get-files',
    () => fromIde.some(message => message.type === 'ide:files'),
  );
  check('stepup:get-files is answered', answered);

  const response = fromIde.find(message => message.type === 'ide:files') as
    | { files?: Array<{ path: string; content: string }> }
    | undefined;
  const returnedPaths = (response?.files ?? []).map(file => file.path).sort();
  check(
    'ide:files returns every file',
    JSON.stringify(returnedPaths) === JSON.stringify(['lib/util.py', 'main.py', 'notes.py']),
    returnedPaths.join(', '),
  );
  check(
    'ide:files returns the UPDATED content, not the persisted copy',
    (response?.files ?? []).some(file => file.path === 'main.py' && file.content.includes('updated')),
  );

  // A file the host dropped must disappear rather than linger.
  post({ type: 'stepup:set-files', files: updated.filter(file => file.path !== 'notes.py') });
  const removed = await waitFor(
    'the dropped file to be removed',
    () => seam()!.workspace.findByPath('notes.py') === null,
  );
  check('a file the host drops is removed', removed);

  check('no errors inside the embedded IDE', errors.length === 0, errors.slice(0, 5).join(' | '));
  equal('the remaining documents are correct', seam()!.workspace.allDocuments().length, 2);
}

run()
  .catch(error => {
    failures += 1;
    lines.push(`FAIL threw: ${error?.stack || error}`);
  })
  .finally(async () => {
    if (errors.length > 0) lines.push(`DIAG iframe errors: ${errors.slice(0, 8).join(' | ')}`);
    lines.push(failures === 0 ? 'EMBEDDED: ALL PASSED' : `EMBEDDED: ${failures} FAILED`);
    document.getElementById('results')!.textContent = lines.join('\n');

    try {
      await fetch(`http://127.0.0.1:${RECEIVER_PORT}/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, failures }),
      });
    } catch {
      /* opened by hand */
    }
  });
