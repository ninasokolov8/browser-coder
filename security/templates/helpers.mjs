/**
 * HTML Report Template Helpers
 * Utility functions for generating report components
 */

// Escape HTML entities
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Some translated report strings include programming generics as plain text
// (Span<T>, Memory<T>, Dictionary<string, object>, etc.). In HTML those angle
// brackets must be escaped, but real HTML tags like <code> must stay intact.
function escapeGenericAngleBrackets(html) {
  if (!html) return '';
  return String(html).replace(
    /\b([A-Za-z_$][\w.$]*)<\s*([A-Za-z_$][\w.$]*(?:\s*,\s*[A-Za-z_$][\w.$]*)*)\s*>/g,
    '$1&lt;$2&gt;'
  );
}

function ensureCodeTagDirection(tag) {
  if (/\sdir\s*=/.test(tag)) return tag;
  return tag.replace(/^<code\b/i, '<code dir="ltr"');
}

// In RTL paragraphs, Latin code-like tokens containing <T>, dots, or () can be
// visually reordered by the browser bidi algorithm. Wrap only those tokens in
// LTR isolates while preserving existing HTML markup such as <code>.
export function isolateInlineCodeTokens(html, dir = 'ltr') {
  if (!html) return '';

  let value = escapeGenericAngleBrackets(String(html));
  if (String(dir).toLowerCase() !== 'rtl') {
    return value.replace(/<code\b[^>]*>/gi, ensureCodeTagDirection);
  }

  const tokenPattern = /(\$\{[^}]+\}|[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<]+|[A-Z]{2,}(?:\/[A-Z0-9]{2,})+|CVE-\d{4}-\d+|[A-Z]{2,}[A-Z0-9_/-]*|[A-Za-z]+[0-9][A-Za-z0-9]*|(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:&lt;[^<>]+?&gt;)+|(?:[A-Za-z_$][\w$]*\.)+[A-Za-z_$][\w$]*(?:\(\))?|[A-Za-z_$][\w$]*\(\)|C#|C\+\+|\.NET|Node\.js|Vue\.js|JavaScript|TypeScript|Python|PHP|Java|API|APIs|JIT|V8)/g;
  const parts = value.split(/(<\/?code\b[^>]*>|<[^>]+>)/gi);
  let insideCode = false;

  return parts.map(part => {
    if (!part) return '';

    if (/^<code\b/i.test(part)) {
      insideCode = true;
      return ensureCodeTagDirection(part);
    }

    if (/^<\/code\b/i.test(part)) {
      insideCode = false;
      return part;
    }

    if (part.startsWith('<') || insideCode) {
      return part;
    }

    return part.replace(tokenPattern, '<span class="bidi-code-token" dir="ltr">$1</span>');
  }).join('');
}

// Use for localized/i18n strings that may already contain safe inline HTML
// such as <code>. It fixes RTL rendering without destroying that markup.
export function formatLocalizedInline(value, dir = 'ltr') {
  if (value == null) return '';
  return isolateInlineCodeTokens(String(value), dir);
}

// Use for plain text values that must be escaped first, such as test names.
export function formatPlainInlineText(value, dir = 'ltr') {
  if (value == null) return '';
  return isolateInlineCodeTokens(escapeHtml(value), dir);
}

function normalizeExplanationText(explanation) {
  const rawLines = String(explanation)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  while (rawLines.length && !rawLines[0].trim()) rawLines.shift();
  while (rawLines.length && !rawLines[rawLines.length - 1].trim()) rawLines.pop();

  const indents = rawLines
    .filter(line => line.trim())
    .map(line => (line.match(/^\s*/) || [''])[0].length);
  const minIndent = indents.length ? Math.min(...indents) : 0;

  return rawLines.map(line => line.slice(minIndent).trim()).join('\n');
}

function isExplanationHeading(line) {
  return /^(🎯|✅|🚫|⚠️|🔥|💡|📌)/.test(line) || /[:：]$/.test(line);
}

function isBulletLine(line) {
  return /^[-–-•]\s+/.test(line);
}

function isNumberedLine(line) {
  return /^\d+[.)]\s+/.test(line);
}

function formatInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\*])\*(?!\s)([^*]+?)\*/g, '$1<em>$2</em>')
    .replace(/`(.*?)`/g, '<code dir="ltr">$1</code>');
}

function renderExplanationBlock(lines) {
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
      continue;
    }

    if (isBulletLine(line)) {
      const items = [];
      while (i < lines.length && isBulletLine(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-–-•]\s+/, ''));
        i += 1;
      }
      html.push(`<ul>${items.map(item => `<li>${formatInlineMarkdown(item)}</li>`).join('')}</ul>`);
      continue;
    }

    if (isNumberedLine(line)) {
      const items = [];
      while (i < lines.length && isNumberedLine(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ''));
        i += 1;
      }
      html.push(`<ol>${items.map(item => `<li>${formatInlineMarkdown(item)}</li>`).join('')}</ol>`);
      continue;
    }

    if (isExplanationHeading(line)) {
      html.push(`<p class="explanation-heading">${formatInlineMarkdown(line)}</p>`);
      i += 1;
      continue;
    }

    const paragraph = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isExplanationHeading(lines[i].trim()) &&
      !isBulletLine(lines[i].trim()) &&
      !isNumberedLine(lines[i].trim())
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    html.push(`<p>${formatInlineMarkdown(paragraph.join(' '))}</p>`);
  }

  return html.join('');
}

// Format explanation with markdown-like syntax, while removing source-code hard wraps.
// The attack files are template literals, so their text is often manually wrapped.
// Rendering every newline as <br> makes Hebrew explanations break badly, especially
// around mixed Hebrew/English tokens. This keeps real sections/lists, but joins
// wrapped prose back into readable paragraphs.
export function formatExplanation(explanation) {
  if (!explanation) return '';
  const normalized = normalizeExplanationText(explanation);
  const blocks = normalized.split(/\n\s*\n+/).map(block =>
    renderExplanationBlock(block.split('\n'))
  );
  return blocks.filter(Boolean).join('');
}

// Get language icon
export function getLanguageIcon(language) {
  const icons = {
    javascript: '🟨',
    typescript: '🔷',
    python: '🐍',
    php: '🐘',
    java: '☕',
    csharp: '🟦',
  };
  return icons[language] || '📄';
}

// Get category icon
export function getCategoryIcon(category) {
  const icons = {
    'code-execution': '⚡',
    'file-system': '📂',
    'network': '🌐',
    'process': '⚙️',
    'prototype-pollution': '🧬',
    'information-disclosure': '🔍',
    'deserialization': '📦',
    'sandbox-escape': '🏃',
    'memory': '💾',
    'injection': '💉',
    'safe-code': '✅',
  };
  return icons[category] || '🔒';
}

// Format category name for display (fallback if not in i18n)
export function formatCategoryName(category) {
  return category
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
