#!/usr/bin/env node
/**
 * Valida que un fichero de reglas compile correctamente contra la API de
 * Firebase Rules **sin desplegar nada** (endpoint `:test`).
 *
 *   node scripts/check-rules.mjs [projectId] [rulesFile]
 *
 * Reutiliza la sesión de `firebase login` (configstore de firebase-tools) para
 * obtener un token de acceso.
 */
import { readFileSync, existsSync } from 'node:fs';
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
  console.error('No se encontró la sesión de firebase login. Ejecuta `firebase login` primero.');
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const refreshToken = config?.tokens?.refresh_token;
if (!refreshToken) {
  console.error('La sesión de firebase login no tiene refresh token. Ejecuta `firebase login` de nuevo.');
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
  console.error(await tokenResponse.text());
  process.exit(1);
}
const { access_token: accessToken } = await tokenResponse.json();

const content = readFileSync(resolve(rulesFile), 'utf8');
const response = await fetch(`https://firebaserules.googleapis.com/v1/projects/${projectId}:test`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({ source: { files: [{ name: rulesFile, content }] } }),
});

const body = await response.json();
if (!response.ok) {
  console.error(`HTTP ${response.status}`);
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

const issues = body?.issues ?? [];
if (!issues.length) {
  console.log(`OK: ${rulesFile} compila sin errores ni avisos.`);
  process.exit(0);
}

let errors = 0;
for (const issue of issues) {
  const pos = issue.sourcePosition ?? {};
  console.log(`${issue.severity[0]} ${pos.line ?? '?'}:${pos.column ?? '?'} - ${issue.description}`);
  if (issue.severity === 'ERROR') errors += 1;
}
console.log(`\n${issues.length} incidencias (${errors} errores).`);
process.exit(errors ? 1 : 0);
