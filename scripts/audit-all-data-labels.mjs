import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dictionaryFiles = [
  'src/app/core/i18n/page-translations.ts',
  'src/app/core/i18n/messages.ts',
  'src/app/core/i18n/source-translations.ts',
  'src/app/core/i18n/feature-translations.ts',
];
const dictionary = new Set();
for (const relative of dictionaryFiles) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const match of source.matchAll(/^\s*(['"])((?:\\.|(?!\1).)*)\1\s*:/gm)) {
    dictionary.add(match[2].replace(/\\(['"\\])/g, '$1'));
  }
}

function walk(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(absolute));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) output.push(absolute);
  }
  return output;
}

const targets = walk(path.join(root, 'src/app/features'))
  .concat(walk(path.join(root, 'src/app/shared')))
  .concat(walk(path.join(root, 'src/app/core/services')));

const missing = new Map();
for (const absolute of targets) {
  const relative = path.relative(root, absolute).replace(/\\/g, '/');
  const source = fs.readFileSync(absolute, 'utf8');
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^\s*import\b/.test(line)) return;
    if (/console\.(log|warn|error)/.test(line)) return;
    for (const match of line.matchAll(/\b(?:label|title|description|summary|tip|placeholder|message|text)\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const value = match[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      if (value.length < 3) continue;
      if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ¿¡]/.test(value)) continue;
      if (/^(https?:|\/|#|\.|@|[a-z-]+\/[a-z-]+)/.test(value)) continue;
      if (/^[a-z0-9_-]+$/.test(value)) continue;
      if (dictionary.has(value)) continue;
      if (!missing.has(value)) missing.set(value, `${relative}:${index + 1}`);
    }
  });
}

console.log(`Etiquetas de datos sin traducir: ${missing.size}`);
for (const [value, location] of [...missing.entries()].sort((a, b) => a[1].localeCompare(b[1]))) {
  console.log(`${location}\t${JSON.stringify(value)}`);
}
