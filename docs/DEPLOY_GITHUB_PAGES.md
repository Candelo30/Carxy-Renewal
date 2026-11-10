# Despliegue en GitHub Pages

La app se publica en **https://candelo30.github.io/Carxy-Renewal/** usando un build estático independiente del servidor SSR. Las rutas limpias, los enlaces profundos y Firebase Auth/Firestore/Storage funcionan bajo el subdirectorio del repositorio.

## 1. Requisitos previos

- Rama por defecto del repositorio: `develop` (el workflow también acepta `main`).
- Proyecto Firebase: `carxy-f3e27`.
- Firebase CLI autenticado para desplegar reglas e índices.
- `gcloud` o `gsutil` para configurar CORS del bucket de Storage.

## 2. Configuración manual en Firebase Console

1. Abre **Authentication → Settings → Authorized domains**.
2. Añade `candelo30.github.io`.
   - No añadas la ruta `/Carxy-Renewal/`: el dominio autorizado es solo el host.
   - Sin este paso, Google y el correo de verificación fallan con `auth/unauthorized-domain`.
3. Comprueba que Email/Password y Google están habilitados si los usas.

## 3. Configuración manual en GitHub

1. Abre **Settings → Pages**.
2. En **Build and deployment → Source**, elige **GitHub Actions**.
3. Haz push a `develop` o ejecuta el workflow **Deploy GitHub Pages** desde la pestaña Actions.
4. El workflow publica `dist/github-pages/browser` y usa el entorno `github-pages`.

El workflow está en `.github/workflows/deploy-pages.yml`.

## 4. Configuración de Firebase para el cliente

`public/firebase-config.js` contiene los identificadores públicos del SDK web y se versiona en el repositorio. Si prefieres inyectarlos desde CI, define estos secretos en **Settings → Secrets and variables → Actions**:

| Secreto | Campo |
| --- | --- |
| `FIREBASE_API_KEY` | `apiKey` |
| `FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `FIREBASE_PROJECT_ID` | `projectId` |
| `FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `FIREBASE_APP_ID` | `appId` |
| `FIREBASE_MEASUREMENT_ID` | `measurementId` (opcional) |

Si no defines ninguno, se usa el archivo versionado. Si defines alguno, deben estar los cinco obligatorios (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `appId`). **Nunca** pongas claves de cuenta de servicio en el repositorio ni en el bundle.

## 5. Reglas, índices y CORS

Despliega la configuración de Firebase desde la raíz del repositorio:

```bash
npx firebase-tools login
npx firebase-tools use carxy-f3e27
npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage
```

El archivo `.firebaserc` ya selecciona `carxy-f3e27` por defecto.

Para que las descargas de modelos y miniaturas funcionen desde GitHub Pages, actualiza CORS del bucket:

```bash
gcloud auth login
gcloud config set project carxy-f3e27
gcloud storage buckets update gs://carxy-f3e27.firebasestorage.app --cors-file=storage.cors.json
```

Alternativa con `gsutil`:

```bash
gsutil cors set storage.cors.json gs://carxy-f3e27.firebasestorage.app
```

`storage.cors.json` ya incluye `https://candelo30.github.io` y `http://localhost:4300` para la vista previa local. CORS no sustituye `storage.rules`.

## 6. Build y vista previa local

```bash
npm install
npm run build:pages
npm run preview:pages
```

Abre **http://localhost:4300/Carxy-Renewal/**.

Prueba estos enlaces profundos:

- `http://localhost:4300/Carxy-Renewal/feed?sort=likes&tag=arte`
- `http://localhost:4300/Carxy-Renewal/favorites`
- `http://localhost:4300/Carxy-Renewal/profile/UID_DE_PRUEBA`
- `http://localhost:4300/Carxy-Renewal/help#atajos`
- `http://localhost:4300/Carxy-Renewal/community-help?q=ID_DE_PREGUNTA`
- `http://localhost:4300/Carxy-Renewal/contact`

El servidor de vista previa reproduce el comportamiento de Pages: sirve `404.html` para rutas sin directorio propio. GitHub Pages también devuelve estado 404 en esos deep links, pero Angular arranca y muestra la ruta correcta.

## 7. Base href y dominio personalizado

El build usa por defecto:

```text
/Carxy-Renewal/
```

Puedes cambiarlo sin editar `angular.json`:

```bash
PAGES_BASE_HREF=/Carxy-Renewal/ npm run build:pages
```

Si usas un dominio personalizado, define en GitHub **Settings → Secrets and variables → Actions → Variables**:

- `PAGES_BASE_HREF` = `/`
- `PAGES_CUSTOM_DOMAIN` = `tudominio.com` (opcional; genera `CNAME`)

Después configura el dominio en **Settings → Pages** y en Firebase Auth añade el nuevo host a los dominios autorizados.

## 8. Qué genera el build estático

`npm run build:pages` ejecuta:

1. `scripts/write-firebase-config.mjs` (config desde CI o archivo versionado).
2. `ng build angular-3d-editor-pages --base-href …`.
3. `scripts/prepare-pages.mjs`, que añade:
   - `404.html` con el shell de Angular;
   - `.nojekyll`;
   - directorios `index.html` para rutas conocidas;
   - `CNAME` si se define `PAGES_CUSTOM_DOMAIN`.

El proyecto `angular-3d-editor-pages` es estático y no incluye `app.routes.server.ts`; el proyecto `angular-3d-editor` conserva SSR para otros entornos.

## 9. Limitaciones de seguridad de GitHub Pages

GitHub Pages no permite definir cabeceras HTTP personalizadas (CSP, HSTS, `X-Frame-Options`, etc.). El servidor SSR de este repositorio sí las aplica, pero no se ejecuta en Pages. Si necesitas esas cabeceras en producción, publica el mismo build estático detrás de Cloudflare Pages/Firebase Hosting o un proxy que las añada. Mantén HTTPS (Pages lo fuerza) y revisa las reglas de Firestore/Storage como autoridad real de acceso.

## 10. Solución de problemas

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| Pantalla en blanco y assets 404 | `base href` no coincide con el subdirectorio | Revisa `PAGES_BASE_HREF` y el nombre exacto del repositorio. |
| `auth/unauthorized-domain` | Falta el host en Firebase Auth | Añade `candelo30.github.io` en dominios autorizados. |
| `storage/unknown` o error CORS | Origen no permitido en el bucket | Actualiza CORS y espera unos minutos. |
| `The query requires an index` | Índices sin desplegar | Ejecuta `npx firebase-tools deploy --only firestore:indexes`. |
| 404 al recargar `/feed` | Falta `404.html` o Pages no usa Actions | Verifica el artefacto y la fuente **GitHub Actions**. |
| Firebase no inicializa | Falta `firebase-config.js` en el artefacto | Comprueba `dist/github-pages/browser/firebase-config.js`. |
| El login funciona pero no carga datos | Reglas de Firestore/Storage antiguas | Despliega reglas e índices actuales. |
| `PAGES_BASE_HREF` inválido | No empieza o termina en `/` | Usa `/Carxy-Renewal/` o `/`. |
