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
