#!/usr/bin/env node
/**
 * Genera public/firebase-config.js desde variables de entorno de CI.
 *
 * Los identificadores del SDK web de Firebase son públicos: no son secretos
 * de servidor ni sustituyen las reglas de Firestore/Storage. Si no se define
 * ninguna variable, se conserva el archivo versionado del repositorio.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mapping = {
  apiKey: 'FIREBASE_API_KEY',
  authDomain: 'FIREBASE_AUTH_DOMAIN',
  projectId: 'FIREBASE_PROJECT_ID',
  storageBucket: 'FIREBASE_STORAGE_BUCKET',
  appId: 'FIREBASE_APP_ID',
  // `messagingSenderId` (FCM) y `measurementId` (Google Analytics) se omiten a
  // propósito: la app no inicializa ninguno de los dos servicios y declararlos
  // solo provoca peticiones a endpoints que los bloqueadores de anuncios
  // cancelan (ERR_BLOCKED_BY_CLIENT).
};

const config = {};
let provided = 0;

for (const [key, envName] of Object.entries(mapping)) {
  const value = process.env[envName]?.trim();
  if (value) {
    config[key] = value;
    provided += 1;
  }
}

if (provided === 0) {
  console.log(
    '[firebase-config] Sin variables FIREBASE_*: se usa public/firebase-config.js versionado.',
  );
  process.exit(0);
}

const required = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'appId'];
const missing = required.filter((key) => !config[key]);

if (missing.length > 0) {
  console.error(
    `[firebase-config] Faltan variables obligatorias: ${missing
      .map((key) => mapping[key])
      .join(', ')}`,
  );
  process.exit(1);
}

const content = `// Generado por scripts/write-firebase-config.mjs desde variables de CI.
// Los identificadores web de Firebase son públicos. Nunca incluyas claves de cuenta de servicio.
window.__FORMA_FIREBASE_CONFIG__ = window.__FORMA_FIREBASE_CONFIG__ || ${JSON.stringify(
  config,
  null,
  2,
)};
`;

writeFileSync(resolve('public/firebase-config.js'), content, 'utf8');
console.log('[firebase-config] public/firebase-config.js generado desde el entorno.');
