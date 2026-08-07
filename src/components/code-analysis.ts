import { maskCommentsAndStrings } from '../languages/syntax.ts';

export interface ParsedFunction {
  name: string;
  type: 'function' | 'method' | 'class' | 'arrow';
  line: number;
  params: string;
}

type SupportedLanguage =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'java'
  | 'php'
  | 'csharp';

const CONTROL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'foreach', 'using',
  'lock', 'fixed', 'unsafe', 'return', 'new', 'throw', 'else',
  'do', 'try', 'finally', 'synchronized',
]);

function normalizeLanguage(language: string): SupportedLanguage | null {
  const normalized = language.toLowerCase().trim();

  switch (normalized) {
    case 'js':
    case 'javascript':
      return 'javascript';
    case 'ts':
    case 'typescript':
      return 'typescript';
    case 'py':
    case 'python':
    case 'python3':
      return 'python';
    case 'java':
      return 'java';
    case 'php':
      return 'php';
    case 'cs':
    case 'c#':
    case 'csharp':
      return 'csharp';
    default:
      return null;
  }
}

function addResult(
  results: ParsedFunction[],
  seen: Set<string>,
  value: ParsedFunction,
): void {
  const key = `${value.line}:${value.type}:${value.name}`;
  if (seen.has(key)) return;
  seen.add(key);
  results.push(value);
}

/**
 * REMOVED: a local `maskCommentsAndStrings`, replaced by the shared lexer in
 * `src/languages/syntax.ts`.
 *
 * The ~100-line state machine that used to sit here hardcoded C-like syntax and
 * took no language argument. Python triple-quoted strings were therefore not
 * masked at all: a `def` written inside a docstring was reported as a real
 * function, and the Run panel offered to run it. A second, independently written
 * copy in `go-to-definition.ts` had grown a `#` case that this one never did -
 * duplication diverging exactly where it hurts.
 *
 * One lexer now, keyed by language, with its table typed so a newly registered
 * language cannot be silently forgotten.
 */

function parseJavaScriptFunctions(code: string): ParsedFunction[] {
  const results: ParsedFunction[] = [];
  const seen = new Set<string>();
  const lines = maskCommentsAndStrings('javascript', code).split('\n');
  let classDepth = 0;
  let braceDepth = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    const trimmed = line.trim();

    const classMatch = trimmed.match(
      /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/,
    );
    if (classMatch) {
      addResult(results, seen, {
        name: classMatch[1],
        type: 'class',
        line: lineNumber,
        params: '',
      });
      classDepth = braceDepth + (line.includes('{') ? 1 : 0);
    }

    const functionMatch = trimmed.match(
      /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function(?:\s*\*)?\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/,
    );
    if (functionMatch) {
      addResult(results, seen, {
        name: functionMatch[1],
        type: 'function',
        line: lineNumber,
        params: functionMatch[2].trim(),
      });
    }

    const arrowMatch = trimmed.match(
      /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/,
    );
    if (arrowMatch) {
      addResult(results, seen, {
        name: arrowMatch[1],
        type: 'arrow',
        line: lineNumber,
        params: (arrowMatch[2] ?? arrowMatch[3] ?? '').trim(),
      });
    }

    const objectMethodMatch = trimmed.match(
      /^(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::[^{]+)?\{/,
    );
    if (
      objectMethodMatch &&
      !CONTROL_KEYWORDS.has(objectMethodMatch[1]) &&
      !functionMatch
    ) {
      addResult(results, seen, {
        name: objectMethodMatch[1],
        type: classDepth > 0 && braceDepth >= classDepth ? 'method' : 'method',
        line: lineNumber,
        params: objectMethodMatch[2].trim(),
      });
    }

    for (const char of line) {
      if (char === '{') braceDepth++;
      if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    }

    if (classDepth > 0 && braceDepth < classDepth) {
      classDepth = 0;
    }
  }

  return results.sort((a, b) => a.line - b.line);
}

function parsePythonFunctions(code: string): ParsedFunction[] {
  const results: ParsedFunction[] = [];
  const seen = new Set<string>();
  // Masked, which it never used to be. The `# comment` check below caught line
  // comments, but nothing caught a DOCSTRING - so a `def` written inside a
  // triple-quoted string was reported as a real function, and the Run panel
  // offered to run it. Masking preserves line and column positions, so the
  // indentation arithmetic below is unaffected.
  const lines = maskCommentsAndStrings('python', code).split('\n');
  const classIndents: number[] = [];

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    const lineNumber = index + 1;
    const indent = rawLine.length - rawLine.trimStart().length;

    if (!trimmed || trimmed.startsWith('#')) continue;

    while (
      classIndents.length > 0 &&
      indent <= classIndents[classIndents.length - 1] &&
      !/^class\s+/.test(trimmed)
    ) {
      classIndents.pop();
    }

    const classMatch = trimmed.match(
      /^class\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:/,
    );
    if (classMatch) {
      addResult(results, seen, {
        name: classMatch[1],
        type: 'class',
        line: lineNumber,
        params: '',
      });
      classIndents.push(indent);
      continue;
    }

    const functionMatch = trimmed.match(
      /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\((.*)\)\s*(?:->\s*[^:]+)?\s*:/,
    );
    if (functionMatch) {
      const insideClass = classIndents.some(classIndent => indent > classIndent);
      addResult(results, seen, {
        name: functionMatch[1],
        type: insideClass ? 'method' : 'function',
        line: lineNumber,
        params: functionMatch[2].trim(),
      });
    }
  }

  return results.sort((a, b) => a.line - b.line);
}

function parseJavaFunctions(code: string): ParsedFunction[] {
  const results: ParsedFunction[] = [];
  const seen = new Set<string>();
  const lines = maskCommentsAndStrings('java', code).split('\n');

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    const lineNumber = index + 1;

    const classMatch = trimmed.match(
      /^(?:(?:public|protected|private|abstract|final|static|sealed|non-sealed)\s+)*(?:class|interface|record|enum)\s+([A-Za-z_$][\w$]*)\b/,
    );
    if (classMatch) {
      addResult(results, seen, {
        name: classMatch[1],
        type: 'class',
        line: lineNumber,
        params: '',
      });
      continue;
    }

    const methodMatch = trimmed.match(
      /^(?:(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp)\s+)*(?:<[^>]+>\s+)?(?:[\w$.[\]<>?,]+\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?:throws\s+[^{;]+)?(?:\{|;|$)/,
    );
    if (methodMatch && !CONTROL_KEYWORDS.has(methodMatch[1])) {
      addResult(results, seen, {
        name: methodMatch[1],
        type: 'method',
        line: lineNumber,
        params: methodMatch[2].trim(),
      });
    }
  }

  return results.sort((a, b) => a.line - b.line);
}

function parsePHPFunctions(code: string): ParsedFunction[] {
  const results: ParsedFunction[] = [];
  const seen = new Set<string>();
  const lines = maskCommentsAndStrings('php', code).split('\n');

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    const lineNumber = index + 1;

    const classMatch = trimmed.match(
      /^(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)\b/i,
    );
    if (classMatch) {
      addResult(results, seen, {
        name: classMatch[1],
        type: 'class',
        line: lineNumber,
        params: '',
      });
      continue;
    }

    const functionMatch = trimmed.match(
      /^(?:(?:public|protected|private|static|abstract|final|readonly)\s+)*function\s*&?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/i,
    );
    if (functionMatch) {
      addResult(results, seen, {
        name: functionMatch[1],
        type: 'function',
        line: lineNumber,
        params: functionMatch[2].trim(),
      });
    }
  }

  return results.sort((a, b) => a.line - b.line);
}

function parseCSharpFunctions(code: string): ParsedFunction[] {
  const results: ParsedFunction[] = [];
  const seen = new Set<string>();
  const lines = maskCommentsAndStrings('csharp', code).split('\n');

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    const lineNumber = index + 1;

    const classMatch = trimmed.match(
      /^(?:(?:public|protected|private|internal|abstract|sealed|static|partial|readonly|ref)\s+)*(?:class|record(?:\s+class|\s+struct)?|struct|interface|enum)\s+([A-Za-z_]\w*)\b/,
    );
    if (classMatch) {
      addResult(results, seen, {
        name: classMatch[1],
        type: 'class',
        line: lineNumber,
        params: '',
      });
      continue;
    }

    const methodMatch = trimmed.match(
      /^(?:(?:public|protected|private|internal|static|virtual|override|sealed|async|partial|extern|unsafe|new|abstract)\s+)*(?:[\w.[\]<>?,]+\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:where\s+[^{=>]+)?(?:\{|=>|;|$)/,
    );
    if (methodMatch && !CONTROL_KEYWORDS.has(methodMatch[1])) {
      addResult(results, seen, {
        name: methodMatch[1],
        type: 'method',
        line: lineNumber,
        params: methodMatch[2].trim(),
      });
    }
  }

  return results.sort((a, b) => a.line - b.line);
}

export function parseFunctions(
  code: string,
  language: string,
): ParsedFunction[] {
  switch (normalizeLanguage(language)) {
    case 'javascript':
    case 'typescript':
      return parseJavaScriptFunctions(code);
    case 'python':
      return parsePythonFunctions(code);
    case 'java':
      return parseJavaFunctions(code);
    case 'php':
      return parsePHPFunctions(code);
    case 'csharp':
      return parseCSharpFunctions(code);
    default:
      return [];
  }
}

interface DefinitionRange {
  start: number;
  end: number;
}

function findBraceDefinitionEnd(
  maskedLines: string[],
  startLine: number,
): number {
  let braceDepth = 0;
  let sawOpeningBrace = false;

  for (let index = startLine; index < maskedLines.length; index++) {
    for (const char of maskedLines[index]) {
      if (char === '{') {
        braceDepth++;
        sawOpeningBrace = true;
      } else if (char === '}') {
        braceDepth--;
      }
    }

    if (sawOpeningBrace && braceDepth <= 0) {
      return index;
    }

    // Expression-bodied declarations and one-line arrow functions.
    if (!sawOpeningBrace && /;\s*$/.test(maskedLines[index])) {
      return index;
    }
  }

  return maskedLines.length - 1;
}

function mergeDefinitionRanges(ranges: DefinitionRange[]): DefinitionRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: DefinitionRange[] = [{ ...sorted[0] }];

  for (const range of sorted.slice(1)) {
    const previous = merged[merged.length - 1];

    if (range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
}

function extractPythonDefinitions(code: string): string {
  const lines = code.split('\n');
  const ranges: DefinitionRange[] = [];

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    const indent = rawLine.length - rawLine.trimStart().length;

    if (!/^(?:async\s+def|def|class)\s+[A-Za-z_]\w*/.test(trimmed)) {
      continue;
    }

    // Only extract top-level declarations. Nested methods/functions are already
    // included when their containing class/function range is copied.
    if (indent !== 0) continue;

    let end = lines.length - 1;
    for (let next = index + 1; next < lines.length; next++) {
      const nextTrimmed = lines[next].trim();
      if (!nextTrimmed || nextTrimmed.startsWith('#')) continue;

      const nextIndent =
        lines[next].length - lines[next].trimStart().length;
      if (nextIndent <= indent) {
        end = next - 1;
        break;
      }
    }

    ranges.push({ start: index, end });
    index = end;
  }

  return ranges
    .map(range => lines.slice(range.start, range.end + 1).join('\n').trimEnd())
    .filter(Boolean)
    .join('\n\n');
}

function extractBraceLanguageDefinitions(
  code: string,
  language: SupportedLanguage,
): string {
  const lines = code.split('\n');
  const maskedLines = maskCommentsAndStrings(language, code).split('\n');
  const ranges: DefinitionRange[] = [];

  const declarationPattern =
    language === 'php'
      ? /^(?:(?:abstract|final|readonly|public|protected|private|static)\s+)*(?:class|interface|trait|enum|function)\b/i
      : language === 'java'
        ? /^(?:(?:public|protected|private|abstract|final|static|sealed|non-sealed)\s+)*(?:class|interface|record|enum)\b/
        : language === 'csharp'
          ? /^(?:(?:public|protected|private|internal|abstract|sealed|static|partial|readonly|ref)\s+)*(?:class|record|struct|interface|enum)\b/
          : /^(?:export\s+(?:default\s+)?)?(?:(?:abstract|async)\s+)*(?:class\b|function\b|(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/;

  for (let index = 0; index < maskedLines.length; index++) {
    const trimmed = maskedLines[index].trim();

    if (!declarationPattern.test(trimmed)) continue;

    const end = findBraceDefinitionEnd(maskedLines, index);
    ranges.push({ start: index, end });
    index = end;
  }

  const extracted = mergeDefinitionRanges(ranges)
    .map(range => lines.slice(range.start, range.end + 1).join('\n').trimEnd())
    .filter(Boolean)
    .join('\n\n');

  if (language !== 'php' || !extracted) return extracted;

  const openingTag = lines.find(line => /^\s*<\?(?:php)?\b/i.test(line));
  return openingTag ? `${openingTag.trim()}\n${extracted}` : extracted;
}

/**
 * Extracts top-level function/class definitions while omitting top-level
 * execution statements. For Java and C#, classes are extracted as complete
 * units because methods cannot execute independently outside their type.
 */
export function extractDefinitionsOnly(
  code: string,
  language: string,
): string {
  const normalized = normalizeLanguage(language);

  if (!normalized) return '';

  if (normalized === 'python') {
    return extractPythonDefinitions(code);
  }

  return extractBraceLanguageDefinitions(code, normalized);
}
