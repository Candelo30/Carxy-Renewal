/**
 * Cloud Functions de envío de correo para CARXY.
 *
 * Cada función es `onCall` (se invoca desde el frontend con firebase-functions
 * httpsCallable) y recibe los datos dinámicos necesarios para renderizar la
 * plantilla correspondiente.
 *
 * Desplegar con: firebase deploy --only functions:sendVerifyEmail,functions:sendResetPassword,...
 */

import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { sendMail } from './transport';
import {
  verifyEmailTemplate,
  resetPasswordTemplate,
  welcomeTemplate,
  projectInvitationTemplate,
  feedbackConfirmationTemplate,
} from './templates';

// Usa la app de Firebase ya inicializada en src/index.ts (no llamar initializeApp dos veces).
const db = admin.firestore();

/** Helper para autenticar al llamador (opcional según la función). */
async function requireAuth(request: { auth?: { uid: string } | null }): Promise<string> {
  if (!request.auth?.uid) {
    throw new Error('no-auth');
  }
  return request.auth.uid;
}

/* ------------------------------------------------------------------ */
/*  1. Verificación de correo (registro)                              */
/* ------------------------------------------------------------------ */

export const sendVerifyEmail = onCall(async (request) => {
  await requireAuth(request);

  const { to, displayName, verifyUrl, expiresIn } = request.data ?? {};
  if (!to || typeof to !== 'string') throw new Error('to-required');

  const { subject, html, text } = verifyEmailTemplate({
    to,
    displayName: String(displayName ?? 'usuario'),
    verifyUrl: String(verifyUrl),
    expiresIn: expiresIn ? String(expiresIn) : undefined,
  });

  await sendMail({ to, subject, html, text });
  return { ok: true, to };
});

/* ------------------------------------------------------------------ */
/*  2. Restablecer contraseña                                         */
/* ------------------------------------------------------------------ */

export const sendResetPassword = onCall(async (request) => {
  // No requiere auth: cualquier persona puede pedir recuperación
  const { to, displayName, resetUrl, expiresIn } = request.data ?? {};
  if (!to || typeof to !== 'string') throw new Error('to-required');

  const { subject, html, text } = resetPasswordTemplate({
    to,
    displayName: String(displayName ?? 'usuario'),
    resetUrl: String(resetUrl),
    expiresIn: expiresIn ? String(expiresIn) : undefined,
  });

  await sendMail({ to, subject, html, text });
  return { ok: true, to };
});

/* ------------------------------------------------------------------ */
/*  3. Correo de bienvenida (post-registro)                           */
/* ------------------------------------------------------------------ */

export const sendWelcomeEmail = onCall(async (request) => {
  await requireAuth(request);

  const { to, displayName, dashboardUrl } = request.data ?? {};
  if (!to || typeof to !== 'string') throw new Error('to-required');

  const { subject, html, text } = welcomeTemplate({
    to,
    displayName: String(displayName ?? 'usuario'),
    dashboardUrl: String(dashboardUrl ?? `${process.env.APP_URL ?? 'https://tu-app.web.app'}/editor`),
  });

  await sendMail({ to, subject, html, text });
  return { ok: true, to };
});

/* ------------------------------------------------------------------ */
/*  4. Invitación a proyecto (colaboración)                           */
/* ------------------------------------------------------------------ */

export const sendProjectInvitation = onCall(async (request) => {
  const uid = await requireAuth(request);

  const {
    to,
    displayName,
    invitedByName,
    projectName,
    role,
    acceptUrl,
    expiresIn,
  } = request.data ?? {};

  if (!to || typeof to !== 'string') throw new Error('to-required');
  if (!invitedByName || typeof invitedByName !== 'string') throw new Error('invitedByName-required');
  if (!projectName || typeof projectName !== 'string') throw new Error('projectName-required');

  const { subject, html, text } = projectInvitationTemplate({
    to,
    displayName: String(displayName ?? 'usuario'),
    invitedByName,
    projectName,
    role: String(role ?? 'viewer'),
    acceptUrl: String(acceptUrl),
    expiresIn: expiresIn ? String(expiresIn) : undefined,
  });

  await sendMail({ to, subject, html, text });

  // Opcional: registrar la invitación enviada en Firestore para auditoría
  try {
    await db.collection('emailAudit').add({
      type: 'projectInvitation',
      to,
      projectName,
      role,
      invitedBy: uid,
      sentAt: admin.firestore.Timestamp.now(),
    });
  } catch {
    // No bloquea el envío si falla la auditoría
  }

  return { ok: true, to };
});

/* ------------------------------------------------------------------ */
/*  5. Confirmación de feedback / soporte                             */
/* ------------------------------------------------------------------ */

export const sendFeedbackConfirmation = onCall(async (request) => {
  await requireAuth(request);

  const { to, displayName, subject, ticketId } = request.data ?? {};
  if (!to || typeof to !== 'string') throw new Error('to-required');

  const { subject: mailSubject, html, text } = feedbackConfirmationTemplate({
    to,
    displayName: String(displayName ?? 'usuario'),
    subject: String(subject ?? ''),
    ticketId: String(ticketId ?? ''),
  });

  await sendMail({ to, subject: mailSubject, html, text });
  return { ok: true, to };
});
