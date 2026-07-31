/**
 * The breadcrumb symbol heuristic.
 *
 * Split from breadcrumbs.ts for one reason: that module imports Monaco, and a
 * module that imports Monaco cannot be loaded by node - so anything living there
 * is untestable without a browser. This half is pure, and the unit tests import it
 * directly. Same split as format-core.ts / formatting.ts.
 */

/**
 * A fallback symbol spine for languages with no document-symbol provider.
 *
 * Deliberately crude: it matches a declaration keyword at the start of a line and
 * uses indentation to decide nesting. That is enough for the common shapes
 * (a method inside a class, a function at top level) and it is honest about being
 * a heuristic - it never claims a symbol it did not see the declaration for.
 *
 * Exported for testing: it is pure.
 */
export function heuristicSpine(
  languageId: string,
  lines: readonly string[],
  cursorLine: number,
): Array<{ name: string; line: number }> {
  const patterns: Record<string, RegExp> = {
    python: /^(\s*)(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/,
    javascript: /^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>))/,
    typescript: /^(\s*)(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?\s+([A-Za-z_$][\w$]*)|(?:class|interface|enum|type)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=])/,
    java: /^(\s*)(?:(?:public|private|protected|static|final|abstract|synchronized|native)\s+)*(?:class|interface|enum|record|[\w<>[\],\s]+?)\s+([A-Za-z_]\w*)\s*(?:\(|\{|extends|implements)/,
    csharp: /^(\s*)(?:(?:public|private|protected|internal|static|sealed|abstract|virtual|override|async|partial)\s+)*(?:class|interface|struct|enum|record|[\w<>[\],\s]+?)\s+([A-Za-z_]\w*)\s*(?:\(|\{|:)/,
    php: /^(\s*)(?:(?:public|private|protected|static|abstract|final)\s+)*(?:function|class|interface|trait)\s+([A-Za-z_]\w*)/,
  };

  const pattern = patterns[languageId];
  if (!pattern) return [];

  const spine: Array<{ name: string; line: number; indent: number }> = [];

  for (let index = 0; index < cursorLine && index < lines.length; index += 1) {
    const match = pattern.exec(lines[index]);
    if (!match) continue;

    const indent = match[1].length;
    // Group 1 is always the indentation; the name is whichever of the remaining
    // alternatives matched. JavaScript and TypeScript need several - `function f`,
    // `class C` and `const f = () =>` are different shapes of the same thing - so
    // taking match[2] unconditionally would return undefined for two of the three.
    const name = match.slice(2).find(group => group !== undefined);
    if (!name) continue;

    // A declaration at the same or shallower indentation closes everything at or
    // below it: that is the only nesting signal available without parsing.
    while (spine.length > 0 && spine[spine.length - 1].indent >= indent) spine.pop();
    spine.push({ name, line: index + 1, indent });
  }

  return spine.map(entry => ({ name: entry.name, line: entry.line }));
}
