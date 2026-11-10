# Política de seguridad

## Versiones compatibles

La rama `develop` es la versión activa del proyecto. Las revisiones de seguridad se aplican sobre la última versión publicada; no se mantienen parches para ramas antiguas.

## Cómo reportar una vulnerabilidad

No abras un issue público con detalles de una vulnerabilidad sin corregir. Usa uno de estos canales:

1. **GitHub Security Advisories** del repositorio: <https://github.com/Candelo30/Carxy-Renewal/security/advisories/new>
2. Si no puedes usar el canal anterior, abre un issue privado o contacta al mantenedor a través del perfil de GitHub: <https://github.com/Candelo30>

Incluye, si es posible:

- Descripción del problema y su impacto.
- Pasos para reproducirlo.
- Versión, navegador y sistema operativo.
- Capturas, registros o una prueba de concepto mínima.

No incluyas contraseñas, tokens, claves de servicio ni datos personales de terceros. Nos comprometemos a confirmar la recepción, investigar el reporte y coordinar una divulgación responsable.

## Medidas de seguridad actuales

- **Autenticación**: Firebase Authentication con verificación de correo y política de contraseñas de al menos 8 caracteres con letras y números.
- **Autorización**: roles `user`, `moderator` y `admin`; el cliente no puede elevar su propio rol. Las reglas de Firestore y Storage son la autoridad del servidor.
- **Reglas de datos**: lectura y escritura limitadas por propietario, participación en chats, roles y campos permitidos. Los modelos privados no se publican en el feed.
- **Moderación**: reportes de contenido, panel de moderación y bloqueo de cuentas.
- **Anti-spam**: un like por usuario y publicación, sin likes propios; límites de longitud y validación en reglas.
- **Cabeceras HTTP** en el servidor SSR (`src/server.ts`):
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY` y `frame-ancestors 'none'`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` restrictiva para cámara, micrófono, geolocalización, pagos y USB
  - `Cross-Origin-Opener-Policy: same-origin-allow-popups`
  - `Cross-Origin-Resource-Policy: same-origin`
  - `Strict-Transport-Security` cuando la petición llega por HTTPS
  - `X-Powered-By` deshabilitado
- **Secretos**: las claves de servicio y credenciales privadas nunca deben estar en `environment.ts`, `public/` ni en el bundle del cliente. La configuración web de Firebase son identificadores públicos, no secretos.
- **Almacenamiento local**: el modo de demostración guarda datos solo en el navegador. No se usa para cuentas reales.

## Buenas prácticas para colaboradores

- No subas archivos `.env`, claves de cuenta de servicio ni tokens al repositorio.
- Ejecuta `npm run build` y las pruebas antes de abrir un pull request.
- Mantén las reglas de Firestore y Storage sincronizadas con los cambios de modelo de datos.
- Revisa que las nuevas rutas no expongan datos privados ni acciones de administración sin guardas.
- Para probar reglas y flujos remotos, usa Firebase Emulator Suite o un proyecto de staging.

## Divulgación responsable

Pedimos un plazo razonable para investigar y corregir el problema antes de publicar detalles. No se tomarán represalias contra quien reporte de buena fe.
