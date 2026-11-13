"use strict";
/**
 * Borrado seguro de un proyecto con todo lo asociado.
 *
 * En el cliente no se puede hacer una cascada completa: las reglas exigen
 * pruebas de propiedad que desaparecen a mitad del proceso (borrar la propia
 * ficha de miembro invalida `isProjectOwner(...)` para el resto de borrados),
 * de modo que el proyecto quedaba huérfano. Esta función usa credenciales de
 * admin y es el único camino soportado por la app para eliminar un proyecto.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteProject = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const db = admin.firestore();

exports.deleteProject = (0, https_1.onCall)({ invoker: 'public' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión para eliminar un proyecto.');
  }
  const data = request.data ?? {};
  const projectId = String(data.projectId ?? '').trim();
  if (!projectId || projectId.length > 200) {
    throw new https_1.HttpsError('invalid-argument', 'projectId no válido.');
  }

  const projectRef = db.collection('projects').doc(projectId);
  const projectSnap = await projectRef.get();
  if (!projectSnap.exists) {
    return { ok: true, alreadyDeleted: true };
  }
  const project = projectSnap.data() ?? {};

  // Permiso: owner por campo del documento, miembro con rol owner o admin global.
  let allowed = project.ownerId === uid;
  if (!allowed) {
    const memberSnap = await db.collection('projectMembers').doc(`${projectId}_${uid}`).get();
    allowed = memberSnap.exists && memberSnap.data()?.role === 'owner';
  }
  if (!allowed) {
    const userSnap = await db.collection('users').doc(uid).get();
    allowed = userSnap.exists && userSnap.data()?.role === 'admin';
  }
  if (!allowed) {
    throw new https_1.HttpsError('permission-denied', 'Solo el dueño puede eliminar este proyecto.');
  }

  const collections = [
    'projectMembers',
    'projectInvitations',
    'projectShareLinks',
    'projectActivity',
    'projectPresences',
  ];
  let deleted = 0;
  for (const collectionName of collections) {
    const snap = await db.collection(collectionName).where('projectId', '==', projectId).get();
    for (const doc of snap.docs) {
      await doc.ref.delete();
      deleted++;
    }
  }
  await projectRef.delete();
  console.log(`deleteProject: ${projectId} por ${uid} (${deleted} documentos asociados eliminados)`);
  return { ok: true, deleted };
});
