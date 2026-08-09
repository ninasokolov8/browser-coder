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

    /*
     * Monaco's cancellation sentinel is not an error.
     *
     * Monaco rejects pending `Delayer` promises with an object whose name AND message
     * are both exactly "Canceled" when the thing that scheduled them is disposed -
     * switching a model, closing a tab. Its own global handler recognises that shape
     * and ignores it (`isCancellationError`), so treating it as an application
     * failure here reports Monaco working as designed.
     *
     * Matched on both fields exactly rather than on a substring, so a real error that
     * merely mentions cancellation is still caught.
     */
    if (reason?.name === 'Canceled' && reason?.message === 'Canceled') return;

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

/**
 * CSS, HTML and JSON must be analysed, not merely coloured.
 *
 * Monaco bundles a full language service for each, but every one runs in its own
 * web worker and asks for it by label. `getWorker` used to answer every label
 * except typescript/javascript with the generic editor worker, which implements
 * none of those protocols - so the services were registered and completely inert.
 *
 * Nothing about that state is observable from the code: the request goes to a
 * worker that never replies, and validation simply never happens. The only honest
 * check is to put a real error in each file and require a marker, which is what
 * this does.
 */
async function checkWebLanguageServices(frameWindow: Window): Promise<void> {
  const monacoApi = (frameWindow as unknown as { __bcMonaco?: typeof import('monaco-editor') })
    .__bcMonaco;
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!monacoApi || !runtime) {
    check('monaco and runtime are reachable for the language-service check', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
  };
  const models = runtime.models as {
    peek(id: string): { uri: { toString(): string } } | null;
    ensureModelsFor(languageIds: readonly string[]): void;
  };

  const cases = [
    {
      language: 'css',
      version: 'css3',
      name: 'probe.css',
      // A property that does not exist. Monaco's CSS service reports it; a
      // tokenizer cannot.
      content: 'body {\n  colour: red;\n}\n',
      expect: /colour|unknown propert/i,
    },
    {
      language: 'json',
      version: 'json',
      name: 'probe.json',
      // A trailing comma - valid JSON5, rejected by every real JSON parser.
      content: '{\n  "a": 1,\n}\n',
      expect: /trailing comma|expected/i,
    },
  ];

  const created: Array<{ id: string; name: string; expect: RegExp }> = [];
  for (const probe of cases) {
    const document = await workspace.createDocument({
      name: probe.name,
      language: probe.language,
      version: probe.version,
      content: probe.content,
    });
    created.push({ id: document.id, name: probe.name, expect: probe.expect });
  }

  // Eagerly, so this also proves the project-wide model sync covers these
  // languages - the file is never opened in a tab.
  models.ensureModelsFor(['css', 'html', 'json']);

  for (const probe of created) {
    const model = models.peek(probe.id);
    check(`${probe.name} has a model without being opened`, model !== null);
    if (!model) continue;

    const markersFor = () =>
      monacoApi.editor
        .getModelMarkers({})
        .filter(marker => marker.resource.toString() === model.uri.toString());

    const appeared = await waitFor(`${probe.name} to be validated`, () => markersFor().length > 0, 30000);
    check(`${probe.name} is validated by a language service`, appeared);

    const messages = markersFor().map(marker => marker.message);
    lines.push(`INFO ${probe.name}: ${messages.join(' | ') || '(none)'}`);
    if (messages.length > 0) {
      check(
        `${probe.name} reports the real problem`,
        messages.some(message => probe.expect.test(message)),
        messages.join(' | '),
      );
    }
  }

  // A file extension the registry knows only as an alias must still resolve. Before
  // `extensions`, `.htm` fell through to the default language and was stored and
  // coloured as JavaScript.
  const tabManager = runtime.tabManager as {
    detectLanguageByExtension(name: string): { id: string } | undefined;
  };
  for (const [fileName, expected] of [
    ['page.htm', 'html'],
    ['notes.markdown', 'markdown'],
    ['notes.md', 'markdown'],
    ['data.json', 'json'],
    ['index.html', 'html'],
  ] as const) {
    const detected = tabManager.detectLanguageByExtension(fileName);
    check(
      `${fileName} is detected as ${expected}`,
      detected?.id === expected,
      `got ${detected?.id ?? 'undefined'}`,
    );
  }
}

/**
 * Quick-open and the breadcrumb bar.
 *
 * Quick-open shares its overlay with the command palette (`picker.ts`), which was
 * extracted from the palette rather than copied. That extraction is the risk this
 * covers: the palette's own assertions above must still pass, AND the new consumer
 * must work, or the shared code has been broken for one of them.
 */
async function checkQuickOpenAndBreadcrumbs(frameWindow: Window): Promise<void> {
  const frameDocument = frame.contentDocument!;
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!runtime) {
    check('runtime is reachable for the navigation check', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
    createFolder?(request: Record<string, unknown>): Promise<{ id: string }>;
  };
  const tabManager = runtime.tabManager as {
    switchToTab(id: string): Promise<unknown>;
    getActiveTab(): { file: { id: string; name: string } } | null;
  };

  // A distinctively-named file, so the filter result is unambiguous.
  const target = await workspace.createDocument({
    name: 'zebra-quickopen.py',
    language: 'python',
    version: 'python3',
    content: 'def stripes():\n    return 3\n',
  });

  // Ctrl+P, on the document, exactly as a user presses it.
  const press = (key: string, options: Record<string, boolean> = {}): void => {
    frameDocument.dispatchEvent(
      new frameWindow.KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  };

  press('p');
  const opened = await waitFor(
    'quick-open to appear',
    () => frameDocument.getElementById('quick-open') !== null,
    5000,
  );
  check('Ctrl+P opens quick-open', opened);
  if (!opened) return;

  // It must be a DIFFERENT overlay from the command palette, or Ctrl+P is just
  // opening the palette and the two features are confused.
  check(
    'quick-open is not the command palette',
    frameDocument.getElementById('command-palette') === null,
  );

  const overlay = frameDocument.getElementById('quick-open')!;
  const input = overlay.querySelector('.palette-input') as HTMLInputElement;
  check('quick-open has an input', input !== null);
  if (!input) return;

  const rowLabels = (): string[] =>
    Array.from(overlay.querySelectorAll('.palette-row .palette-label')).map(
      node => node.textContent ?? '',
    );

  check('quick-open lists workspace files', rowLabels().length > 0, `rows: ${rowLabels().length}`);

  // Filtering, by subsequence, the way a user types.
  input.value = 'zebra';
  input.dispatchEvent(new frameWindow.Event('input', { bubbles: true }));

  const filtered = await waitFor(
    'quick-open to filter to the zebra file',
    () => rowLabels().length > 0 && rowLabels().every(label => /zebra/i.test(label)),
    5000,
  );
  check('typing filters the file list', filtered, `rows: ${rowLabels().join(', ')}`);

  // Enter must actually switch to it.
  input.dispatchEvent(
    new frameWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );

  const switched = await waitFor(
    'the editor to switch to the picked file',
    () => tabManager.getActiveTab()?.file.id === target.id,
    5000,
  );
  check('picking a file opens it', switched, `active: ${tabManager.getActiveTab()?.file.name}`);
  check('quick-open closes after picking', frameDocument.getElementById('quick-open') === null);

  // ── Breadcrumbs ──────────────────────────────────────────────────────────
  const bar = frameDocument.getElementById('breadcrumbs');
  check('the breadcrumb bar exists', bar !== null);
  if (!bar) return;

  const crumbs = (): string[] =>
    Array.from(bar.querySelectorAll('.breadcrumb-segment')).map(node => node.textContent ?? '');

  const named = await waitFor(
    'the breadcrumb to show the file',
    () => crumbs().some(text => text === 'zebra-quickopen.py'),
    8000,
  );
  check('the breadcrumb names the open file', named, `crumbs: ${crumbs().join(' > ')}`);

  // Put the cursor inside the function and require the symbol segment. This is the
  // part a path-only breadcrumb would not give.
  const editor = runtime.editor as {
    setPosition(position: { lineNumber: number; column: number }): void;
  };
  editor.setPosition({ lineNumber: 2, column: 5 });

  const symbolShown = await waitFor(
    'the breadcrumb to show the enclosing symbol',
    () => crumbs().includes('stripes'),
    8000,
  );
  check('the breadcrumb tracks the enclosing symbol', symbolShown, `crumbs: ${crumbs().join(' > ')}`);
  lines.push(`INFO breadcrumbs: ${crumbs().join(' > ')}`);
}

/**
 * Format document must actually format, in every language.
 *
 * It was bound straight to Monaco's action, which does nothing when no provider
 * is registered for the model's language - no error, no message, no edit. Five of
 * the ten languages had no provider, so for half the IDE the command was a silent
 * no-op that read as "your code is already formatted".
 *
 * Driven through the command registry, on a Java file, because Java is one of the
 * five and its indentation is unambiguous enough to assert exactly.
 */
async function checkFormattingWorks(frameWindow: Window): Promise<void> {
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!runtime) {
    check('runtime is reachable for the formatting check', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
    getDocument(id: string): { getContent(): string } | null;
  };
  const tabManager = runtime.tabManager as { switchToTab(id: string): Promise<unknown> };
  const commands = runtime.commands as {
    execute(id: string, context: { source: string }): Promise<{ status: string }>;
  };

  const document = await workspace.createDocument({
    name: 'Ragged.java',
    language: 'java',
    version: 'java17',
    content:
      'public class Ragged {\n' +
      'public static void main(String[] a) {\n' +
      'if (a.length > 0) {\n' +
      'System.out.println("x");   \n' +
      '}\n' +
      '}\n' +
      '}\n',
  });

  await tabManager.switchToTab(document.id);
  const outcome = await commands.execute('editor.formatDocument', { source: 'api' });
  check('the format command is enabled for Java', outcome.status === 'ran', `status ${outcome.status}`);

  // The edit is applied to the model, which flows back into the document.
  const formatted = await waitFor(
    'the Java file to be re-indented',
    () => /\n[ \t]+public static/.test(workspace.getDocument(document.id)?.getContent() ?? ''),
    10000,
  );
  check('formatting a Java file actually indents it', formatted);

  const content = workspace.getDocument(document.id)?.getContent() ?? '';
  lines.push(`INFO formatted Java:\n${content.replace(/\n/g, '\\n')}`);

  // Asserted as DEPTH, not as a number of spaces: the width comes from the
  // editor's own tabSize, so hardcoding it would make this test fail the day
  // someone changes an unrelated editor preference - which is exactly what it did
  // when first written against 4 spaces while the editor uses 2.
  const indentOf = (needle: string): number => {
    const line = content.split('\n').find(candidate => candidate.trim().startsWith(needle));
    return line === undefined ? -1 : /^[ \t]*/.exec(line)![0].length;
  };

  const classDepth = indentOf('public class');
  const methodDepth = indentOf('public static');
  const ifDepth = indentOf('if (');
  const bodyDepth = indentOf('System.out');

  check(
    'each nesting level is indented one step further than the last',
    classDepth === 0 &&
      methodDepth > classDepth &&
      ifDepth > methodDepth &&
      bodyDepth > ifDepth &&
      methodDepth - classDepth === ifDepth - methodDepth &&
      ifDepth - methodDepth === bodyDepth - ifDepth,
    `depths: class ${classDepth}, method ${methodDepth}, if ${ifDepth}, body ${bodyDepth}`,
  );
  check('trailing whitespace is removed', !/[ \t]+\n/.test(content));

  // And a language Monaco owns must still be handled by Monaco, not by us.
  const jsonDocument = await workspace.createDocument({
    name: 'ragged.json',
    language: 'json',
    version: 'json',
    content: '{"a":1,"b":[2,3]}',
  });
  await tabManager.switchToTab(jsonDocument.id);
  const jsonOutcome = await commands.execute('editor.formatDocument', { source: 'api' });
  check('the format command is enabled for JSON', jsonOutcome.status === 'ran');

  const jsonFormatted = await waitFor(
    'the JSON file to be reformatted by Monaco',
    () => (workspace.getDocument(jsonDocument.id)?.getContent() ?? '').includes('\n'),
    10000,
  );
  check("Monaco's own JSON formatter still runs", jsonFormatted);
}

/**
 * The debugger, driven the way a student drives it.
 *
 * Everything below this point in the stack is already covered: the adapter has its own
 * contract tests, the channel and the command boundary have unit tests, and the HTTP
 * surface has contract tests against the production image. What none of them can show
 * is that a student can actually debug something - that the glyph margin is on, the
 * breakpoint reaches the adapter, the toolbar enables, and the variables appear.
 *
 * Requires the API, so it runs in the app-boot suite where one is already started.
 */
async function checkDebuggerWorks(frameWindow: Window): Promise<void> {
  const frameDocument = frame.contentDocument!;
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!runtime) {
    check('runtime is reachable for the debugger check', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
  };
  const tabManager = runtime.tabManager as { switchToTab(id: string): Promise<unknown> };
  const commands = runtime.commands as {
    execute(id: string, context: { source: string }): Promise<{ status: string }>;
    isEnabled(id: string): boolean;
  };

  const document = await workspace.createDocument({
    name: 'debug-probe.py',
    language: 'python',
    version: 'python3',
    content: [
      'total = 0',              // 1
      'for index in range(3):', // 2
      '    total += index',     // 3
      'print("total", total)',  // 4
      'print("done")',          // 5
    ].join('\n'),
  });

  await tabManager.switchToTab(document.id);

  // The glyph margin must be ON, or breakpoints are invisible AND the click that
  // toggles one is never delivered. Monaco defaults it off, so this is the assertion
  // that the whole feature is reachable at all.
  const editor = runtime.editor as { getOption(id: number): unknown; getModel(): unknown };
  const monacoApi = (frameWindow as unknown as { __bcMonaco?: typeof import('monaco-editor') }).__bcMonaco!;
  check(
    'the glyph margin is enabled, so breakpoints can be drawn and clicked',
    editor.getOption(monacoApi.editor.EditorOption.glyphMargin) === true,
  );

  check('the debug command is enabled for Python', commands.isEnabled('workspace.debug'));

  // Set a breakpoint through the state, as the margin click does.
  const debugModule = (runtime as { debug?: { toggleBreakpoint(line: number): boolean } }).debug;
  check('the debug state is reachable from the runtime seam', Boolean(debugModule));
  if (!debugModule) return;

  debugModule.toggleBreakpoint(4);

  const stateBefore = (runtime as { debug?: { snapshot(): { breakpoints: number[]; documentId: string | null } } }).debug!.snapshot();
  lines.push(`INFO before run: breakpoints=${JSON.stringify(stateBefore.breakpoints)} documentId=${stateBefore.documentId} target=${document.id}`);

  /*
   * Deliberately NOT awaited.
   *
   * `runCode` resolves when the program EXITS, and a debugged program paused at a
   * breakpoint has not exited - so awaiting the command here waits for a run that is
   * waiting for this test. The first version of this assertion did exactly that and
   * hung the whole suite until the harness timed out.
   *
   * The real UI has the same shape and is fine: a click handler does not block on it.
   */
  const runPromise = commands.execute('workspace.debug', { source: 'api' });
  runPromise.catch(() => { /* reported through the state below */ });

  // The toolbar appears as soon as the session starts.
  const toolbarShown = await waitFor(
    'the debug toolbar to appear',
    () => frameDocument.getElementById('debug-toolbar')?.hidden === false,
    15000,
  );
  check('the debug toolbar appears for a debug run', toolbarShown);

  const state = () => (runtime as { debug?: { snapshot(): { status: string; stop: unknown } } }).debug!.snapshot();

  const paused = await waitFor(
    'the program to stop at the breakpoint',
    () => state().status === 'paused',
    30000,
  );
  check('the program stops at the breakpoint', paused, `status ${state().status}`);
  if (!paused) return;

  const stop = state().stop as { line: number; locals: Array<{ name: string; value: { text: string } }> };
  check('it stopped on the right line', stop.line === 4, `line ${stop.line}`);

  const total = stop.locals.find(entry => entry.name === 'total');
  // 0 + 1 + 2 by the time line 4 runs.
  check('the loop variable is reported with its value', total?.value.text === '3', JSON.stringify(total));

  /*
   * The line the debugger is paused on must be MARKED in the editor.
   *
   * This was the gap. Stopping worked, the call stack named the right line, and the
   * editor showed nothing - because the check for "is the stop in the file on screen"
   * compared strings, and a snippet is written into the job as `main.py` whatever the
   * tab is called. A debugger that will not say where it is reads as a broken one.
   *
   * Asserted through Monaco's decoration list rather than by looking for a CSS class in
   * the DOM: the decoration is the thing the feature creates, and a rendered line is
   * only ever a consequence of it.
   */
  const model = (runtime.models as { peek(id: string): { getAllDecorations(): Array<{ options: { className?: string | null } }> } | null })
    .peek(document.id);
  check('the paused document still has a model', model !== null);

  if (model) {
    const highlighted = await waitFor(
      'the paused line to be highlighted',
      () => model.getAllDecorations().some(entry => entry.options.className === 'debug-current-line'),
      8000,
    );
    check('the line the debugger stopped on is highlighted', highlighted);

    const all = model.getAllDecorations() as Array<{
      range: { startLineNumber: number };
      options: { className?: string | null; glyphMarginClassName?: string | null };
    }>;
    lines.push(
      'INFO decorations: ' +
      all
        .filter(entry => entry.options.className || entry.options.glyphMarginClassName)
        .map(entry => `${entry.range.startLineNumber}:${entry.options.className || entry.options.glyphMarginClassName}`)
        .join(', '),
    );
    lines.push(`INFO stop.file=${JSON.stringify((state().stop as { file?: string }).file)}`);

    const current = all.filter(entry => entry.options.className === 'debug-current-line');
    check(
      'and it is the line it actually stopped on',
      current.length === 1 && current[0].range.startLineNumber === 4,
      `marked lines: ${current.map(entry => entry.range.startLineNumber).join(', ') || 'none'}`,
    );

    /*
     * The highlight must be VISIBLE, not merely present.
     *
     * The decoration was applied correctly and still could not be seen: the fill was
     * 14% amber over a near-black editor, a four-percent luminance shift. "A class is
     * attached" was true and useless, so this measures the paint instead - an alpha
     * floor and the left bar - which is the thing a student either sees or does not.
     */
    const probe = frameDocument.createElement('div');
    probe.className = 'debug-current-line';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    frameDocument.body.appendChild(probe);

    const painted = frameWindow.getComputedStyle(probe);
    const alpha = Number(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(painted.backgroundColor)?.[1] ?? '1');

    check(
      'the paused line is filled strongly enough to see',
      alpha >= 0.18,
      `background ${painted.backgroundColor} (alpha ${alpha})`,
    );
    check(
      'and carries a bar down its left edge',
      painted.boxShadow !== 'none' && painted.boxShadow.includes('inset'),
      `box-shadow ${painted.boxShadow}`,
    );

    probe.remove();
  }

  // The variables panel shows it.
  const variablesShown = await waitFor(
    'the variables panel to render',
    () => (frameDocument.getElementById('debug-variables')?.textContent || '').includes('total'),
    8000,
  );
  check('the variables panel shows the variable', variablesShown);

  const debugPanels = frameDocument.getElementById('debug-panels');
  const minimizeDetails = frameDocument.getElementById('debug-panel-minimize') as HTMLButtonElement | null;
  minimizeDetails?.click();
  check('debugger details can be minimized to a small header', debugPanels?.classList.contains('collapsed') === true);
  minimizeDetails?.click();
  check('minimized debugger details can be expanded again', debugPanels?.classList.contains('collapsed') === false);

  (frameDocument.getElementById('debug-panel-close') as HTMLButtonElement | null)?.click();
  check('debugger details can be closed for the current run', debugPanels?.hidden === true);
  (frameDocument.getElementById('debug-show-details') as HTMLButtonElement | null)?.click();
  check('Show values reopens closed debugger details', debugPanels?.hidden === false);

  /*
   * A watch expression, end to end.
   *
   * The `evaluate` command has been in both adapters since the debugger was written and
   * nothing in the UI ever sent one - so this drives the real input, against a real
   * paused Python program, and requires a real answer back from the adapter.
   */
  const watchHost = frameDocument.getElementById('debug-watch');
  check('the watch panel exists', watchHost !== null);

  const watchInput = watchHost?.querySelector('.debug-watch-input') as HTMLInputElement | null;
  check('it has an input to type an expression into', watchInput !== null);

  if (watchInput) {
    // An expression that is NOT one of the reported locals, so a pass cannot come from
    // the variables panel having happened to contain the text.
    watchInput.value = 'total * 10';
    watchInput.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const watchAnswered = await waitFor(
      'the watch to be evaluated by the adapter',
      () => /30/.test(watchHost?.textContent ?? ''),
      15000,
    );
    check('a watch expression is evaluated in the paused frame', watchAnswered, watchHost?.textContent ?? '');
    check(
      'and it is shown against the expression the student typed',
      (watchHost?.textContent ?? '').includes('total * 10'),
      watchHost?.textContent ?? '',
    );
  }

  const stepOver = frameDocument.getElementById('debug-step-over') as HTMLButtonElement | null;
  check('step-over is enabled while paused', stepOver !== null && !stepOver.disabled);

  const continueButton = frameDocument.getElementById('debug-continue') as HTMLButtonElement | null;
  check('continue is enabled while paused', continueButton !== null && !continueButton.disabled);

  // Step, and require the line to advance.
  stepOver?.click();
  const stepped = await waitFor(
    'the program to advance a line',
    () => state().status === 'paused' && (state().stop as { line: number }).line !== 4,
    15000,
  );
  check('step-over advances the program', stepped);

  // Finish, and require the session to end cleanly.
  (frameDocument.getElementById('debug-continue') as HTMLButtonElement | null)?.click();
  const ended = await waitFor('the debug session to end', () => state().status === 'ended', 20000);
  check('the session ends when the program finishes', ended, `status ${state().status}`);
  check('debugger details close automatically when the run finishes', debugPanels?.hidden === true);

  // Finished no longer means forgotten. Both pauses are recorded, so the student
  // can inspect how `total` changed even after Continue reached the end.
  const historyShown = await waitFor(
    'the recorded pause history to remain after the session ends',
    () => frameDocument.querySelectorAll('.debug-history-cell').length >= 2,
    8000,
  );
  check('recorded pauses remain available after the run', historyShown);

  const stepBack = frameDocument.getElementById('debug-step-back') as HTMLButtonElement | null;
  check('Step back is enabled when an earlier pause exists', stepBack !== null && !stepBack.disabled);
  stepBack?.click();
  check('asking to review history reopens the debugger details', debugPanels?.hidden === false);
  check(
    'Step back reviews the earlier recorded line without rerunning',
    /Reviewing line 4/.test(frameDocument.getElementById('debug-status')?.textContent ?? ''),
    frameDocument.getElementById('debug-status')?.textContent ?? '',
  );
  check(
    'future variable values fade while reviewing the past',
    frameDocument.querySelector('.debug-history-cell.future') !== null,
  );

  const historyForward = frameDocument.getElementById('debug-history-forward') as HTMLButtonElement | null;
  check('history Forward is enabled while reviewing the past', historyForward !== null && !historyForward.disabled);
  historyForward?.click();

  // Let the run settle so it cannot leak into a later assertion.
  await Promise.race([runPromise, new Promise(resolve => setTimeout(resolve, 5000))]);
}

/** The new beginner tools, through the composed app and real execution route. */
async function checkRecordedLearningTools(frameWindow: Window): Promise<void> {
  const frameDocument = frame.contentDocument!;
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!runtime) {
    check('runtime is reachable for the recorded learning tools', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
  };
  const tabManager = runtime.tabManager as { switchToTab(id: string): Promise<unknown> };
  const commands = runtime.commands as {
    execute(id: string, context: { source: string }): Promise<{ status: string }>;
  };
  const models = runtime.models as {
    peek(id: string): { getAllDecorations(): Array<{ range: { startLineNumber: number }; options: { className?: string; glyphMarginClassName?: string } }> } | null;
  };

  // Output -> code: repeated output from one print in a loop keeps the same owner.
  const outputDocument = await workspace.createDocument({
    name: 'output-trace-probe.js', language: 'javascript', version: 'es2022',
    content: [
      'console.log("Start");',
      'for (const n of [1, 2]) console.log(n * 10);',
      'console.log("Done");',
    ].join('\n'),
  });
  await tabManager.switchToTab(outputDocument.id);
  await commands.execute('workspace.run', { source: 'api' });

  const traced = [...frameDocument.querySelectorAll<HTMLElement>('.output-trace-line')];
  check('each stdout line is clickable', traced.length === 4, `found ${traced.length}`);
  check(
    'loop output maps twice to its one print statement',
    traced.map(node => node.dataset.outputLine).join(',') === '1,2,2,3',
    traced.map(node => node.dataset.outputLine).join(','),
  );
  traced[1]?.click();
  const outputHighlighted = await waitFor(
    'the clicked output line to highlight its source',
    () => models.peek(outputDocument.id)?.getAllDecorations().some(entry =>
      entry.range.startLineNumber === 2 && entry.options.className === 'output-trace-code-line') === true,
    5000,
  );
  check(
    'clicking output highlights its source line',
    outputHighlighted,
  );

  // Log point: evaluate three times, report three values, never require Continue.
  const logDocument = await workspace.createDocument({
    name: 'logpoint-probe.py', language: 'python', version: 'python3',
    content: [
      'for i in range(3):',
      '    value = i',
      '    print(value)',
      'print("done")',
    ].join('\n'),
  });
  await tabManager.switchToTab(logDocument.id);
  const editor = runtime.editor as {
    setPosition(position: { lineNumber: number; column: number }): void;
    getAction(id: string): { label: string; run(): Promise<void> } | null;
  };
  editor.setPosition({ lineNumber: 2, column: 5 });
  const logpointAction = editor.getAction('logpointAtLine');
  check(
    'the code-line context menu explains what a log point does',
    /Print a value when this line runs/.test(logpointAction?.label ?? ''),
    logpointAction?.label ?? 'action missing',
  );
  const originalPrompt = frameWindow.prompt;
  frameWindow.prompt = () => 'i';
  await logpointAction?.run();
  frameWindow.prompt = originalPrompt;
  const debug = runtime.debug as {
    logpointExpression(line: number): string | null;
    toggleBreakpoint(line: number): boolean;
    snapshot(): { status: string; stop: { line: number } | null };
  };
  check(
    'the context-menu action places a log point without a breakpoint',
    debug.logpointExpression(2) === 'i',
  );
  check(
    'a log point has a diamond gutter mark',
    models.peek(logDocument.id)?.getAllDecorations().some(entry =>
      entry.range.startLineNumber === 2 && entry.options.glyphMarginClassName === 'debug-logpoint-glyph') === true,
  );
  await commands.execute('workspace.debug', { source: 'api' });
  const logLines = [...frameDocument.querySelectorAll<HTMLElement>('.output-trace-line')]
    .filter(node => /i = [012]/.test(node.textContent ?? ''));
  check('the log point prints once per loop pass and continues', logLines.length === 3, logLines.map(node => node.textContent).join(' | '));
  const orderedLoopLines = [...frameDocument.querySelectorAll<HTMLElement>('.output-trace-line')]
    .filter(node => node.dataset.outputLine === '2' || node.dataset.outputLine === '3');
  check(
    'log points and ordinary prints stay in source execution order',
    orderedLoopLines.map(node => node.dataset.outputLine).join(',') === '2,3,2,3,2,3',
    orderedLoopLines.map(node => `${node.dataset.outputLine}:${node.textContent}`).join(' | '),
  );

  // Turtle replay: the finished canvas is scrub-able and a scrub highlights Python.
  const turtleDocument = await workspace.createDocument({
    name: 'turtle-replay-probe.py', language: 'python', version: 'python3',
    content: [
      'import turtle',
      'pen = turtle.Turtle()',
      'for _ in range(2):',
      '    pen.forward(20)',
      '    pen.left(90)',
    ].join('\n'),
  });
  await tabManager.switchToTab(turtleDocument.id);
  await commands.execute('workspace.run', { source: 'api' });
  const replayReady = await waitFor(
    'the turtle replay controls to appear',
    () => frameDocument.getElementById('turtle-replay-controls') !== null,
    15000,
  );
  check('a finished turtle drawing has replay controls', replayReady);
  const slider = frameDocument.querySelector<HTMLInputElement>('#turtle-replay-controls input[type="range"]');
  check('the turtle replay has recorded drawing steps', Number(slider?.max ?? 0) > 0);
  if (slider) {
    slider.value = '1';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    check(
      'scrubbing turtle replay highlights the Python line that drew that step',
      models.peek(turtleDocument.id)?.getAllDecorations().some(entry =>
        entry.range.startLineNumber === 4 && entry.options.className === 'turtle-replay-code-line') === true,
    );
    slider.value = '2';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    check(
      'the replay also records non-drawing turns in sequence',
      models.peek(turtleDocument.id)?.getAllDecorations().some(entry =>
        entry.range.startLineNumber === 5 && entry.options.className === 'turtle-replay-code-line') === true,
    );
  }

  // Live turtle debugging: one Step Over must visibly apply exactly the turtle
  // command on the paused line, without waiting for the program to finish.
  const liveTurtleDocument = await workspace.createDocument({
    name: 'turtle-live-debug-probe.py', language: 'python', version: 'python3',
    content: [
      'import turtle',
      'pen = turtle.Turtle()',
      'pen.forward(40)',
      'pen.left(90)',
      'pen.forward(20)',
    ].join('\n'),
  });
  await tabManager.switchToTab(liveTurtleDocument.id);
  debug.toggleBreakpoint(3);
  const liveRun = commands.execute('workspace.debug', { source: 'api' });
  liveRun.catch(() => { /* surfaced through debug state below */ });
  const pausedBeforeForward = await waitFor(
    'the turtle debugger to pause before forward',
    () => debug.snapshot().status === 'paused' && debug.snapshot().stop?.line === 3,
    30000,
  );
  check('turtle debug pauses on the drawing command', pausedBeforeForward);
  const turtleWindow = frameDocument.getElementById('turtle-window');
  const liveCanvas = frameDocument.getElementById('turtle-canvas') as HTMLCanvasElement | null;
  check(
    'the turtle window opens while the debug run is still paused',
    Boolean(turtleWindow && !turtleWindow.classList.contains('hidden') && liveCanvas),
  );
  const beforeForward = liveCanvas?.toDataURL() ?? '';
  (frameDocument.getElementById('debug-step-over') as HTMLButtonElement | null)?.click();
  const pausedAfterForward = await waitFor(
    'the turtle debugger to advance past forward',
    () => debug.snapshot().status === 'paused' && debug.snapshot().stop?.line === 4,
    15000,
  );
  check('Step Over advances to the next turtle line', pausedAfterForward);
  const drawingChanged = await waitFor(
    'the turtle canvas to reflect the stepped command',
    () => Boolean(liveCanvas && liveCanvas.toDataURL() !== beforeForward),
    5000,
  );
  check('the turtle draws before the debug session finishes', drawingChanged);
  (frameDocument.getElementById('debug-continue') as HTMLButtonElement | null)?.click();
  await Promise.race([liveRun, new Promise(resolve => setTimeout(resolve, 20000))]);
}

/**
 * Hovering a keyword must teach something.
 *
 * The curated explanations existed all along and were reachable only by knowing to
 * right-click. This asserts the hover provider is actually registered and returns the
 * teaching note - a provider that is registered but never consulted looks exactly like
 * a missing feature, which is the failure mode this codebase keeps producing.
 */
async function checkHoverTeaches(frameWindow: Window): Promise<void> {
  const monacoApi = (frameWindow as unknown as { __bcMonaco?: typeof import('monaco-editor') }).__bcMonaco;
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!monacoApi || !runtime) {
    check('monaco and runtime are reachable for the hover check', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
  };
  const models = runtime.models as { peek(id: string): unknown };
  const tabManager = runtime.tabManager as { switchToTab(id: string): Promise<unknown> };

  const doc = await workspace.createDocument({
    name: 'hover-probe.py',
    language: 'python',
    version: 'python3',
    // `range` on line 1, and the same word inside a comment on line 2.
    content: 'for i in range(3):\n    pass  # loop over a range\n',
  });
  await tabManager.switchToTab(doc.id);

  const model = models.peek(doc.id) as import('monaco-editor').editor.ITextModel | null;
  check('the hover probe has a model', model !== null);
  if (!model) return;

  // Monaco's standalone build gives no supported way to EXECUTE a hover provider - the
  // hover widget is driven internally - so the assertion is that our lookup is
  // reachable from the running app and produces the right text for a real document's
  // language. The rendering itself has 22 unit tests against the curated data.
  const help = (runtime as { hoverHelp?: (language: string, word: string) => string | null }).hoverHelp;
  check('the hover help seam is exposed', typeof help === 'function');
  if (typeof help !== 'function') return;

  const rangeHover = help('python', 'range');
  check('hovering a Python built-in returns a teaching note', Boolean(rangeHover), String(rangeHover));
  check(
    'the note carries an example',
    Boolean(rangeHover && rangeHover.includes('```python')),
    String(rangeHover).slice(0, 120),
  );

  const unknown = help('python', 'my_own_variable');
  check('a word with no entry produces no hover', unknown === null);

  /*
   * The library, not just the language.
   *
   * Hover covered keywords and built-ins and nothing else, so the functions a beginner
   * actually types - every turtle call in the drawing exercises this course is built
   * on - produced no hover at all. `forward` is the exact word that was reported as
   * silent.
   */
  for (const word of ['forward', 'left', 'penup', 'begin_fill', 'Turtle']) {
    const note = help('python', word);
    check(`hovering turtle's ${word} teaches something`, Boolean(note), String(note));
  }

  const forwardHover = help('python', 'forward');
  check(
    'and it carries a worked example',
    Boolean(forwardHover && forwardHover.includes('```python')),
    String(forwardHover).slice(0, 140),
  );

  lines.push(`INFO hover for range: ${String(rangeHover).split('\n')[0]}`);
  lines.push(`INFO hover for forward: ${String(forwardHover).split('\n')[0]}`);

}

/**
 * Wait until the diagnostics for one document stop changing.
 *
 * Needed because the producers answer on different schedules: the run publishes
 * synchronously when the stream closes, while Monaco's marker events are debounced.
 * Reading the store at the first sign of either one measures a half-finished state.
 */
async function settleDiagnostics(
  store: { all(): Array<{ documentId: string; source: string; line: number; message: string }> },
  documentId: string,
  quietPolls = 5,
  intervalMs = 200,
  maxMs = 10000,
): Promise<void> {
  const snapshot = () =>
    JSON.stringify(
      store
        .all()
        .filter(diagnostic => diagnostic.documentId === documentId)
        .map(diagnostic => `${diagnostic.source}:${diagnostic.line}:${diagnostic.message}`)
        .sort(),
    );

  const deadline = Date.now() + maxMs;
  let previous = snapshot();
  let stable = 0;

  while (Date.now() < deadline && stable < quietPolls) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    const current = snapshot();
    stable = current === previous ? stable + 1 : 0;
    previous = current;
  }
}

/**
 * A failed run must put a squiggle on the line, not just text in a panel.
 *
 * This is the capability the IDE did not have: `setModelMarkers` was called
 * nowhere, so for Python, Java, PHP and C# - which have no Monaco language service
 * - a compiler error produced no marker, no Problems entry and nothing to click.
 *
 * Driven through the real command, so it exercises parsing, document resolution and
 * marker writing together rather than calling the parser directly. JavaScript is
 * used because its failure is reproducible on any host; the parsers for the other
 * five are unit-tested against output captured from the production image.
 */
async function checkRunErrorsBecomeMarkers(frameWindow: Window): Promise<void> {
  const monacoApi = (frameWindow as unknown as { __bcMonaco?: typeof import('monaco-editor') })
    .__bcMonaco;
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!monacoApi || !runtime) {
    check('monaco and runtime are reachable for the marker check', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
  };
  const models = runtime.models as {
    peek(id: string): { uri: { toString(): string } } | null;
    ensureModelsFor(languageIds: readonly string[]): void;
  };
  const tabManager = runtime.tabManager as { switchToTab(id: string): Promise<unknown> };
  const commands = runtime.commands as {
    execute(id: string, context: { source: string }): Promise<{ status: string }>;
  };

  // A program that throws at a line we choose, so the reported line can be asserted
  // rather than merely being present.
  const broken = await workspace.createDocument({
    name: 'marker-probe.js',
    language: 'javascript',
    version: 'es2022',
    content: 'console.log("before");\nnotDefinedAnywhere();\n',
  });

  models.ensureModelsFor(['javascript']);
  await tabManager.switchToTab(broken.id);

  const outcome = await commands.execute('workspace.run', { source: 'api' });
  check('the failing run executed', outcome.status === 'ran', `status ${outcome.status}`);

  const model = models.peek(broken.id);
  check('the failing document has a model', model !== null);
  if (!model) return;

  const runMarkersNow = () =>
    monacoApi.editor
      .getModelMarkers({})
      .filter(
        marker =>
          marker.resource.toString() === model.uri.toString() &&
          marker.owner === 'browser-coder-run',
      );

  // runCode publishes after the stream closes, but the store notifies listeners
  // asynchronously, so the marker lands a tick or two later.
  const appeared = await waitFor('a marker from the failed run', () => runMarkersNow().length > 0, 30000);
  check('a runtime error becomes an editor marker', appeared);

  const runMarkers = runMarkersNow();
  lines.push(
    `INFO run markers: ${runMarkers.map(m => `L${m.startLineNumber}:${m.message}`).join(' | ') || '(none)'}`,
  );
  if (runMarkers.length === 0) return;

  const marker = runMarkers[0];
  // Line 2 is `notDefinedAnywhere()`. A marker on the wrong line sends the student
  // to correct code, so the number is asserted, not just the presence.
  check(
    'the marker is on the line that actually failed',
    marker.startLineNumber === 2,
    `marker was on line ${marker.startLineNumber}`,
  );
  check(
    'the marker carries the real error message',
    /ReferenceError|notDefinedAnywhere/.test(marker.message),
    marker.message,
  );
  check(
    'it is reported as an error, not a warning',
    marker.severity === monacoApi.MarkerSeverity.Error,
    `severity ${marker.severity}`,
  );

  // And the Problems panel reads the same store, so it must be listed there too.
  const store = runtime.diagnostics as {
    all(): Array<{ documentId: string; source: string; line: number; message: string }>;
  };

  // Settle before reading the store.
  //
  // Monaco fires onDidChangeMarkers on a debounce, so a mirror of the run markers
  // would arrive a few hundred milliseconds AFTER the run marker itself. Asserting
  // immediately passes whether or not the loop exists - which is exactly what this
  // check did until removing the guard failed to break it.
  await settleDiagnostics(store, broken.id);

  const sources = [...new Set(store.all().map(diagnostic => diagnostic.source))];
  check(
    'the failure reaches the Problems store as well',
    sources.includes('javascript'),
    `sources: ${sources.join(', ') || '(none)'}`,
  );

  // The run producer must not be mirrored back under the `ts` producer: writing a
  // marker fires onDidChangeMarkers, so without the exclusion in monaco-source.ts
  // every run diagnostic is republished as a `ts` one and listed twice.
  //
  // The discriminator is the MESSAGE, not the line or the count. Monaco's own JS
  // worker legitimately flags this same line ("Cannot find name ..."), so counting
  // `ts` diagnostics on this document would fail against correct code. A mirror is
  // identifiable by carrying the run's wording verbatim.
  const mirrored = store
    .all()
    .filter(
      diagnostic =>
        diagnostic.documentId === broken.id &&
        diagnostic.source === 'ts' &&
        diagnostic.message === marker.message,
    );
  check(
    'run markers are not mirrored back as a second diagnostic',
    mirrored.length === 0,
    mirrored.map(diagnostic => `L${diagnostic.line}:${diagnostic.message}`).join(' | '),
  );

  // Monaco checks JavaScript semantically, so this error is ALSO caught before the
  // run. Asserting it here keeps that from being switched off unnoticed - it is the
  // difference between a JS typo showing instantly and only after a round trip.
  const staticallyCaught = store
    .all()
    .some(
      diagnostic =>
        diagnostic.documentId === broken.id &&
        diagnostic.source === 'ts' &&
        /notDefinedAnywhere/.test(diagnostic.message),
    );
  check('JavaScript is also checked statically, before any run', staticallyCaught);
}

/**
 * Closing a tab must not break the file it closed.
 *
 * `onTabClose` disposes the Monaco model, but closing a tab does not delete the file -
 * it is still in the workspace and still in the explorer. Acquiring a model makes it the
 * document's authoritative buffer, and `release()` disposes it without detaching, so the
 * document is left reading through a `MonacoBuffer` wrapping a disposed model.
 * `getValue()` and `getRevision()` have no disposal guard, and Monaco throws.
 *
 * Everything that reads a document goes through there: collecting the workspace to Run,
 * search, the snapshot Step-Up asks for. No node test can see it - `MemoryBuffer` has no
 * disposed state, which is the same blind spot the registry's note on `#reconcile`
 * already records.
 */
async function checkClosingATabKeepsTheFileUsable(frameWindow: Window): Promise<void> {
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!runtime) {
    check('runtime is reachable for the tab-close check', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
    getDocument(id: string): { getContent(): string } | null;
    allDocuments(): Array<{ id: string }>;
  };
  const tabManager = runtime.tabManager as {
    switchToTab(id: string): Promise<unknown>;
    closeTab(id: string): Promise<unknown>;
  };

  const doc = await workspace.createDocument({
    name: 'closed-but-kept.py',
    content: 'value = 41\nprint(value + 1)\n',
    language: 'python',
    version: 'python3',
  });

  // Open it, so it gets a model and that model becomes the document's buffer.
  await tabManager.switchToTab(doc.id);
  await tabManager.closeTab(doc.id);

  check(
    'closing a tab does not delete the file',
    workspace.allDocuments().some(entry => entry.id === doc.id),
  );

  let content: string | null = null;
  let threw = '';
  try {
    content = workspace.getDocument(doc.id)?.getContent() ?? null;
  } catch (error) {
    threw = String((error as Error)?.message || error);
  }

  check('the closed file can still be read', threw === '', threw);
  check(
    'and its content is intact',
    content?.includes('value = 41') === true,
    `read ${JSON.stringify(content)}`,
  );
}

/**
 * An open image must not collect the source file's text.
 *
 * With an asset tab active, `onTabSwitch` shows the viewer and returns BEFORE
 * `editor.setModel(...)`, so the editor keeps the previously-opened source file's model
 * attached and merely hidden. The content listener used to attribute any change to the
 * ACTIVE TAB, so a change to that hidden model wrote Python into the image's document -
 * and autosave persisted it over the student's file.
 *
 * Reachable without anything exotic: Replace All across files edits documents through
 * their buffers, and for an open file that buffer IS the Monaco model.
 */
async function checkAnOpenImageIsNotOverwritten(frameWindow: Window): Promise<void> {
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!runtime) {
    check('runtime is reachable for the asset-overwrite check', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
    getDocument(id: string): { getContent(): string } | null;
  };
  const tabManager = runtime.tabManager as { switchToTab(id: string): Promise<unknown> };
  const models = runtime.models as {
    peek(id: string): { setValue(value: string): void } | null;
  };

  const source = await workspace.createDocument({
    name: 'beside-the-image.py',
    content: 'first = 1\n',
    language: 'python',
    version: 'python3',
  });

  // A 1x1 PNG, stored the way an imported asset is.
  const PIXEL =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const image = await workspace.createDocument({
    name: 'picture.png',
    content: PIXEL,
    language: 'asset',
    version: 'asset',
  });

  // Open the source file so its model is the one the editor holds, then switch to the
  // image - which shows the viewer and leaves that model attached behind it.
  await tabManager.switchToTab(source.id);
  await tabManager.switchToTab(image.id);

  // Something edits the still-attached model. Replace All is the realistic route.
  const hidden = models.peek(source.id);
  if (!hidden) {
    check('the source model is still attached behind the viewer', false);
    return;
  }
  hidden.setValue('first = 2\n');

  const imageContent = workspace.getDocument(image.id)?.getContent() ?? null;
  check(
    'the image still holds its own bytes',
    imageContent === PIXEL,
    `image now: ${JSON.stringify(imageContent)?.slice(0, 60)}`,
  );

  const sourceContent = workspace.getDocument(source.id)?.getContent() ?? null;
  check(
    'and the edit landed on the file it belongs to',
    sourceContent?.includes('first = 2') === true,
    `source now: ${JSON.stringify(sourceContent)}`,
  );
}

/**
 * The titlebar a student sees first.
 *
 * It held eleven controls in one flat row. The most prominent - bright green, leftmost
 * - was Hack Lab, a read-only security report with nothing to do with writing a
 * program; "Clear", which ERASES the workspace, sat one button from "Download"; and Run
 * and Debug were in the middle with the same weight as a theme picker. Meanwhile "Check
 * my work" had no control at all and was reachable only from the command palette.
 *
 * These assertions are about priority rather than pixels: what is top-level, what is
 * behind the menu, and that nothing became unreachable in the move.
 */
async function checkTheTitlebarIsSimple(frameWindow: Window): Promise<void> {
  const frameDocument = frameWindow.document;

  const menu = frameDocument.getElementById('more-menu');
  const toggle = frameDocument.getElementById('more-toggle');
  check('there is a single overflow menu', !!menu && !!toggle);
  if (!menu || !toggle) return;

  check('it starts closed', menu.hidden);
  check('and says so for a screen reader', toggle.getAttribute('aria-expanded') === 'false');

  // The things a lesson uses, together and top-level.
  for (const id of ['run', 'stop', 'debug']) {
    const button = frameDocument.getElementById(id);
    check(`${id} is a top-level action`, !!button && !menu.contains(button));
  }

  // The occasional and the dangerous are behind the menu.
  for (const id of ['btn-hack-lab', 'btn-clear-cache', 'btn-download-project', 'theme', 'ui-lang']) {
    const element = frameDocument.getElementById(id);
    check(`${id} moved into the menu`, !!element && menu.contains(element));
  }

  // Opening it works, and Escape closes it and gives focus back.
  (toggle as HTMLElement).click();
  check('the menu opens', !menu.hidden);
  check('and reports it', toggle.getAttribute('aria-expanded') === 'true');

  frameDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape closes it', menu.hidden);
  check('and focus returns to the button', frameDocument.activeElement === toggle);
}

/**
 * Errors appear while typing, without pressing Run.
 *
 * Monaco squiggles TypeScript, JavaScript, CSS, HTML and JSON as you type because it
 * ships language services for them. Python, Java, PHP and C# had NOTHING until a run
 * finished - the editor looked clean while the student typed a broken line, and only
 * admitted otherwise once they pressed Run. That is the opposite of what an IDE is for.
 *
 * Asserted through the real marker list rather than the store, because the store having
 * the diagnostic and Monaco drawing it are two different things, and only the second one
 * is what a student sees.
 */
async function checkErrorsAppearWhileTyping(frameWindow: Window): Promise<void> {
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  const monacoApi = (frameWindow as unknown as { __bcMonaco?: typeof import('monaco-editor') }).__bcMonaco;
  if (!runtime || !monacoApi) {
    check('runtime and monaco are reachable for the live-error check', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
    getDocument(id: string): { setContent(text: string): void } | null;
  };
  const models = runtime.models as { peek(id: string): { uri: unknown } | null };
  const diagnostics = runtime.diagnostics as {
    forDocument(id: string): Array<{ line: number; message: string }>;
  };

  const created = await workspace.createDocument({
    name: 'live-errors.py',
    content: 'print("ok")\n',
    language: 'python',
    version: 'python3',
  });
  const tabManager = runtime.tabManager as { switchToTab(id: string): Promise<unknown> };
  await tabManager.switchToTab(created.id);

  const markersFor = (): Array<{ message: string; startLineNumber: number }> => {
    const model = models.peek(created.id);
    if (!model) return [];
    return monacoApi.editor.getModelMarkers({ resource: model.uri as never });
  };

  check('a correct file has no markers before running', markersFor().length === 0);

  // Type something broken. No Run anywhere in this test.
  workspace.getDocument(created.id)!.setContent('print("hello"\n');

  const appeared = await waitFor(
    'a squiggle to appear from typing alone',
    () => markersFor().length > 0,
    5000,
  );
  check('an error is marked without pressing Run', appeared, `markers: ${markersFor().length}`);

  const [marker] = markersFor();
  if (marker) {
    check(
      'and it points at the line the student broke',
      marker.startLineNumber === 1,
      `line ${marker.startLineNumber}: ${marker.message}`,
    );
  }

  // Fixing it must clear the squiggle, or the mark outlives the mistake.
  workspace.getDocument(created.id)!.setContent('print("hello")\n');
  const cleared = await waitFor('the squiggle to clear once fixed', () => markersFor().length === 0, 5000);
  check('fixing the code clears the mark', cleared, `still ${markersFor().length} marker(s)`);

  /*
   * The Python preflight emits one familiar File/Error block per undefined name.
   * The output parser used to keep only its final block, and the preflight separately
   * collapsed repeated names. This exact shape reproduces the reported t/g/g failure.
   */
  workspace.getDocument(created.id)!.setContent('t\ng\ng\n');
  const allNamesMarked = await waitFor(
    'all repeated undefined names to be marked',
    () => markersFor().filter(marker => /NameError/.test(marker.message)).length === 3,
    10000,
  );
  const nameMarkers = markersFor().filter(marker => /NameError/.test(marker.message));
  check(
    'every undefined-name occurrence gets its own squiggle',
    allNamesMarked && nameMarkers.map(marker => marker.startLineNumber).join(',') === '1,2,3',
    nameMarkers.map(marker => `L${marker.startLineNumber}:${marker.message}`).join(' | '),
  );
  check(
    'the Problems count receives every undefined-name occurrence',
    diagnostics.forDocument(created.id).filter(item => /NameError/.test(item.message)).length === 3,
    JSON.stringify(diagnostics.forDocument(created.id)),
  );

  workspace.getDocument(created.id)!.setContent('t = 1\ng = 2\nprint(t, g)\n');
  const allNamesCleared = await waitFor(
    'all undefined-name marks to clear together',
    () => markersFor().filter(marker => /NameError/.test(marker.message)).length === 0,
    10000,
  );
  check('fixing all names clears all of their marks', allNamesCleared);

  workspace.getDocument(created.id)!.setContent([
    't',
    'g',
    'terry.forward(18g0)',
    'time.sleep(0.7-)',
    'g',
  ].join('\n'));
  const mixedErrorsMarked = await waitFor(
    'mixed syntax and name errors to be marked together',
    () => {
      const markers = markersFor();
      return markers.filter(marker => /SyntaxError/.test(marker.message)).length === 2
        && markers.filter(marker => /NameError/.test(marker.message)).length === 3;
    },
    10000,
  );
  const mixedMarkers = markersFor();
  check(
    'a parser error does not erase independent semantic errors',
    mixedErrorsMarked
      && new Set(mixedMarkers.map(marker => marker.startLineNumber)).size === 5,
    mixedMarkers.map(marker => `L${marker.startLineNumber}:${marker.message}`).join(' | '),
  );
  check(
    'the Problems count includes every mixed error category',
    diagnostics.forDocument(created.id).length === 5,
    JSON.stringify(diagnostics.forDocument(created.id)),
  );

  workspace.getDocument(created.id)!.setContent('print("fixed")\n');
  const mixedErrorsCleared = await waitFor(
    'all mixed errors to clear after one fix',
    () => markersFor().length === 0,
    10000,
  );
  check('fixing mixed errors clears all categories', mixedErrorsCleared);

  // The shared marker pipeline must keep every scanner result in each language which
  // has no Monaco parser. Three independent closing tokens are unambiguous errors.
  for (const language of ['python', 'java', 'php', 'csharp']) {
    const extension = { python: 'py', java: 'java', php: 'php', csharp: 'cs' }[language]!;
    const version = {
      python: 'python3', java: 'java17', php: 'php8', csharp: 'csharp12',
    }[language]!;
    const probe = await workspace.createDocument({
      name: `multi-errors-${language}.${extension}`,
      content: ')\n]\n}\n',
      language,
      version,
    });
    await tabManager.switchToTab(probe.id);
    const probeMarkers = () => {
      const model = models.peek(probe.id);
      return model ? monacoApi.editor.getModelMarkers({ resource: model.uri as never }) : [];
    };
    const allMarked = await waitFor(
      `${language}'s independent errors to be marked`,
      () => probeMarkers().length >= 3,
      5000,
    );
    check(
      `${language} keeps every independently detectable error`,
      allMarked && new Set(probeMarkers().map(marker => marker.startLineNumber)).size >= 3,
      probeMarkers().map(marker => `L${marker.startLineNumber}:${marker.message}`).join(' | '),
    );
  }

  // JavaScript uses Monaco's real language service instead of the shared scanner.
  const javascript = await workspace.createDocument({
    name: 'multi-errors-javascript.js',
    content: 'firstMissing;\nsecondMissing;\nthirdMissing;\n',
    language: 'javascript',
    version: 'es2022',
  });
  await tabManager.switchToTab(javascript.id);
  const javascriptMarkers = () => {
    const model = models.peek(javascript.id);
    return model ? monacoApi.editor.getModelMarkers({ resource: model.uri as never }) : [];
  };
  const allJavaScriptMarked = await waitFor(
    'JavaScript language-service errors to be marked',
    () => javascriptMarkers().filter(marker => /Cannot find name/.test(marker.message)).length === 3,
    15000,
  );
  check(
    'javascript keeps every language-service error',
    allJavaScriptMarked,
    javascriptMarkers().map(marker => `L${marker.startLineNumber}:${marker.message}`).join(' | '),
  );

  workspace.getDocument(javascript.id)!.setContent([
    'firstMissing;',
    'const broken = ;',
    'secondMissing;',
  ].join('\n'));
  const mixedJavaScriptMarked = await waitFor(
    'JavaScript syntax and semantic errors to be marked together',
    () => {
      const lines = new Set(javascriptMarkers().map(marker => marker.startLineNumber));
      return lines.has(1) && lines.has(2) && lines.has(3);
    },
    15000,
  );
  check(
    'javascript keeps semantic errors around a parser error',
    mixedJavaScriptMarked,
    javascriptMarkers().map(marker => `L${marker.startLineNumber}:${marker.message}`).join(' | '),
  );
}

/**
 * The compiler's answer arrives on its own, and the student is never shown the same
 * mistake twice.
 *
 * Two producers report on the same file: the instant scanner, from the text alone, and
 * the real toolchain via POST /api/check. They find the SAME mistake constantly - an
 * unclosed bracket is what each is best at - so the store suppresses the scanner on any
 * line the compiler has spoken about.
 *
 * Asserted through Monaco's marker list, because "one problem per line" is a claim
 * about what is drawn, not about what is stored.
 */
async function checkTheCompilerAgreesWithoutDuplicating(frameWindow: Window): Promise<void> {
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  const monacoApi = (frameWindow as unknown as { __bcMonaco?: typeof import('monaco-editor') }).__bcMonaco;
  if (!runtime || !monacoApi) {
    check('runtime and monaco are reachable for the compiler check', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
    getDocument(id: string): { setContent(text: string): void } | null;
  };
  const models = runtime.models as { peek(id: string): { uri: unknown } | null };
  const tabManager = runtime.tabManager as { switchToTab(id: string): Promise<unknown> };

  const created = await workspace.createDocument({
    name: 'dedupe-probe.py',
    content: 'x = 1\n',
    language: 'python',
    version: 'python3',
  });
  await tabManager.switchToTab(created.id);

  const markers = (): Array<{ startLineNumber: number; message: string; source?: string }> => {
    const model = models.peek(created.id);
    if (!model) return [];
    return monacoApi.editor.getModelMarkers({ resource: model.uri as never });
  };

  // An unclosed bracket: the one mistake BOTH producers reliably find.
  workspace.getDocument(created.id)!.setContent('value = (1 + 2\nprint(value)\n');

  const marked = await waitFor('the bracket error to be marked', () => markers().length > 0, 6000);
  check('an unclosed bracket is marked while typing', marked);

  /*
   * Settle for longer than the Python debounce (400ms) plus a round trip, so the
   * compiler's answer has landed too. If deduplication were broken, THIS is when the
   * second squiggle would appear on the same line.
   */
  await new Promise(resolve => setTimeout(resolve, 2500));

  const onLineOne = markers().filter(marker => marker.startLineNumber === 1);
  check(
    'exactly one problem is shown on the broken line',
    onLineOne.length === 1,
    onLineOne.map(marker => marker.message).join(' || '),
  );

  // And fixing it clears everything, from both producers.
  workspace.getDocument(created.id)!.setContent('value = (1 + 2)\nprint(value)\n');
  const cleared = await waitFor('both producers to clear', () => markers().length === 0, 8000);
  check('fixing it clears every mark', cleared, `${markers().length} left: ${markers().map(m => m.message).join(' || ')}`);
}

/**
 * Running only the selected lines must run only the selected lines.
 *
 * The gesture the feature advertises - triple-click, or a click in the line-number
 * gutter - produces a selection ending at column 1 of the NEXT line, and the old code
 * expanded that to the whole next line. So "run this one line" ran two, and the extra
 * line was executed with no indication. Asserted against a real run, because the
 * failure is in what reaches the sandbox, not in what the editor shows.
 */
/**
 * The Run/Stop pair, and the debugger's toolbar being on screen rather than merely
 * rendered.
 *
 * Both were invisible for the same underlying reason and neither had a test.
 *
 * `#editor` was `position: absolute; inset: 0`, which fills #editor-container - and a
 * positioned element paints above its in-flow siblings, so Monaco covered the
 * breadcrumbs bar and the whole debugger toolbar. The toolbar built its five buttons
 * and updated their enabled state on every debug event, underneath the editor.
 *
 * And there was no way to stop a program at all: `startRunLoader()` disabled Run and
 * put a spinner in it, so an endless loop could only be ended by the server timeout or
 * by reloading the page.
 *
 * `elementFromPoint` rather than `getBoundingClientRect`, because the bug was never
 * that the element had no box - it had a perfectly good box that nobody could see or
 * click. Asking the document what is actually at those coordinates is the only check
 * that would have failed before the fix.
 */
async function checkRunStopAndDebugToolbarAreVisible(frameWindow: Window): Promise<void> {
  const frameDocument = frameWindow.document;

  /*
   * Open a source file first.
   *
   * The preceding scenario leaves an IMAGE tab active, and the asset viewer is an
   * overlay across the editor area - so without this the toolbar is genuinely covered,
   * by the viewer rather than by the editor, and this check would fail for a reason
   * that has nothing to do with what it is testing.
   */
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  const workspace = runtime?.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
  } | undefined;
  const tabManager = runtime?.tabManager as { switchToTab(id: string): Promise<unknown> } | undefined;
  if (workspace && tabManager) {
    const source = await workspace.createDocument({
      name: 'toolbar-probe.py',
      content: 'print(1)\n',
      language: 'python',
      version: 'python3',
    });
    await tabManager.switchToTab(source.id);
    await new Promise(resolve => frameWindow.requestAnimationFrame(() => resolve(null)));
  }

  const runButton = frameDocument.getElementById('run') as HTMLButtonElement | null;
  const stopButton = frameDocument.getElementById('stop') as HTMLButtonElement | null;

  check('there is a Run button', !!runButton);
  check('there is a Stop button', !!stopButton);
  if (!runButton || !stopButton) return;

  check('Stop is hidden while nothing is running', stopButton.hidden);

  /** Is this element the thing actually on screen at its own centre? */
  const isOnTop = (element: HTMLElement): boolean => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    const hit = frameDocument.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return hit === element || element.contains(hit);
  };

  const toolbar = frameDocument.getElementById('debug-toolbar') as HTMLElement | null;
  check('the debugger has a toolbar element', !!toolbar);
  if (!toolbar) return;

  // Force it visible without a debug session: this is a LAYOUT assertion, and the
  // question is whether the editor paints over it, which does not depend on state.
  const wasHidden = toolbar.hidden;
  toolbar.hidden = false;
  await new Promise(resolve => frameWindow.requestAnimationFrame(() => resolve(null)));

  const buttons = ['debug-continue', 'debug-step-over', 'debug-step-in', 'debug-step-out', 'debug-stop'];
  const missing = buttons.filter(id => !frameDocument.getElementById(id));
  check('all five debugger buttons exist', missing.length === 0, `missing: ${missing.join(', ')}`);

  const detail: string[] = [];
  const covered = buttons
    .map(id => frameDocument.getElementById(id) as HTMLElement | null)
    .filter((element): element is HTMLElement => !!element)
    .filter(element => {
      const box = element.getBoundingClientRect();
      const hit = frameDocument.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      ) as HTMLElement | null;
      const ok = box.width > 0 && box.height > 0 && (hit === element || element.contains(hit));
      if (!ok) {
        detail.push(
          `${element.id} box=${Math.round(box.width)}x${Math.round(box.height)}@` +
          `${Math.round(box.left)},${Math.round(box.top)} hit=${hit ? (hit.id || hit.className || hit.tagName) : 'null'}`,
        );
      }
      return !ok;
    })
    .map(element => element.id);

  check(
    'the debugger buttons are actually on screen, not under the editor',
    covered.length === 0,
    detail.join(' | '),
  );

  toolbar.hidden = wasHidden;
}

async function checkRunSelection(frameWindow: Window): Promise<void> {
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!runtime) {
    check('runtime is reachable for the selection-run check', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
  };
  const tabManager = runtime.tabManager as { switchToTab(id: string): Promise<unknown> };
  const commands = runtime.commands as {
    isEnabled(id: string): boolean;
    execute(id: string, context: { source: string }): Promise<{ status: string }>;
  };
  const editor = runtime.editor as {
    setSelection(range: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    }): void;
  };

  const doc = await workspace.createDocument({
    name: 'selection-probe.js',
    language: 'javascript',
    version: 'es2022',
    content: 'console.log("only-this-line");\nconsole.log("not-this-one");\n',
  });
  await tabManager.switchToTab(doc.id);

  check(
    'run-selection is disabled with no selection',
    !commands.isEnabled('workspace.runSelection'),
  );

  // Exactly the shape Monaco produces for a triple-click on line 1.
  editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 1 });
  check('run-selection is enabled for a whole-line selection', commands.isEnabled('workspace.runSelection'));

  const outcome = await commands.execute('workspace.runSelection', { source: 'api' });
  check('the selection ran', outcome.status === 'ran', `status ${outcome.status}`);

  const output = () => frame.contentDocument?.getElementById('panel-content')?.textContent ?? '';
  const printed = await waitFor('the selection output', () => /only-this-line/.test(output()), 30000);
  check('the selected line ran', printed, output().slice(0, 200));
  check(
    'the line AFTER the selection did NOT run',
    !/not-this-one/.test(output()),
    output().slice(0, 200),
  );
}

/**
 * A failed run must EXPLAIN itself, not just report itself.
 *
 * The traceback has to stay - a student has to learn to read the real thing - so this
 * asserts both halves: the runtime's own message is still there, and the plain-language
 * explanation is underneath it. Driven through a real run, because the whole feature
 * lives in the seam between the parser, the dictionary and the panel.
 */
async function checkErrorsAreExplained(frameWindow: Window): Promise<void> {
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!runtime) {
    check('runtime is reachable for the error-explanation check', false);
    return;
  }

  const workspace = runtime.workspace as {
    createDocument(request: Record<string, unknown>): Promise<{ id: string }>;
  };
  const tabManager = runtime.tabManager as { switchToTab(id: string): Promise<unknown> };
  const commands = runtime.commands as {
    execute(id: string, context: { source: string }): Promise<{ status: string }>;
  };

  const doc = await workspace.createDocument({
    name: 'explain-probe.mjs',
    language: 'javascript',
    version: 'es2022',
    content: 'console.log("starting");\nnotDeclaredAnywhere();\n',
  });
  await tabManager.switchToTab(doc.id);

  const outcome = await commands.execute('workspace.run', { source: 'api' });
  check('the failing run executed', outcome.status === 'ran', `status ${outcome.status}`);

  const monacoApi = (frameWindow as unknown as {
    __bcMonaco?: typeof import('monaco-editor');
  }).__bcMonaco;
  const model = (runtime.models as {
    peek(id: string): import('monaco-editor').editor.ITextModel | null;
  }).peek(doc.id);
  const marker = monacoApi && model
    ? monacoApi.editor.getModelMarkers({ resource: model.uri })
        .find(item => item.owner === 'browser-coder-run')
    : null;
  check(
    'the Problems-row message stays concise',
    marker?.message === 'ReferenceError: notDeclaredAnywhere is not defined',
    marker?.message ?? 'marker missing',
  );

  // Exercise the real Monaco hover UI. The marker remains intentionally concise,
  // while a dedicated hover provider renders the teaching card in the language that
  // is active at the moment the student points at the error.
  const editor = runtime.editor as {
    setPosition(position: { lineNumber: number; column: number }): void;
    revealLine(line: number): void;
    focus(): void;
    trigger(source: string, action: string, payload: unknown): void;
  };
  editor.setPosition({ lineNumber: 2, column: 2 });
  editor.revealLine(2);
  editor.focus();
  editor.trigger('browser-test', 'editor.action.showHover', {});

  const hoverAppeared = await waitFor(
    'the structured error hover to appear',
    () => /WHAT THIS MEANS/.test(frame.contentDocument?.querySelector('.monaco-hover')?.textContent ?? ''),
    5000,
  );
  const hover = frame.contentDocument?.querySelector('.monaco-hover');
  const hoverText = hover?.textContent ?? '';
  const sectionHeadings = [...(hover?.querySelectorAll('h2, h3') ?? [])];
  check('the structured error hover appears', hoverAppeared, hoverText || 'hover missing');
  check('the explanation is labeled separately', sectionHeadings.some(node => /WHAT THIS MEANS/.test(node.textContent ?? '')), hoverText);
  check('the likely cause is labeled separately', sectionHeadings.some(node => /COMMON CAUSE/.test(node.textContent ?? '')), hoverText);
  check('the example is labeled as an example', sectionHeadings.some(node => /EXAMPLE/.test(node.textContent ?? '')), hoverText);
  check(
    'the primary diagnostic appears exactly once in the hover',
    hoverText.split("Cannot find name 'notDeclaredAnywhere'.").length - 1 === 1,
    hoverText,
  );
  const title = hover?.querySelector('h2');
  const body = hover?.querySelector('p');
  check(
    'the main explanation title is visually larger than its prose',
    Boolean(title && body) &&
      Number.parseFloat(frameWindow.getComputedStyle(title!).fontSize) >
        Number.parseFloat(frameWindow.getComputedStyle(body!).fontSize),
  );

  const output = () => frame.contentDocument?.getElementById('panel-content')?.textContent ?? '';
  const explained = await waitFor(
    'the explanation to appear',
    () => /what this means/i.test(output()),
    30000,
  );
  check('a failed run explains the error', explained, output().slice(-300));

  const panel = output();
  const explanationStart = panel.search(/what this means/i);
  const explanation = explanationStart >= 0 ? panel.slice(explanationStart) : panel;
  check(
    'the runtime message is still shown, not replaced',
    /ReferenceError/.test(panel),
    panel.slice(-300),
  );
  check(
    'the explanation is the one for THIS error',
    /never seen|declared/i.test(explanation),
    explanation.slice(0, 200),
  );
  check(
    'it says what usually causes it',
    /spelling mistake|typo/i.test(explanation),
  );

  const languageSelect = frame.contentDocument?.getElementById('ui-lang') as HTMLSelectElement | null;
  if (languageSelect) {
    let changedLanguage = '';
    const recordLanguage = (event: Event) => {
      changedLanguage = String((event as CustomEvent<{ lang?: string }>).detail?.lang ?? '');
    };
    frameWindow.addEventListener('languageChanged', recordLanguage);
    languageSelect.value = 'he';
    languageSelect.dispatchEvent(new frameWindow.Event('change', { bubbles: true }));
    const switchedToHebrew = await waitFor(
      'the UI language to switch to Hebrew',
      () => changedLanguage === 'he',
      5000,
    );
    check(
      'the language selector activates Hebrew',
      switchedToHebrew,
      `select=${languageSelect.value}, html=${frame.contentDocument?.documentElement.lang}, ` +
        `debug=${frame.contentDocument?.getElementById('debug')?.textContent ?? ''}`,
    );
    check(
      'Debug is translated as דיבאג',
      /דיבאג/.test(frame.contentDocument?.getElementById('debug')?.textContent ?? ''),
      frame.contentDocument?.getElementById('debug')?.textContent ?? '',
    );
    check('changing the UI language does not erase program output', output() === panel, output().slice(-200));
    // Changing models closes Monaco's sticky keyboard-opened hover, just as clicking
    // another file does in the UI. Returning and hovering again must resolve the
    // teaching text in the locale that is active now, not the one stored at run time.
    const dismissDocument = await workspace.createDocument({
      name: 'hover-dismiss.txt', language: 'text', version: '', content: '',
    });
    await tabManager.switchToTab(dismissDocument.id);
    await tabManager.switchToTab(doc.id);
    editor.setPosition({ lineNumber: 2, column: 2 });
    editor.trigger('browser-test', 'editor.action.showHover', {});
    const hebrewHoverAppeared = await waitFor(
      'the same error hover to be translated after the language switch',
      () => /מה זה אומר/.test(frame.contentDocument?.querySelector('.monaco-hover')?.textContent ?? ''),
      5000,
    );
    const hebrewHover = frame.contentDocument?.querySelector('.monaco-hover');
    const hebrewText = hebrewHover?.textContent ?? '';
    check('the error explanation follows the current Hebrew UI language', hebrewHoverAppeared, hebrewText);
    check('the Hebrew explanation is isolated as RTL text', hebrewText.includes('\u2067') && hebrewText.includes('\u2069'));
    const hebrewMarkdown = hebrewHover?.querySelector('.markdown-hover');
    check(
      'Hebrew hover text starts at the right without moving the hover window',
      Boolean(hebrewMarkdown) &&
        frameWindow.getComputedStyle(hebrewMarkdown!).direction === 'rtl' &&
        frameWindow.getComputedStyle(hebrewMarkdown!).textAlign === 'right',
    );
    const hebrewCode = hebrewHover?.querySelector('div[data-code]');
    check(
      'code stays LTR inside a right-aligned Hebrew hover',
      Boolean(hebrewCode) && frameWindow.getComputedStyle(hebrewCode!).direction === 'ltr',
    );

    languageSelect.value = 'en';
    languageSelect.dispatchEvent(new frameWindow.Event('change', { bubbles: true }));
    await waitFor(
      'the UI language to return to English',
      () => changedLanguage === 'en',
      5000,
    );
    frameWindow.removeEventListener('languageChanged', recordLanguage);
  }
}

/**
 * The IDE must be usable without a mouse, and audible to a screen reader.
 *
 * Before this the explorer rows were plain divs: no role, no tab stop, no key handling,
 * so a student who cannot use a mouse could not open a file at all. These assertions
 * drive the real tree in the real app, because the whole feature is DOM behaviour.
 */
async function checkKeyboardAndScreenReader(frameWindow: Window): Promise<void> {
  const frameDocument = frame.contentDocument!;
  const runtime = (frameWindow as unknown as { __bcRuntime?: Record<string, unknown> }).__bcRuntime;
  if (!runtime) {
    check('runtime is reachable for the accessibility check', false);
    return;
  }

  // ── Live regions ──────────────────────────────────────────────────────────
  const status = frameDocument.getElementById('status');
  check('the status line is a live region', status?.getAttribute('aria-live') === 'polite');
  check('it is announced as a whole', status?.getAttribute('aria-atomic') === 'true');

  const announcer = frameDocument.getElementById('a11y-announcer');
  check('there is an announcer for run outcomes', announcer !== null);
  check('the announcer is polite', announcer?.getAttribute('aria-live') === 'polite');

  const panel = frameDocument.getElementById('panel-content');
  check('the output panel is a log', panel?.getAttribute('role') === 'log');
  check(
    'the output panel is NOT live, so a long run is not read line by line',
    panel?.getAttribute('aria-live') === null,
  );
  check('the output panel is reachable by keyboard', panel?.getAttribute('tabindex') === '0');

  // ── The tree ──────────────────────────────────────────────────────────────
  const tree = frameDocument.getElementById('file-tree');
  check('the file tree is a tree', tree?.getAttribute('role') === 'tree');

  const rows = [...frameDocument.querySelectorAll('.tree-item')] as HTMLElement[];
  check('the tree has rows to navigate', rows.length > 0, `${rows.length} rows`);
  if (rows.length === 0) return;

  check('every row is a treeitem', rows.every(row => row.getAttribute('role') === 'treeitem'));
  check('every row declares its depth', rows.every(row => !!row.getAttribute('aria-level')));

  const tabbable = rows.filter(row => row.getAttribute('tabindex') === '0');
  check(
    'exactly one row is tabbable, so the tree is ONE tab stop',
    tabbable.length === 1,
    `${tabbable.length} tabbable rows of ${rows.length}`,
  );

  // ── Arrow-key navigation ──────────────────────────────────────────────────
  //
  // This suite runs the IDE in snippet mode, which hides the whole sidebar
  // (`body.mode-snippet #sidebar { display: none }`) as well as the explorer panel -
  // and an element inside `display: none` cannot take focus, so the keyboard contract
  // could not be exercised at all. The tree's key handling does not depend on the
  // layout mode, so both classes are lifted for the duration of the check and put back
  // afterwards.
  const hidden = ['mode-snippet', 'hide-explorer-panel'].filter(name =>
    frameDocument.body.classList.contains(name),
  );
  for (const name of hidden) frameDocument.body.classList.remove(name);

  const first = tabbable[0] ?? rows[0];
  first.focus();
  check('a row can take focus', frameDocument.activeElement === first);

  const press = (key: string) => {
    (frameDocument.activeElement as HTMLElement).dispatchEvent(
      new (frameWindow as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent(
        'keydown',
        { key, bubbles: true, cancelable: true },
      ),
    );
  };

  if (rows.length > 1) {
    const before = frameDocument.activeElement;
    press('ArrowDown');
    check(
      'ArrowDown moves to the next row',
      frameDocument.activeElement !== before
        && (frameDocument.activeElement as HTMLElement)?.classList.contains('tree-item'),
      String((frameDocument.activeElement as HTMLElement)?.className),
    );

    const afterDown = frameDocument.activeElement;
    press('ArrowUp');
    check('ArrowUp moves back', frameDocument.activeElement !== afterDown);

    press('End');
    check(
      'End jumps to the last row',
      frameDocument.activeElement === rows[rows.length - 1],
    );
    press('Home');
    check('Home jumps back to the first', frameDocument.activeElement === rows[0]);
  }

  for (const name of hidden) frameDocument.body.classList.add(name);

  // ── High contrast ─────────────────────────────────────────────────────────
  const themeSelect = frameDocument.getElementById('theme') as HTMLSelectElement | null;
  check(
    'a high-contrast theme can be chosen',
    !!themeSelect && [...themeSelect.options].some(option => option.value === 'hc-black'),
  );

  if (themeSelect) {
    const original = themeSelect.value;
    themeSelect.value = 'hc-black';
    themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor('high contrast to apply', () => frameDocument.body.classList.contains('hc-theme'), 5000);
    check('choosing it applies the theme', frameDocument.body.classList.contains('hc-theme'));
    check(
      'and it layers on dark, so an unrestated variable is not light',
      frameDocument.body.classList.contains('dark-theme'),
    );

    themeSelect.value = original;
    themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor('the theme to go back', () => !frameDocument.body.classList.contains('hc-theme'), 5000);
    check('switching away removes it', !frameDocument.body.classList.contains('hc-theme'));
  }
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
  await checkRunErrorsBecomeMarkers(frameWindow);
  await checkWebLanguageServices(frameWindow);
  await checkFormattingWorks(frameWindow);
  await checkQuickOpenAndBreadcrumbs(frameWindow);
  await checkDebuggerWorks(frameWindow);
  await checkRecordedLearningTools(frameWindow);
  await checkHoverTeaches(frameWindow);
  await checkRunSelection(frameWindow);
  await checkErrorsAreExplained(frameWindow);
  await checkKeyboardAndScreenReader(frameWindow);
  await checkClosingATabKeepsTheFileUsable(frameWindow);
  await checkAnOpenImageIsNotOverwritten(frameWindow);
  await checkRunStopAndDebugToolbarAreVisible(frameWindow);
  await checkTheTitlebarIsSimple(frameWindow);
  await checkErrorsAppearWhileTyping(frameWindow);
  await checkTheCompilerAgreesWithoutDuplicating(frameWindow);

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
