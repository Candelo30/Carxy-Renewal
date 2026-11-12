# Configuración de correos de invitación (CARXY)

## Estado actual: modo simple

El proyecto está en **modo simple**: no requiere ninguna configuración.

- El transporte de correos (`functions/lib/email/transport.js`) funciona en **modo desarrollo**:
  registra en los logs del Cloud Function el correo que se habría enviado y **no falla**.
- No existe ninguna variable de entorno (`RESEND_API_KEY`, etc.) ni API key que configurar.
- Las Cloud Functions (`sendWelcomeEmail`, `sendProjectInvitation`, `sendFeedbackConfirmation`, `sendResetPassword`, `sendVerifyEmail`) se despliegan sin configuración adicional.

## Qué hace el modo simple

1. Al invitar a un usuario desde la app, se crea la invitación en Firestore (`projectInvitations/{id}`).
2. La app llama (best-effort) a la Cloud Function `sendProjectInvitation` vía `httpsCallable`.
3. La función registra el correo en los logs y **siempre responde con éxito** (`{ ok: true }`).
4. La invitación queda visible para el invitado en `/projects` → "Invitaciones pendientes" (aceptar/declinar).

## Si en el futuro se quiere un envío real

Este archivo queda como referencia. El transporte fue diseñado para aceptar un transport de correo real sustituyendo la función `sendMail` en `functions/lib/email/transport.js`.

## Notas

- Nunca subas claves ni archivos `.env` reales a git.
- Los correos incluyen un enlace a `/projects` donde se acepta la invitación; no exponen tokens en el enlace.
- El envío es "best-effort": si fallara, la invitación no se pierde, solo no llega el aviso. El invitado siempre puede entrar con el correo invitado y aceptarla en `/projects`.
