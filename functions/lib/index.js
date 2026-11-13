"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendFeedbackConfirmation = exports.deleteProject = exports.sendProjectInvitation = exports.sendWelcomeEmail = exports.sendResetPassword = exports.sendVerifyEmail = exports.cleanupInactiveUsers = exports.deleteFirebaseAuthUser = void 0;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
const DAY = 24 * 60 * 60 * 1000;
const INACTIVE_DAYS = 30;
/**
 * Borra un usuario de Firebase Authentication.
 * Solo puede ser llamado por un administrador autenticado.
 * Se usa desde el panel de administración al eliminar cuentas (manual o por inactividad).
 */
exports.deleteFirebaseAuthUser = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new Error('no-auth');
    }
    const callerUid = request.auth.uid;
    const callerSnap = await db.collection('users').doc(callerUid).get();
    if (!callerSnap.exists || callerSnap.data()?.role !== 'admin') {
        throw new Error('no-admin');
    }
    const { uid } = request.data ?? {};
    if (!uid || typeof uid !== 'string') {
        throw new Error('uid-required');
    }
    try {
        await admin.auth().deleteUser(uid);
        return { ok: true, uid };
    }
    catch (error) {
        throw new Error(error?.message || 'no-se-pudo-borrar-usuario-de-auth');
    }
});
/**
 * Limpieza programada automática.
 * Corre cada 24 horas y borra cuentas con más de 30 días sin actividad:
 * - Datos de Firestore (perfil, privado, actividad, posts, likes)
 * - Cuenta de Firebase Authentication
 * - Entrada de auditoría en accountDeletionAudit
 *
 * Para activar: firebase deploy --only functions:cleanupInactiveUsers
 */
exports.cleanupInactiveUsers = (0, scheduler_1.onSchedule)({
    schedule: 'every 24 hours',
    timeZone: 'America/Bogota',
}, async () => {
    const now = Date.now();
    const limitMs = INACTIVE_DAYS * DAY;
    // Última actividad conocida por usuario
    const activitySnap = await db.collection('userActivity').get();
    const lastSeenByUid = new Map();
    for (const doc of activitySnap.docs) {
        const data = doc.data();
        const uid = String(data.uid ?? '');
        const raw = data.lastSeenAt;
        const lastSeen = typeof raw === 'number' ? raw : raw?.toMillis?.() ?? 0;
        const prev = lastSeenByUid.get(uid);
        if (prev === undefined || lastSeen > prev)
            lastSeenByUid.set(uid, lastSeen);
    }
    // Usuarios candidatos a eliminar (excluye admins y suspendidos)
    const usersSnap = await db.collection('users').get();
    const targets = [];
    for (const doc of usersSnap.docs) {
        const data = doc.data();
        const uid = String(doc.id);
        if (data.role === 'admin' || data.isBanned === true)
            continue;
        const lastSeen = lastSeenByUid.get(uid);
        if (!lastSeen || now - lastSeen <= limitMs)
            continue;
        targets.push({
            uid,
            email: String(data.email ?? ''),
            displayName: String(data.displayName ?? ''),
        });
    }
    let deleted = 0;
    const errors = [];
    for (const user of targets) {
        try {
            const batch = db.batch();
            // Perfiles
            batch.delete(db.collection('users').doc(user.uid));
            batch.delete(db.collection('userPrivate').doc(user.uid));
            batch.delete(db.collection('userActivity').doc(user.uid));
            // Posts propios
            const postsSnap = await db.collection('posts').where('authorId', '==', user.uid).get();
            for (const post of postsSnap.docs)
                batch.delete(post.ref);
            // Likes que el usuario haya dado en cualquier post
            const likesSnap = await db.collectionGroup('likes').where('uid', '==', user.uid).get();
            for (const like of likesSnap.docs)
                batch.delete(like.ref);
            await batch.commit();
            // Borrar cuenta de Firebase Auth
            await admin.auth().deleteUser(user.uid);
            // Registro de auditoría
            await db.collection('accountDeletionAudit').add({
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                deletedAt: admin.firestore.Timestamp.now(),
                deletedBy: 'system-cleanup',
                reason: 'inactivity',
            });
            deleted++;
        }
        catch (error) {
            errors.push(`${user.uid}: ${error?.message ?? String(error)}`);
        }
    }
    console.log(`Limpieza automática de inactividad: ${deleted} cuenta(s) eliminada(s), ${errors.length} error(es).`);
});
// --- Funciones de correo (envío decorado y dinámico) ---
var functions_1 = require("./email/functions");
Object.defineProperty(exports, "sendVerifyEmail", { enumerable: true, get: function () { return functions_1.sendVerifyEmail; } });
Object.defineProperty(exports, "sendResetPassword", { enumerable: true, get: function () { return functions_1.sendResetPassword; } });
Object.defineProperty(exports, "sendWelcomeEmail", { enumerable: true, get: function () { return functions_1.sendWelcomeEmail; } });
Object.defineProperty(exports, "sendProjectInvitation", { enumerable: true, get: function () { return functions_1.sendProjectInvitation; } });
Object.defineProperty(exports, "sendFeedbackConfirmation", { enumerable: true, get: function () { return functions_1.sendFeedbackConfirmation; } });
// --- Eliminación de proyectos (cascada segura) ---
var projects_1 = require("./projects");
Object.defineProperty(exports, "deleteProject", { enumerable: true, get: function () { return projects_1.deleteProject; } });
// --- Asistente CARXY (Gemini) ---
var assistant_1 = require("./assistant");
Object.defineProperty(exports, "askCarxyBot", { enumerable: true, get: function () { return assistant_1.askCarxyBot; } });
