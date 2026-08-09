/**
 * Turning one curated explanation into the Markdown a hover shows.
 *
 * Split from `hover-help.ts` because that module imports Monaco and the language
 * loader - which uses Vite's `import.meta.glob` - so neither can be loaded by node.
 * The rendering decisions are where this can be silently wrong, so they live here and
 * are tested directly. Same split as `format-core` / `formatting` and
 * `breadcrumb-symbols` / `breadcrumbs`.
 */

/** The shape `getKeywordExplanation` returns. Restated so this module imports nothing. */
export interface HoverEntry {
  readonly explanation: string;
  readonly example?: string;
  readonly type?: string;
  /** True when `explanation` is the Hebrew translation. */
  readonly rtl?: boolean;
}

/** A short label for the kind of thing this is, shown after the name. */
const TYPE_LABELS: Record<string, string> = {
  core: 'built-in',
  builtin: 'built-in',
  keyword: 'keyword',
  control_flow: 'control flow',
  access_modifier: 'access modifier',
  operator: 'operator',
  type: 'type',
  function: 'function',
  method: 'method',
  statement: 'statement',
  declaration: 'declaration',
  module: 'module',
  exception: 'exception',
  // The drawing library, which is most of what a beginner's Python actually calls.
  // Labelled so a student can tell `forward` from a language keyword at a glance.
  turtle: 'turtle drawing',
};

const TYPE_LABELS_HE: Record<string, string> = {
  core: 'מובנה', builtin: 'מובנה', keyword: 'מילת מפתח',
  control_flow: 'בקרת זרימה', access_modifier: 'מגדיר גישה',
  operator: 'אופרטור', type: 'טיפוס', function: 'פונקציה', method: 'מתודה',
  statement: 'פקודה', declaration: 'הצהרה', module: 'מודול',
  exception: 'חריגה', turtle: 'ציור בצב',
};

/**
 * Escape the characters Markdown would otherwise interpret.
 *
 * Not a security boundary - the explanations are curated data in this repo - but a
 * correctness one, and it matters more than it sounds. An explanation mentioning
 * `*args` opens an italic run that swallows the rest of the sentence, and `__init__`
 * renders as bold "init" - destroying the exact identifier a beginner is trying to
 * learn. The terms most in need of escaping are the ones most worth teaching.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|<>~])/g, '\\$1');
}

/** Human-readable form of an entry's `type`. */
export function typeLabel(type: string | undefined, rtl = false): string | null {
  if (!type) return null;
  return (rtl ? TYPE_LABELS_HE[type] : TYPE_LABELS[type]) ?? type.replace(/_/g, ' ');
}

/**
 * The hover body for one word.
 *
 * The example is placed in a fenced block and deliberately NOT escaped: a fence is
 * already literal, so escaping would show the student backslashes through their own
 * code.
 */
export function renderHover(languageId: string, word: string, entry: HoverEntry): string {
  const label = typeLabel(entry.type, entry.rtl === true);
  const lines: string[] = [];

  lines.push(
    label
      ? `**\u2066${escapeMarkdown(word)}\u2069** · *${entry.rtl ? '\u2067' : '\u2066'}${escapeMarkdown(label)}\u2069*`
      : `**${escapeMarkdown(word)}**`,
  );
  lines.push('');

  lines.push(
    entry.rtl
      ? `\u2067${escapeMarkdown(entry.explanation)}\u2069`
      : escapeMarkdown(entry.explanation),
  );

  if (entry.example) {
    lines.push('');
    lines.push(`\`\`\`${languageId}`);
    lines.push(entry.example);
    lines.push('```');
  }

  return lines.join('\n');
}
