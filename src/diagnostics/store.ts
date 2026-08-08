/**
 * The diagnostics store: problems, bound to the revision they were computed for.
 *
 * Diagnostics arrive asynchronously - Monaco's TypeScript worker answers on its own
 * schedule, and a server compile error arrives a whole round trip after the code was
 * sent. So by the time a result lands, the document may already have changed. The
 * same shape as the persistence race (V-09), and with the same remedy: a producer
 * states which revision it examined, and a result for a revision that is no longer
 * current is discarded rather than displayed.
 *
 * Without that, the Problems panel shows errors for code the user has already fixed,
 * with line numbers that point at the wrong lines - which is worse than showing
 * nothing, because the student trusts it and goes looking.
 *
 * Pure: no DOM, no Monaco. The sources adapt into it.
 */

import { Emitter } from '../workspace/emitter.ts';
import type { Disposable } from '../workspace/types.ts';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface DiagnosticHelp {
  readonly heading: string;
  readonly explanation: string;
  readonly cause: string | null;
  readonly example: string | null;
  readonly rtl: boolean;
}

export interface Diagnostic {
  readonly documentId: string;
  /** Canonical workspace path, for display and for grouping. */
  readonly path: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** 1-based, matching what editors and compilers report. */
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  /** Who produced it: "ts", "javac", "python", ... Shown so the origin is legible. */
  readonly source: string;
  /**
   * A plain-language explanation of this message, when one exists.
   *
   * Carried on the diagnostic so it can reach the SQUIGGLE - the place the student is
   * actually looking - rather than only the output panel underneath a traceback, which
   * is where a stuck student has already stopped reading. Shown in the editor's hover;
   * deliberately not in the Problems panel, where it would turn every row into a
   * paragraph.
   */
  readonly help?: DiagnosticHelp;
}

export interface DiagnosticCounts {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
  readonly total: number;
}

interface Entry {
  readonly revision: number;
  readonly diagnostics: readonly Diagnostic[];
}

const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };

export class DiagnosticsStore {
  /** documentId -> producer -> entry. Producers are kept apart deliberately. */
  #byDocument = new Map<string, Map<string, Entry>>();
  #onDidChange = new Emitter<void>();

  readonly onDidChange = (listener: () => void): Disposable => this.#onDidChange.event(listener);

  /**
   * Publish one producer's diagnostics for one document at one revision.
   *
   * Producers are keyed separately because they answer at different times and about
   * different things: Monaco reports type errors continuously while the server
   * reports compile errors only after a run. Merging them into one list per document
   * would mean whichever answered last erased the other's findings.
   */
  set(
    documentId: string,
    source: string,
    revision: number,
    diagnostics: readonly Diagnostic[],
  ): void {
    const bySource = this.#byDocument.get(documentId) ?? new Map<string, Entry>();

    const existing = bySource.get(source);
    // Strictly older results are dropped. Equal revisions are accepted so a producer
    // can correct itself without the document having to change first.
    if (existing && revision < existing.revision) return;

    bySource.set(source, { revision, diagnostics: [...diagnostics] });
    this.#byDocument.set(documentId, bySource);
    this.#onDidChange.fire();
  }

  /**
   * Drop everything a producer said about a document.
   *
   * Distinct from `set(..., [])`: clearing means "I no longer have an opinion",
   * which is what should happen when a document is deleted or a producer is turned
   * off, whereas an empty list means "I looked, and it is clean".
   */
  clear(documentId: string, source?: string): void {
    const bySource = this.#byDocument.get(documentId);
    if (!bySource) return;

    if (source) bySource.delete(source);
    else this.#byDocument.delete(documentId);

    if (bySource.size === 0) this.#byDocument.delete(documentId);
    this.#onDidChange.fire();
  }

  clearAll(): void {
    if (this.#byDocument.size === 0) return;
    this.#byDocument.clear();
    this.#onDidChange.fire();
  }

  /**
   * Discard anything computed for an older revision of a document.
   *
   * Called when a document changes. The alternative - filtering at read time - keeps
   * stale results alive in memory and makes every reader responsible for remembering
   * the rule.
   */
  invalidate(documentId: string, currentRevision: number): void {
    const bySource = this.#byDocument.get(documentId);
    if (!bySource) return;

    let changed = false;
    for (const [source, entry] of [...bySource]) {
      if (entry.revision < currentRevision) {
        bySource.delete(source);
        changed = true;
      }
    }

    if (bySource.size === 0) this.#byDocument.delete(documentId);
    if (changed) this.#onDidChange.fire();
  }

  forDocument(documentId: string): Diagnostic[] {
    const bySource = this.#byDocument.get(documentId);
    if (!bySource) return [];
    return sortDiagnostics(preferAuthoritative(bySource));
  }

  all(): Diagnostic[] {
    const everything: Diagnostic[][] = [];
    for (const bySource of this.#byDocument.values()) {
      // Deduplicated per DOCUMENT, because the rule is about one line of one file.
      // Pooling every file first would let a compiler error in one suppress the
      // scanner's finding on the same line number of another.
      everything.push(preferAuthoritative(bySource));
    }
    return sortDiagnostics(everything.flat());
  }

  /** Grouped by path, in display order, for the Problems tree. */
  groupedByPath(): Array<{ path: string; documentId: string; diagnostics: Diagnostic[] }> {
    const groups = new Map<string, { path: string; documentId: string; diagnostics: Diagnostic[] }>();

    for (const diagnostic of this.all()) {
      const group = groups.get(diagnostic.path);
      if (group) group.diagnostics.push(diagnostic);
      else {
        groups.set(diagnostic.path, {
          path: diagnostic.path,
          documentId: diagnostic.documentId,
          diagnostics: [diagnostic],
        });
      }
    }

    return [...groups.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  counts(): DiagnosticCounts {
    let error = 0;
    let warning = 0;
    let info = 0;

    for (const diagnostic of this.all()) {
      if (diagnostic.severity === 'error') error++;
      else if (diagnostic.severity === 'warning') warning++;
      else info++;
    }

    return { error, warning, info, total: error + warning + info };
  }

  /** True when a run should be blocked. Only errors block; warnings never do. */
  hasErrors(): boolean {
    return this.all().some(diagnostic => diagnostic.severity === 'error');
  }
}

/** Errors first, then by position - the order a reader works through them. */
/**
 * The one producer that yields to the others: the instant client-side scanner.
 *
 * Stated as "everything else outranks this" rather than as a list of who is
 * authoritative, so a producer added later is trusted by default. Getting that
 * backwards would silently demote a real compiler the day it was introduced.
 *
 * This is the PRODUCER key - the second argument to `set()` - not `Diagnostic.source`,
 * which is a display label ('python', 'javac', 'ts') and is not unique to a producer.
 */
const ADVISORY_PRODUCER = 'syntax';

/**
 * One problem per line, with the compiler winning.
 *
 * The instant scanner and the real compiler frequently find the SAME mistake - an
 * unclosed bracket is exactly what both are best at - and a student who typed one
 * error should be shown one error. Two squiggles on one line, worded differently,
 * reads as two separate faults and sends them looking for a second bug that is not
 * there.
 *
 * Suppression is by LINE rather than by exact position, deliberately. A scanner and a
 * compiler routinely disagree about the column - the scanner points at the bracket
 * that was opened, `javac` points at where it gave up - and matching on column would
 * leave both showing, which is the case this exists to prevent.
 *
 * Applied at READ time, not when publishing. That matters: when the student edits and
 * the compiler's result is invalidated as stale, the scanner's finding comes back on
 * its own, with no republishing and nothing to keep in step.
 */
function preferAuthoritative(bySource: Map<string, Entry>): Diagnostic[] {
  const spokenFor = new Set<number>();
  for (const [producer, entry] of bySource) {
    if (producer === ADVISORY_PRODUCER) continue;
    for (const diagnostic of entry.diagnostics) spokenFor.add(diagnostic.line);
  }

  const kept: Diagnostic[] = [];
  for (const [producer, entry] of bySource) {
    for (const diagnostic of entry.diagnostics) {
      if (producer === ADVISORY_PRODUCER && spokenFor.has(diagnostic.line)) continue;
      kept.push(diagnostic);
    }
  }
  return kept;
}

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    if (a.severity !== b.severity) return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });
}
