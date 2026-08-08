import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE_ROOTS = ['src', 'server', 'languages', 'security'];
const ROOT_FILES = ['server.mjs'];
const CODE_EXTENSIONS = ['.ts', '.mts', '.js', '.mjs'];

function collectFiles(directory, output) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(absolute, output);
    else if (CODE_EXTENSIONS.includes(path.extname(entry.name))) output.push(path.resolve(absolute));
  }
}

const files = ROOT_FILES.map(file => path.resolve(ROOT, file));
for (const directory of SOURCE_ROOTS) collectFiles(path.resolve(ROOT, directory), files);
const knownFiles = new Set(files);

function resolveCodeImport(importer, specifier) {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    base,
    ...CODE_EXTENSIONS.map(extension => base + extension),
    ...CODE_EXTENSIONS.map(extension => path.join(base, `index${extension}`)),
  ];
  return candidates.find(candidate => knownFiles.has(candidate)) ?? null;
}

function relativeImports(source) {
  const imports = [];
  // Type-only imports are erased and cannot create a runtime initialization cycle.
  const staticPattern =
    /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s*)?['"](\.[^'"]+)['"]/g;
  const dynamicPattern = /import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(staticPattern)) imports.push(match[1]);
  for (const match of source.matchAll(dynamicPattern)) imports.push(match[1]);
  return imports;
}

const graph = new Map();
for (const file of files) {
  const dependencies = relativeImports(fs.readFileSync(file, 'utf8'))
    .map(specifier => resolveCodeImport(file, specifier))
    .filter(Boolean);
  graph.set(file, dependencies);
}

const visiting = new Set();
const visited = new Set();
const stack = [];
const cycles = [];

function visit(file) {
  if (visited.has(file)) return;
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    cycles.push([...stack.slice(start), file]);
    return;
  }

  visiting.add(file);
  stack.push(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

for (const file of files) visit(file);

const uniqueCycles = new Map();
for (const cycle of cycles) {
  const names = cycle.slice(0, -1).map(file =>
    path.relative(ROOT, file).replaceAll(path.sep, '/'));
  const rotations = names.map((_, index) => [...names.slice(index), ...names.slice(0, index)]);
  rotations.sort((a, b) => a.join('|').localeCompare(b.join('|')));
  uniqueCycles.set(rotations[0].join('|'), rotations[0]);
}

if (uniqueCycles.size > 0) {
  console.error('Runtime import cycles:');
  for (const cycle of uniqueCycles.values()) {
    console.error(`  ${cycle.join(' -> ')} -> ${cycle[0]}`);
  }
  process.exitCode = 1;
} else {
  console.log(`architecture: ${files.length} source modules, no runtime import cycles`);
}
