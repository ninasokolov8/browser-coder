/**
 * Light mode, guarded.
 *
 * Light mode broke the way this kind of thing always breaks: nobody deleted it, they
 * just stopped maintaining it. Every component added after the original layout - the
 * debugger, the asset viewer, breadcrumbs, the command palette, the Problems panel,
 * the Output panel's semantic colours, the interactive console - hardcoded values
 * chosen against #1e1e1e. There is exactly one `.dark-theme` selector in the file and
 * no dark-scoped component overrides, so those literals applied in BOTH themes: the
 * success line was 1.6:1 on the light panel, the paused-line arrow 1.5:1, and every
 * `rgba(255,255,255,α)` overlay about 1.01:1 - invisible.
 *
 * So these tests read the real stylesheet and assert the properties that make the
 * failure impossible rather than merely fixed:
 *
 *  - the two variable blocks define exactly the same names
 *  - every `var()` used anywhere resolves in both
 *  - no new white-alpha overlay appears outside the handful of always-dark surfaces
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HTML = readFileSync(
  resolve(import.meta.dirname, '../../index.html'),
  'utf8',
);

const STYLE = HTML.slice(HTML.indexOf('<style>') + 7, HTML.indexOf('</style>'));

/** The declarations inside one selector block, given the selector's opening line. */
function variableBlock(selector) {
  const start = STYLE.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `no ${selector} block in index.html`);
  const end = STYLE.indexOf('\n      }', start);
  assert.notEqual(end, -1, `${selector} block is not terminated as expected`);
  return STYLE.slice(start, end);
}

function definedNames(block) {
  return new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1]));
}

const LIGHT = variableBlock(':root');
const DARK = variableBlock('.dark-theme');
const HIGH_CONTRAST = variableBlock('.hc-theme');

/**
 * Where the variable blocks end and the component rules begin.
 *
 * Taken from the LAST variable block, not the first: adding high contrast put a third
 * block of legitimate literals after `.dark-theme`, and a scan anchored on the first
 * `color-scheme: dark` would have read that block as a wall of dark-only components.
 */
const COMPONENT_CSS = STYLE.slice(STYLE.indexOf('}', STYLE.indexOf(HIGH_CONTRAST)));

describe('the two themes are symmetric', () => {
  test('every variable defined in one is defined in the other', () => {
    const light = definedNames(LIGHT);
    const dark = definedNames(DARK);

    const onlyLight = [...light].filter(name => !dark.has(name));
    const onlyDark = [...dark].filter(name => !light.has(name));

    assert.deepEqual(onlyLight, [], `defined only for light: ${onlyLight.join(', ')}`);
    assert.deepEqual(onlyDark, [], `defined only for dark: ${onlyDark.join(', ')}`);
  });

  test('both declare color-scheme, so native scrollbars follow the theme', () => {
    // Without it the browser paints light scrollbars and light form-control internals
    // on a dark IDE, because nothing told it the surface is dark.
    assert.match(LIGHT, /color-scheme:\s*light/);
    assert.match(DARK, /color-scheme:\s*dark/);
  });

  test('the semantic colours a run depends on exist in both', () => {
    for (const name of ['--fg-error', '--fg-success', '--fg-info', '--fg-warning']) {
      assert.ok(definedNames(LIGHT).has(name), `light is missing ${name}`);
      assert.ok(definedNames(DARK).has(name), `dark is missing ${name}`);
    }
  });

  test('high contrast defines no variable the base themes do not have', () => {
    // It is an OVERRIDE layered on dark, so it may restate a subset - but a name that
    // exists nowhere else is a typo producing a variable nothing reads, which is
    // exactly how --bg-input came to be used and never declared.
    const stray = [...definedNames(HIGH_CONTRAST)].filter(name => !definedNames(DARK).has(name));
    assert.deepEqual(stray, [], `high contrast declares unknown variables: ${stray.join(', ')}`);
  });

  test('high contrast restates every colour that carries meaning', () => {
    // A semantic colour left at its dark value would be the one unreadable thing in a
    // theme whose entire purpose is readability.
    for (const name of [
      '--fg-error', '--fg-success', '--fg-info', '--fg-warning',
      '--focus-ring', '--border-subtle', '--bg-selected', '--glyph-current',
    ]) {
      assert.ok(definedNames(HIGH_CONTRAST).has(name), `high contrast is missing ${name}`);
    }
  });

  test('the theme selector offers it, or nobody can choose it', () => {
    assert.match(HTML, /<option value="hc-black">/);
  });

  test('the activity bar icons are legible, because that bar is dark in BOTH themes', () => {
    // --bg-activitybar is #2c2c2c in light mode too (VS Code Light does the same), so
    // the light block's old #424242 icon colour was 1.39:1 - Explorer, Search and Run
    // simply were not there.
    assert.match(LIGHT, /--bg-activitybar:\s*#2c2c2c/);
    assert.match(LIGHT, /--icon-color:\s*#858585/);
    assert.match(LIGHT, /--icon-active:\s*#ffffff/);
  });
});

describe('every variable that is used is defined', () => {
  test('no rule references a variable neither block declares', () => {
    // `--bg-input` and `--font-mono` were used by the Run-panel argument inputs and
    // declared nowhere, so those fields had no background and no monospace font in
    // either theme. An undefined custom property is invalid at computed-value time,
    // which fails silently.
    // Only uses with NO fallback. `var(--sidebar-width, 220px)` is set from JS at
    // runtime and its fallback is the real default, so it is not a missing variable.
    const used = new Set(
      [...STYLE.matchAll(/var\((--[a-z0-9-]+)\s*([,)])/g)]
        .filter(match => match[2] === ')')
        .map(match => match[1]),
    );
    const light = definedNames(LIGHT);
    const dark = definedNames(DARK);

    const undefinedNames = [...used].filter(name => !light.has(name) || !dark.has(name));
    assert.deepEqual(undefinedNames, [], `used but not defined in both themes: ${undefinedNames.join(', ')}`);
  });
});

describe('no component may be dark-only again', () => {
  /**
   * The surfaces that are dark whatever the theme, where a white overlay is correct.
   *
   * Anything else that wants one has to add a variable, which is the point: the list
   * is short, and a new entry is a decision someone made on purpose.
   */
  const ALLOWED_WHITE_OVERLAYS = [
    // The always-blue status bar (#007acc in both themes).
    '.status-item:hover { background: rgba(255,255,255,0.12); }',
    // The spinner on the accent-coloured Run button.
    'border: 2px solid rgba(255, 255, 255, 0.35);',
  ];

  test('white-alpha overlays outside the variable blocks are accounted for', () => {
    const componentCss = COMPONENT_CSS;
    const offenders = componentCss
      .split('\n')
      .map(line => line.trim())
      .filter(line => /rgba\(\s*255,\s*255,\s*255/.test(line))
      .filter(line => !ALLOWED_WHITE_OVERLAYS.includes(line));

    assert.deepEqual(
      offenders,
      [],
      `dark-only overlays: ${offenders.join(' | ')}`,
    );
  });

  test('the dark-theme palette literals are gone from component rules', () => {
    // The exact values that made light mode unreadable. Each is now a variable.
    const componentCss = COMPONENT_CSS;
    for (const literal of ['#f48771', '#89d185', '#75beff', '#ce9178', '#9cdcfe', '#ffcc00', '#e8ab6a', '#6a9955']) {
      assert.ok(
        !componentCss.includes(literal),
        `${literal} is still hardcoded in a component rule`,
      );
    }
  });
});

describe('the theme is decided before the first paint', () => {
  test('body does not ship hardcoded dark', () => {
    // It used to, and the saved theme was applied many awaits later, so a light-theme
    // student got a full-window dark flash on every load.
    assert.ok(!/<body class="dark-theme">/.test(HTML), 'body still hardcodes the dark class');
  });

  test('an inline script decides it from storage, then from the OS', () => {
    const bootstrap = HTML.slice(HTML.indexOf('<body>'), HTML.indexOf('<div id="app">'));
    assert.match(bootstrap, /localStorage\.getItem\('browser-coder-settings'\)/);
    assert.match(bootstrap, /prefers-color-scheme: light/);
    assert.match(bootstrap, /__bcInitialTheme/);
    // Inline, not a module: an external script is fetched, and the fetch is exactly
    // the gap the flash lives in.
    assert.ok(!/<script[^>]*src=/.test(bootstrap), 'the theme bootstrap must not be an external script');
  });

  test('an EMBEDDED IDE keeps the dark default and ignores the OS', () => {
    // The host page controls how a lesson looks and never sends a theme. Inheriting
    // the student's OS would silently turn every embedded task light for everyone on a
    // light-mode laptop - a change the host never asked for. An explicit stored choice
    // still wins, because that is the student deciding.
    const bootstrap = HTML.slice(HTML.indexOf('<body>'), HTML.indexOf('<div id="app">'));
    assert.match(bootstrap, /embed'\) === '1'/, 'the pre-paint script does not check for an embed');
    assert.match(
      bootstrap,
      /!embedded[\s\S]{0,80}prefers-color-scheme: light/,
      'the OS preference is not gated on being standalone',
    );
  });
});
