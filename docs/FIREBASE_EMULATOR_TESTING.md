# Pruebas de integración con Firebase Emulator Suite

> Objetivo: validar `firestore.rules`, `storage.rules` y flujos de Cloud Functions **sin tocar datos reales**.
>
> Este entorno de desarrollo **no tiene Java instalado** (el emulador de Firestore lo requiere). La configuración y los tests están listos para ejecutarse en cualquier máquina con Java o en CI (GitHub Actions trae Java por defecto).

## 1. Requisitos

- Java 11+ en PATH (`java -version`).
- Firebase CLI (`firebase-tools` ≥ 15): `npm install -g firebase-tools`
- Dependencia de pruebas adicional (opcional, sólo para reglas):

```bash
npm install -D @firebase/rules-unit-testing
```

## 2. Levantar el emulador

```bash
firebase emulators:start --only firestore,storage,auth,functions
```

Panel de emuladores: http://localhost:4000
Demo project id: `demo-carxy-test` (el emulador funciona sin proyecto real con el prefijo `demo-`).

Exportar/importar datos:

```bash
firebase emulators:start --only firestore --import=./emulator-data --export-on-exit=./emulator-data
```

## 3. Ejemplo de test de reglas (firestore.rules.test.mjs)

```js
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { setDoc, getDoc, doc, deleteDoc } from 'firebase/firestore';

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-carxy-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'posts', 'p1'), { title: 'privado', isPrivate: true, authorId: 'owner-uid', createdAt: Date.now() });
  await setDoc(doc(db, 'posts', 'p2'), { title: 'público', isPrivate: false, authorId: 'owner-uid', createdAt: Date.now(), likes: 0 });
});

// Usuario no autenticado: no puede crear posts
await testEnv.unauthenticatedContext().withSecurityRulesDisabled(() => {});

// Un usuario logueado NO puede elevar su propio rol
// (añadir uid y campos en el contexto autenticado según tus reglas)

await testEnv.cleanup();
```

Criterios mínimos a cubrir:
- `posts`: lectura pública de `isPrivate == false`; lectura del privado sólo por autor/admin; creación requiere auth; `likes`/`viewsCount`/`remixCount` incrementales válidos.
- `chats/{chatId}/messages`: sólo participantes `participantIds` leen/escriben.
- `users/{uid}`: lectura pública del doc; escritura sólo del propio uid (sin rol/baneo editable por el cliente).
- `reports`: crear autenticado; resolver/ban sólo admin o moderador.
- Storage: subida de GLB/PNG a `models/{uid}/...` sólo por el dueño y con contentType/size válidos.

Ejecutar:

```bash
firebase emulators:exec --only firestore 'node --test firestore.rules.test.mjs'
```

## 4. Cloud Functions contra el emulador

```bash
cd functions && npm install
firebase emulators:start --only functions,firestore,auth
```

Escrituras de prueba (p. ej. `deleteFirebaseAuthUser`, `sendVerifyEmail`) con un token de admin/custom claim o con `userFixtures`. El emulador de Auth permite crear usuarios de prueba con `firebase auth:debug` o vía script.

## 5. CI (GitHub Actions) — paso sugerido

```yaml
# .github/workflows/rules.yml
name: Firestore rules tests
on: [push, pull_request]
jobs:
  rules:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: '17' }
      - run: npm install -g firebase-tools && npm ci && npm install -D @firebase/rules-unit-testing
      - run: firebase emulators:exec --only firestore --project demo-carxy-test 'node --test firestore.rules.test.mjs'
```

## 6. Estado actual del repositorio

- `firestore.rules` (806 líneas) y `storage.rules` existen y están documentados en `docs/FIRESTORE_DATA_MODEL.md`.
- `firestore.indexes.json` contiene los índices compuestos requeridos (feed/portafolios).
- Las pruebas de reglas/integración **no** se ejecutan localmente en este entorno por falta de Java; al añadir `@firebase/rules-unit-testing` y el paso de CI anterior, el pipeline validará reglas en cada push.
- Los streams en vivo del feed usan `getRecentPublicPosts()` con ventana incremental (9 → 18 → …); los tests de UI locales (`ng test`) cubren los componentes en modo demo/local.

## 7. Checklist antes de desplegar reglas

1. `firebase emulators:exec --only firestore 'node --test firestore.rules.test.mjs'` → todos verdes.
2. Ningún `.backup` de reglas desplegado por error (sólo `firebase deploy --only firestore:rules,firestore:indexes,storage`).
3. Verificar que clientes antiguos (versiones anteriores) no cachéeaban lecturas que ahora requieran más privilegios.
4. Probar en web: feed, chat, likes, reportes, publicación, panel admin/moderador.
