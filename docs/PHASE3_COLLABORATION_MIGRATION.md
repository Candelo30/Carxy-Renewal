# Fase 3: Migración de colaboración (miembros e invitaciones)

Este documento describe los cambios de contrato introducidos en la rama de Fase 3 para `projectMembers` y `projectInvitations`, y una guía práctica para migrar datos existentes en Firestore.

> **Importante:** valida primero en Firebase Emulator Suite o en un proyecto de staging. Haz respaldo/exportación antes de modificar datos de producción.

## 1) Cambios de contrato

### `projectMembers`
- **Antes:** ID aleatorio (`doc(collection(...))`).
- **Ahora:** ID determinístico `"{projectId}_{userId}"`.
- **Motivo:** alinear la app con las reglas (`isProjectMember/isProjectWriter/isProjectOwner`) y permitir comprobaciones consistentes de permisos/membresía.
- **Campos esperados:** `id`, `projectId`, `userId`, `userName`, `userPhotoURL`, `role`, `joinedAt`.

### `projectInvitations`
- **Antes:** ID aleatorio.
- **Ahora:** ID determinístico `"{projectId}_{invitedEmailNormalizado}"` donde `invitedEmailNormalizado = invitedEmail.trim().toLowerCase()`.
- **Motivo:** permitir que las reglas verifiquen, en la misma transacción, que la aceptación de invitación y la creación del miembro corresponden a la invitación correcta (`getAfter` del documento de invitación).
- **Campos esperados:** `id`, `projectId`, `projectName`, `invitedBy`, `invitedByName`, `invitedEmail`, `invitedUid`, `role`, `status`, `createdAt`, `expiresAt` (+ `respondedAt` al responder).

## 2) Impacto en datos existentes

- Miembros con IDs aleatorios pueden seguir existiendo, pero **no serán reconocidos** por las reglas/helpers basados en `{projectId}_{userId}`.
- Invitaciones con IDs aleatorios pueden seguir existiendo, pero **el nuevo flujo de aceptación** (app + reglas endurecidas) espera el ID determinístico por proyecto+email.
- Las consultas de UI que filtran por campos (`projectId`, `userId`, `invitedEmail`, `status`) pueden seguir encontrando documentos antiguos, pero las operaciones protegidas por reglas pueden fallar hasta migrar.

## 3) Estrategia de migración recomendada (staging/producción)

### Paso A — Congelar/coordinar cambios
1. Despliega primero app y reglas compatibles (esta rama) en staging.
2. Comunica una ventana corta de migración si hay usuarios colaborando activamente.
3. Evita nuevas invitaciones/aceptaciones durante la migración para reducir carreras.

### Paso B — Migrar `projectMembers` a IDs determinísticos
Para cada documento en `projectMembers`:
1. Leer `projectId` y `userId`.
2. Si falta alguno, registrar para revisión manual.
3. Calcular `targetId = projectId + '_' + userId`.
4. Si el documento ya está en `targetId`, omitir.
5. Crear/merge en `projectMembers/{targetId}` con `id = targetId` y el resto de campos normalizados.
6. Si existen duplicados (mismo `projectId`+`userId` con IDs distintos), elegir el canónico (p. ej. mayor `joinedAt` válido o el que tenga rol más privilegiado según política) y consolidar.
7. Eliminar documentos antiguos con ID aleatorio tras verificar el canónico.

**Notas:**
- Preserva `joinedAt` original cuando sea posible.
- Normaliza `role` a `owner|editor|viewer`.
- Si hay conflictos de rol, prioriza la política del proyecto (normalmente `owner` explícito del proyecto).

### Paso C — Migrar `projectInvitations` a IDs determinísticos
Para cada documento en `projectInvitations`:
1. Leer `projectId`, `invitedEmail`, `status`, etc.
2. Normalizar email: `trim().toLowerCase()`.
3. Calcular `targetId = projectId + '_' + emailNormalizado`.
4. Si el documento ya está en `targetId`, omitir.
5. Consolidar por `(projectId, emailNormalizado)`:
   - Preferir `pending` vigente (no expirada) si existe.
   - Si no, conservar la más reciente por `respondedAt`/`createdAt` según corresponda.
6. Escribir documento canónico en `projectInvitations/{targetId}` con `id = targetId` e `invitedEmail` normalizado.
7. Eliminar duplicados/IDs aleatorios tras verificación.

**Notas:**
- El nuevo contrato asume una invitación activa por proyecto+email (clave determinística). Si el negocio requiere múltiples invitaciones históricas por email, habrá que ajustar el modelo y las reglas.
- Revisa invitaciones `accepted` antiguas para asegurar coherencia con `projectMembers`.

### Paso D — Verificación posterior
- Confirmar que cada owner de proyecto tiene su miembro `"{projectId}_{ownerId}"` con rol `owner`.
- Probar aceptación de una invitación nueva y de una migrada (si aplica) en staging.
- Verificar lectura de miembros/presencias/actividad para usuarios miembros.
- Revisar logs de permisos denegados en Firestore tras desplegar reglas.

## 4) Ejemplo de enfoque técnico (script de migración)

Implementar como script administrativo (Node.js + Firebase Admin SDK) ejecutado fuera del cliente:

- Entrada: proyecto Firebase (staging/prod), modo `dry-run` y `apply`.
- Proceso:
  - Escanear `projectMembers` y generar plan de movimientos/consolidaciones.
  - Escanear `projectInvitations` y generar plan por `(projectId,emailNormalizado)`.
  - En `dry-run`, exportar reporte (JSON/CSV) con acciones propuestas.
  - En `apply`, ejecutar en lotes (batch/transactions según necesidad) con reintentos y registro de resultados.
- Salida: reporte de documentos migrados, duplicados consolidados y casos manuales.

> No se incluye un script ejecutable en este commit porque requiere credenciales administrativas y decisiones de consolidación específicas del entorno.

## 5) Recomendaciones de despliegue

1. **Staging:** desplegar reglas + app, correr migración en `dry-run`, revisar reporte, aplicar migración, probar flujos.
2. **Producción:** respaldo/export, ventana controlada, `dry-run`, `apply`, verificación funcional y monitoreo.
3. **Rollback:** mantener respaldo/export y plan para restaurar documentos afectados; si se revierten reglas/app, considerar también la compatibilidad de IDs.