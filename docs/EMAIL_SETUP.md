# Configuración de correos de invitación (Resend + Cloud Functions)

## Diagnóstico (por qué no llegaban los correos)

Dos problemas distintos:

1. **Bug de la app (corregido)**: `CollaborationService.inviteMember()` solo creaba el documento `projectInvitations/{id}` en Firestore y mostraba "Invitación enviada", pero **nunca llamaba a ninguna Cloud Function de correo**. Ahora, tras crear la invitación, el cliente llama (best-effort) a `sendProjectInvitation` vía `httpsCallable`. La invitación se crea igualmente aunque el correo falle, y la UI avisa si el correo no pudo enviarse.
2. **Servicio de correo no configurado**: `functions/lib/email/transport.js`, si falta la variable de entorno `RESEND_API_KEY`, **no envía nada** y solo escribe un `console.warn` con el contenido del correo (modo desarrollo). El envío real requiere API key de Resend + dominio verificado + desplegar las functions.

Además, el invitado **siempre** ve la invitación pendiente en `/projects` al entrar con el mismo correo (no necesita el correo).

## Paso 1 — Elige el remitente (From)

El remitente es lo que aparece en "De:" del correo; Resend solo permite direcciones verificadas.

**Sin dominio propio (recomendado para empezar):** usa `onboarding@resend.dev` (ya configurado por defecto en `functions/lib/email/config.js`). Limitación: en sandbox Resend **solo entrega al correo del dueño de la cuenta**. Perfecto para probar que tus invitaciones llegan.

**Con dominio propio (obligatorio para producción/entrega a terceros):**
1. Crea cuenta en https://resend.com y genera una API key (`re_...`).
2. **Domains → Add Domain**: añade tu dominio (p. ej. `tudominio.com`) — en tu app vive en `candelo30.github.io/Carxy-Renewal`, pero `github.io` **no es verificable** (DNS de GitHub), no necesitas asociarlo a Resend.
3. Publica en el DNS del dominio los registros SPF/DKIM (y DMARC recomendado) que Resend indique. Revisa el estado "Verified".
4. En `functions/lib/email/config.js` cambia `fromEmail` a `noreply@tudominio-verificado.com`.

## Paso 2 — Configurar secretos en Firebase (Functions v2)

El transporte lee `process.env.RESEND_API_KEY`. Copia la plantilla y rellena tu clave (no se versiona — está en `.gitignore`):

```bash
cp functions/.env.example functions/.env   # y edita RESEND_API_KEY
```

o, en su lugar, con el gestor de secretos de Google Cloud (Secret Manager + `defineSecret`).

## Paso 3 — Remitente y URL (ya configurados por defecto)

`functions/lib/email/config.js` ya trae valores por defecto razonables:
- `fromEmail`: `onboarding@resend.dev` (solo entrega al correo del dueño de la cuenta). Cámbialo a `noreply@tudominio-verificado.com` cuando verifiques tu dominio.
- `appUrl`: `https://candelo30.github.io/Carxy-Renewal` (la URL pública actual de la app).
- `supportEmail` / `privacyUrl` / `termsUrl`: aún tienen placeholders, actualízalos a tus URLs reales.
- `config.js` es la fuente desplegada hoy (el proyecto no tiene `functions/src`; `lib/` es el código desplegado). Mantén `package.json`/`package-lock.json` como manifiesto.

## Paso 4 — Desplegar las Cloud Functions

```bash
firebase deploy --only functions
# o selectivamente:
firebase deploy --only functions:sendProjectInvitation,functions:sendVerifyEmail
```

Comprueba en Firebase Console → Functions que `sendProjectInvitation` aparece y que los logs no muestran `RESEND_API_KEY no está configurada`.

## Paso 5 — Probar

1. Desde la web, invita a un correo que **reciba realmente** (en sandbox: el correo de tu cuenta Resend).
2. Revisa Firebase Console → Functions → Logs para ver `sendProjectInvitation` ejecutándose sin error.
3. Revisa la bandeja/spam del destinatario y los logs de Resend (Delivered/Bounced/Blocked).
4. Verifica también que en `firestore.rules` el set de `projectInvitations` es el esperado y que el invitado la ve en `/projects` → "Invitaciones pendientes".

## Errores habituales

| Síntoma | Causa | Solución |
|---|---|---|
| Toast "correo no se pudo enviar" | Functions no desplegadas / RESEND_API_KEY ausente | Paso 4 |
| Resend: "domain is not verified" | fromEmail con dominio no verificado | Paso 3 |
| "Resend no entrega a otros destinatarios" | Cuenta sandbox | Verificar dominio (Paso 1) |
| Correo en spam | DNS incompleto (SPF/DKIM) | Añadir registros de Resend |
| Invitación aparece, no hay correo | Servicio de correo no configurado | Normal hasta Pasos 2–4 |

## Notas sobre seguridad
- Nunca subas `RESEND_API_KEY` ni el `.env` de `functions/` a git (está en `.gitignore`).
- Los correos incluyen un enlace a `/projects` donde se acepta la invitación; no exponen tokens en el enlace.
- El envío es "best-effort": si el servicio de correo falla, la invitación no se pierde, solo no llega el aviso. El invitado siempre puede entrar con el correo invitado y aceptarla en `/projects`.
