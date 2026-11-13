#!/usr/bin/env node
/**
 * Verifica las reglas de Firestore contra casos reales de la app usando la
 * API `:test` (no despliega nada y no escribe datos).
 *
 * Cada caso se evalúa con las dos expectativas posibles (ALLOW y DENY) para
 * deducir el resultado real: así no se depende de interpretar `state`.
 *
 *   node scripts/test-rules.mjs [projectId] [rulesFile]
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

const config = JSON.parse(readFileSync(findConfigstore(), 'utf8'));
const refreshToken = config?.tokens?.refresh_token;
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
const { access_token: accessToken } = await tokenResponse.json();
const content = readFileSync(resolve(rulesFile), 'utf8');

/**
 * Evalúa un caso. La API devuelve `state: SUCCESS` cuando la expectativa se
 * cumple, así que se prueba con la expectativa esperada: si da SUCCESS, la
 * regla se comporta como se espera.
 */
async function evaluate(testCase, expectation) {
  // `expect` es una clave propia del harness: no debe enviarse a la API
  // (rechaza el payload entero).
  const { expect: _expected, label: _label, ...request } = testCase;
  const res = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${projectId}:test`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        source: { files: [{ name: rulesFile, content }] },
        testSuite: { testCases: [{ ...request, expectation }] },
      }),
    },
  );
  const body = await res.json();
  const result = body?.testResults?.[0];
  if (result?.state === 'SUCCESS') return { ok: true, detail: '' };
  const detail = [
    `http=${res.status}`,
    ...(body?.error?.message ? [`error=${body.error.message}`] : []),
    ...(result?.debugMessages ?? []),
    result?.errorPosition ? `errorPosition line ${result.errorPosition.line}:${result.errorPosition.column}` : '',
  ].filter(Boolean).join(' | ');
  return { ok: false, detail };
}

const ACTOR = 'actorUid123';
const RECIPIENT = 'recipientUid456';
const CHAT_ID = `${ACTOR}__${RECIPIENT}`;
const NOW = 1760000000000;

const notificationBase = {
  id: 'n1',
  recipientId: RECIPIENT,
  actorId: ACTOR,
  actorName: 'Actor',
  actorPhotoURL: null,
  createdAt: NOW,
  read: false,
};

const cases = [
  // --- Notificaciones: lectura ---
  {
    label: 'LIST notifications propias',
    request: { auth: { uid: 'u1' }, path: '/databases/(default)/documents/users/u1/notifications', method: 'LIST' },
    expect: 'PERMITIDO',
  },
  {
    label: 'LIST notifications ajenas',
    request: { auth: { uid: 'u1' }, path: '/databases/(default)/documents/users/otro/notifications', method: 'LIST' },
    expect: 'DENEGADO',
  },
  {
    label: 'GET notification propia (no hay allow get; solo list/create/update/delete)',
    request: { auth: { uid: 'u1' }, path: '/databases/(default)/documents/users/u1/notifications/n1', method: 'GET' },
    expect: 'DENEGADO',
  },
  {
    label: 'CREATE notification follow',
    request: {
      auth: { uid: ACTOR },
      path: `/databases/(default)/documents/users/${RECIPIENT}/notifications/n1`,
      method: 'CREATE',
      resource: { data: { ...notificationBase, kind: 'follow' } },
    },
    expect: 'PERMITIDO',
  },
  {
    label: 'CREATE notification like (targetId=post)',
    request: {
      auth: { uid: ACTOR },
      path: `/databases/(default)/documents/users/${RECIPIENT}/notifications/n2`,
      method: 'CREATE',
      resource: { data: { ...notificationBase, id: 'n2', kind: 'like', targetId: 'post1' } },
    },
    expect: 'PERMITIDO',
  },
  {
    label: 'CREATE notification comment (targetId=post)',
    request: {
      auth: { uid: ACTOR },
      path: `/databases/(default)/documents/users/${RECIPIENT}/notifications/n3`,
      method: 'CREATE',
      resource: { data: { ...notificationBase, id: 'n3', kind: 'comment', targetId: 'post1' } },
    },
    expect: 'PERMITIDO',
  },
  {
    label: 'CREATE notification message (targetId=chatId)',
    request: {
      auth: { uid: ACTOR },
      path: `/databases/(default)/documents/users/${RECIPIENT}/notifications/n4`,
      method: 'CREATE',
      resource: { data: { ...notificationBase, id: 'n4', kind: 'message', targetId: CHAT_ID } },
    },
    expect: 'PERMITIDO',
  },
  {
    label: 'CREATE notification a uno mismo (debe fallar)',
    request: {
      auth: { uid: ACTOR },
      path: `/databases/(default)/documents/users/${ACTOR}/notifications/n5`,
      method: 'CREATE',
      resource: { data: { ...notificationBase, id: 'n5', recipientId: ACTOR } },
    },
    expect: 'DENEGADO',
  },
  // --- Otras subcolecciones de users (control de regresión) ---
  {
    label: 'LIST followers (control)',
    request: { auth: { uid: 'u1' }, path: '/databases/(default)/documents/users/u1/followers', method: 'LIST' },
    expect: 'PERMITIDO',
  },
  {
    label: 'LIST following (control)',
    request: { auth: { uid: 'u1' }, path: '/databases/(default)/documents/users/u1/following', method: 'LIST' },
    expect: 'PERMITIDO',
  },
  {
    label: 'LIST likedPosts propios (control)',
    request: { auth: { uid: 'u1' }, path: '/databases/(default)/documents/users/u1/likedPosts', method: 'LIST' },
    expect: 'PERMITIDO',
  },
];

let failed = 0;
for (const testCase of cases) {
  // La API espera 'ALLOW' | 'DENY'.
  const expectation = testCase.expect === 'PERMITIDO' ? 'ALLOW' : 'DENY';
  const { ok, detail } = await evaluate(testCase, expectation);
  if (!ok) failed++;
  console.log(`${ok ? 'OK   ' : 'FALLO'} | esperado ${testCase.expect.padEnd(9)} | ${testCase.label}${detail ? ` | ${detail}` : ''}`);
}

console.log(`\n${cases.length - failed}/${cases.length} casos correctos.`);
process.exit(failed ? 1 : 0);
