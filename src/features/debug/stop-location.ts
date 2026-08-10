/**
 * Is the program stopped in the file the student is looking at?
 *
 * ## Why this is not a string comparison
 *
 * The server does not run a snippet under the student's name. `runCode` sends only
 * `code` in snippet mode, so the job writes it as `main.py`, `Main.java`, `Program.cs`
 * or `main.mjs` whatever the tab is called - and the adapter then reports every stop in
 * THAT file. A student editing `main_1.py` was told the program had stopped in
 * `main.py`, the two "differed", and the line the debugger was paused on was never
 * highlighted. Stopping worked; the call stack was right; the editor showed nothing,
 * which reads exactly like a debugger that does not work.
 *
 * ## The rule
 *
 * The question is not "do the names match" but "is there a BETTER candidate". A
 * reported file that matches some other document in the workspace belongs to that
 * document, and highlighting here would put an arrow on code the program is not in -
 * worse than no arrow, because the student would trust it and read the wrong lines.
 *
 * A reported file that matches NOTHING in the workspace is the server's own name for
 * whatever it was given, and in that case the document on screen is not merely the best
 * candidate, it is the only one.
 *
 * The same shape as `resolveDocument` in diagnostics/server-source.ts, which resolves
 * compiler messages: exact path, then basename, then the fallback that a name the
 * workspace does not know can only mean the file that was sent.
 */

export interface StopLocationQuery {
  /** The file the adapter reported the stop in. Empty when it did not say. */
  readonly stopFile: string | null | undefined;
  /** Canonical workspace path of the document on screen. */
  readonly activePath: string | null | undefined;
  /** Its bare name, for the case where no path can be resolved. */
  readonly activeName: string | null | undefined;
  /** Every path the workspace holds, so a better candidate can be recognised. */
  readonly workspacePaths: readonly string[];
  /** Identity of the document currently shown, when available. */
  readonly activeDocumentId?: string | null;
  /** Identity of the document launched by this debug session. */
  readonly executionDocumentId?: string | null;
  /** True when only the launched document was sent and the adapter renamed it. */
  readonly singleFileExecution?: boolean;
}

/** Strip directories and normalise separators, so `src/a.py` and `a.py` compare. */
function basename(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').split('/').pop() ?? value;
}

function normalise(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function stopIsOnScreen(query: StopLocationQuery): boolean {
  const {
    stopFile,
    activePath,
    activeName,
    workspacePaths,
    activeDocumentId,
    executionDocumentId,
    singleFileExecution,
  } = query;

  // In snippet mode there cannot be another source file on the server. Adapters give
  // the one submitted document their own conventional name, which can collide with a
  // different, unsent workspace tab. Document identity is therefore the only correct
  // answer: highlight the file that launched, never the coincidentally named tab.
  if (singleFileExecution && executionDocumentId) {
    return activeDocumentId === executionDocumentId;
  }

  // The adapter said nothing about where it stopped - a v1-shaped answer. There is
  // nothing to contradict, so the stop is shown where the student is.
  if (!stopFile) return true;

  const reported = normalise(stopFile);
  const reportedName = basename(reported);

  /** Does this workspace file answer to the name the adapter reported? */
  const isTheReportedFile = (value: string | null | undefined): boolean => {
    if (!value) return false;
    const candidate = normalise(value);
    return candidate === reported || basename(candidate) === reportedName;
  };

  if (isTheReportedFile(activePath) || isTheReportedFile(activeName)) return true;

  /*
   * Does the reported file name some OTHER document?
   *
   * If so it belongs there and not here. This is what keeps the fallback below honest:
   * a project stopped in `helper.py` while the student looks at `main.py` must NOT draw
   * an arrow on main.py.
   *
   * The active document is excluded by IDENTITY - its own path - not by whether it
   * matches the reported name. Excluding it by name skipped precisely the entries this
   * is looking for, so nothing ever "belonged elsewhere".
   */
  const activeNormalised = activePath ? normalise(activePath) : null;
  const belongsElsewhere = workspacePaths.some(path => {
    const candidate = normalise(path);
    if (activeNormalised && candidate === activeNormalised) return false;
    return isTheReportedFile(candidate);
  });
  if (belongsElsewhere) return false;

  /*
   * The workspace has never heard of this file, so it is the server's own name for
   * what it was given - `main.py` for a snippet. The document on screen is the only
   * thing it can be.
   */
  return true;
}
