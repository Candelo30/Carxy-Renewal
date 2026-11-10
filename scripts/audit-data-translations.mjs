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
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) continue;
  const source = fs.readFileSync(absolute, 'utf8');
  for (const match of source.matchAll(/^\s*(['"])((?:\\.|(?!\1).)*)\1\s*:/gm)) {
    dictionary.add(match[2].replace(/\\(['"\\])/g, '$1'));
  }
}

const targets = [
  'src/app/features/about/about-page.ts',
  'src/app/features/getting-started/getting-started-page.ts',
  'src/app/features/help/help-page.ts',
  'src/app/core/services/onboarding.ts',
  'src/app/features/feed/feed-page.ts',
];

const missing = new Map();
for (const relative of targets) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^\s*import\b/.test(line)) return;
    if (/console\.(log|warn|error)/.test(line)) return;
    for (const match of line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const value = match[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      if (value.length < 4) continue;
      if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ¿¡]/.test(value)) continue;
      if (/^(https?:|\/|#|\.|@|[a-z-]+\/[a-z-]+)/.test(value)) continue;
      if (/^[a-z0-9_-]+$/.test(value)) continue;
      if (!/\s/.test(value)) continue;
      if (dictionary.has(value)) continue;
      if (!missing.has(value)) missing.set(value, `${relative}:${index + 1}`);
    }
  });
}

console.log(`Possible missing data strings: ${missing.size}`);
for (const [value, location] of [...missing.entries()].sort((a, b) => a[1].localeCompare(b[1]))) {
  console.log(`${location}\t${JSON.stringify(value)}`);
}
