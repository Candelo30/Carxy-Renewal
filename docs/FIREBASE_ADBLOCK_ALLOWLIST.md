# Bloqueadores de anuncios y `net::ERR_BLOCKED_BY_CLIENT`

Si en la consola del navegador aparece

```
Failed to load resource: net::ERR_BLOCKED_BY_CLIENT
```

el recurso **no** lo bloquea el servidor: lo cancela una extensión del navegador
(bloqueador de anuncios, extensión de privacidad) o una política corporativa de red.
La aplicación sigue funcionando, pero se pierden partes: el acceso con Google, el
`reCAPTCHA` del acceso con correo, o los avatares de Google.

## Hosts que usa la aplicación

| Host | Para qué | Cuándo se pide |
| --- | --- | --- |
| `carxy-f3e27.firebaseapp.com` | `iframe` y `handler` de Firebase Auth | Acceso con Google |
| `apis.google.com` | `gapi` (`/js/api.js`) para el popup de Google | Acceso con Google |
| `accounts.google.com` | OAuth de Google | Acceso con Google |
| `www.google.com` | `reCAPTCHA Enterprise` (`/recaptcha/enterprise.js`) | Acceso con correo, registro, restablecer contraseña |
| `www.gstatic.com` | Runtime de `reCAPTCHA` | Junto con el anterior |
| `identitytoolkit.googleapis.com` | API de Firebase Auth | Acceso con correo |
| `securetoken.googleapis.com` | Emisión de ID token | Tras iniciar sesión |
| `firestore.googleapis.com` | Firestore (REST + WebSocket) | Toda la app |
| `firebasestorage.googleapis.com` | Firebase Storage | Publicar y cargar modelos |
| `us-central1-carxy-f3e27.cloudfunctions.net` | Cloud Functions | Invitar a un proyecto, eliminar cuenta |

## Allowlist para uBlock Origin / AdBlock

Añádela en `Extensiones → uBlock Origin → ⋮ → Más listas → Filtrar listas
personalizadas` (o en el panel de reglas):

```
@@||carxy-f3e27.firebaseapp.com^$frame,subdocument
@@||www.google.com/recaptcha/
@@||www.gstatic.com/recaptcha/
@@||apis.google.com^$script
@@||accounts.google.com^
@@||identitytoolkit.googleapis.com^
@@||securetoken.googleapis.com^
@@||firestore.googleapis.com^
@@||firestore.googleapis.com^$websocket
@@||firebasestorage.googleapis.com^
@@||us-central1-carxy-f3e27.cloudfunctions.net^
```

Para Privacy Badger o Ghostery hay que permitir las categorías *Google Analytics* y
*Google Fonts* en los dominios `google.com`, `gstatic.com` y `apis.google.com`.

## Medidas aplicadas en la aplicación

- La cabecera CSP de `src/server.ts` ya incluye `https://www.gstatic.com` en
  `script-src` y `https://www.google.com` en `frame-src`, para que el runtime de
  `reCAPTCHA` no sea rechazado también por la política de la propia app.
- `public/firebase-config.js` ya **no** declara `measurementId` (Google Analytics)
  ni `messagingSenderId` (FCM): la app no inicializa ninguno de los dos servicios y
  declararlos solo provoca peticiones a endpoints que los bloqueadores cancelan.
- Los errores de acceso muestran un mensaje explícito que menciona el bloqueador
  (`auth/network-request-failed`, `auth/popup-blocked`).

## Si el bloqueo viene de la empresa

El síntoma típico es "en casa funciona, en la oficina no". Las políticas corporativa
suelen cortar `*.googleapis.com` o `*.cloudfunctions.net`. Hay que pedir a Sistemas
que permita:

- `identitytoolkit.googleapis.com` (443)
- `securetoken.googleapis.com` (443)
- `firestore.googleapis.com` (443) y `wss://firestore.googleapis.com`
- `firebasestorage.googleapis.com` (443)
- `us-central1-carxy-f3e27.cloudfunctions.net` (443)
- `carxy-f3e27.firebaseapp.com` (443)
- `www.google.com` y `www.gstatic.com` (443, solo para `reCAPTCHA`)

## Alternativas

- **Firebase Console → Authentication → Email/Password → desactivar "reCAPTCHA
  Enterprise protection"**: elimina las peticiones a `www.google.com/recaptcha` y
  `www.gstatic.com/recaptcha` y es la solución más rápida si el error aparece al
  acceder con correo.
- **Emuladores locales** (`docs/FIREBASE_EMULATOR_TESTING.md`): durante el desarrollo
  no se sale a internet en absoluto, así que ningún bloqueador puede interferir.
- **Quitar el proveedor de Google**: elimina `gapi`, `accounts.google.com` y el
  `iframe` de `firebaseapp.com`.
