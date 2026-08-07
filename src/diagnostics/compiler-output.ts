/**
 * Turn compiler and runtime output into structured diagnostics.
 *
 * For four of six languages the editor knew nothing the compiler knew. A javac
 * error, a Python traceback, a PHP parse error and a C# build failure were all
 * rendered as a paragraph of text in the output panel: no squiggle, no line
 * marker, no Problems entry, nothing to click. `setModelMarkers` was called
 * nowhere in the codebase.
 *
 * These parsers are the missing half. Each pattern below was taken from output
 * captured from the ACTUAL production image rather than from documentation or
 * memory - the fixtures in tests/unit/compiler-output.test.ts are those exact
 * strings, because a parser written against a guessed format is a parser that
 * silently matches nothing.
 *
 * Pure: no DOM, no Monaco. The mapping to markers happens in server-source.ts.
 */

import type { DiagnosticSeverity } from './store.ts';

export interface ParsedDiagnostic {
  /** File as the tool reported it, e.g. `main.py`. Resolved to a document later. */
  readonly file: string;
  /** 1-based. */
  readonly line: number;
  /** 1-based when the tool gives one. */
  readonly column?: number;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
}

/** Frames inside the runtime's own machinery, which are never the student's bug. */
const INTERNAL_FRAME = /^\s*at\s+(?:node:|async\s+node:|ModuleJob|ModuleLoader|asyncRunEntryPoint)/;

/**
 * Python: `  File "main.py", line 2` then a caret line, then `NameError: …`.
 *
 * A traceback lists frames outermost-first, so the LAST frame that names a
 * workspace file is where the student's problem is - the earlier ones are the
 * call path that got there.
 */
function parsePython(text: string): ParsedDiagnostic[] {
  const frames = [...text.matchAll(/^\s*File "([^"]+)", line (\d+)/gm)];
  if (frames.length === 0) return [];

  const last = frames[frames.length - 1];
  const file = last[1];
  const line = Number.parseInt(last[2], 10);

  // The message is the final non-empty line: `NameError: name 'y' is not defined`.
  const lines = text.split('\n').map(part => part.trimEnd()).filter(part => part.trim() !== '');
  const message = lines[lines.length - 1]?.trim() ?? 'Error';

  // The caret line locates the column. Its indentation is measured against the
  // source line above it, which Python indents by four spaces.
  let column: number | undefined;
  const caretIndex = lines.findIndex(part => /^\s*\^+\s*$/.test(part));
  if (caretIndex > 0) {
    const caretOffset = lines[caretIndex].indexOf('^');
    const sourceIndent = lines[caretIndex - 1].length - lines[caretIndex - 1].trimStart().length;
    const relative = caretOffset - sourceIndent;
    if (relative >= 0) column = relative + 1;
  }

  return [{ file, line, column, severity: 'error', message }];
}

/** javac: `Main.java:1: error: illegal start of expression` */
function parseJava(text: string): ParsedDiagnostic[] {
  const results: ParsedDiagnostic[] = [];
  for (const match of text.matchAll(/^(\S+\.java):(\d+):\s*(error|warning):\s*(.*)$/gm)) {
    results.push({
      file: match[1],
      line: Number.parseInt(match[2], 10),
      severity: match[3] === 'warning' ? 'warning' : 'error',
      message: match[4].trim(),
    });
  }
  return results;
}

/** dotnet: `Program.cs(1,9): error CS1525: Invalid expression term ';'` */
function parseCSharp(text: string): ParsedDiagnostic[] {
  const results: ParsedDiagnostic[] = [];
  for (const match of text.matchAll(
    /^(\S+\.cs)\((\d+),(\d+)\):\s*(error|warning)\s+([A-Z]+\d+):\s*(.*)$/gm,
  )) {
    results.push({
      file: match[1],
      line: Number.parseInt(match[2], 10),
      column: Number.parseInt(match[3], 10),
      severity: match[4] === 'warning' ? 'warning' : 'error',
      // The code is kept in the message: CS1525 is searchable and students do.
      message: `${match[5]}: ${match[6].trim()}`,
    });
  }
  return results;
}

/** PHP: `PHP Parse error:  syntax error, … in main.php on line 3` */
function parsePhp(text: string): ParsedDiagnostic[] {
  const results: ParsedDiagnostic[] = [];
  for (const match of text.matchAll(
    /^(?:PHP\s+)?(Parse error|Fatal error|Warning|Notice|Deprecated):\s*(.*?)\s+in\s+(\S+)\s+on line\s+(\d+)/gim,
  )) {
    const kind = match[1].toLowerCase();
    results.push({
      file: match[3],
      line: Number.parseInt(match[4], 10),
      severity: kind === 'warning' || kind === 'notice' || kind === 'deprecated' ? 'warning' : 'error',
      message: `${match[1]}: ${match[2].trim()}`,
    });
  }
  return results;
}

/**
 * Node: a header line naming the file, then the error, then `at` frames.
 *
 *     file://main.mjs:2
 *     nope();
 *     ^
 *
 *     ReferenceError: nope is not defined
 *         at file://main.mjs:2:1
 *
 * The `at` frame carries the column, so it is preferred when it points at the
 * same file. Internal node frames are skipped - they are never the student's bug.
 */
function parseJavaScript(text: string): ParsedDiagnostic[] {
  const header = text.match(/^(?:file:\/\/)?(\S+\.[cm]?[jt]s):(\d+)$/m);
  const message = text.match(/^([A-Z]\w*(?:Error|Exception)):\s*(.*)$/m);

  let file: string | undefined;
  let line: number | undefined;
  let column: number | undefined;

  if (header) {
    file = header[1];
    line = Number.parseInt(header[2], 10);
  }

  for (const frame of text.matchAll(/^\s*at\s+(?:.*?\()?(?:file:\/\/)?(\S+?\.[cm]?[jt]s):(\d+):(\d+)\)?$/gm)) {
    if (INTERNAL_FRAME.test(frame[0])) continue;
    file ??= frame[1];
    line ??= Number.parseInt(frame[2], 10);
    if (frame[1] === file) {
      column = Number.parseInt(frame[3], 10);
      break;
    }
  }

  if (!file || !line) return [];

  return [{
    file,
    line,
    column,
    severity: 'error',
    message: message ? `${message[1]}: ${message[2].trim()}` : text.split('\n')[0].trim(),
  }];
}

/** tsc: `main.ts:1:7 - error TS2322: Type 'string' is not assignable…` */
function parseTypeScript(text: string): ParsedDiagnostic[] {
  const results: ParsedDiagnostic[] = [];
  for (const match of text.matchAll(
    /^(\S+\.tsx?):(\d+):(\d+)\s*-\s*(error|warning)\s+(TS\d+):\s*(.*)$/gm,
  )) {
    results.push({
      file: match[1],
      line: Number.parseInt(match[2], 10),
      column: Number.parseInt(match[3], 10),
      severity: match[4] === 'warning' ? 'warning' : 'error',
      message: `${match[5]}: ${match[6].trim()}`,
    });
  }
  return results;
}

const PARSERS: Record<string, (text: string) => ParsedDiagnostic[]> = {
  python: parsePython,
  java: parseJava,
  csharp: parseCSharp,
  php: parsePhp,
  javascript: parseJavaScript,
  typescript: parseTypeScript,
};

/**
 * Parse whatever a run produced into diagnostics.
 *
 * Returns an empty array rather than guessing when nothing matches. A wrong line
 * number is worse than no marker: it sends the student to correct code.
 */
export function parseCompilerOutput(languageId: string, text: string): ParsedDiagnostic[] {
  if (!text || !text.trim()) return [];
  const parser = PARSERS[languageId];
  if (!parser) return [];

  try {
    return parser(text).filter(
      diagnostic =>
        Number.isFinite(diagnostic.line) &&
        diagnostic.line > 0 &&
        diagnostic.message.trim() !== '',
    );
  } catch {
    // A parser must never be able to break a run's reporting.
    return [];
  }
}
