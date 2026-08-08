/**
 * "Check my work": run the teacher's marking harness and report per case.
 *
 * The pieces already existed and blueprint 44.5 said so: `X_HIDDEN_` files let a
 * teacher ship a harness the student cannot open, the run pipeline takes an entry
 * point, and the whole project travels with every run. What was missing was the
 * surface - a button, and something that reads the result rather than dumping the
 * harness's stdout at a fourteen-year-old.
 *
 * This is the thin part. The two decisions worth testing - which file is the harness,
 * and what its output means - are in `harness.ts` and `protocol.ts`, both pure. This
 * file is the wiring that needs a browser.
 */

import { runtime } from '../../app/runtime';
import { appendOutputHtml, setStatus } from '../../components/output';
import { announce } from '../../components/announce.ts';
import { escapeHtml } from '../../components/html-escape.ts';
import { collectWorkspaceSnapshot } from '../workspace';
import { runCode } from '../execution';
import { findHarness } from './harness.ts';
import { parseTestReport, summariseReport, type TestReport } from './protocol.ts';

/** The status glyph for each outcome. Shape as well as colour, for the same reason the
 * conditional breakpoint is a different shape: colour alone is not a signal everyone
 * receives. */
const GLYPH = { pass: '✔', fail: '✘', skip: '–' } as const;
const CLASS = { pass: 'success', fail: 'error', skip: 'info' } as const;

/*
 * There is no `hasHarness()` for the command's `when` to call, and that is a decision
 * rather than an omission: finding the harness needs the workspace snapshot, which is
 * async, and a command's `when` is synchronous.
 *
 * So the command is always offered and says "this task has no checks" when there are
 * none. An item that is always there and sometimes has nothing to do is easier to
 * learn than one that appears and disappears for reasons the student cannot see.
 */
async function locateHarness() {
  const activeTab = runtime.tabManager?.getActiveTab();
  if (!activeTab) return null;

  const snapshot = await collectWorkspaceSnapshot();
  return findHarness(
    snapshot.map(file => ({ path: file.path, languageId: file.language ?? '' })),
    activeTab.file.language,
  );
}

/**
 * A twelve-cell bar. Enough to read at a glance, short enough not to wrap.
 *
 * Proportional rather than one cell per check: a harness that loops can report
 * hundreds, and a bar that grows with them stops being a bar.
 */
function progressBar(passed: number, total: number): string {
  if (total <= 0) return '';
  const filled = Math.round((passed / total) * 12);
  return '█'.repeat(filled) + '░'.repeat(12 - filled);
}

/** Render one case per line, which is the whole point of the feature. */
function renderReport(report: TestReport): void {
  const total = report.passed + report.failed + report.skipped;
  const firstFailure = report.cases.find(entry => entry.status === 'fail');

  /*
   * The verdict FIRST, then the list.
   *
   * It used to be last. A harness that loops prints hundreds of cases, so "3 of 5
   * passing" was below a screen of them and a student had to scroll to find out how
   * they had done - past the very list they needed the summary to make sense of.
   */
  const headline = total > 0
    ? `${progressBar(report.passed, total)}  ${report.passed} of ${total} checks passing`
    : 'The checks produced no results.';

  const lines: string[] = [
    '',
    '<span class="info">── Check my work ───────────────────────────────────────────</span>',
    `<span class="${report.failed > 0 ? 'warning' : 'success'}">${escapeHtml(headline)}</span>`,
  ];

  /*
   * One thing to do next.
   *
   * A list of four failures is a list; the FIRST one is an instruction. A student who
   * fixes it re-runs and gets the next, which is the loop this feature exists to
   * create - and it is far less discouraging than being handed everything at once.
   */
  if (firstFailure) {
    const detail = firstFailure.detail ? ` — ${firstFailure.detail}` : '';
    lines.push(
      `<span class="info">Start here: </span>` +
      `<span class="error">${escapeHtml(firstFailure.name + detail)}</span>`,
    );
  }

  lines.push('');

  for (const entry of report.cases) {
    const detail = entry.detail ? `  <span class="info">${escapeHtml(entry.detail)}</span>` : '';
    lines.push(
      `<span class="${CLASS[entry.status]}">${GLYPH[entry.status]} ${escapeHtml(entry.name)}</span>${detail}`,
    );
  }

  if (report.truncated) {
    lines.push('<span class="info">… more checks ran than are listed here.</span>');
  }

  lines.push('', `<span class="info">${escapeHtml(summariseReport(report))}</span>`);
  appendOutputHtml(`${lines.join('\n')}\n`);
}

/**
 * Run the harness and report.
 *
 * The run itself is an ordinary run with a different entry point, so it gets the
 * diagnostics gate, the stream, the console and the error explanations for free - and
 * a harness that crashes is reported the same way any other crashing program is.
 */
export async function runStudentTests(): Promise<void> {
  const found = await locateHarness();

  if (!found || found.kind === 'none') {
    /*
     * Said in the OUTPUT panel, not only the status line.
     *
     * The status line is twelve-pixel grey text beside the app name, and it was the only
     * report this case produced - so running the command looked like pressing a dead
     * button. It is also exactly why the toolbar button was removed: the feature was
     * working and telling nobody.
     */
    setStatus('This task has no checks to run.');
    appendOutputHtml(
      '\n<span class="info">── Check my work ───────────────────────────────────────────</span>\n' +
      '<span class="info">This task has no checks. A teacher adds them by including a ' +
      'marking file (one whose name starts with X_HIDDEN_) in the project.</span>\n',
    );
    return;
  }

  if (found.kind === 'ambiguous') {
    /*
     * Refused rather than resolved by picking one. Two harnesses is a mistake in the
     * TASK, and marking a student against an arbitrary one of them - differently
     * depending on file order - is worse than saying so.
     */
    setStatus('This task has more than one marking harness, so none was run.');
    appendOutputHtml(
      `\n<span class="error">More than one marking harness was found:</span>\n`
      + found.paths.map(path => `<span class="error">  ${escapeHtml(path)}</span>`).join('\n')
      + `\n<span class="info">A task must have exactly one.</span>\n`,
    );
    return;
  }

  const editor = runtime.editor;
  const result = await runCode(editor?.getValue() ?? '', { entryPointOverride: found.path });
  if (!result) return;

  const report = parseTestReport(result.stdout);

  if (!report.present) {
    /*
     * The harness ran and said nothing. Usually it crashed - in which case the run's
     * own error output and explanation are already on screen above this, and adding
     * "0 of 0 passed" would be both wrong and confusing.
     */
    setStatus('The checks did not run.');
    announce('The marking harness produced no results.');
    return;
  }

  renderReport(report);

  const summary = summariseReport(report);
  setStatus(
    report.failed === 0 && report.done
      ? `All ${report.passed} checks passed ✅`
      : `${report.passed} of ${report.cases.length} checks passed`,
  );
  // Said once. The panel is not a live region, for the same reason it is not one for
  // ordinary output: a hundred lines would be read aloud.
  announce(summary);
}
