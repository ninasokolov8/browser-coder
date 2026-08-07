/**
 * The check-my-work protocol: `BCTEST` lines on stdout.
 *
 * A teacher ships a marking harness beside the task (an `X_HIDDEN_` file, so the
 * student cannot open it), the student presses "Check my work", and the IDE reports
 * pass or fail PER CASE instead of dumping the harness's output.
 *
 * ## Why a printed line and not a test framework
 *
 * Because a framework cannot be reached from inside this sandbox, in five of the six
 * languages, and the reasons are structural rather than a matter of effort:
 *
 *   C#      the project sets `<RestoreSources></RestoreSources>` and builds
 *           `--no-restore` - "Restore must never reach the network". xunit is a
 *           NuGet package.
 *   Java    `javac` is invoked directly with a classpath of one directory. There is
 *           no Maven, no Gradle; JUnit is a jar somebody would have to vendor.
 *   PHP     `php -l` then `php`. PHPUnit is a phar to vendor.
 *   JS/TS   there is no `node_modules` in a job and no installer. `node --test`
 *           exists, but it solves one language out of six.
 *   Python  runs `-I -S`, isolated with no site-packages. `unittest` is stdlib and
 *           would work; pytest is not there.
 *
 * So a framework buys Python and JavaScript, and needs four vendored binaries plus
 * four different result formats - JUnit XML, TRX, TAP, unittest text - for the rest.
 * A line of text is something every language can print with the tools it already has,
 * and there is exactly one parser.
 *
 * ## The format
 *
 *     BCTEST plan 3
 *     BCTEST case adds two numbers pass
 *     BCTEST case handles zero fail expected 0 but got 1
 *     BCTEST case negatives skip not written yet
 *     BCTEST done
 *
 * Verb first so a line can be recognised before it is understood, and the status word
 * LAST on a case line so a name may contain spaces without needing quoting - which is
 * the difference between a teacher writing `adds two numbers` and having to remember
 * an escaping rule.
 *
 * ## Pure
 *
 * No DOM, no Monaco, no fetch. Parsing a student-visible result is exactly the kind of
 * thing that should be tested without a browser, and the panel is a separate file.
 */

export type TestStatus = 'pass' | 'fail' | 'skip';

export interface TestCase {
  readonly name: string;
  readonly status: TestStatus;
  /** Whatever the harness said after the status - usually why it failed. */
  readonly detail: string;
}

export interface TestReport {
  /** Did the output contain any BCTEST line at all? */
  readonly present: boolean;
  /** How many cases the harness said it would run, if it said. */
  readonly plan: number | null;
  readonly cases: readonly TestCase[];
  /** Did the harness reach its end, or did the program die partway? */
  readonly done: boolean;
  /** True when more cases were printed than will be shown. */
  readonly truncated: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

/** The marker. Deliberately unlikely to appear in a student's own output. */
export const BCTEST = 'BCTEST';

/**
 * Most cases reported.
 *
 * A harness in a loop can print thousands, and a panel with thousands of rows helps
 * nobody. The count still reflects everything seen, so "12 of 4000 passed" stays true
 * even though only the first few hundred are listed.
 */
const MAX_CASES = 500;
const MAX_NAME_CHARS = 200;
const MAX_DETAIL_CHARS = 500;

const STATUSES: readonly string[] = ['pass', 'fail', 'skip'];

function clamp(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

/**
 * Read every `BCTEST` line out of a program's output.
 *
 * Lenient on purpose. A harness is written by a teacher, not generated, so it will
 * contain typos - and the useful behaviour for a line this does not understand is to
 * ignore it rather than to refuse the whole report. The student still sees the cases
 * that did parse, which is more than they had.
 */
export function parseTestReport(stdout: string): TestReport {
  const cases: TestCase[] = [];
  let plan: number | null = null;
  let done = false;
  let present = false;
  let seen = 0;
  const tally: Record<TestStatus, number> = { pass: 0, fail: 0, skip: 0 };

  for (const rawLine of String(stdout ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith(BCTEST)) continue;

    // `BCTESTING` is not a BCTEST line. The marker has to be a whole word.
    const rest = line.slice(BCTEST.length);
    if (rest !== '' && !/^\s/.test(rest)) continue;

    present = true;
    const body = rest.trim();

    if (body.startsWith('plan')) {
      const count = Number(body.slice(4).trim());
      if (Number.isInteger(count) && count >= 0) plan = count;
      continue;
    }

    if (body === 'done' || body.startsWith('done ')) {
      done = true;
      continue;
    }

    if (!body.startsWith('case')) continue;

    /*
     * `case <name...> <status> [detail...]`
     *
     * The status is found by scanning FORWARD for the first status word, so the name
     * may contain spaces and the detail may contain the word "fail" without either
     * confusing the other. A teacher writing `case handles zero fail expected 0`
     * means the name is "handles zero", not "handles".
     */
    const words = body.slice(4).trim().split(/\s+/).filter(Boolean);
    const at = words.findIndex(word => STATUSES.includes(word.toLowerCase()));
    if (at < 1) continue;

    const status = words[at].toLowerCase() as TestStatus;

    seen += 1;
    /*
     * Tally every case, list only the first MAX_CASES.
     *
     * These have to be counted here rather than over `cases` at the end. A harness that
     * loops - "your sort, on 1000 random arrays" - overruns the display cap, and
     * counting the listed subset would report `failed: 0` for a student whose failures
     * all happened to land past the cap. The IDE would then say "All checks passed"
     * about a run that did not pass, which is the one thing this feature must never do.
     * `truncated` is what tells the student the LIST is short; the verdict is not.
     */
    tally[status] += 1;

    if (cases.length >= MAX_CASES) continue;

    cases.push({
      name: clamp(words.slice(0, at).join(' '), MAX_NAME_CHARS),
      status,
      detail: clamp(words.slice(at + 1).join(' '), MAX_DETAIL_CHARS),
    });
  }

  return {
    present,
    plan,
    cases,
    done,
    truncated: seen > cases.length,
    passed: tally.pass,
    failed: tally.fail,
    skipped: tally.skip,
  };
}

/**
 * The program's output with the protocol lines taken out.
 *
 * A harness usually prints nothing else, but a student's own program under test may
 * print plenty - and that output is theirs and worth keeping. Only the machine lines
 * are removed, because showing them raw is the thing this replaces.
 */
export function stripReportLines(stdout: string): string {
  return String(stdout ?? '')
    .split(/\r?\n/)
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed.startsWith(BCTEST)) return true;
      const rest = trimmed.slice(BCTEST.length);
      return rest !== '' && !/^\s/.test(rest);
    })
    .join('\n');
}

/**
 * One sentence for the status bar and the screen reader.
 *
 * The count is the motivating number - "4 of 5" tells a stuck student they are nearly
 * there, where "failed" tells them nothing - so it leads, and the first failure is
 * named because that is the one they will work on next.
 */
export function summariseReport(report: TestReport): string {
  if (!report.present) {
    return 'The marking harness produced no results. It may have crashed before it ran.';
  }

  // Over everything the harness reported, not over what the list shows. `cases` is
  // capped at MAX_CASES, so on a looping harness this read "598 of 500 checks passed".
  const total = report.passed + report.failed + report.skipped;
  const parts: string[] = [`${report.passed} of ${total} checks passed`];

  if (report.skipped > 0) parts.push(`${report.skipped} skipped`);

  if (!report.done) {
    // The distinction that matters: a harness that died mid-run has not said the
    // remaining cases failed, and reporting them as failures would be a lie.
    parts.push('the harness stopped early, so some checks did not run');
  }

  const firstFailure = report.cases.find(entry => entry.status === 'fail');
  if (firstFailure) {
    parts.push(
      firstFailure.detail
        ? `first failure: ${firstFailure.name} — ${firstFailure.detail}`
        : `first failure: ${firstFailure.name}`,
    );
  } else if (report.failed > 0) {
    // Failures exist but every one of them is past the display cap. Saying nothing
    // here is how "0 of the listed cases failed" became "everything passed".
    parts.push(
      `${report.failed} ${report.failed === 1 ? 'check' : 'checks'} failed further down `
      + 'than the list shows',
    );
  }

  return `${parts.join('. ')}.`;
}
