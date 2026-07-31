/**
 * The Markdown renderer.
 *
 * Two things are being tested, and the second matters more: that the common
 * constructs render, and that nothing a student can type in a note becomes
 * executable in the published preview.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown, markdownToPage, escapeHtml } from '../../src/features/markdown.ts';

describe('block structure', () => {
  test('headings', () => {
    assert.equal(renderMarkdown('# Title'), '<h1>Title</h1>');
    assert.equal(renderMarkdown('### Third'), '<h3>Third</h3>');
    // Six is the deepest; a seventh hash is prose.
    assert.match(renderMarkdown('####### Seven'), /<p>/);
  });

  test('a closing sequence of hashes is not part of the text', () => {
    assert.equal(renderMarkdown('## Middle ##'), '<h2>Middle</h2>');
  });

  test('paragraphs are separated by blank lines', () => {
    assert.equal(renderMarkdown('one\n\ntwo'), '<p>one</p>\n<p>two</p>');
  });

  test('a single newline inside a paragraph is a soft break', () => {
    assert.equal(renderMarkdown('one\ntwo'), '<p>one<br />two</p>');
  });

  test('unordered lists', () => {
    assert.equal(renderMarkdown('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
    assert.equal(renderMarkdown('* a\n+ b'), '<ul><li>a</li><li>b</li></ul>');
  });

  test('ordered lists', () => {
    assert.equal(renderMarkdown('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  });

  test('changing the list type starts a new list', () => {
    assert.equal(
      renderMarkdown('- a\n1. b'),
      '<ul><li>a</li></ul>\n<ol><li>b</li></ol>',
    );
  });

  test('blockquotes nest other blocks', () => {
    assert.equal(renderMarkdown('> # quoted'), '<blockquote><h1>quoted</h1></blockquote>');
  });

  test('horizontal rules', () => {
    assert.equal(renderMarkdown('---'), '<hr />');
    assert.equal(renderMarkdown('***'), '<hr />');
  });

  test('a fenced block keeps its contents literal', () => {
    const html = renderMarkdown('```python\nprint("*hi*")\n```');
    assert.equal(html, '<pre><code class="language-python">print(&quot;*hi*&quot;)</code></pre>');
  });

  test('a fence closes only on a matching marker', () => {
    // The tilde line is content, not a close: markers must match.
    const html = renderMarkdown('```\n~~~\nstill code\n```');
    assert.match(html, /~~~\nstill code/);
  });

  test('an unterminated fence still ends the document cleanly', () => {
    assert.equal(renderMarkdown('```\nopen forever'), '<pre><code>open forever</code></pre>');
  });

  test('tables, with alignment', () => {
    const html = renderMarkdown('| a | b |\n|:--|--:|\n| 1 | 2 |');
    assert.match(html, /<th style="text-align:left">a<\/th>/);
    assert.match(html, /<th style="text-align:right">b<\/th>/);
    assert.match(html, /<td style="text-align:left">1<\/td>/);
  });

  test('a row of pipes that is not a table stays a paragraph', () => {
    assert.match(renderMarkdown('a | b\nnot a divider'), /^<p>/);
  });

  test('a short row is padded rather than dropped', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 |');
    assert.match(html, /<td>1<\/td><td><\/td>/);
  });
});

describe('inline formatting', () => {
  test('strong and emphasis', () => {
    assert.equal(renderMarkdown('**bold**'), '<p><strong>bold</strong></p>');
    assert.equal(renderMarkdown('*italic*'), '<p><em>italic</em></p>');
    assert.equal(renderMarkdown('~~gone~~'), '<p><del>gone</del></p>');
  });

  test('strong wins over emphasis', () => {
    // "**x**" read as emphasis-of-emphasis produces <em><em>, which is the classic
    // ordering bug in a hand-written renderer.
    assert.equal(renderMarkdown('**x**'), '<p><strong>x</strong></p>');
  });

  test('snake_case identifiers are not italicised', () => {
    assert.equal(renderMarkdown('call my_helper_function now'), '<p>call my_helper_function now</p>');
  });

  test('a code span is literal', () => {
    assert.equal(renderMarkdown('use `**not bold**`'), '<p>use <code>**not bold**</code></p>');
  });

  test('links', () => {
    assert.equal(
      renderMarkdown('[docs](https://example.com)'),
      '<p><a href="https://example.com" rel="noopener noreferrer">docs</a></p>',
    );
  });

  test('images, including a workspace-relative one', () => {
    assert.equal(
      renderMarkdown('![a maze](maze.svg)'),
      '<p><img src="maze.svg" alt="a maze" /></p>',
    );
  });

  test('an image is not mistaken for a link', () => {
    assert.match(renderMarkdown('![alt](x.png)'), /<img /);
    assert.doesNotMatch(renderMarkdown('![alt](x.png)'), /<a /);
  });

  test('a query string is not double-escaped', () => {
    assert.match(
      renderMarkdown('[q](https://example.com/?a=1&b=2)'),
      /href="https:\/\/example\.com\/\?a=1&amp;b=2"/,
    );
  });
});

describe('nothing a student types becomes executable', () => {
  test('raw HTML is shown, not run', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });

  test('an img with an inline handler is shown as text', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    // `onerror` survives as characters, which is the point - what must not survive
    // is the tag around it, so the browser never sees an element to attach it to.
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  });

  test('a javascript: link loses its href', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    assert.doesNotMatch(html, /href/);
    assert.match(html, /click/);
  });

  test('a data: image is refused', () => {
    const html = renderMarkdown('![x](data:text/html;base64,PHN2Zz4=)');
    assert.doesNotMatch(html, /<img/);
  });

  test('the scheme check is not fooled by a colon later in a path', () => {
    // "notes/a:b" has no scheme, so it must survive as a relative link.
    assert.match(renderMarkdown('[x](notes/a:b)'), /href="notes\/a:b"/);
  });

  test('a quote in a URL cannot break out of the attribute', () => {
    const html = renderMarkdown('[x](a" onmouseover="alert(1))');
    assert.doesNotMatch(html, /onmouseover="alert/);
  });

  test('alt text cannot break out either', () => {
    const html = renderMarkdown('![" onerror="alert(1)](x.png)');
    assert.doesNotMatch(html, /onerror="alert/);
  });

  test('escapeHtml covers all five structural characters', () => {
    assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('the page wrapper', () => {
  test('produces a complete document with an escaped title', () => {
    const page = markdownToPage('# Hi', '<notes>.md');
    assert.match(page, /^<!doctype html>/);
    assert.match(page, /<title>&lt;notes&gt;\.md<\/title>/);
    assert.match(page, /<h1>Hi<\/h1>/);
  });

  test('an empty document is still valid', () => {
    assert.match(markdownToPage('', 'empty.md'), /<body>\s*<\/body>/);
  });
});
