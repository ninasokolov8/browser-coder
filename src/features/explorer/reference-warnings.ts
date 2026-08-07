/**
 * Warnings for files whose references could not be rewritten automatically.
 *
 * `import-refactor.ts` rewrites imports for javascript, typescript, python, php,
 * java, csharp, html and css. Three of the IDE's eleven languages - `svg`, `json`
 * and `markdown` - have no rewriter, and `detectImportLanguage` returns `unknown`
 * for them. The `default:` branch then returned zero replacements and, critically,
 * **no warning**.
 *
 * So a student who moved `maze.svg` saw "Renamed file; updated 3 imports", believed
 * the move was clean, and was left with a broken `![maze](maze.svg)` in their notes,
 * a dead `<image href>` in an SVG, or a stale path in a JSON config. Silence read as
 * success.
 *
 * The rule here is deliberately narrow. Warning about every unhandled file on every
 * move produces noise on moves that changed nothing relevant, and a warning a
 * student learns to ignore is worse than none. A warning is raised only when the
 * file's text actually contains the name of something that moved.
 *
 * Split into its own module because `import-refactor.ts` imports `runtime` and so
 * cannot be loaded by node - anything left in there is untestable without a browser.
 * Pure: no DOM, no runtime, no storage.
 */

/** A file that moved: where it was, and what it is called now. */
export interface MovedFile {
  readonly oldPath: string;
  readonly newPath: string;
}

/**
 * Basenames of the files that moved.
 *
 * Basenames rather than full paths, because a Markdown link, an SVG `href` or a JSON
 * value is usually relative and would not contain the workspace path. A basename is
 * the part that appears either way.
 */
export function movedBasenames(moved: readonly MovedFile[]): Set<string> {
  const names = new Set<string>();
  for (const file of moved) {
    if (file.oldPath === file.newPath) continue;
    const base = file.oldPath.split('/').pop();
    // Only names distinctive enough to be worth matching. A one-character name
    // would appear in almost any file by chance.
    if (base && base.length > 1) names.add(base);
  }
  return names;
}

/**
 * Warnings for one file whose language has no rewriter.
 *
 * Returns an empty array when the file mentions nothing that moved, which is the
 * common case and must stay quiet.
 */
export function warningsForUnhandledFile(
  filePath: string,
  content: string,
  languageLabel: string,
  moved: ReadonlySet<string>,
): string[] {
  const warnings: string[] = [];

  for (const name of moved) {
    // The file's own name moving is not a reference to itself.
    if (filePath.endsWith(`/${name}`) || filePath === name) continue;
    if (!content.includes(name)) continue;

    warnings.push(
      `${filePath} mentions "${name}" but was not updated automatically - ` +
      `Browser Coder does not rewrite references in ${languageLabel} yet. ` +
      `Check it by hand.`,
    );
  }

  return warnings;
}
