/**
 * Comprehensive smoke + integration test suite for browser-coder.
 *
 * Layers tested:
 *   1. Unit — escHtml, stripTempPath, cleanCSharpErrors, renderRunResult logic
 *   2. Server static analysis — all new code paths present in server.mjs
 *   3. Frontend static analysis — execution.ts, output.ts, run-panel.ts, index.html
 *   4. Integration — real HTTP /api/run calls for each language
 *   5. TypeScript compiler package availability
 *
 * Run: node _test_suite.mjs
 */

import { readFileSync } from 'fs';

// ─── ANSI colours ─────────────────────────────────────────────────────────────
const C = { reset:'\x1b[0m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m',
            blue:'\x1b[34m', cyan:'\x1b[36m', bold:'\x1b[1m', dim:'\x1b[2m' };
const PASS = `${C.green}PASS${C.reset}`;
const FAIL = `${C.red}FAIL${C.reset}`;
const SKIP = `${C.yellow}SKIP${C.reset}`;
const INFO = `${C.cyan}INFO${C.reset}`;

// ─── Test runner ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ${PASS}  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ${FAIL}  ${name}`);
    console.log(`       ${C.red}${e.message}${C.reset}`);
    failures.push({ name, error: e.message });
    failed++;
  }
}

function skipTest(name, reason) {
  console.log(`  ${SKIP}  ${name}  ${C.dim}(${reason})${C.reset}`);
  skipped++;
}

function assert(cond, msg)         { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, msg)    { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assertContains(s, sub, m) { if (!String(s).includes(sub)) throw new Error(m || `Expected "${String(s).slice(0,120)}" to contain "${sub}"`); }
function assertNotContains(s, sub, m) { if (String(s).includes(sub)) throw new Error(m || `String must NOT contain "${sub}"`); }

// ─── HTTP helper ──────────────────────────────────────────────────────────────
const API = 'http://localhost:3001';

async function apiRun(payload, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const data = await res.json();
    return { status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. UNIT TESTS
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${C.bold}${C.blue}═══ 1. Unit tests ═══════════════════════════════════════${C.reset}`);

// ── escHtml ──────────────────────────────────────────────────────────────────
const escHtml = t => t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

await test('escHtml: escapes &',           () => assertEqual(escHtml('5 & 3'), '5 &amp; 3'));
await test('escHtml: escapes <',           () => assertEqual(escHtml('<b>'), '&lt;b&gt;'));
await test('escHtml: escapes >',           () => assertEqual(escHtml('a > b'), 'a &gt; b'));
await test('escHtml: preserves newlines',  () => assertEqual(escHtml('a\nb'), 'a\nb'));
await test('escHtml: empty string',        () => assertEqual(escHtml(''), ''));
await test('escHtml: no bare < after esc', () => assert(!escHtml('<script>').includes('<'), 'escaped must have no bare <'));

// ── stripTempPath ─────────────────────────────────────────────────────────────
function stripTempPath(text, dir) {
  if (!text || !dir) return text || '';
  const prefix = dir.endsWith('/') ? dir : dir + '/';
  return text.replace(new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
}

await test('stripTempPath: removes prefix',          () => assertEqual(stripTempPath('/tmp/abc123/Main.java:5', '/tmp/abc123'), 'Main.java:5'));
await test('stripTempPath: trailing slash in dir',   () => assertEqual(stripTempPath('/tmp/abc/Main.java:5', '/tmp/abc/'), 'Main.java:5'));
await test('stripTempPath: empty text → empty',      () => assertEqual(stripTempPath('', '/tmp/abc'), ''));
await test('stripTempPath: null text → empty',       () => assertEqual(stripTempPath(null, '/tmp/abc'), ''));
await test('stripTempPath: replaces all occurrences',() => assertEqual(stripTempPath('/tmp/t/a.java /tmp/t/b.java', '/tmp/t'), 'a.java b.java'));
await test('stripTempPath: regex-special chars in path', () => {
  // Path with parens, dots
  const result = stripTempPath('/tmp/c(x)/Main.java:1', '/tmp/c(x)');
  assertEqual(result, 'Main.java:1');
});

// ── cleanCSharpErrors ─────────────────────────────────────────────────────────
function cleanCSharpErrors(text, dir) {
  if (!text) return '';
  return stripTempPath(text, dir)
    .replace(/\s*\[[^\]]*\.csproj\]/g, '')
    .replace(/^Build\s+(FAILED|succeeded)\.?\s*$/gim, '')
    .replace(/^\s*\d+\s+(Error|Warning)\(s\)\s*$/gim, '')
    .replace(/^Time Elapsed\s.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

await test('cleanCSharpErrors: removes project path',     () => { const r = cleanCSharpErrors('/tmp/cs_abc/Program.cs(4,1): error CS1002', '/tmp/cs_abc'); assertContains(r, 'Program.cs(4,1): error CS1002'); assertNotContains(r, '/tmp/cs_abc'); });
await test('cleanCSharpErrors: removes Build FAILED',      () => assertNotContains(cleanCSharpErrors('Build FAILED.\nerror CS0001', '/none'), 'Build FAILED'));
await test('cleanCSharpErrors: removes error count line',  () => { const r = cleanCSharpErrors('error CS0001\n1 Error(s)\n0 Warning(s)', '/none'); assertNotContains(r, '1 Error(s)'); });
await test('cleanCSharpErrors: removes Time Elapsed',      () => assertNotContains(cleanCSharpErrors('Time Elapsed 00:00:05.1', '/none'), 'Time Elapsed'));
await test('cleanCSharpErrors: empty input → empty',       () => assertEqual(cleanCSharpErrors('', '/none'), ''));

// ── renderRunResult logic ─────────────────────────────────────────────────────
function getCompileLabel(id) {
  return { java:'Compile Error (javac)', csharp:'Compile Error (dotnet build)',
           typescript:'TypeScript Error', php:'Parse Error (php -l)',
           python:'Problem Detected — code was not run' }[id] || 'Compile Error';
}

function renderRunResult(data, langId) {
  const isCompile = data.phase === 'compile';
  const parts = [];
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  if (isCompile) {
    parts.push(`<span class="info">── ${esc(getCompileLabel(langId))} ──────────────────────────────────────</span>\n`);
    if (data.stderr) parts.push(`<span class="error">${esc(data.stderr)}</span>`);
  } else {
    if (data.stdout) parts.push(esc(data.stdout));
    if (data.stderr) {
      if (parts.length > 0) parts.push('\n');
      parts.push(`<span class="info">── stderr ─────────────────────────────────────────────────</span>\n`);
      parts.push(`<span class="error">${esc(data.stderr)}</span>`);
    }
  }
  if (parts.length > 0 && !parts[parts.length-1].endsWith('\n')) parts.push('\n');
  parts.push(data.exitCode === 0 ? `<span class="success">[exit 0 ✓]</span>` : `<span class="error">[exit code: ${data.exitCode}]</span>`);
  return parts.join('');
}

await test('renderRunResult: success shows [exit 0 ✓] in success span',     () => { const h = renderRunResult({stdout:'hi', exitCode:0}, 'python'); assertContains(h, '<span class="success">[exit 0 ✓]</span>'); assertContains(h, 'hi'); });
await test('renderRunResult: failure shows exit code in error span',         () => assertContains(renderRunResult({stderr:'oops', exitCode:1}, 'python'), '<span class="error">[exit code: 1]</span>'));
await test('renderRunResult: compile error shows language label (python)',   () => { const h = renderRunResult({stderr:'SyntaxError', exitCode:1, phase:'compile'}, 'python'); assertContains(h, 'Problem Detected'); assertContains(h, '<span class="info">'); });
await test('renderRunResult: runtime stderr gets stderr section header',     () => { const h = renderRunResult({stdout:'hi', stderr:'oops', exitCode:1, phase:'run'}, 'javascript'); assertContains(h, '── stderr ─'); assertContains(h, 'hi'); assertContains(h, 'oops'); });
await test('renderRunResult: HTML special chars escaped in stdout',          () => { const h = renderRunResult({stdout:'<script>alert(1)</script>', exitCode:0}, 'js'); assertNotContains(h, '<script>'); assertContains(h, '&lt;script&gt;'); });
await test('renderRunResult: & in stdout escaped',                           () => assertContains(renderRunResult({stdout:'5 & 3 = 1', exitCode:0}, 'js'), '5 &amp; 3 = 1'));
await test('renderRunResult: empty stdout+stderr still shows footer',        () => assertContains(renderRunResult({exitCode:0}, 'js'), '[exit 0 ✓]'));
await test('renderRunResult: empty when no parts, no trailing newline',      () => assertEqual(renderRunResult({exitCode:0, phase:'run'}, 'js'), '<span class="success">[exit 0 ✓]</span>'));
await test('renderRunResult: java compile label',                            () => assertContains(renderRunResult({stderr:'e', exitCode:1, phase:'compile'}, 'java'), 'Compile Error (javac)'));
await test('renderRunResult: csharp compile label',                          () => assertContains(renderRunResult({stderr:'e', exitCode:1, phase:'compile'}, 'csharp'), 'Compile Error (dotnet build)'));
await test('renderRunResult: typescript compile label',                      () => assertContains(renderRunResult({stderr:'e', exitCode:1, phase:'compile'}, 'typescript'), 'TypeScript Error'));
await test('renderRunResult: php compile label',                             () => assertContains(renderRunResult({stderr:'e', exitCode:1, phase:'compile'}, 'php'), 'Parse Error (php -l)'));
await test('renderRunResult: default compile label for unknown lang',        () => assertContains(renderRunResult({stderr:'e', exitCode:1, phase:'compile'}, 'cobol'), 'Compile Error'));
await test('renderRunResult: compile error with no stderr shows just header',() => { const h = renderRunResult({exitCode:1, phase:'compile'}, 'java'); assertContains(h, 'Compile Error (javac)'); assertContains(h, '[exit code: 1]'); });
await test('renderRunResult: newline output followed by correct footer',     () => { const h = renderRunResult({stdout:'hello\nworld', exitCode:0}, 'python'); assertContains(h, 'hello\nworld'); assertContains(h, '[exit 0 ✓]'); });

// ── adjustTurtleTraceback: shift shim-offset line numbers back to editor lines ──
function adjustTurtleTraceback(text, offset, fileMatch) {
  if (!text || !offset) return text || '';
  const lines = text.split('\n');
  const out = [];
  const frameRe = /^(\s*File\s+")([^"]*)("\s*,\s+line\s+)(\d+)(.*?)\r?$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(frameRe);
    if (!m) { out.push(lines[i]); continue; }
    const filePath = m[2];
    const lineNo = parseInt(m[4], 10);
    const isTargetFile = !fileMatch || filePath.includes(fileMatch);
    if (!isTargetFile) { out.push(lines[i]); continue; }
    if (lineNo > offset) {
      out.push(m[1] + m[2] + m[3] + (lineNo - offset) + m[5]);
    } else {
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (frameRe.test(next) || !/^\s{2,}\S/.test(next)) break;
        i++;
      }
    }
  }
  return out.join('\n');
}

await test('adjustTurtleTraceback: shifts user-code line back', () => {
  const tb = 'Traceback (most recent call last):\n  File "user.py", line 771, in <module>\n    t.foward(50)\nAttributeError: no attribute';
  const r = adjustTurtleTraceback(tb, 765, 'user.py');
  assertContains(r, 'line 6,');
  assertNotContains(r, 'line 771');
});
await test('adjustTurtleTraceback: offset 0 is a no-op', () => {
  const tb = '  File "user.py", line 771, in <module>';
  assertEqual(adjustTurtleTraceback(tb, 0, 'user.py'), tb);
});
await test('adjustTurtleTraceback: drops shim-internal frames + snippets', () => {
  const tb = [
    'Traceback (most recent call last):',
    '  File "user.py", line 768, in <module>',
    '    t.forward("abc")',
    '    ~~~~~~~~~^^^^^^^',
    '  File "user.py", line 546, in forward',
    '    def forward(self, d):    _fwd(self._s, d)',
    '                             ~~~~^^^^^^^^^^^^',
    '  File "user.py", line 232, in _fwd',
    '    _seg(s, s[\'x\'] + d)',
    '                     ~~^~',
    'TypeError: bad',
  ].join('\n');
  const r = adjustTurtleTraceback(tb, 765, 'user.py');
  assertContains(r, 'line 3,');            // 768 - 765
  assertNotContains(r, 'in forward');      // shim frame dropped
  assertNotContains(r, 'in _fwd');         // shim frame dropped
  assertNotContains(r, 'def forward(self');// shim source snippet removed
  assertNotContains(r, '_seg(s');          // shim source snippet removed
  assertContains(r, 't.forward("abc")');   // user source line kept
  assertContains(r, 'TypeError: bad');     // exception message kept
});
await test('adjustTurtleTraceback: leaves other user modules untouched', () => {
  const tb = '  File "helper.py", line 3, in foo\n    bar()';
  assertEqual(adjustTurtleTraceback(tb, 765, 'user.py'), tb);
});
await test('adjustTurtleTraceback: tolerates \\r\\n line endings', () => {
  const tb = 'Traceback:\r\n  File "user.py", line 800, in <module>\r\n    boom()\r\nError';
  const r = adjustTurtleTraceback(tb, 765, 'user.py');
  assertContains(r, 'line 35,');           // 800 - 765
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SERVER STATIC ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${C.bold}${C.blue}═══ 2. Server static analysis ═══════════════════════════${C.reset}`);

const serverSrc = readFileSync('server.mjs', 'utf8');

await test("server: typescript case calls executeTS",            () => assert(/case 'typescript'\s*:\s*return this\.executeTS\(/.test(serverSrc)));
await test("server: javascript case calls executeJS",            () => assert(/case 'javascript'\s*:\s*return this\.executeJS\(/.test(serverSrc)));
await test("server: executeTS uses getTsCompiler",               () => assertContains(serverSrc, 'const ts = await getTsCompiler()'));
await test("server: executeTS returns phase:compile on error",   () => assertContains(serverSrc, "phase: 'compile'"));
await test("server: executePython detects SyntaxError",          () => assert(/SyntaxError\|IndentationError\|TabError/.test(serverSrc)));
await test("server: python sets result.phase=compile",           () => { const b = serverSrc.slice(serverSrc.indexOf('async executePython('), serverSrc.indexOf('async executeJava(')); assertContains(b, "result.phase = 'compile'"); });
await test("server: executePythonMulti SyntaxError detection",   () => { const b = serverSrc.slice(serverSrc.indexOf('async executePythonMulti('), serverSrc.indexOf('async executePHPMulti(')); assertContains(b, "result.phase = 'compile'"); });
await test("server: executePHP has php -l step",                 () => { const b = serverSrc.slice(serverSrc.indexOf('async executePHP('), serverSrc.indexOf('async executeJava(')); assertContains(b, "'-l'"); assertContains(b, "phase: 'compile'"); });
await test("server: executePHPMulti has php -l step",            () => { const b = serverSrc.slice(serverSrc.indexOf('async executePHPMulti('), serverSrc.indexOf('async executeJavaMulti(')); assertContains(b, "'-l'"); assertContains(b, "phase: 'compile'"); });
await test("server: executeJava strips tempDir from stderr",     () => { const b = serverSrc.slice(serverSrc.indexOf('async executeJava('), serverSrc.indexOf('async executeCSharp(')); assertContains(b, 'stripTempPath(compileResult.stderr'); });
await test("server: executeJavaMulti strips tempDir from stderr",() => { const b = serverSrc.slice(serverSrc.indexOf('async executeJavaMulti('), serverSrc.indexOf('async executeCSharp(')); assertContains(b, 'stripTempPath(compileResult.stderr'); });
await test("server: executeCSharp detects CS\\d+ pattern",       () => { const b = serverSrc.slice(serverSrc.indexOf('async executeCSharp('), serverSrc.indexOf('async executeCSharpMulti(')); assert(/CS\\d\+/.test(b)); });
await test("server: executeCSharpMulti detects CS\\d+ pattern",  () => { const b = serverSrc.slice(serverSrc.indexOf('async executeCSharpMulti('), serverSrc.indexOf('runProcess(command, args')); assert(/CS\\d\+/.test(b)); });
await test("server: /api/run response has phase field",          () => assertContains(serverSrc, 'phase: result.phase ||'));
await test("server: stripTempPath regex-escapes path",           () => assertContains(serverSrc, "replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')"));
await test("server: dev PATH includes host PATH",                () => assertContains(serverSrc, 'process.env.PATH'));
await test("server: getTsCompiler is lazy-loaded",               () => assertContains(serverSrc, 'async function getTsCompiler()'));
await test("server: executeTSMulti method present",              () => assertContains(serverSrc, 'async executeTSMulti('));
await test("server: cleanCSharpErrors helper present",           () => assertContains(serverSrc, 'function cleanCSharpErrors('));
await test("server: turtleShimLineOffset helper present",        () => assertContains(serverSrc, 'function turtleShimLineOffset('));
await test("server: adjustTurtleTraceback helper present",       () => assertContains(serverSrc, 'function adjustTurtleTraceback('));
await test("server: executePython applies traceback shift",      () => { const b = serverSrc.slice(serverSrc.indexOf('async executePython('), serverSrc.indexOf('async executePHP(')); assertContains(b, "adjustTurtleTraceback(result.stderr, turtleShimLineOffset(), 'user.py')"); });
await test("server: executePythonMulti applies traceback shift", () => { const b = serverSrc.slice(serverSrc.indexOf('async executePythonMulti('), serverSrc.indexOf('async executePHPMulti(')); assertContains(b, 'adjustTurtleTraceback('); assertContains(b, 'path.basename(mainFile)'); });
await test("server: single shared turtle user-code separator",   () => assertContains(serverSrc, 'const TURTLE_USER_CODE_SEP'));

// ── No execution result cache ────────────────────────────────────────────────
// Replaying stored stdout makes a program a pure function of its source text,
// which froze random.randint()/Math.random()/time-dependent output at the first
// value produced. execute()/executeMulti() must always reach the real executor.
await test("server: no execution result cache class",           () => { assertNotContains(serverSrc, 'class SmartCache'); assertNotContains(serverSrc, 'new SmartCache('); });
await test("server: no run-request deduplicator",               () => { assertNotContains(serverSrc, 'class RequestDeduplicator'); assertNotContains(serverSrc, '.dedupe('); });
await test("server: execute() always calls executeCode",        () => { const b = serverSrc.slice(serverSrc.indexOf('async execute(language'), serverSrc.indexOf('async executeMulti(')); assertContains(b, 'await this.executeCode(language, version, code)'); assertNotContains(b, 'cached: true'); });
await test("server: executeMulti() always calls executeMultiFile", () => { const b = serverSrc.slice(serverSrc.indexOf('async executeMulti(language'), serverSrc.indexOf('async executeMultiFile(')); assertContains(b, 'await this.executeMultiFile(language, version, files'); assertNotContains(b, 'cached: true'); });
await test("server: /api/run never reports cached:true",        () => assertContains(serverSrc, 'cached: false'));

// ── Preflight: static pre-run check refuses to run broken Python ──────────────
await test("server: PYTHON_PREFLIGHT_PATH points at preflight.py", () => { assertContains(serverSrc, 'const PYTHON_PREFLIGHT_PATH ='); assertContains(serverSrc, "'preflight.py'"); });
await test("server: formatPreflightProblems helper present",       () => assertContains(serverSrc, 'function formatPreflightProblems('));
await test("server: preflightPython method present",               () => assertContains(serverSrc, 'async preflightPython('));
await test("server: preflightPython returns phase compile",        () => { const b = serverSrc.slice(serverSrc.indexOf('async preflightPython('), serverSrc.indexOf('async executePython(')); assertContains(b, "phase: 'compile'"); assertContains(b, 'JSON.parse'); assertContains(b, 'return null'); });
await test("server: executePython runs preflight before executing",() => { const b = serverSrc.slice(serverSrc.indexOf('async executePython('), serverSrc.indexOf('async executePHP(')); assertContains(b, "this.preflightPython(code, 'user.py')"); assert(b.indexOf('preflightPython') < b.indexOf('writeFileSync')); });
await test("server: executePythonMulti runs preflight on entry",   () => { const b = serverSrc.slice(serverSrc.indexOf('async executePythonMulti('), serverSrc.indexOf('async executePHPMulti(')); assertContains(b, 'this.preflightPython('); assertContains(b, 'path.basename(mainFile)'); });

// ── formatPreflightProblems: format JSON problems into a Python-style block ────
function formatPreflightProblems(problems, filename) {
  return problems.map((p) => {
    const lines = [`  File "${filename}", line ${p.line}`];
    if (p.text) {
      lines.push('    ' + p.text.replace(/\s+$/, ''));
      const caretCol = Math.max(1, Number(p.col) || 1);
      lines.push(' '.repeat(4 + caretCol - 1) + '^');
    }
    lines.push(p.msg);
    return lines.join('\n');
  }).join('\n\n');
}
await test('formatPreflightProblems: renders name error block', () => {
  const out = formatPreflightProblems([{ line: 2, col: 1, msg: "NameError: name 'prin' is not defined", text: 'prin("test")', kind: 'name' }], 'user.py');
  assertContains(out, 'File "user.py", line 2');
  assertContains(out, '    prin("test")');
  assertContains(out, '    ^');
  assertContains(out, "NameError: name 'prin' is not defined");
});
await test('formatPreflightProblems: caret indents by column', () => {
  const out = formatPreflightProblems([{ line: 1, col: 5, msg: 'X', text: 'abcd = z', kind: 'name' }], 'user.py');
  assertContains(out, '\n' + ' '.repeat(8) + '^');   // 4 + (5-1)
});
await test('formatPreflightProblems: no text → no caret line', () => {
  const out = formatPreflightProblems([{ line: 3, col: 1, msg: 'SyntaxError: bad', text: '', kind: 'syntax' }], 'user.py');
  assertContains(out, 'File "user.py", line 3');
  assertContains(out, 'SyntaxError: bad');
  assertNotContains(out, '^');
});
await test('formatPreflightProblems: joins multiple problems with blank line', () => {
  const out = formatPreflightProblems([
    { line: 1, col: 1, msg: 'A', text: 'x', kind: 'name' },
    { line: 2, col: 1, msg: 'B', text: 'y', kind: 'name' },
  ], 'user.py');
  assertContains(out, 'A\n\n  File');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. FRONTEND STATIC ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${C.bold}${C.blue}═══ 3. Frontend static analysis ═════════════════════════${C.reset}`);

const execSrc = readFileSync('src/features/execution.ts', 'utf8');
const outSrc  = readFileSync('src/components/output.ts', 'utf8');
const rpSrc   = readFileSync('src/features/run-panel.ts', 'utf8');
const idxSrc  = readFileSync('index.html', 'utf8');

// output.ts
await test('output.ts: exports escHtml',            () => assertContains(outSrc, 'export function escHtml('));
await test('output.ts: exports setOutputHtml',      () => assertContains(outSrc, 'export function setOutputHtml('));
await test('output.ts: setOutput uses innerHTML',   () => { const fn = outSrc.slice(outSrc.indexOf('export function setOutput('), outSrc.indexOf('export function appendOutput(')); assertContains(fn, 'innerHTML'); assertNotContains(fn, 'textContent ='); });
await test('output.ts: appendOutput uses innerHTML',() => assertContains(outSrc.slice(outSrc.indexOf('export function appendOutput(')), 'innerHTML'));
await test('output.ts: setOutputHtml no auto-escape (caller escapes)', () => assertNotContains(outSrc.slice(outSrc.indexOf('export function setOutputHtml(')), 'escHtml'));

// execution.ts
await test('execution.ts: imports setOutputHtml',             () => assertContains(execSrc, 'setOutputHtml'));
await test('execution.ts: pre-run TS gate present',           () => assertContains(execSrc, 'getModelMarkers('));
await test('execution.ts: pre-run TS gate checks Error sev',  () => assertContains(execSrc, 'MarkerSeverity.Error'));
await test('execution.ts: renderRunResult defined',           () => assertContains(execSrc, 'function renderRunResult('));
await test('execution.ts: renderRunResult called on result',  () => assertContains(execSrc, 'renderRunResult(data, lang.id)'));
await test('execution.ts: Compile error ❌ status',           () => assertContains(execSrc, "Compile error ❌"));
await test('execution.ts: Runtime error ❌ status',           () => assertContains(execSrc, "Runtime error ❌"));
await test('execution.ts: Ready ✅ status',                   () => assertContains(execSrc, "'Ready ✅'"));
await test('execution.ts: HTTP error uses setOutputHtml',     () => { const idx = execSrc.indexOf('if (!resp.ok)'); assertContains(execSrc.slice(idx, idx + 300), 'setOutputHtml('); });
await test('execution.ts: JSON parse error uses setOutputHtml',() => assertContains(execSrc, 'ERROR: Server returned no JSON'));
await test('execution.ts: catch block uses setOutputHtml',    () => { const idx = execSrc.lastIndexOf('} catch (e: any)'); assertContains(execSrc.slice(idx, idx + 300), 'setOutputHtml('); });
await test('execution.ts: esc() helper escapes &',            () => assert(/replace\(\/&\/g.*?&amp;/.test(execSrc.replace(/\s+/g,' '))));

// run-panel.ts
await test('run-panel.ts: imports setOutputHtml',              () => assertContains(rpSrc, 'setOutputHtml'));
await test('run-panel.ts: success status has ✅',             () => assertContains(rpSrc, '✅'));
await test('run-panel.ts: failure status has ❌',             () => assertContains(rpSrc, '❌'));
await test('run-panel.ts: exit code footer in output',         () => assertContains(rpSrc, '[exit code: ${data.exitCode}]'));
await test('run-panel.ts: HTTP error block uses setOutputHtml',() => { const i = rpSrc.indexOf('if (!res.ok)'); assertContains(rpSrc.slice(i, i + 400), 'setOutputHtml('); });
await test('run-panel.ts: network catch uses setOutputHtml',   () => { const i = rpSrc.lastIndexOf('} catch (e)'); assertContains(rpSrc.slice(i, i + 200), 'setOutputHtml('); });

// index.html
await test('index.html: .error CSS class',              () => assertContains(idxSrc, '.error { color: #f48771'));
await test('index.html: .success CSS class',            () => assertContains(idxSrc, '.success { color: #89d185'));
await test('index.html: .info CSS class',               () => assertContains(idxSrc, '.info { color: #75beff'));
await test('index.html: .warning CSS class',            () => assertContains(idxSrc, '.warning { color: #ce9178'));
await test('index.html: white-space: pre-wrap',         () => assertContains(idxSrc, 'white-space: pre-wrap'));
await test('index.html: direction: ltr on panel',       () => assertContains(idxSrc, 'direction: ltr'));

// turtle popup window — drawing lives in its own floating window, not the panel
const turtleSrc = readFileSync('src/components/turtle.ts', 'utf8');
await test('index.html: #turtle-window CSS present',    () => assertContains(idxSrc, '#turtle-window {'));
await test('index.html: #turtle-window fixed position', () => assertContains(idxSrc, 'position: fixed'));
await test('index.html: #turtle-window has close btn CSS',() => assertContains(idxSrc, '#turtle-window-close'));
await test('turtle.ts: creates #turtle-window popup',   () => assertContains(turtleSrc, "windowEl.id = 'turtle-window'"));
await test('turtle.ts: window appended to body',        () => assertContains(turtleSrc, 'document.body.appendChild(windowEl)'));
await test('turtle.ts: window is draggable',            () => assertContains(turtleSrc, 'function _makeDraggable('));
await test('turtle.ts: close button hides window',      () => assertContains(turtleSrc, 'clearTurtleCanvas()'));
await test('turtle.ts: clearTurtleCanvas hides window', () => { const fn = turtleSrc.slice(turtleSrc.indexOf('export function clearTurtleCanvas(')); assertContains(fn, "getElementById('turtle-window')"); assertContains(fn, "classList.add('hidden')"); });
await test('turtle.ts: no longer appends to panelEl',   () => assertNotContains(turtleSrc, 'panelEl.appendChild'));
await test('execution.ts: no turtle on compile error',  () => assertContains(execSrc, "data.phase !== 'compile' &&"));
await test('execution.ts: no turtle on runtime error',  () => assertContains(execSrc, "data.exitCode === 0 &&"));

// ═══════════════════════════════════════════════════════════════════════════════
// 4. INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${C.bold}${C.blue}═══ 4. Integration tests (server :3001) ══════════════════${C.reset}`);

let serverAvailable = false;
try {
  const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
  serverAvailable = r.ok || r.status < 500;
} catch {}

if (!serverAvailable) {
  console.log(`  ${INFO}  Server not reachable on :3001 — skipping all integration tests.`);
} else {

  // ── Probe: does node execution actually work? ────────────────────────────
  // In production mode the server strips PATH to Linux-only paths, so on a
  // Windows dev machine the node executable is not found.
  let jsExecWorks = false;
  try {
    const p = await apiRun({ language: 'javascript', code: "console.log('probe')" }, 6000);
    jsExecWorks = p.data.exitCode === 0 && !!p.data.stdout?.includes('probe');
  } catch {}

  // ── JavaScript ────────────────────────────────────────────────────────────
  console.log(`\n  ${C.dim}JavaScript${C.reset}`);

  await test('JS: response always has phase field', async () => {
    const { data } = await apiRun({ language: 'javascript', code: "console.log(1)" });
    assert('phase' in data, 'phase field must be in every response');
  });

  if (!jsExecWorks) {
    console.log(`  ${INFO}  Node exec unavailable on server side — skipping JS runtime tests`);
    skipTest('JS: basic stdout',                'node not in server PATH on this host');
    skipTest('JS: runtime error is phase=run',  'node not in server PATH');
    skipTest('JS: multiline output',            'node not in server PATH');
    skipTest('JS: HTML chars not mangled',      'node not in server PATH');
    skipTest('JS: empty program exit 0',        'node not in server PATH');
    skipTest('JS: concurrent requests',         'node not in server PATH');
  } else {
    await test('JS: basic stdout', async () => {
      const { data } = await apiRun({ language: 'javascript', code: "console.log('hello world')" });
      assertContains(data.stdout, 'hello world');
      assertEqual(data.exitCode, 0);
      assertEqual(data.phase, 'run');
    });

    await test('JS: runtime error is phase=run (not compile)', async () => {
      const { data } = await apiRun({ language: 'javascript', code: "throw new Error('boom')" });
      assert(data.exitCode !== 0, 'must fail');
      assertEqual(data.phase, 'run');
      assertContains(data.stderr, 'boom');
    });

    await test('JS: multiline output preserves newlines', async () => {
      const { data } = await apiRun({ language: 'javascript', code: "console.log('a');\nconsole.log('b');" });
      assertContains(data.stdout, 'a');
      assertContains(data.stdout, 'b');
      assertEqual(data.exitCode, 0);
    });

    await test('JS: HTML-special chars in stdout not mangled', async () => {
      const { data } = await apiRun({ language: 'javascript', code: "console.log('<b>hello</b> & world')" });
      assertContains(data.stdout, '<b>hello</b> & world');
    });

    await test('JS: empty program exits 0', async () => {
      const { data } = await apiRun({ language: 'javascript', code: '// nothing' });
      assertEqual(data.exitCode, 0);
    });

    await test('JS: 5 concurrent requests all succeed', async () => {
      const code = "console.log('par')";
      const results = await Promise.all(Array.from({length:5}, () => apiRun({language:'javascript', code})));
      for (const { data } of results) {
        assertContains(data.stdout, 'par');
        assertEqual(data.exitCode, 0);
      }
    });

    // ── Randomness: identical source must NOT produce identical output ───────
    // Regression guard for the execution result cache, which returned the first
    // run's stdout for every later run of the same code.
    const RAND_JS = 'console.log(Math.floor(Math.random()*1e9))';

    await test('JS: repeated identical runs give different random values', async () => {
      const out = [];
      for (let i = 0; i < 6; i++) {
        const { data } = await apiRun({ language: 'javascript', code: RAND_JS });
        assertEqual(data.exitCode, 0);
        out.push(data.stdout.trim());
      }
      assert(new Set(out).size >= 5, `6 runs produced ${new Set(out).size} distinct values: ${out.join(', ')}`);
    });

    await test('JS: concurrent identical runs give different random values', async () => {
      const results = await Promise.all(Array.from({length:6}, () => apiRun({ language: 'javascript', code: RAND_JS })));
      const out = results.map(r => r.data.stdout.trim());
      assert(new Set(out).size >= 5, `6 concurrent runs produced ${new Set(out).size} distinct values: ${out.join(', ')}`);
    });

    await test('JS: multi-file project re-randomises every run', async () => {
      const files = [
        { name: 'main.js', content: 'import { pick } from "./dice.js";\nconsole.log(pick());\n', isMain: true },
        { name: 'dice.js', content: 'export const pick = () => Math.floor(Math.random()*1e9);\n' },
      ];
      const out = [];
      for (let i = 0; i < 4; i++) {
        const { data } = await apiRun({ language: 'javascript', files, entryPoint: 'main.js' });
        assertEqual(data.exitCode, 0);
        out.push(data.stdout.trim());
      }
      assert(new Set(out).size >= 3, `4 runs produced ${new Set(out).size} distinct values: ${out.join(', ')}`);
    });

    await test('JS: response never claims cached:true', async () => {
      await apiRun({ language: 'javascript', code: "console.log('cachecheck')" });
      const { data } = await apiRun({ language: 'javascript', code: "console.log('cachecheck')" });
      assertEqual(data.cached, false, 'a repeated run must not be served from a cache');
    });
  }

  // ── TypeScript ────────────────────────────────────────────────────────────
  console.log(`\n  ${C.dim}TypeScript${C.reset}`);

  // Compile-phase tests work even without node (transpile happens server-side in JS).
  await test('TS: syntax error → phase=compile (pre-node)', async () => {
    const { data } = await apiRun({ language: 'typescript', code: "const x: = 5;" });
    assertEqual(data.exitCode, 1);
    assertEqual(data.phase, 'compile');
    assert(data.stderr && data.stderr.length > 0, 'compile error must have a message');
  });

  await test('TS: phase field always present', async () => {
    const { data } = await apiRun({ language: 'typescript', code: "console.log('hi')" });
    assert('phase' in data, 'phase must be in every response');
  });

  await test('TS: transpileModule error msg references user.ts (if errored)', async () => {
    const { data } = await apiRun({ language: 'typescript', code: "const x: = 5;" });
    assertContains(data.stderr, 'user.ts');
  });

  if (!jsExecWorks) {
    skipTest('TS: basic stdout',                  'node not in server PATH on this host');
    skipTest('TS: type annotations work',         'node not in server PATH');
    skipTest('TS: interfaces work',               'node not in server PATH');
    skipTest('TS: runtime error is phase=run',    'node not in server PATH');
  } else {
    await test('TS: basic stdout', async () => {
      const { data } = await apiRun({ language: 'typescript', code: "const x: number = 42;\nconsole.log(x);" });
      assertContains(data.stdout, '42');
      assertEqual(data.exitCode, 0);
      assertEqual(data.phase, 'run');
    });

    await test('TS: type annotations work (no false-positive error)', async () => {
      const { data } = await apiRun({ language: 'typescript', code: "function add(a:number,b:number):number{return a+b;}\nconsole.log(add(2,3));" });
      assertContains(data.stdout, '5');
      assertEqual(data.exitCode, 0);
    });

    await test('TS: interfaces work', async () => {
      const code = "interface P{x:number;y:number;}\nconst p:P={x:1,y:2};\nconsole.log(p.x+p.y);";
      const { data } = await apiRun({ language: 'typescript', code });
      assertContains(data.stdout, '3');
      assertEqual(data.exitCode, 0);
    });

    await test('TS: runtime error is phase=run', async () => {
      const { data } = await apiRun({ language: 'typescript', code: "throw new Error('ts runtime')" });
      assert(data.exitCode !== 0, 'must fail');
      assertEqual(data.phase, 'run');
      assertContains(data.stderr, 'ts runtime');
    });
  }

  // ── Python ────────────────────────────────────────────────────────────────
  console.log(`\n  ${C.dim}Python${C.reset}`);

  let pythonOk = false;
  try {
    const p = await apiRun({ language: 'python', code: "print('ptest')" }, 5000);
    pythonOk = p.data.exitCode === 0 && !!p.data.stdout?.includes('ptest');
  } catch {}

  if (!pythonOk) {
    ['basic stdout','syntax error → phase=compile','IndentationError → phase=compile',
     'runtime error stays phase=run','turtle data returned','temp path stripped from stderr',
     'random.randint differs every run','random.shuffle/choice differ every run',
     'multi-file random differs every run'
    ].forEach(n => skipTest(`Python: ${n}`, 'python3 not available on server'));
  } else {
    await test('Python: basic stdout', async () => {
      const { data } = await apiRun({ language: 'python', code: "print('hello py')" });
      assertContains(data.stdout, 'hello py');
      assertEqual(data.exitCode, 0);
      assertEqual(data.phase, 'run');
    });

    await test('Python: syntax error → phase=compile', async () => {
      const { data } = await apiRun({ language: 'python', code: "x = 1 2" });
      assertEqual(data.exitCode, 1);
      assertEqual(data.phase, 'compile');
      assertContains(data.stderr, 'SyntaxError');
    });

    await test('Python: IndentationError → phase=compile', async () => {
      const { data } = await apiRun({ language: 'python', code: "def f():\nx = 1" });
      assertEqual(data.exitCode, 1);
      assertEqual(data.phase, 'compile');
    });

    await test('Python: runtime NameError stays phase=run', async () => {
      const { data } = await apiRun({ language: 'python', code: "print(undefined_var)" });
      assert(data.exitCode !== 0);
      assertEqual(data.phase, 'run');
    });

    await test('Python: Traceback (runtime) stays phase=run', async () => {
      const { data } = await apiRun({ language: 'python', code: "raise ValueError('oops')" });
      assert(data.exitCode !== 0);
      assertEqual(data.phase, 'run');
      assertContains(data.stderr, 'Traceback');
    });

    await test('Python: temp path stripped from compile error', async () => {
      const { data } = await apiRun({ language: 'python', code: "x = 1 2" });
      assertNotContains(data.stderr, '/tmp/');
    });

    await test('Python: turtle data returned', async () => {
      const code = "import turtle\nt=turtle.Turtle()\nt.forward(50)";
      const { data } = await apiRun({ language: 'python', code }, 15000);
      assertEqual(data.exitCode, 0);
      assert(data.turtleData, 'turtleData must be in response');
      assert(Array.isArray(data.turtleData.shapes), 'turtleData.shapes must be an array');
    });

    // ── Randomness: the originally reported bug ───────────────────────────────
    // "import random; print(random.randint(1,100))" printed the same number on
    // every run because the server replayed the cached stdout instead of
    // starting a new Python process.
    await test('Python: random.randint differs every run', async () => {
      const code = 'import random\nprint(random.randint(1, 1000000))';
      const out = [];
      for (let i = 0; i < 6; i++) {
        const { data } = await apiRun({ language: 'python', code });
        assertEqual(data.exitCode, 0);
        out.push(data.stdout.trim());
      }
      assert(new Set(out).size >= 5, `6 runs produced ${new Set(out).size} distinct values: ${out.join(', ')}`);
    });

    await test('Python: random.shuffle/choice differ every run', async () => {
      const code = [
        'import random',
        'cards = list(range(1, 15))',
        'random.shuffle(cards)',
        'print(cards, random.choice(cards), random.random())',
      ].join('\n');
      const out = [];
      for (let i = 0; i < 5; i++) {
        const { data } = await apiRun({ language: 'python', code });
        assertEqual(data.exitCode, 0);
        out.push(data.stdout.trim());
      }
      assert(new Set(out).size >= 4, `5 runs produced ${new Set(out).size} distinct values`);
    });

    await test('Python: multi-file random differs every run', async () => {
      const files = [
        { name: 'main.py', content: 'from dice import roll\nprint(roll())\n', isMain: true },
        { name: 'dice.py', content: 'import random\n\n\ndef roll():\n    return random.randint(1, 1000000)\n' },
      ];
      const out = [];
      for (let i = 0; i < 4; i++) {
        const { data } = await apiRun({ language: 'python', files, entryPoint: 'main.py' });
        assertEqual(data.exitCode, 0);
        out.push(data.stdout.trim());
      }
      assert(new Set(out).size >= 3, `4 runs produced ${new Set(out).size} distinct values: ${out.join(', ')}`);
    });
  }

  // ── Java ──────────────────────────────────────────────────────────────────
  console.log(`\n  ${C.dim}Java${C.reset}`);

  let javaOk = false;
  try {
    const p = await apiRun({ language: 'java', code: 'public class Main{public static void main(String[] a){System.out.println("jtest");}}' }, 30000);
    javaOk = p.data.exitCode === 0 && !!p.data.stdout?.includes('jtest');
  } catch {}

  if (!javaOk) {
    ['basic stdout','compile error → phase=compile','compile stderr no temp path','runtime exception stays phase=run'
    ].forEach(n => skipTest(`Java: ${n}`, 'javac not available on server'));
  } else {
    await test('Java: basic stdout', async () => {
      const { data } = await apiRun({ language: 'java', code: 'public class Main{public static void main(String[] a){System.out.println("hello java");}}' }, 30000);
      assertContains(data.stdout, 'hello java');
      assertEqual(data.exitCode, 0);
    });

    await test('Java: compile error → phase=compile', async () => {
      const { data } = await apiRun({ language: 'java', code: 'public class Main{public static void main(String[] a){int x = "oops"}}' }, 30000);
      assertEqual(data.exitCode, 1);
      assertEqual(data.phase, 'compile');
    });

    await test('Java: compile stderr has no temp path', async () => {
      const { data } = await apiRun({ language: 'java', code: 'public class Main{public static void main(String[] a){int x = "oops"}}' }, 30000);
      assertNotContains(data.stderr, '/tmp/');
    });

    await test('Java: runtime exception stays phase=run', async () => {
      const { data } = await apiRun({ language: 'java', code: 'public class Main{public static void main(String[] a){throw new RuntimeException("boom");}}' }, 30000);
      assert(data.exitCode !== 0);
      assertEqual(data.phase, 'run');
    });
  }

  // ── C# ────────────────────────────────────────────────────────────────────
  console.log(`\n  ${C.dim}C#${C.reset}`);

  let csOk = false;
  try {
    const p = await apiRun({ language: 'csharp', code: 'System.Console.WriteLine("cstest");' }, 60000);
    csOk = p.data.exitCode === 0 && !!p.data.stdout?.includes('cstest');
  } catch {}

  if (!csOk) {
    ['basic stdout','compile error → phase=compile','compile error no project path','runtime error stays phase=run'
    ].forEach(n => skipTest(`C#: ${n}`, 'dotnet not available or template not ready'));
  } else {
    await test('C#: basic stdout', async () => {
      const { data } = await apiRun({ language: 'csharp', code: 'System.Console.WriteLine("hello csharp");' }, 60000);
      assertContains(data.stdout, 'hello csharp');
      assertEqual(data.exitCode, 0);
    });

    await test('C#: compile error → phase=compile', async () => {
      const { data } = await apiRun({ language: 'csharp', code: 'int x = "oops";' }, 60000);
      assertEqual(data.exitCode, 1);
      assertEqual(data.phase, 'compile');
      assertContains(data.stderr, 'CS');
    });

    await test('C#: compile error has no project path', async () => {
      const { data } = await apiRun({ language: 'csharp', code: 'int x = "oops";' }, 60000);
      assertNotContains(data.stderr ?? '', '/tmp/');
    });

    await test('C#: runtime error stays phase=run', async () => {
      const { data } = await apiRun({ language: 'csharp', code: 'throw new System.Exception("cs boom");' }, 60000);
      assert(data.exitCode !== 0);
      assertEqual(data.phase, 'run');
    });
  }

  // ── PHP ───────────────────────────────────────────────────────────────────
  console.log(`\n  ${C.dim}PHP${C.reset}`);

  let phpOk = false;
  try {
    const p = await apiRun({ language: 'php', code: '<?php echo "phptest";' }, 10000);
    phpOk = p.data.exitCode === 0 && !!p.data.stdout?.includes('phptest');
  } catch {}

  if (!phpOk) {
    ['basic stdout','parse error → phase=compile','parse error no temp path','runtime error stays phase=run'
    ].forEach(n => skipTest(`PHP: ${n}`, 'php not available on server'));
  } else {
    await test('PHP: basic stdout', async () => {
      const { data } = await apiRun({ language: 'php', code: '<?php echo "hello php";' });
      assertContains(data.stdout, 'hello php');
      assertEqual(data.exitCode, 0);
    });

    await test('PHP: parse error → phase=compile', async () => {
      const { data } = await apiRun({ language: 'php', code: '<?php echo "hi"' }); // missing ;
      assertEqual(data.exitCode, 1);
      assertEqual(data.phase, 'compile');
    });

    await test('PHP: parse error has no temp path', async () => {
      const { data } = await apiRun({ language: 'php', code: '<?php echo "hi"' });
      assertNotContains(data.stderr ?? '', '/tmp/');
    });

    await test('PHP: runtime exception stays phase=run', async () => {
      const { data } = await apiRun({ language: 'php', code: '<?php throw new Exception("php boom");' });
      assert(data.exitCode !== 0);
      assertEqual(data.phase, 'run');
    });
  }

  // ── Edge cases ─────────────────────────────────────────────────────────────
  console.log(`\n  ${C.dim}Edge cases${C.reset}`);

  await test('API: response always has stdout, stderr, exitCode, phase', async () => {
    const { data } = await apiRun({ language: 'javascript', code: "console.log('ok')" });
    ['stdout','stderr','exitCode','phase'].forEach(k => assert(k in data, `missing ${k} — this was the original bug!`));
  });

  await test('API: phase=run for successful JS (default when no compile error)', async () => {
    const { data } = await apiRun({ language: 'javascript', code: "console.log(1)" });
    assertEqual(data.phase, 'run');
  });

  await test('API: invalid language returns 4xx', async () => {
    const { status } = await apiRun({ language: 'cobol', code: "hello" });
    assert(status >= 400, `expected 4xx for unknown language, got ${status}`);
  });

  await test('API: empty code returns 400 (not a crash)', async () => {
    const { status } = await apiRun({ language: 'javascript', code: '' });
    assertEqual(status, 400, 'empty code should be rejected with 400');
  });

  if (jsExecWorks) {
    await test('API: very long output truncated gracefully', async () => {
      const code = "for(let i=0;i<100000;i++) process.stdout.write('x'.repeat(200)+'\\n');";
      const { data } = await apiRun({ language: 'javascript', code }, 15000);
      assert('exitCode' in data, 'must return a result');
      const total = (data.stdout?.length ?? 0) + (data.stderr?.length ?? 0);
      assert(total < 50_000_000, 'output must not be unbounded');
    });
  }

} // end serverAvailable block

// ═══════════════════════════════════════════════════════════════════════════════
// 5. TYPESCRIPT COMPILER PACKAGE
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${C.bold}${C.blue}═══ 5. TypeScript compiler availability ══════════════════${C.reset}`);

let tsVersion = null;
try { const m = await import('typescript'); tsVersion = (m.default || m).version; } catch {}

await test('typescript importable in Node (is in dependencies, not devDeps)', () => {
  assert(tsVersion, 'typescript package must be importable at runtime');
  console.log(`       ${C.dim}version: ${tsVersion}${C.reset}`);
});

await test('transpileModule: valid TS has no diagnostics', async () => {
  const { default: ts } = await import('typescript');
  const r = ts.transpileModule('const x: number = 1; console.log(x);', { fileName:'t.ts', compilerOptions:{module:ts.ModuleKind.ESNext}, reportDiagnostics:true });
  assert(r.outputText, 'must produce output');
  assert(!r.diagnostics || r.diagnostics.length === 0, 'valid TS must have no diagnostics');
});

await test('transpileModule: syntax error produces diagnostics', async () => {
  const { default: ts } = await import('typescript');
  const r = ts.transpileModule('const x: = 5;', { fileName:'t.ts', compilerOptions:{module:ts.ModuleKind.ESNext}, reportDiagnostics:true });
  assert(r.diagnostics && r.diagnostics.length > 0, 'bad TS must produce diagnostics');
});

await test('transpileModule: type annotations are stripped', async () => {
  const { default: ts } = await import('typescript');
  const r = ts.transpileModule('const greet = (name: string): void => console.log(name);', { fileName:'t.ts', compilerOptions:{module:ts.ModuleKind.ESNext}, reportDiagnostics:true });
  assertNotContains(r.outputText, ': string');
  assertNotContains(r.outputText, ': void');
  assertContains(r.outputText, 'console.log');
});

// ─── Summary ──────────────────────────────────────────────────────────────────
const total = passed + failed + skipped;
console.log(`\n${C.bold}${'─'.repeat(62)}${C.reset}`);
console.log(`${C.bold}Results: ${C.green}${passed} passed${C.reset}  ${failed > 0 ? C.red : ''}${failed} failed${C.reset}  ${C.yellow}${skipped} skipped${C.reset}  (${total} total)`);

if (failures.length > 0) {
  console.log(`\n${C.red}${C.bold}Failed tests:${C.reset}`);
  for (const f of failures) {
    console.log(`  ${C.red}✗ ${f.name}${C.reset}`);
    console.log(`    ${C.dim}${f.error}${C.reset}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
