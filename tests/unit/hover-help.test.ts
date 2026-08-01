/**
 * The teaching hover: the rendering, and the real curated data behind it.
 *
 * The IDE already held 189-305 explanations per language, each with an example, fully
 * translated to Hebrew - reachable only by knowing to right-click. A student who does
 * not know what `range` means does not know to right-click it either.
 *
 * Two things are tested separately because they fail differently:
 *
 *  - the RENDERING, where Markdown silently mangles the very terms worth teaching
 *  - the DATA, read straight off disk, because a coverage claim is only worth making
 *    if it is checked
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { escapeMarkdown, renderHover, typeLabel } from '../../src/features/hover-content.ts';

const LANGUAGES_ROOT = resolve(import.meta.dirname, '../../languages');

const TAUGHT = ['python', 'javascript', 'typescript', 'java', 'php', 'csharp'] as const;

interface Entry {
  explanation: string;
  example?: string;
  type?: string;
}

/** The real curated file for a language. */
function keywords(language: string): Record<string, Entry> {
  return JSON.parse(readFileSync(resolve(LANGUAGES_ROOT, language, 'keywords.json'), 'utf8'));
}

function hebrew(language: string): Record<string, Entry> {
  return JSON.parse(readFileSync(resolve(LANGUAGES_ROOT, language, 'keywords_he.json'), 'utf8'));
}

describe('rendering', () => {
  test('the name, the category and the example all appear', () => {
    const markdown = renderHover('python', 'range', {
      explanation: 'Produces a sequence of numbers.',
      example: 'for i in range(3):\n    print(i)',
      type: 'core',
    });

    assert.match(markdown, /\*\*range\*\*/);
    // `built\-in`: the hyphen is escaped, correctly - an unescaped leading `-` starts
    // a Markdown list item.
    assert.match(markdown, /built\\?-in/);
    assert.match(markdown, /Produces a sequence/);
    assert.match(markdown, /```python/);
    assert.match(markdown, /for i in range\(3\):/);
  });

  test('an entry with no example renders without an empty fence', () => {
    const markdown = renderHover('python', 'pass', { explanation: 'Does nothing.' });
    assert.doesNotMatch(markdown, /```/);
  });

  test('an entry with no type renders without a dangling dash', () => {
    const markdown = renderHover('python', 'pass', { explanation: 'Does nothing.' });
    assert.equal(markdown.split('\n')[0], '**pass**');
  });

  test('an underscored type name reads as words', () => {
    assert.equal(typeLabel('control_flow'), 'control flow');
    assert.equal(typeLabel('access_modifier'), 'access modifier');
    assert.equal(typeLabel(undefined), null);
  });

  test('an unmapped type is shown rather than dropped', () => {
    // A new category in the data should still label the popup.
    assert.equal(typeLabel('coroutine_thing'), 'coroutine thing');
  });
});

describe('Markdown does not mangle the terms being taught', () => {
  test('asterisks are escaped, so *args does not open an italic run', () => {
    const markdown = renderHover('python', 'def', {
      explanation: 'Use *args and **kwargs for variable arguments.',
    });
    const prose = markdown.split('```')[0].split('\n').slice(2).join('\n');
    assert.match(prose, /\\\*args/);
    assert.doesNotMatch(prose, /(?<!\\)\*/);
  });

  test('underscores are escaped, so __init__ is not rendered as bold init', () => {
    const markdown = renderHover('python', 'class', {
      explanation: 'Define __init__ to construct instances.',
    });
    assert.match(markdown, /\\_\\_init\\_\\_/);
  });

  test('backticks are escaped, so an explanation cannot open a code span', () => {
    const markdown = renderHover('python', 'x', { explanation: 'A `weird` case.' });
    const prose = markdown.split('\n')[2];
    assert.doesNotMatch(prose, /(?<!\\)`/);
  });

  test('the example is NOT escaped, because a fence is already literal', () => {
    // Escaping inside a fence shows the student backslashes through their own code.
    const markdown = renderHover('python', 'print', {
      explanation: 'Writes to output.',
      example: 'print("a_b", *items)',
    });
    const example = markdown.split('```python\n')[1].split('\n```')[0];
    assert.equal(example, 'print("a_b", *items)');
  });

  test('markup in an entry renders as text, not as HTML', () => {
    const markdown = renderHover('python', 'x', {
      explanation: '<script>alert(1)</script>',
    });
    assert.doesNotMatch(markdown.split('```')[0], /(?<!\\)<script>/);
  });

  test('escapeMarkdown covers every character Markdown reads', () => {
    for (const character of ['\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '-', '.', '!', '|', '<', '>', '~']) {
      assert.equal(escapeMarkdown(character), `\\${character}`, character);
    }
  });

  test('ordinary prose is left alone apart from punctuation', () => {
    assert.equal(escapeMarkdown('A simple sentence'), 'A simple sentence');
  });
});

describe('Hebrew', () => {
  test('an RTL explanation is marked, so its punctuation lands correctly', () => {
    const markdown = renderHover('python', 'def', {
      explanation: 'מגדיר פונקציה חדשה.',
      rtl: true,
    });
    // U+200F RIGHT-TO-LEFT MARK. Without it the trailing full stop renders on the
    // left of a right-to-left sentence.
    assert.ok(markdown.includes('‏'), 'no RTL mark on a Hebrew explanation');
  });

  test('an English explanation is not marked', () => {
    const markdown = renderHover('python', 'def', { explanation: 'Defines a function.' });
    assert.ok(!markdown.includes('‏'));
  });
});

describe('the curated data, read from disk', () => {
  test('every taught language has a file with substantial coverage', () => {
    for (const language of TAUGHT) {
      const entries = keywords(language);
      assert.ok(
        Object.keys(entries).length >= 150,
        `${language} has only ${Object.keys(entries).length} entries`,
      );
    }
  });

  test('built-ins are covered, not only reserved words', () => {
    // The difference that matters for a beginner: `for` is guessable from context,
    // `range` and `len` are not.
    const python = keywords('python');
    for (const word of ['print', 'len', 'range', 'input', 'str', 'int', 'list', 'dict']) {
      assert.ok(word in python, `python has no entry for ${word}`);
    }
  });

  test('every entry has an explanation, and it is not a placeholder', () => {
    for (const language of TAUGHT) {
      for (const [word, entry] of Object.entries(keywords(language))) {
        assert.ok(entry.explanation, `${language}/${word} has no explanation`);
        assert.ok(
          entry.explanation.length > 15,
          `${language}/${word} explanation is too short to teach: "${entry.explanation}"`,
        );
      }
    }
  });

  test('nearly every entry carries a worked example', () => {
    // An explanation without an example is much weaker for a beginner, so the
    // proportion is asserted rather than assumed.
    for (const language of TAUGHT) {
      const entries = Object.values(keywords(language));
      const withExample = entries.filter(entry => entry.example && entry.example.length > 0);
      const ratio = withExample.length / entries.length;
      assert.ok(ratio > 0.9, `${language}: only ${(ratio * 100).toFixed(0)}% of entries have an example`);
    }
  });

  test('the Hebrew translation covers the same words', () => {
    // A partially translated file is worse than none: a Hebrew-speaking student would
    // get English for exactly the words nobody thought to translate.
    for (const language of TAUGHT) {
      const english = Object.keys(keywords(language));
      const translated = hebrew(language);
      const missing = english.filter(word => !(word in translated));
      assert.deepEqual(
        missing,
        [],
        `${language}: ${missing.length} words are untranslated (${missing.slice(0, 5).join(', ')})`,
      );
    }
  });

  test('every real entry renders without throwing', () => {
    // The rendering runs over data nobody re-reads, so it is exercised over all of it.
    for (const language of TAUGHT) {
      for (const [word, entry] of Object.entries(keywords(language))) {
        const markdown = renderHover(language, word, entry);
        assert.ok(markdown.length > 0, `${language}/${word} rendered empty`);
        assert.ok(markdown.includes(word) || markdown.includes(escapeMarkdown(word)));
      }
    }
  });
});

describe('coverage the data does not have', () => {
  test('operators are not covered, and that is recorded rather than assumed', () => {
    // A beginner asking what `//` or `%` means gets nothing today. Adding them is a
    // data change, not a code change - noted so the gap is explicit.
    const python = keywords('python');
    assert.ok(!('%' in python));
    assert.ok(!('//' in python));
  });

  test('html, css, json and markdown have no curated help', () => {
    // Monaco's own language services provide hovers for these now that the workers are
    // wired, so the absence is a decision rather than an oversight.
    for (const language of ['html', 'css', 'json', 'markdown', 'svg']) {
      assert.throws(() => keywords(language), `${language} unexpectedly has keywords.json`);
    }
  });
});
