# Modelo de datos de Firestore — CARXY 3D Studio

> Refleja el modelo actual usado por `src/app/core/services/*` y `src/app/core/models/social.models.ts`.
> Las colecciones y campos pueden ampliarse con el tiempo; mantén este documento sincronizado con `firestore.rules` y `firestore.indexes.json` al evolucionar el modelo.
>
> La autoridad de acceso son `firestore.rules` y `storage.rules` (no el cliente). El cliente se usa como UX/optimista; nada de esto sustituye las reglas desplegadas.

## Convenciones generales

- `createdAt` / `updatedAt` / `lastSeenAt` son timestamps en **milisegundos** (`Date.now()`).
- Elementos públicos del feed: `posts` con `isPrivate == false`.
- Las interacciones por usuario (likes, comentarios, notificaciones) viven en **subcolecciones**.
- Los documentos públicos de usuario (`users`) se duplican parcialmente en `userPrivate` para email y datos de contacto.
- Modo local/demo: los mismos datos se guardan en `localStorage`/IndexedDB con prefijos `forma-local-*`/`forma-social-*` y NO pasan por reglas. Ver límites en README / SECURITY.

## Colecciones

### `users/{uid}` (público de creador)
| Campo | Tipo | Notas |
|---|---|---|
| `uid` | string | igual al doc id |
| `displayName` | string |  |
| `photoURL` | string \| null | avatar (fallback `user-avatar.svg`) |
| `bio` | string |  |
| `role` | `'user' \| 'moderator' \| 'admin'` | gestionado por admin; el cliente no puede elevarlo |
| `isBanned` | boolean | cuentas suspendidas no publican/comentan |
| `createdAt` | number |  |
| `emailVerified` | boolean | espejo del estado de Auth |
| `providers` | string[] | proveedores de Auth enlazados |

### `userPrivate/{uid}`
Documento privado del usuario (mismo id). Contiene email y datos de contacto para administración/auditoría; no es legible públicamente.

### `userActivity/{uid}`
| Campo | Tipo | Notas |
|---|---|---|
| `uid` | string |  |
| `email` | string | copia para auditoría de actividad |
| `displayName` | string |  |
| `lastSeenAt` | number | usado para purgar cuentas inactivas (>30d) |
| `lastSeenPath` | string | ruta donde se registró la actividad |
| `updatedAt` | number |  |

### `accountDeletionAudit/{id}`
| Campo | Tipo | Notas |
|---|---|---|
| `uid`, `email`, `displayName` | string | cuenta eliminada |
| `deletedAt` | number |  |
| `deletedBy` | string | `'self' \| 'admin' \| 'inactivity'` |
| `reason` | string |  |

### `posts/{postId}` (modelos 3D publicados)
| Campo | Tipo | Notas |
|---|---|---|
| `title` | string | trim, ≤100 (regla de validación) |
| `description` | string | trim, ≤2000 |
| `modelUrl` | string | URL de descarga de Storage |
| `thumbnailUrl` | string | data URL o URL de Storage |
| `modelPath` | string | `models/{uid}/{postId}.glb` |
| `thumbnailPath` | string | `thumbnails/{uid}/{postId}.png` |
| `author` | mapa tipo `User` | espejo público del autor |
| `authorId` | string | id del autor (para índices y consultas) |
| `authorName` | string |  |
| `likes` / `likesCount` | number | contadores desnormalizados |
| `viewsCount` / `remixCount` | number | contadores desnormalizados |
| `isPrivate` | boolean | feed público: `false`; `true` oculto salvo autor/admin |
| `tags` | string[] | ≤12 etiquetas |
| `createdAt` | number | orden del feed |

**Subcolecciones:**
- `posts/{postId}/likes/{uid}`: `{ uid, createdAt }` — anti-spam: un like por usuario; sin likes propios.
- `posts/{postId}/comments/{commentId}`: `{ id, text, author: User-público, createdAt }`.
- Índices compuestos para feed/portafolios: ver `firestore.indexes.json` (`authorId + createdAt desc`, `authorId + isPrivate + createdAt desc`).

### `chats/{chatId}`
| Campo | Tipo | Notas |
|---|---|---|
| `participantIds` | [string, string] | ordenados (`a < b`); id del chat = `a__b` |
| `updatedAt` | number |  |
| `lastMessage` | mapa `ChatMessage` | para listar conversaciones sin leer subcolección |

**Subcolección:** `chats/{chatId}/messages/{messageId}` — `{ id, text, senderId, senderName, createdAt }`, ordenado `createdAt asc`.
Solo participantes leen/escriben según reglas.

### `follows` (por usuario, dentro de subcolecciones)
- `users/{uid}/followers/{followerId}`: `{ followerId, followingId, createdAt }`.
- `users/{uid}/following/{followingId}`: espejo inverso.
- `users/{uid}/notifications/{notificationId}`: `{ recipientId, actorId, actorName, actorPhotoURL, kind: 'follow'|'like'|'comment', targetId?, createdAt, read }`.
- `users/{uid}/likedPosts/{postId}`: `{ postId, createdAt }` para favoritos.

### `reports/{reportId}` (moderación de contenido)
`{ postId, postTitle, reporterId, reporterName, reason: 'spam'|'inappropriate'|'copyright'|'other', details (≤500), status: 'open'|'resolved'|'dismissed', createdAt, resolvedAt? }`

### `feedback/{id}` (contacto/feedback)
`{ userId, name, email, type: 'bug'|'idea'|'account'|'collaboration'|'other', subject, message, status: 'new'|'reviewing'|'resolved', createdAt, updatedAt? }`

### `communityQuestions/{id}` (ayuda de la comunidad)
`{ authorId, authorName, authorPhotoURL, title, body, tags[], createdAt, updatedAt?, answersCount, votes, voterIds[], resolved, pinned, locked, acceptedAnswerId }`
Subcolección: `communityQuestions/{id}/answers/{answerId}` — `{ questionId, authorId, body, createdAt, votes, voterIds[], accepted }`

### `projects/{projectId}` (colaboración)
`{ ownerId, name, description, sceneJson?, thumbnailUrl?, isPublic, createdAt, updatedAt }`

**Relacionadas:**
- `projectMembers/{id}`: `{ projectId, userId, userName, userPhotoURL, role: 'owner'|'editor'|'viewer', joinedAt }`
- `projectInvitations/{id}`: `{ projectId, projectName, invitedBy, invitedEmail, invitedUid?, role, status: 'pending'|'accepted'|'rejected'|'revoked'|'expired', createdAt, expiresAt, respondedAt? }`
- `projectActivity/{id}`: `{ projectId, actorId, actorName, action: 'object_created'|'object_updated'|'object_deleted'|'material_changed'|'layer_changed', objectId, objectType, snapshot?, createdAt }`
- `projectPresences/{id}`: `{ uid, projectId, displayName, photoURL, isOnline, currentObjectId, cursorX, cursorY, transform?: { objectId, position, rotation, scale, updatedAt }, lastSeen }`

### `helpArticles/{id}`
`{ category: 'primeros-pasos'|'editor'|'publicacion'|'comunidad'|'colaboracion'|'cuenta', title, subtitle, icon, keywords, body: string[], steps?: string[], tip?, order, isPublished, createdAt, updatedAt }`

## Storage

| Ruta | Contenido | Límites |
|---|---|---|
| `models/{uid}/{postId}.glb` | archivo GLB del modelo | ≤ `environment.uploads.maxModelBytes` (ver `storage.rules`); contentType `model/gltf-binary` |
| `thumbnails/{uid}/{postId}.png` | captura PNG | ≤ `environment.uploads.maxThumbnailBytes`; `image/png` |

## Lecturas desnormalizadas / agregados

- Contadores de post (`likesCount`, `viewsCount`, `remixCount`) se actualizan con `increment()`/transacciones.
- `lastMessage` en `chats/{id}` evita leer la subcolección `messages` al listar.
- `authorName` en `posts/{id}` y reporteros en reportes evita `get()` extra al listar/compilar vistas.
- `inactiveUsers$` y `deletionAudit$` en admin combinan `userActivity` + `users` por UI.

## Costes (lecturas) y reglas

- `firestore.rules` usa helpers `roleOf(uid)` / `isActiveUser()` que hacen `get()` del doc de usuario en cada evaluación: en operaciones masivas (batch) se multiplican las lecturas.
- Migración recomendada a **custom claims** (`request.auth.token.role`, `request.auth.token.admin`) para rol/estado en reglas; requiere asignar claims desde un backend/Cloud Function de confianza y refrescar tokens.

## Feed

El listener del feed público (`isPrivate == false`, `orderBy('createdAt','desc')`) carga como máximo **los 120 posts más recientes** (`POSTS_FEED_LIMIT` en `social.ts`). Búsqueda/etiqueta/orden/paginación se hacen en cliente sobre ese conjunto. Para colecciones mayores se requiere paginación con cursores (`startAfter`) y/o un servicio de búsqueda (Algolia/Typesense) — ver "Pendientes" en README.
