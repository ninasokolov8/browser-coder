/**
 * Run output -> diagnostics -> editor markers.
 *
 * This is the half that was missing. Monaco reports type errors for TypeScript and
 * JavaScript continuously; for Python, Java, PHP and C# the only thing that knows
 * what is wrong is the compiler on the server, and its answer went nowhere except a
 * paragraph of text in the output panel.
 *
 * Now a failed run produces the same thing a Monaco diagnostic produces: a squiggle
 * on the line, an entry in the Problems panel, and a click target.
 */

import * as monaco from 'monaco-editor';

import { parseCompilerOutput } from './compiler-output.ts';
import { buildErrorHelpBlock, formatErrorHover, selectErrorKey } from '../features/error-help.ts';
import { getUILang } from '../features/wrapped-i18n.ts';
import { getErrorExplanation, getLanguage } from '../languages';
import type { Diagnostic, DiagnosticHelp, DiagnosticsStore } from './store.ts';
import type { MonacoModelRegistry } from '../workspace/monaco/model-registry.ts';
import type { WorkspaceService } from '../workspace/service.ts';
import type { Disposable } from '../workspace/types.ts';

/**
 * Marker owner for run diagnostics.
 *
 * Distinct from Monaco's own owners so the two never overwrite each other - and so
 * `monaco-source.ts` can ignore these when mirroring markers back into the store.
 * Without that exclusion the two sources feed each other: writing a marker fires
 * onDidChangeMarkers, which republishes it under the `ts` producer, which is a loop
 * that duplicates every diagnostic.
 */
export const RUN_MARKER_OWNER = 'browser-coder-run';

/** Producer key in the store for diagnostics from an actual run. */
export const RUN_SOURCE = 'run';

/**
 * Producer key for the live check - the same compiler, invoked without executing.
 *
 * Kept apart from `run` because they answer at different times about different things:
 * a run reports what happened when the program ran, a check reports whether it would
 * compile at all. Merging them would mean whichever answered last erased the other.
 */
export const CHECK_SOURCE = 'check';

/**
 * Which document a reported filename belongs to.
 *
 * The server does not always run the file under the student's name: a snippet is
 * written as `main.py`, `Main.java` or `Program.cs` regardless of what the tab is
 * called. So an exact match is tried first, then a basename match, and only then
 * the fallback - and the fallback is restricted to the single-document case, where
 * there is nothing else it could mean.
 */
function resolveDocument(
  service: WorkspaceService,
  reportedFile: string,
  entryDocumentId: string | null,
  documentCount: number,
): string | null {
  const normalized = reportedFile.replace(/\\/g, '/').replace(/^\.\//, '');

  const byPath = service.findByPath(normalized);
  if (byPath) return byPath.id;

  const basename = normalized.split('/').pop() ?? normalized;
  const matches = service
    .allDocuments()
    .filter(document => document.name === basename);
  if (matches.length === 1) return matches[0].id;

  // One file in the run means the diagnostic can only be about that file, whatever
  // the server called it. With several, guessing would put a marker on the wrong
  // file - worse than none, so it is dropped.
  if (documentCount === 1 && entryDocumentId) return entryDocumentId;

  return null;
}

/**
 * The plain-language explanation for a compiler message, or null.
 *
 * Lives HERE rather than in error-help.ts because it needs the language registry, and
 * error-help.ts is a pure module that node tests import directly - `../languages` is a
 * directory import that Vite resolves and node's ESM loader does not, so putting this
 * there broke every test of the module it was added to. The rules for CHOOSING an
 * explanation stay pure and tested; only the lookup is here, where impurity already
 * lives.
 *
 * Silent when there is no entry, deliberately: a confidently wrong explanation in a
 * teaching tool is worse than none, because a student cannot tell it from a right one.
 */
function explanationFor(languageId: string, message: string, uiLanguage: string): DiagnosticHelp | null {
  const entries = getLanguage(languageId)?.errors;
  if (!entries) return null;

  const key = selectErrorKey(languageId, message, Object.keys(entries));
  if (!key) return null;

  const help = getErrorExplanation(languageId, key, uiLanguage);
  if (!help) return null;

  return buildErrorHelpBlock(key, help);
}

export interface PublishRunOptions {
  store: DiagnosticsStore;
  service: WorkspaceService;
  // No `models` here. It was required, passed by the one caller, and never read: the
  // markers are driven by `connectRunMarkers` watching the store, not written at
  // publish time. Keeping it would have forced the live check to invent one.
  languageId: string;
  /** stderr and stdout concatenated - compilers use both. */
  output: string;
  /** The document that was run, for the single-file fallback. */
  entryDocumentId: string | null;
  /** Documents included in this run, to know whether the fallback is safe. */
  documentCount: number;
}

/**
 * Publish the diagnostics from one run. Clears previous run diagnostics first, so
 * a fixed error disappears instead of accumulating.
 */
export function publishRunDiagnostics(options: PublishRunOptions): void {
  publishCompilerDiagnostics({ ...options, producer: RUN_SOURCE });
}

/**
 * Turn raw compiler text into diagnostics under one producer.
 *
 * Shared by the run and the live check, which differ only in WHEN the compiler was
 * asked. Everything after that - parsing its text, working out which file each
 * message belongs to, binding the result to the revision that was compiled - is
 * identical, and having it once is what stops a run and a check from attributing the
 * same javac output to different files.
 */
export function publishCompilerDiagnostics(
  options: PublishRunOptions & {
    producer: string;
    /**
     * The revision that was COMPILED, per document.
     *
     * Reading `document.revision` at publish time is only safe when the compile just
     * happened, which is true of a run and false of a debounced check: the student
     * keeps typing while it is in flight, and stamping the answer with the revision
     * they have now would present a stale result as current. Defaults to the live
     * revision, which is the run's behaviour unchanged.
     */
    revisionOf?: (documentId: string) => number | undefined;
  },
): void {
  const {
    store, service, languageId, output, entryDocumentId, documentCount, producer, revisionOf,
  } = options;

  // A new run supersedes the last one entirely. Without this, fixing one of two
  // errors leaves the fixed one on screen.
  for (const document of service.allDocuments()) {
    store.clear(document.id, producer);
  }

  const parsed = parseCompilerOutput(languageId, output);
  if (parsed.length === 0) return;

  const byDocument = new Map<string, Diagnostic[]>();

  for (const item of parsed) {
    const documentId = resolveDocument(service, item.file, entryDocumentId, documentCount);
    if (!documentId) continue;

    const document = service.getDocument(documentId);
    if (!document) continue;

    const path = service.pathOf(documentId) ?? document.name;
    const list = byDocument.get(documentId) ?? [];
    list.push({
      documentId,
      path,
      severity: item.severity,
      message: item.message,
      line: item.line,
      column: item.column ?? 1,
      source: languageId,
      // Looked up once, here, so every consumer of this diagnostic has it and none of
      // them has to know how explanations are found.
      help: explanationFor(languageId, item.message, getUILang()) ?? undefined,
    });
    byDocument.set(documentId, list);
  }

  for (const [documentId, diagnostics] of byDocument) {
    const document = service.getDocument(documentId);
    if (!document) continue;
    // Bound to the revision the run actually executed. If the student has already
    // edited since, the store discards these rather than pointing at moved lines.
    store.set(documentId, producer, revisionOf?.(documentId) ?? document.revision, diagnostics);
  }
}

/**
 * Keep Monaco's squiggles in step with the store.
 *
 * Driven by the store rather than written at publish time, so markers are correct
 * after any change - including the store discarding a stale result.
 */
export function connectRunMarkers({
  store,
  models,
  service,
}: {
  store: DiagnosticsStore;
  models: MonacoModelRegistry;
  service: WorkspaceService;
}): Disposable {
  const helpFor = (diagnostic: Diagnostic, languageId: string): DiagnosticHelp | undefined => {
    const key = diagnostic.help?.key;
    if (!key) return diagnostic.help;
    const current = getErrorExplanation(languageId, key, getUILang());
    return current ? buildErrorHelpBlock(key, current) : diagnostic.help;
  };

  const rangeFor = (
    model: monaco.editor.ITextModel,
    diagnostic: Diagnostic,
  ): monaco.Range => {
    const line = Math.min(Math.max(1, diagnostic.line), model.getLineCount());
    const endLine = Math.min(
      Math.max(line, diagnostic.endLine ?? diagnostic.line),
      model.getLineCount(),
    );
    const maxColumn = model.getLineMaxColumn(line);
    const column = Math.min(Math.max(1, diagnostic.column), maxColumn);

    if (endLine !== line) {
      return new monaco.Range(
        line,
        column,
        endLine,
        Math.min(
          Math.max(1, diagnostic.endColumn ?? model.getLineMaxColumn(endLine)),
          model.getLineMaxColumn(endLine),
        ),
      );
    }

    let endColumn = diagnostic.endColumn
      ? Math.min(Math.max(column, diagnostic.endColumn), maxColumn)
      : undefined;

    /*
     * Most compilers give a start column but no end column. Underlining the rest of
     * the line made two errors on one line overlap into one indistinguishable blur,
     * and made the hover provider pick whichever diagnostic happened to be first.
     * Prefer Monaco's word boundary; punctuation receives a precise one-character
     * range. A diagnostic at the virtual end-of-line column remains zero-width.
     */
    if (endColumn === undefined) {
      const word = model.getWordAtPosition({ lineNumber: line, column });
      endColumn = word && column >= word.startColumn && column <= word.endColumn
        ? word.endColumn
        : Math.min(maxColumn, column + 1);
    }

    return new monaco.Range(line, column, line, endColumn);
  };

  const apply = () => {
    for (const entry of models.all()) {
      const forDocument = store
        .forDocument(entry.id)
        .filter(diagnostic => diagnostic.source !== 'ts');

      const markers: monaco.editor.IMarkerData[] = forDocument.map(diagnostic => {
        const model = entry.model;
        // Clamp: a compiler can name a position past the end of what the editor now
        // holds, and Monaco throws on an out-of-range marker.
        const range = rangeFor(model, diagnostic);

        return {
          severity:
            diagnostic.severity === 'warning'
              ? monaco.MarkerSeverity.Warning
              : monaco.MarkerSeverity.Error,
          // Keep Monaco's marker and Problems-row message literal and concise. The
          // registered hover provider below adds the structured teaching card.
          message: diagnostic.message,
          startLineNumber: range.startLineNumber,
          startColumn: range.startColumn,
          endLineNumber: range.endLineNumber,
          endColumn: range.endColumn,
          source: diagnostic.source,
        };
      });

      monaco.editor.setModelMarkers(entry.model, RUN_MARKER_OWNER, markers);
    }
  };

  const subscription = store.onDidChange(apply);
  // A document appearing or disappearing changes which models need markers.
  const workspaceSubscription = service.onDidChangeWorkspace(apply);
  // A Step-Up project is added to the workspace before its active Monaco model is
  // acquired. The diagnostics may therefore already exist when the first model
  // appears. Re-apply on the model lifecycle too, or the status count updates while
  // the editor stays visually clean until another diagnostic happens to arrive.
  const modelSubscription = models.onDidChange(apply);
  const hoverSubscriptions = [
    'python', 'javascript', 'typescript', 'java', 'php', 'csharp',
  ].map(languageId => monaco.languages.registerHoverProvider(languageId, {
    provideHover(model, position) {
      const entry = models.all().find(candidate => candidate.model === model);
      if (!entry) return null;
      const diagnostic = store.forDocument(entry.id).find(item =>
        item.help && rangeFor(model, item).containsPosition(position));
      if (!diagnostic) return null;
      const help = helpFor(diagnostic, model.getLanguageId());
      if (!help) return null;
      return {
        range: rangeFor(model, diagnostic),
        contents: [{
          value: formatErrorHover(
            help,
            model.getLanguageId(),
            getUILang(),
          ),
          isTrusted: false,
          supportHtml: true,
        }],
      };
    },
  }));
  apply();

  return {
    dispose: () => {
      subscription.dispose();
      workspaceSubscription.dispose();
      modelSubscription.dispose();
      for (const hoverSubscription of hoverSubscriptions) hoverSubscription.dispose();
    },
  };
}
