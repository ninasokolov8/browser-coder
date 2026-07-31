/**
 * Monaco's markers, published into the diagnostics store.
 *
 * Monaco already computes TypeScript and JavaScript diagnostics continuously and
 * exposes them as markers. Before this they were read in exactly one place - a
 * pre-run gate inside `runCode` that looked at the ACTIVE model only - so a type
 * error in a file the user was not currently looking at blocked nothing and was
 * shown nowhere.
 *
 * Publishing them into the store instead gives the Problems panel, the status bar
 * count and the run gate one shared answer, for the whole project rather than the
 * focused tab.
 */

import * as monaco from 'monaco-editor';

import { RUN_MARKER_OWNER } from './server-source.ts';
import type { DiagnosticsStore, Diagnostic, DiagnosticSeverity } from './store.ts';
import type { MonacoModelRegistry } from '../workspace/monaco/model-registry.ts';
import type { WorkspaceService } from '../workspace/service.ts';
import type { Disposable } from '../workspace/types.ts';

/** Monaco's numeric severities, which do not map one-to-one onto ours. */
function severityOf(marker: monaco.editor.IMarker): DiagnosticSeverity {
  switch (marker.severity) {
    case monaco.MarkerSeverity.Error:
      return 'error';
    case monaco.MarkerSeverity.Warning:
      return 'warning';
    default:
      // Info and Hint both become 'info'. Hint is used by Monaco for "unnecessary
      // code" style suggestions, which a beginner reads as a problem if it is
      // presented next to real errors - but hiding it entirely loses a real signal,
      // so it is demoted rather than dropped.
      return 'info';
  }
}

export interface MonacoDiagnosticsOptions {
  store: DiagnosticsStore;
  models: MonacoModelRegistry;
  service: WorkspaceService;
  /** Producer key in the store. */
  source?: string;
}

/**
 * Start mirroring Monaco markers into the store. Returns a disposable.
 */
export function connectMonacoDiagnostics({
  store,
  models,
  service,
  source = 'ts',
}: MonacoDiagnosticsOptions): Disposable {
  /** Map a model URI back to the document that owns it. */
  const documentForUri = (uri: monaco.Uri): { id: string; path: string } | null => {
    for (const entry of models.all()) {
      if (entry.model.uri.toString() === uri.toString()) {
        return { id: entry.id, path: entry.path };
      }
    }
    return null;
  };

  const publishFor = (uri: monaco.Uri): void => {
    const document = documentForUri(uri);
    if (!document) return;

    const model = monaco.editor.getModel(uri);
    if (!model || model.isDisposed()) {
      store.clear(document.id, source);
      return;
    }

    // The revision the markers describe. Monaco computes asynchronously, so this is
    // the model version at the moment the markers were read - which is what makes a
    // late result identifiable as stale.
    const revision = model.getVersionId();

    const diagnostics: Diagnostic[] = monaco.editor
      .getModelMarkers({ resource: uri })
      // Skip our own run markers. Writing a marker fires onDidChangeMarkers, so
      // mirroring them back into the store would republish every run diagnostic
      // under the `ts` producer - a feedback loop that duplicates each one.
      .filter(marker => marker.owner !== RUN_MARKER_OWNER)
      .map(marker => ({
        documentId: document.id,
        path: document.path,
        severity: severityOf(marker),
        message: marker.message,
        line: marker.startLineNumber,
        column: marker.startColumn,
        endLine: marker.endLineNumber,
        endColumn: marker.endColumn,
        source,
      }));

    store.set(document.id, source, revision, diagnostics);
  };

  const markerSubscription = monaco.editor.onDidChangeMarkers(uris => {
    for (const uri of uris) publishFor(uri);
  });

  // A document that goes away must take its problems with it, or the panel lists
  // errors in a file that no longer exists and clicking one navigates nowhere.
  const workspaceSubscription = service.onDidChangeWorkspace(event => {
    if (event.reason !== 'delete' && event.reason !== 'clear' && event.reason !== 'replace-all') {
      return;
    }
    for (const documentId of event.affected) {
      if (!service.getDocument(documentId)) store.clear(documentId);
    }
    if (event.reason === 'clear') store.clearAll();
  });

  // Publish whatever Monaco already knows, so opening the panel before the next
  // edit does not show an empty list.
  for (const entry of models.all()) publishFor(entry.model.uri);

  return {
    dispose: () => {
      markerSubscription.dispose();
      workspaceSubscription.dispose();
    },
  };
}
