# Migración de rol/estado a Custom Claims (Firestore rules)

## Objetivo
Eliminar los `get()` del documento de usuario dentro de `firestore.rules` (p. ej. helpers `roleOf(uid)` / `isActiveUser()`), para:
- reducir lecturas y coste en cada evaluación de regla,
- acelerar operaciones batch/transaccionales,
- evitar dependencia del documento `users/{uid}` para autorizar.

## Estado actual
`firestore.rules` consulta el documento `users/{uid}` para obtener `role` e `isBanned`. Cada operación autenticada puede realizar una o más lecturas extra.

## Diseño propuesto
Custom claims de Firebase Auth en el ID token:
- `request.auth.token.role`: `'user' | 'moderator' | 'admin'` (default `user`)
- `request.auth.token.active`: `true` si la cuenta no está suspendida (default `true`)

### Fuentes de verdad
- El claim se asigna/actualiza **solo** desde backend de confianza: Cloud Function HTTPS/callable o script admin (nunca desde el cliente).

### Flujo de sincronización
1. **Crear usuario**: función onCreate (Auth) → `setCustomUserClaims(uid, { role: 'user', active: true })`.
2. **Cambio de rol/suspensión**: admin usa callable (p. ej. `setUserRole`, `setUserBanned`) → actualiza Firestore `users/{uid}` y **reasigna claims** `{ role, active }`.
3. **Eliminación de cuenta**: al anonimizar/borrar, asignar `{ role: 'user', active: false }` (cuenta inutilizada) o eliminar el token revocando el usuario de Auth.
4. El cliente fuerza el **refresco del token** tras cambios: `getIdToken(true)` en `AuthService` cuando el servidor confirma mutación de rol/estado.

### Reglas (nuevo patrón)
```
function roleOf() { return request.auth.token.role; }
function isAdmin() { return roleOf() == 'admin'; }
function isModerator() { return roleOf() == 'moderator' || isAdmin(); }
function isActiveUser() { return request.auth.token.active == true; }
```
Ya no hay `get()` en reglas.

### Pasos de migración
1. Desplegar Cloud Functions nuevas (onCreate + callables) con claims.
2. Ejecutar **backfill**: función callable/batch admin que recorra `users` y asigne claims según `role`/`isBanned` actuales.
3. Refrescar tokens de clientes activos (o expirar sesiones: `currentUser.getIdTokenResult()` y desautenticar para obligar re-login).
4. Sustituir helpers en `firestore.rules` por las versiones basadas en token y **desplegar reglas**.
5. Verificar en emulador con 2–3 escenarios (usuario normal, moderador, admin, ban).
6. Eliminar/retirar helpers con `get()`.

### Consideraciones
- Los claims viajan en el token; cambios de rol pueden tardar hasta expiración del token (~1h) si el cliente no refresca. Considerar TTL corto y `auth.currentUser.getIdToken(true)` tras admin actions.
- Mantener Firestore como lectura para UI (perfil, admin listado); los claims solo son para **autorizar en servidor**.
- Auditoría: registrar cambios de claim en `userActivity`/audit trail.
- No pongas en claims datos sensibles (email, etc.): no son privados.

### Riesgos y rollback
- Si los claims se desincronizan, usar fallback en reglas: `roleOf()` = token claim o (si ausente) doc fallback `get()` temporal durante la transición.
- Mantener una versión "híbrida" de reglas durante el backfill para evitar lockouts, retirándola tras verificar.

### Esfuerzo estimado
8–12 horas (incluye backfill, helpers nuevas en reglas, refresco de tokens, pruebas en emulador y despliegue coherente).
