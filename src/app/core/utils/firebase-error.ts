/**
 * Traducción de errores de Firebase a mensajes comprensibles.
 *
 * Los SDK de Firestore/Storage devuelven textos crudos como
 * "Missing or insufficient permissions." o "Firebase: Error (permission-denied)".
 * Mostrarlos en la interfaz confunde al usuario, así que aquí se convierten a
 * mensajes en español que `I18nService.translate()` puede traducir.
 */

/** Mensajes en español (el texto original actúa como clave de traducción). */
const FIREBASE_ERROR_MESSAGES: Record<string, string> = {
  'permission-denied': 'No tienes permisos para ver o modificar esta información.',
  'unauthenticated': 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  'unavailable': 'El servicio no está disponible en este momento. Inténtalo de nuevo en unos segundos.',
  'failed-precondition': 'Esta operación necesita un índice o un paso previo que todavía no está disponible.',
  'not-found': 'El elemento ya no existe.',
  'deadline-exceeded': 'La operación tardó demasiado. Inténtalo de nuevo.',
  'resource-exhausted': 'Se ha alcanzado el límite de operaciones. Inténtalo de nuevo en unos segundos.',
  'internal': 'Firebase devolvió un error interno. Inténtalo de nuevo.',
  'cancelled': 'La operación se canceló antes de completarse.',
  'aborted': 'La operación se canceló porque hubo un conflicto. Inténtalo de nuevo.',
  'storage/unauthorized': 'Firebase Storage rechazó la operación. Revisa los permisos del archivo.',
  'storage/canceled': 'Se canceló la subida del archivo.',
  'storage/quota-exceeded': 'Se ha superado la cuota de Firebase Storage.',
};

const PERMISSION_MESSAGE_PATTERN = /missing or insufficient permissions|permission[- ]denied/i;
const INDEX_MESSAGE_PATTERN = /requires an index/i;

/** Devuelve el mensaje en español del error o `null` si no es un error conocido. */
export function firebaseErrorMessage(error: unknown): string | null {
  if (!error) return null;

  const code = typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const byCode = code ? FIREBASE_ERROR_MESSAGES[code] : undefined;
  if (byCode) return byCode;

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message) return null;
  if (PERMISSION_MESSAGE_PATTERN.test(message)) return FIREBASE_ERROR_MESSAGES['permission-denied'];
  if (INDEX_MESSAGE_PATTERN.test(message)) {
    return 'Falta desplegar un índice de Firestore para esta consulta. Ejecuta `firebase deploy --only firestore:indexes`.';
  }
  return null;
}
