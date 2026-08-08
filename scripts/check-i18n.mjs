import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const localeDir = path.join(root, 'src', 'i18n', 'locales');
const pluralSuffix = /\.(?:zero|one|two|few|many|other)$/;
const dynamicFamilies = ['format.reason.', 'problems.severity.'];
const failures = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function readLocale(fileName) {
  const filePath = path.join(localeDir, fileName);
  const source = fs.readFileSync(filePath, 'utf8');
  const keys = [...source.matchAll(/^\s*"([^"]+)"\s*:/gm)].map(match => match[1]);
  const duplicates = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  if (duplicates.length) failures.push(`${fileName} has duplicate keys: ${duplicates.join(', ')}`);
  try {
    return JSON.parse(source);
  } catch (error) {
    failures.push(`${fileName} is not valid JSON: ${error.message}`);
    return {};
  }
}

const localeFiles = fs.readdirSync(localeDir).filter(name => name.endsWith('.json')).sort();
const locales = new Map(localeFiles.map(file => [file.replace(/\.json$/, ''), readLocale(file)]));
const english = locales.get('en') ?? {};
const englishKeys = Object.keys(english).sort();

if (localeFiles.length < 2) failures.push('At least two locale files are required.');

const placeholders = value =>
  [...String(value).matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort();

for (const [code, locale] of locales) {
  const keys = Object.keys(locale).sort();
  const missing = englishKeys.filter(key => !(key in locale));
  const extra = keys.filter(key => !(key in english));
  if (missing.length) failures.push(`${code}.json is missing: ${missing.join(', ')}`);
  if (extra.length) failures.push(`${code}.json has extra keys: ${extra.join(', ')}`);

  for (const [key, value] of Object.entries(locale)) {
    if (typeof value !== 'string' || value.trim() === '') {
      failures.push(`${code}.${key} must be a non-empty string.`);
      continue;
    }
    if (key in english && placeholders(value).join('\0') !== placeholders(english[key]).join('\0')) {
      failures.push(`${code}.${key} has different placeholders from en.${key}.`);
    }
  }
}

const sourceFiles = [
  ...walk(path.join(root, 'src')).filter(file => file.endsWith('.ts') && !file.startsWith(localeDir)),
  path.join(root, 'index.html'),
];
const sources = sourceFiles.map(file => fs.readFileSync(file, 'utf8'));
const sourceText = sources.join('\n');
const referenced = new Set();

for (const source of sources) {
  for (const match of source.matchAll(/\b(?:t|tn)\(\s*(['"])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g)) {
    referenced.add(match[2]);
  }
  for (const match of source.matchAll(/data-i18n(?:-title|-placeholder|-aria-label)?=["']([^"']+)["']/g)) {
    referenced.add(match[1]);
  }
}

for (const key of referenced) {
  const exists = key in english || englishKeys.some(candidate => candidate.startsWith(`${key}.`));
  if (!exists) failures.push(`Source references missing translation key: ${key}`);
}

// Registry titles and key maps are translated later through t(variable), so count
// any exact dotted string literal as a use as well as direct t()/data-i18n calls.
const literalKeys = new Set(referenced);
for (const match of sourceText.matchAll(/(['"])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g)) {
  if (match[2] in english) literalKeys.add(match[2]);
}

const unused = englishKeys.filter(key => {
  const base = key.replace(pluralSuffix, '');
  return !literalKeys.has(key)
    && !literalKeys.has(base)
    && !dynamicFamilies.some(prefix => key.startsWith(prefix));
});
if (unused.length) failures.push(`Unused translation keys: ${unused.join(', ')}`);

// The security-report hub is a standalone static surface, so it has its own small
// catalog. Hold it to the same parity/usage standard as the main IDE.
const { reportLocales } = await import(
  `../security/reports/locales.js?i18n-check=${Date.now()}`
);
const reportEnglish = reportLocales.en ?? {};
const reportKeys = Object.keys(reportEnglish).sort();
const reportHtml = fs.readFileSync(path.join(root, 'security', 'reports', 'index.html'), 'utf8');
const reportScript = fs.readFileSync(path.join(root, 'security', 'reports', 'index.js'), 'utf8');
const reportReferenced = new Set(
  [...reportHtml.matchAll(/data-i18n=["']([^"']+)["']/g)].map(match => match[1]),
);
for (const match of reportScript.matchAll(/i18n\[[^\]]+\]\.([A-Za-z]\w*)/g)) {
  reportReferenced.add(match[1]);
}

for (const [code, locale] of Object.entries(reportLocales)) {
  const keys = Object.keys(locale).sort();
  const missing = reportKeys.filter(key => !(key in locale));
  const extra = keys.filter(key => !(key in reportEnglish));
  if (missing.length) failures.push(`report ${code} is missing: ${missing.join(', ')}`);
  if (extra.length) failures.push(`report ${code} has extra keys: ${extra.join(', ')}`);
  for (const [key, value] of Object.entries(locale)) {
    if (typeof value === 'string' && value.trim() === '') {
      failures.push(`report ${code}.${key} must not be empty`);
    }
    if (Array.isArray(value) && value.some(item => typeof item !== 'string' || item.trim() === '')) {
      failures.push(`report ${code}.${key} contains an empty translation`);
    }
    if (key in reportEnglish && Array.isArray(value) !== Array.isArray(reportEnglish[key])) {
      failures.push(`report ${code}.${key} has a different value shape from English`);
    }
  }
}

for (const key of reportReferenced) {
  if (!(key in reportEnglish)) failures.push(`Report hub references missing translation key: ${key}`);
}
const unusedReportKeys = reportKeys.filter(key => !reportReferenced.has(key));
if (unusedReportKeys.length) {
  failures.push(`Unused report-hub translation keys: ${unusedReportKeys.join(', ')}`);
}

// Security reports keep fixture names/code in English, but every educational
// explanation has a Hebrew overlay. The overlay must not duplicate executable
// assertions, because that previously let the two languages disagree about
// whether a case was safe or blocked.
const securityLanguages = ['javascript', 'typescript', 'python', 'php', 'java', 'csharp'];
let securityExplanationCount = 0;
for (const language of securityLanguages) {
  const englishModule = await import(
    `../tests/security/attacks/${language}.mjs?i18n-check=${Date.now()}`
  );
  const hebrewModule = await import(
    `../security/attacks/${language}_he.mjs?i18n-check=${Date.now()}`
  );
  const englishTests = Object.values(englishModule).find(Array.isArray) ?? [];
  const hebrewExports = Object.values(hebrewModule);
  const hebrewExplanations = hebrewExports[0] ?? {};

  if (hebrewExports.length !== 1 || Array.isArray(hebrewExplanations)) {
    failures.push(`${language} Hebrew security locale must export one explanation catalog.`);
    continue;
  }

  const englishNames = englishTests.map(test => test.name).sort();
  const hebrewNames = Object.keys(hebrewExplanations).sort();
  const missing = englishNames.filter(name => !(name in hebrewExplanations));
  const extra = hebrewNames.filter(name => !englishNames.includes(name));
  if (missing.length) failures.push(`${language} Hebrew security locale is missing: ${missing.join(', ')}`);
  if (extra.length) failures.push(`${language} Hebrew security locale has extra names: ${extra.join(', ')}`);

  for (const [name, explanation] of Object.entries(hebrewExplanations)) {
    securityExplanationCount += 1;
    if (typeof explanation !== 'string' || !/[\u0590-\u05ff]/.test(explanation)) {
      failures.push(`${language}/${name} must contain a Hebrew explanation.`);
    }
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`i18n: ${failure}`);
  process.exit(1);
}

console.log(
  `i18n: ${localeFiles.length} IDE locales (${englishKeys.length} keys), ` +
  `${Object.keys(reportLocales).length} report locales (${reportKeys.length} keys), ` +
  `${securityExplanationCount} security explanations, ` +
  `${sourceFiles.length} source files checked`,
);
