"use strict";
/**
 * Cloud Functions de envío de correo para CARXY.
 *
 * Cada función es `onCall` (se invoca desde el frontend con firebase-functions
 * httpsCallable) y recibe los datos dinámicos necesarios para renderizar la
 * plantilla correspondiente.
 *
 * Desplegar con: firebase deploy --only functions:sendVerifyEmail,functions:sendResetPassword,...
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendFeedbackConfirmation = exports.sendProjectInvitation = exports.sendWelcomeEmail = exports.sendResetPassword = exports.sendVerifyEmail = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const transport_1 = require("./transport");
const templates_1 = require("./templates");
// Usa la app de Firebase ya inicializada en src/index.ts (no llamar initializeApp dos veces).
const db = admin.firestore();
/** Helper para autenticar al llamador (opcional según la función). */
async function requireAuth(request) {
    if (!request.auth?.uid) {
        throw new Error('no-auth');
    }
    return request.auth.uid;
}
/* ------------------------------------------------------------------ */
/*  1. Verificación de correo (registro)                              */
/* ------------------------------------------------------------------ */
exports.sendVerifyEmail = (0, https_1.onCall)(async (request) => {
    await requireAuth(request);
    const { to, displayName, verifyUrl, expiresIn } = request.data ?? {};
    if (!to || typeof to !== 'string')
        throw new Error('to-required');
    const { subject, html, text } = (0, templates_1.verifyEmailTemplate)({
        to,
        displayName: String(displayName ?? 'usuario'),
        verifyUrl: String(verifyUrl),
        expiresIn: expiresIn ? String(expiresIn) : undefined,
    });
    await (0, transport_1.sendMail)({ to, subject, html, text });
    return { ok: true, to };
});
/* ------------------------------------------------------------------ */
/*  2. Restablecer contraseña                                         */
/* ------------------------------------------------------------------ */
exports.sendResetPassword = (0, https_1.onCall)(async (request) => {
    // No requiere auth: cualquier persona puede pedir recuperación
    const { to, displayName, resetUrl, expiresIn } = request.data ?? {};
    if (!to || typeof to !== 'string')
        throw new Error('to-required');
    const { subject, html, text } = (0, templates_1.resetPasswordTemplate)({
        to,
        displayName: String(displayName ?? 'usuario'),
        resetUrl: String(resetUrl),
        expiresIn: expiresIn ? String(expiresIn) : undefined,
    });
    await (0, transport_1.sendMail)({ to, subject, html, text });
    return { ok: true, to };
});
/* ------------------------------------------------------------------ */
/*  3. Correo de bienvenida (post-registro)                           */
/* ------------------------------------------------------------------ */
exports.sendWelcomeEmail = (0, https_1.onCall)(async (request) => {
    await requireAuth(request);
    const { to, displayName, dashboardUrl } = request.data ?? {};
    if (!to || typeof to !== 'string')
        throw new Error('to-required');
    const { subject, html, text } = (0, templates_1.welcomeTemplate)({
        to,
        displayName: String(displayName ?? 'usuario'),
        dashboardUrl: String(dashboardUrl ?? `${process.env.APP_URL ?? 'https://tu-app.web.app'}/editor`),
    });
    await (0, transport_1.sendMail)({ to, subject, html, text });
    return { ok: true, to };
});
/* ------------------------------------------------------------------ */
/*  4. Invitación a proyecto (colaboración)                           */
/* ------------------------------------------------------------------ */
exports.sendProjectInvitation = (0, https_1.onCall)(async (request) => {
    const uid = await requireAuth(request);
    const { to, displayName, invitedByName, projectName, role, acceptUrl, expiresIn, } = request.data ?? {};
    if (!to || typeof to !== 'string')
        throw new Error('to-required');
    if (!invitedByName || typeof invitedByName !== 'string')
        throw new Error('invitedByName-required');
    if (!projectName || typeof projectName !== 'string')
        throw new Error('projectName-required');
    const { subject, html, text } = (0, templates_1.projectInvitationTemplate)({
        to,
        displayName: String(displayName ?? 'usuario'),
        invitedByName,
        projectName,
        role: String(role ?? 'viewer'),
        acceptUrl: String(acceptUrl),
        expiresIn: expiresIn ? String(expiresIn) : undefined,
    });
    await (0, transport_1.sendMail)({ to, subject, html, text });
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
    }
    catch {
        // No bloquea el envío si falla la auditoría
    }
    return { ok: true, to };
});
/* ------------------------------------------------------------------ */
/*  5. Confirmación de feedback / soporte                             */
/* ------------------------------------------------------------------ */
exports.sendFeedbackConfirmation = (0, https_1.onCall)(async (request) => {
    await requireAuth(request);
    const { to, displayName, subject, ticketId } = request.data ?? {};
    if (!to || typeof to !== 'string')
        throw new Error('to-required');
    const { subject: mailSubject, html, text } = (0, templates_1.feedbackConfirmationTemplate)({
        to,
        displayName: String(displayName ?? 'usuario'),
        subject: String(subject ?? ''),
        ticketId: String(ticketId ?? ''),
    });
    await (0, transport_1.sendMail)({ to, subject: mailSubject, html, text });
    return { ok: true, to };
});
