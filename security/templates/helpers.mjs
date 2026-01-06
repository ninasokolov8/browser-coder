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

// Format explanation with markdown-like syntax
export function formatExplanation(explanation) {
  if (!explanation) return '';
  return explanation
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

// Get language icon
export function getLanguageIcon(language) {
  const icons = {
    javascript: '🟨',
    typescript: '🔷',
    python: '🐍',
    php: '🐘',
    java: '☕',
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
