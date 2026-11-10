import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const messagesSource = fs.readFileSync(path.join(root, 'src/app/core/i18n/messages.ts'), 'utf8');
const i18nSource = fs.readFileSync(path.join(root, 'src/app/core/services/i18n.ts'), 'utf8');

const messages = new Set();
for (const match of messagesSource.matchAll(/^\s*(['"])((?:\\.|(?!\1).)*)\1\s*:/gm)) {
  messages.add(match[2].replace(/\\(['"\\])/g, '$1'));
}

const spanish = new Set();
const spanishBlock = i18nSource.slice(i18nSource.indexOf('private spanishMessage'));
for (const match of spanishBlock.matchAll(/^\s*(['"])((?:\\.|(?!\1).)*)\1\s*:/gm)) {
  spanish.add(match[2].replace(/\\(['"\\])/g, '$1'));
}

function walk(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(absolute));
    else if ((entry.name.endsWith('.ts') || entry.name.endsWith('.html')) && !entry.name.endsWith('.spec.ts')) {
      output.push(absolute);
    }
  }
  return output;
}

const files = walk(path.join(root, 'src/app'));
const used = new Map();
const dynamicPrefixes = new Set();

for (const absolute of files) {
  const relative = path.relative(root, absolute).replace(/\\/g, '/');
  const source = fs.readFileSync(absolute, 'utf8');
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/(['"])([a-zA-Z][\w-]*(?:\.[\w-]+)+)\1\s*(?:\|\s*translate|\))/g)) {
      const key = match[2];
      if (!used.has(key)) used.set(key, `${relative}:${index + 1}`);
    }
    for (const match of line.matchAll(/(['"])([a-zA-Z][\w-]*\.[\w.-]*)\1\s*\+/g)) {
      dynamicPrefixes.add(match[2]);
    }
  });
}

for (const prefix of dynamicPrefixes) {
  for (const key of messages) {
    if (key.startsWith(prefix) && !used.has(key)) {
      used.set(key, `dynamic:${prefix}`);
    }
  }
}

const missingMessages = [];
const missingSpanish = [];
for (const [key, location] of used) {
  if (!messages.has(key)) missingMessages.push(`${location}\t${key}`);
  if (!spanish.has(key)) missingSpanish.push(`${location}\t${key}`);
}

console.log(`Claves semánticas usadas: ${used.size}`);
console.log(`Sin entrada en MESSAGES: ${missingMessages.length}`);
for (const line of missingMessages) console.log(line);
console.log(`Sin texto en español (spanishMessage): ${missingSpanish.length}`);
for (const line of missingSpanish) console.log(line);
