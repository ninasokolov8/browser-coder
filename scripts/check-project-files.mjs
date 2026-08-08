/**
 * Repository-wide file hygiene gate.
 *
 * The list comes from Git, so generated output, dependencies and ignored reports
 * are outside the project inventory while new untracked source files are included.
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const BINARY_EXTENSIONS = new Set([
  '.gif', '.ico', '.jpeg', '.jpg', '.otf', '.pdf', '.png', '.ttf', '.webp',
  '.woff', '.woff2', '.zip',
]);
const JAVASCRIPT_EXTENSIONS = new Set(['.cjs', '.js', '.mjs']);
const decoder = new TextDecoder('utf-8', { fatal: true });

function projectFiles() {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
    .filter(existsSync)
    .sort();
}

function addFailure(failures, file, problem) {
  failures.push(`${file}: ${problem}`);
}

const files = projectFiles();
const failures = [];
const caseInsensitivePaths = new Map();
let binaryCount = 0;
let textCount = 0;

for (const file of files) {
  const normalizedPath = file.toLowerCase();
  const collision = caseInsensitivePaths.get(normalizedPath);
  if (collision) {
    addFailure(failures, file, `case-insensitive path collision with ${collision}`);
  } else {
    caseInsensitivePaths.set(normalizedPath, file);
  }

  const bytes = readFileSync(file);
  const extension = path.extname(file).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) {
    binaryCount += 1;
    continue;
  }

  textCount += 1;
  if (bytes.length === 0) {
    addFailure(failures, file, 'empty text file');
    continue;
  }

  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    addFailure(failures, file, 'not valid UTF-8');
    continue;
  }

  if (text.includes('\0')) addFailure(failures, file, 'contains a literal NUL byte');
  if (text.includes('\r')) addFailure(failures, file, 'contains CR/CRLF instead of LF');
  if (!text.endsWith('\n')) addFailure(failures, file, 'missing final newline');
  if (extension !== '.md' && /[ \t]+$/m.test(text)) {
    addFailure(failures, file, 'contains trailing whitespace');
  }

  if (extension === '.json' && !path.basename(file).startsWith('tsconfig')) {
    try {
      JSON.parse(text);
    } catch (error) {
      addFailure(failures, file, `invalid JSON (${error.message})`);
    }
  }

  if (JAVASCRIPT_EXTENSIONS.has(extension)) {
    const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (syntax.status !== 0) {
      const detail = (syntax.stderr || syntax.stdout || 'syntax check failed').trim();
      addFailure(failures, file, detail);
    }
  }
}

if (failures.length > 0) {
  console.error(`Project file check failed (${failures.length} problem${failures.length === 1 ? '' : 's'}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Project files clean: ${files.length} total (${textCount} text, ${binaryCount} binary).`);
}
