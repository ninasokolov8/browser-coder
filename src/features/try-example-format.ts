/**
 * Turning a hover's example into a program that runs.
 *
 * Pure and separate from try-example.ts because that module reaches the language
 * registry, and `../languages` is a DIRECTORY import - Vite resolves it and node's ESM
 * loader does not, so anything importing it cannot be tested here. The rules about what
 * a runnable program looks like per language are exactly the part worth testing, so
 * they live where tests can reach them.
 *
 * Every example in the content files is written as a SNIPPET, because that is what
 * reads well in a tooltip. Python, JavaScript, TypeScript and PHP run one as written.
 * Java and C# will not execute a statement that is not inside a method inside a type,
 * so for them "try this" means generating a whole program - and getting that wrong is
 * not cosmetic: the file fails to compile and the IDE has taught the student that its
 * own documentation is broken.
 */

/** Command id used by the hover's markdown link. */
export const TRY_EXAMPLE_COMMAND = 'browserCoder.tryExample';

/**
 * Wrap a bare example so it is a runnable program in this language.
 *
 * Only Java and C# need it: both refuse to execute a statement that is not inside a
 * method inside a type. Everything else runs a snippet as written, which is why the
 * examples are written as snippets in the first place.
 */
export function asRunnableProgram(languageId: string, example: string, className: string): string {
  const body = example.trimEnd();

  if (languageId === 'java') {
    const indented = body.split('\n').map(line => `        ${line}`).join('\n');
    return [
      `// Try it: change anything here and press Run.`,
      `public class ${className} {`,
      `    public static void main(String[] args) {`,
      indented,
      `    }`,
      `}`,
      '',
    ].join('\n');
  }

  if (languageId === 'csharp') {
    const indented = body.split('\n').map(line => `        ${line}`).join('\n');
    return [
      `// Try it: change anything here and press Run.`,
      `using System;`,
      ``,
      `class ${className} {`,
      `    static void Main() {`,
      indented,
      `    }`,
      `}`,
      '',
    ].join('\n');
  }

  const comment = languageId === 'python' ? '#' : '//';
  const prefix = languageId === 'php' && !body.trimStart().startsWith('<?php')
    ? '<?php\n'
    : '';

  return `${prefix}${comment} Try it: change anything here and press Run.\n${body}\n`;
}

/** The scratch file's name for a language. Stable, so the same file is reused. */
export function scratchFileName(languageId: string, extension: string): string {
  // Java insists the public class and the file share a name, so the file is named for
  // the class the wrapper generates rather than the other way round.
  if (languageId === 'java') return `TryIt.${extension}`;
  if (languageId === 'csharp') return `TryIt.${extension}`;
  return `try-it.${extension}`;
}

/** The markdown link, built here so no content-file text reaches a trusted string. */
export function tryExampleLink(languageId: string, word: string, label: string): string {
  /*
   * Parentheses are escaped by hand, because `encodeURIComponent` does not.
   *
   * Its unreserved set includes `( )` - along with `! ~ * '` - so a word containing a
   * bracket would survive into the link TARGET and close `[label](…)` early, spilling
   * the rest into the document. This is the one `isTrusted: true` string in the hover,
   * so it is the one place that matters.
   *
   * The words come from curated content files rather than from a student, so this is
   * defence in depth rather than a live hole - but the alternative is a rule that holds
   * only as long as nobody adds an entry with a bracket in it.
   */
  const args = encodeURIComponent(JSON.stringify([languageId, word]))
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');

  return `[$(play) ${label}](command:${TRY_EXAMPLE_COMMAND}?${args})`;
}
