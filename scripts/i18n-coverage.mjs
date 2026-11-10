import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const appRoot = path.join(root, 'src', 'app');
const localesDir = path.join(root, 'src', 'app', 'core', 'i18n', 'locales');

function walk(directory, extension, callback) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, extension, callback);
    else if (entry.name.endsWith(extension)) callback(full);
  }
}

function unescapeLiteral(value) {
  return value.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function collectUsedKeys() {
  const used = new Set();
  walk(appRoot, '.html', (file) => {
    const source = fs.readFileSync(file, 'utf8');
    const regex = /(['"])((?:\\.|(?!\1).)*)\1\s*\|\s*translate\b/g;
    let match;
    while ((match = regex.exec(source))) used.add(unescapeLiteral(match[2]));
  });
  walk(appRoot, '.ts', (file) => {
    const source = fs.readFileSync(file, 'utf8');
    const regex = /\.translate\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
    let match;
    while ((match = regex.exec(source))) used.add(unescapeLiteral(match[2]));
  });
  return used;
}

function collectOverlayKeys(code) {
  const keys = new Set();
  for (const suffix of ['', '.editor', '.extra']) {
    const file = path.join(localesDir, `${code}${suffix}.ts`);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^\s*'([^']+)'\s*:/gm)) keys.add(match[1]);
  }
  return keys;
}

const used = collectUsedKeys();
const baseLanguages = new Set(['es', 'en', 'fr', 'pt']);
const available = fs.readdirSync(localesDir)
  .filter((file) => /^[a-z]{2}\.ts$/.test(file))
  .map((file) => file.slice(0, 2));
const requested = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const targets = requested.length ? requested : available;
const showMissing = process.argv.includes('--missing');
const strict = process.argv.includes('--strict');

for (const code of targets) {
  const overlay = collectOverlayKeys(code);
  const translated = [...used].filter((key) => baseLanguages.has(code) || overlay.has(key));
  const missing = [...used].filter((key) => !baseLanguages.has(code) && !overlay.has(key));
  const percentage = used.size ? ((translated.length / used.size) * 100).toFixed(1) : '100.0';
  console.log(`${code}: ${translated.length}/${used.size} claves usadas (${percentage}%)`);
  if (showMissing && missing.length) {
    console.log(`  Faltan en ${code}.ts / ${code}.editor.ts:`);
    for (const key of missing) console.log(`    ${JSON.stringify(key)}`);
  }
  if (strict && missing.length) process.exitCode = 1;
}
