#!/usr/bin/env node
/**
 * Consulta las reglas de Firestore REALMENTE desplegadas en el proyecto y las
 * compara con el fichero local. No despliega nada.
 *
 *   node scripts/check-deployed-rules.mjs [projectId] [rulesFile]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const FIREBASE_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

const projectId = process.argv[2] ?? 'carxy-f3e27';
const rulesFile = process.argv[3] ?? 'firestore.rules';

function findConfigstore() {
  const candidates = [
    process.env.XDG_CONFIG_HOME && join(process.env.XDG_CONFIG_HOME, 'configstore', 'firebase-tools.json'),
    process.env.APPDATA && join(process.env.APPDATA, 'configstore', 'firebase-tools.json'),
    join(homedir(), '.config', 'configstore', 'firebase-tools.json'),
    join(homedir(), '.config', 'firebase-tools.json'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

const configPath = findConfigstore();
if (!configPath) {
  console.error('No se encontró la sesión de firebase login.');
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const refreshToken = config?.tokens?.refresh_token;
if (!refreshToken) {
  console.error('La sesión no tiene refresh token.');
  process.exit(1);
}

const tokenResponse = await fetch('https://www.googleapis.com/oauth2/v3/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    refresh_token: refreshToken,
    client_id: FIREBASE_CLIENT_ID,
    client_secret: FIREBASE_CLIENT_SECRET,
    grant_type: 'refresh_token',
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  }),
});
if (!tokenResponse.ok) {
  console.error(`No se pudo renovar el token: HTTP ${tokenResponse.status}`);
  process.exit(1);
}
const { access_token: accessToken } = await tokenResponse.json();

/**
 * La API de Rules Resource Manager devuelve las reglas de un "ruleset". Para
 * Firestore el recurso es `projects/{p}/databases/(default)/documents`.
 */
const endpoints = [
  `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
  `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`,
];

let deployedContent = null;

// 1. El release de Firestore indica qué ruleset está desplegado.
let deployedRulesetName = null;
for (const endpoint of endpoints) {
  const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();
  if (!res.ok) {
    console.error(`  ${endpoint} -> HTTP ${res.status}`);
    continue;
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    console.error(`  ${endpoint} -> respuesta no-JSON`);
    continue;
  }
  // Formato lista: { rulesets: [ { name, createTime, ... } ] }
  if (Array.isArray(body?.rulesets) && body.rulesets.length) {
    const rulesets = body.rulesets
      .slice()
      .sort((a, b) => String(b.createTime ?? '').localeCompare(String(a.createTime ?? '')));
    console.log(`Rulesets encontrados: ${rulesets.map((r) => r.name).join(', ')}`);
    deployedRulesetName = rulesets[0].name;
    break;
  }
  // Formato release: { name, rulesetName, ... }
  if (body?.rulesetName) {
    deployedRulesetName = body.rulesetName;
    console.log(`Release desplegado -> ruleset ${deployedRulesetName}`);
    break;
  }
  console.error(`  ${endpoint} -> sin 'rulesets' ni 'rulesetName'`);
}

if (!deployedRulesetName) {
  console.error('No se pudo determinar el ruleset desplegado.');
  process.exit(1);
}

// 2. Descarga el contenido del ruleset.
const rulesetRes = await fetch(
  `https://firebaserules.googleapis.com/v1/${deployedRulesetName}`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
const rulesetText = await rulesetRes.json();
if (!rulesetRes.ok) {
  console.error(`No se pudo descargar el ruleset ${deployedRulesetName}:`);
  console.error(JSON.stringify(rulesetText, null, 2));
  process.exit(1);
}
// El contenido vive en source.files[].content.
const deployedFiles = rulesetText?.source?.files ?? [];
const firestoreFile = deployedFiles.find((f) => f.name?.endsWith('.rules')) ?? deployedFiles[0];
if (typeof firestoreFile?.content !== 'string' || !firestoreFile.content.length) {
  console.error('El ruleset no contiene contenido de reglas.');
  console.error(JSON.stringify(rulesetText, null, 2));
  process.exit(1);
}
deployedContent = firestoreFile.content;
console.log(`Ruleset: ${deployedRulesetName}`);
console.log(`Creado: ${rulesetText?.createTime ?? '(desconocido)'}`);
console.log(`Fichero: ${firestoreFile.name}`);

if (!deployedContent) {
  console.error('No se pudieron obtener las reglas desplegadas.');
  process.exit(1);
}

const localContent = readFileSync(resolve(rulesFile), 'utf8');
const deployedLines = deployedContent.split('\n');
const localLines = localContent.split('\n');

function printBlock(lines, title) {
  console.log(`\n=== ${title} ===`);
  const start = lines.findIndex((l) => l.includes('notifications/{notificationId}'));
  if (start < 0) {
    console.log('(bloque no encontrado)');
    return;
  }
  console.log(lines.slice(start, start + 24).join('\n'));
}

printBlock(deployedLines, 'DESPLEGADO: notifications/{notificationId}');
printBlock(localLines, 'LOCAL: notifications/{notificationId}');

console.log('\n=== Comparación ===');
if (localContent.trim() === deployedContent.trim()) {
  console.log('IDÉNTICAS: el fichero local ya está desplegado.');
} else {
  console.log('DIFIEREN: hay cambios locales SIN desplegar.');
  const tmp = join(homedir(), '.config', 'deployed-rules.txt');
  writeFileSync(tmp, deployedContent);
  console.log(`Contenido desplegado guardado en: ${tmp}`);

  // Diff línea a línea resumido.
  const max = Math.max(deployedLines.length, localLines.length);
  let shown = 0;
  for (let i = 0; i < max && shown < 25; i++) {
    if (deployedLines[i] !== localLines[i]) {
      console.log(`  L${i + 1} desplegado: ${deployedLines[i]?.trim() ?? '(fin)'}`);
      console.log(`  L${i + 1} local    : ${localLines[i]?.trim() ?? '(fin)'}`);
      shown++;
    }
  }
}
