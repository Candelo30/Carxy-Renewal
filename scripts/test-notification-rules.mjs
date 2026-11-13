#!/usr/bin/env node
/**
 * Prueba las reglas de Firestore DESPLEGADAS contra casos concretos de
 * creación de notificación, usando la API `:test` (no despliega nada y no
 * escribe datos).
 *
 *   node scripts/test-notification-rules.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FIREBASE_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
const projectId = 'carxy-f3e27';

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

const rsRes = await fetch(
  `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
const { rulesets } = await rsRes.json();
const latest = rulesets
  .slice()
  .sort((a, b) => String(b.createTime ?? '').localeCompare(String(a.createTime ?? '')))[0];
const det = await fetch(`https://firebaserules.googleapis.com/v1/${latest.name}`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const db = await det.json();
const content = db?.source?.files?.[0]?.content;
console.log(`Ruleset desplegado: ${latest.name} (${latest.createTime})`);

/** Replica exactamente lo que escribe el cliente. */
const ACTOR = 'actorUid123';
const RECIPIENT = 'recipientUid456';
const CHAT_ID = 'actorUid123__recipientUid456';
const NOW = 1760000000000;

const base = {
  id: `message_${ACTOR}_${CHAT_ID}`,
  recipientId: RECIPIENT,
  actorId: ACTOR,
  actorName: 'Actor',
  actorPhotoURL: null,
  createdAt: NOW,
  read: false,
};

const cases = [
  { name: 'message (con targetId=chatId)', data: { ...base, kind: 'message', targetId: CHAT_ID } },
  { name: 'message (sin targetId)', data: { ...base, kind: 'message' } },
  { name: 'follow', data: { ...base, kind: 'follow', id: `follow_${ACTOR}_${RECIPIENT}` } },
  { name: 'like (targetId=postId)', data: { ...base, kind: 'like', targetId: 'post1' } },
  { name: 'comment (targetId=postId)', data: { ...base, kind: 'comment', targetId: 'post1' } },
  { name: 'follow SIN actorPhotoURL', data: { ...base, kind: 'follow', id: `follow_${ACTOR}_${RECIPIENT}`, actorPhotoURL: undefined } },
];

for (const testCase of cases) {
  const data = { ...testCase.data };
  if (data.actorPhotoURL === undefined) delete data.actorPhotoURL;

  const payload = {
    source: { files: [{ name: 'firestore.rules', content }] },
    testSuite: {
      testCases: [
        {
          request: {
            auth: { uid: ACTOR, token: { email: 'actor@example.com' } },
            path: `/databases/(default)/documents/users/${RECIPIENT}/notifications/${data.id}`,
            method: 'CREATE',
            resource: { data },
          },
          expectation: 'ALLOW',
        },
      ],
    },
  };

  const res = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${projectId}:test`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    },
  );
  const body = await res.json();
  const result = body?.testResults?.[0];
  const state = result?.state;
  const debug = (result?.debugMessages ?? []).join(' | ');
  console.log(`${state === 'SUCCESS' ? 'PERMITIDO' : 'DENEGADO '} | ${testCase.name}${debug ? ` | ${debug}` : ''}`);
}
