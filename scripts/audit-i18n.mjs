import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appRoot = path.join(root, 'src', 'app');

function walk(directory, extension, callback) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, extension, callback);
    else if (entry.name.endsWith(extension)) callback(full);
  }
}

function collectDictionaryKeys() {
  const files = [
    'src/app/core/i18n/page-translations.ts',
    'src/app/core/i18n/messages.ts',
    'src/app/core/i18n/source-translations.ts',
    'src/app/core/i18n/feature-translations.ts',
  ];
  const keys = new Set();
  for (const relative of files) {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    for (const match of source.matchAll(/^\s*(['"])((?:\\.|(?!\1).)*)\1\s*:/gm)) {
      keys.add(match[2].replace(/\\(['"\\])/g, '$1'));
    }
  }
  return keys;
}

function unescapeLiteral(value) {
  return value.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function collectTemplateKeys() {
  const used = [];
  walk(appRoot, '.html', (file) => {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const pipeRegex = /(['"])((?:\\.|(?!\1).)*)\1\s*\|\s*translate\b/g;
      let match;
      while ((match = pipeRegex.exec(line))) {
        used.push({
          key: unescapeLiteral(match[2]),
          file: path.relative(root, file),
          line: index + 1,
        });
      }
    });
  });
  return used;
}

function collectServiceKeys() {
  const used = [];
  walk(appRoot, '.ts', (file) => {
    const source = fs.readFileSync(file, 'utf8');
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      const callRegex = /\.translate\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
      let match;
      while ((match = callRegex.exec(line))) {
        used.push({
          key: unescapeLiteral(match[2]),
          file: path.relative(root, file),
          line: index + 1,
        });
      }
    });
  });
  return used;
}

const dictionary = collectDictionaryKeys();
const used = [...collectTemplateKeys(), ...collectServiceKeys()];
const missingMap = new Map();
for (const entry of used) {
  if (!entry.key || dictionary.has(entry.key)) continue;
  if (!missingMap.has(entry.key)) missingMap.set(entry.key, []);
  missingMap.get(entry.key).push(`${entry.file}:${entry.line}`);
}

const hardcodedLanguage = [];
walk(appRoot, '.html', (file) => {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/\[\s*language\s*\]\s*=\s*["']es["']/.test(line) || /language\s*===\s*['"]es['"]/.test(line)) {
      hardcodedLanguage.push(`${path.relative(root, file)}:${index + 1}: ${line.trim()}`);
    }
  });
});

console.log(`Dictionary keys: ${dictionary.size}`);
console.log(`Translated usages: ${used.length}`);
console.log(`Missing keys: ${missingMap.size}`);
for (const [key, locations] of [...missingMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`MISSING  ${JSON.stringify(key)}  (${locations.slice(0, 3).join(', ')})`);
}
console.log(`Hardcoded language bindings: ${hardcodedLanguage.length}`);
for (const entry of hardcodedLanguage) console.log(`HARDCODED  ${entry}`);

if (missingMap.size > 0 || hardcodedLanguage.length > 0) process.exitCode = 1;
