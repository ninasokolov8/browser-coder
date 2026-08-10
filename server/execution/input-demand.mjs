/**
 * Decide whether a program can ask the student for terminal input.
 *
 * The process runner deliberately keeps stdin open for every interactive session.
 * This module has one narrower job: it prevents the console from displaying an
 * input box just because a running or paused program has been quiet for a moment.
 */

const INPUT_PATTERNS = Object.freeze({
  python: [
    /\binput\s*\(/,
    /\bsys\s*\.\s*stdin\b/,
    /\bstdin\s*\.\s*(?:read|readline|readlines)\s*\(/,
  ],
  javascript: [
    /\bprocess\s*\.\s*stdin\b/,
    /\breadline\s*\.\s*(?:createInterface|question)\s*\(/,
    /\bprompt\s*\(/,
  ],
  typescript: [
    /\bprocess\s*\.\s*stdin\b/,
    /\breadline\s*\.\s*(?:createInterface|question)\s*\(/,
    /\bprompt\s*\(/,
  ],
  php: [
    /\bSTDIN\b/,
    /\breadline\s*\(/i,
  ],
  java: [
    /\bSystem\s*\.\s*in\b/,
    /\bnew\s+Scanner\s*\(/,
  ],
  csharp: [
    /\bConsole\s*\.\s*(?:Read|ReadLine|In)\b/,
  ],
});

/** Replace comments and string contents with spaces while retaining line layout. */
export function executableText(source, language) {
  const text = String(source ?? '');
  const hashComments = language === 'python' || language === 'php';
  const tripleQuotes = language === 'python';
  let result = '';
  let index = 0;
  let state = 'code';
  let quote = '';

  const blank = character => character === '\n' || character === '\r' ? character : ' ';

  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1] ?? '';

    if (state === 'line-comment') {
      result += blank(character);
      index += 1;
      if (character === '\n') state = 'code';
      continue;
    }

    if (state === 'block-comment') {
      result += blank(character);
      if (character === '*' && next === '/') {
        result += ' ';
        index += 2;
        state = 'code';
      } else {
        index += 1;
      }
      continue;
    }

    if (state === 'string') {
      result += blank(character);
      if (character === '\\') {
        if (index + 1 < text.length) result += blank(text[index + 1]);
        index += 2;
      } else if (text.startsWith(quote, index)) {
        for (let offset = 1; offset < quote.length; offset += 1) result += ' ';
        index += quote.length;
        state = 'code';
        quote = '';
      } else {
        index += 1;
      }
      continue;
    }

    if (hashComments && character === '#') {
      result += ' ';
      index += 1;
      state = 'line-comment';
      continue;
    }
    if (character === '/' && next === '/') {
      result += '  ';
      index += 2;
      state = 'line-comment';
      continue;
    }
    if (character === '/' && next === '*') {
      result += '  ';
      index += 2;
      state = 'block-comment';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = tripleQuotes && (character === "'" || character === '"')
        && text.slice(index, index + 3) === character.repeat(3)
        ? character.repeat(3)
        : character;
      result += ' '.repeat(quote.length);
      index += quote.length;
      state = 'string';
      continue;
    }

    result += character;
    index += 1;
  }

  return result;
}

/** True only when executable source contains a terminal-input API for its language. */
export function programMayRequestInput({ language, code, files } = {}) {
  const patterns = INPUT_PATTERNS[String(language ?? '').toLowerCase()];
  if (!patterns) return false;

  const sources = [];
  if (typeof code === 'string') sources.push(code);
  for (const file of Array.isArray(files) ? files : []) {
    if (typeof file?.content === 'string' && file.type !== 'asset') sources.push(file.content);
  }

  return sources.some(source => {
    const executable = executableText(source, String(language ?? '').toLowerCase());
    return patterns.some(pattern => pattern.test(executable));
  });
}
