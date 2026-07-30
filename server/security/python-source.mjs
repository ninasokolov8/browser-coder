/**
 * Blank out Python comments and string literals before policy scanning.
 *
 * MOVED VERBATIM from server.mjs (lines 545-622 of the pre-refactor file).
 *
 * Why this exists: without it, a blocked word appearing in a comment, a
 * docstring, a printed message or a filename would refuse a legitimate program.
 * f-string replacement fields are deliberately NOT blanked, because they hold
 * real expressions and code hidden in one must stay visible to the scanner.
 */

/**
 * Return `code` with every comment and string literal blanked out, keeping all
 * other characters and every newline in place.
 *
 * Python security scanning runs on the result, so a blocked word in a comment, a
 * docstring, a printed message or an SVG file name can never be the reason a
 * program is refused - only real code is inspected.
 *
 * f-string replacement fields are deliberately NOT blanked: they hold real
 * expressions, so code hidden in one must stay visible to the scanner.
 */
function stripPythonCommentsAndStrings(code) {
  const src = String(code);
  let out = '';
  let i = 0;

  // Keep newlines so reported line numbers still line up with the source.
  const blank = (ch) => { out += ch === '\n' ? '\n' : ' '; };

  while (i < src.length) {
    const ch = src[i];

    // ── Comment: blank out the rest of the line ──────────────────────────
    if (ch === '#') {
      while (i < src.length && src[i] !== '\n') blank(src[i++]);
      continue;
    }

    // ── String literal, with any prefix (r, b, u, f, rb, …) ──────────────
    const opener = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 5));
    const atTokenStart = i === 0 || !/[A-Za-z0-9_]/.test(src[i - 1]);
    if (opener && (opener[1].length === 0 || atTokenStart)) {
      const prefix = opener[1];
      const quote = opener[2];
      const isFString = /[fF]/.test(prefix);

      for (const c of prefix + quote) blank(c);
      i += prefix.length + quote.length;

      while (i < src.length) {
        // A backslash escapes the next character - in raw strings too, as far
        // as finding the end of the literal goes.
        if (src[i] === '\\' && i + 1 < src.length) {
          blank(src[i]); blank(src[i + 1]);
          i += 2;
          continue;
        }
        if (src.startsWith(quote, i)) {
          for (const c of quote) blank(c);
          i += quote.length;
          break;
        }
        // f-string replacement field: {...} is code, not text. Keep it verbatim
        // and blank only the literal text around it.
        if (isFString && src[i] === '{') {
          if (src[i + 1] === '{') { blank(src[i]); blank(src[i + 1]); i += 2; continue; }
          let depth = 0;
          while (i < src.length) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            out += src[i];
            i++;
            if (depth === 0) break;
          }
          continue;
        }
        blank(src[i]);
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

export { stripPythonCommentsAndStrings };
