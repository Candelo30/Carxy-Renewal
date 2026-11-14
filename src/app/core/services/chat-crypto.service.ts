import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
} from '@angular/fire/firestore';
import { catchError, firstValueFrom, of, take, timeout } from 'rxjs';
import { AuthService } from './auth';

export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
  algorithm: 'AES-GCM';
}

export interface EncryptedBlobPayload {
  iv: string;
  data: ArrayBuffer;
  algorithm: 'AES-GCM';
}

const DB_NAME = 'carxy-e2e-keys';
const DB_STORE = 'keys';
const PRIVATE_KEY_ID = 'ecdh-private';
const PUBLIC_KEY_DOC = 'chatKeys';

/**
 * Cifrado de extremo a extremo (E2E) para los mensajes del chat.
 *
 * Modelo de claves:
 * - Cada navegador genera UN par ECDH P-256 por usuario. La clave privada es
 *   NO extraíble y se guarda en IndexedDB (no sale del dispositivo).
 * - La clave pública se sube a `chatKeys/{uid}` (Firestore, lectura autenticada,
 *   escritura solo del dueño).
 * - Cada mensaje de texto se cifra con AES-GCM (256 bits) usando una clave
 *   compartida derivada por ECDH entre mi privada y la pública del interlocutor.
 * - No hay multi-dispositivo: otro navegador no puede descifrar historial
 *   (limitación documentada; Fase 2 puede añadir sincronización de clave).
 *
 * Los mensajes antiguos (texto plano) siguen funcionando: `encrypted` ausente
 * implica texto en claro.
 *
 * En modo local/demo (sin Firebase) no se cifra: los datos nunca salen del
 * navegador.
 */
@Injectable({ providedIn: 'root' })
export class ChatCryptoService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly auth = inject(AuthService, { optional: true });

  private keyPairPromise: Promise<CryptoKeyPair | null> | null = null;
  private readonly sharedKeys = new Map<string, Promise<CryptoKey | null>>();
  private readonly peerPublicKeys = new Map<string, Promise<JsonWebKey | null>>();
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  /** Verdadero si el navegador soporta Web Crypto (contexto seguro) y Firestore está disponible. */
  isSupported(): boolean {
    return typeof crypto !== 'undefined' && !!crypto.subtle && !!this.firestore;
  }

  /**
   * Resuelve el uid del usuario esperando a que Auth restaure la sesión.
   * El getter síncrono `currentUser` puede devolver `null` en el primer frame;
   * por eso nadie debería usarlo directamente para subir claves.
   */
  private async currentUid(): Promise<string | null> {
    try {
      await this.auth?.waitForAuthReady();
    } catch {
      // Si auth no está disponible, se intenta igualmente con el getter.
    }
    const syncUid = this.auth?.currentUser?.uid;
    if (syncUid) return syncUid;
    if (!this.auth) return null;
    try {
      const user = await firstValueFrom(this.auth.user$.pipe(take(1), timeout(10000), catchError(() => of(null))));
      return user?.uid ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Asegura que mi par de claves existe (genera y sube la pública si hace
   * falta). Devuelve `true` si el cifrado E2E está operativo para mi cuenta.
   * Best effort: los errores se propagan para que el llamante decida si son
   * fatales (p. ej. al enviar un mensaje) o ignorables (p. ej. al abrir la app).
   */
  async ensureMyKeyPair(): Promise<boolean> {
    if (!this.isSupported()) return false;
    // waitForAuthReady + user$ garantizan el uid incluso en el primer frame.
    const pair = await this.myKeyPair();
    if (!pair) return false;
    await this.uploadMyPublicKey(pair.publicKey);
    return true;
  }

  /** Cifra `plaintext` para un destinatario concreto. Lanza si falta su clave pública. */
  async encryptText(peerUid: string, plaintext: string): Promise<EncryptedPayload> {
    const key = await this.sharedKey(peerUid);
    if (!key) {
      throw new Error('PEER_KEY_MISSING');
    }
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
    const bytes = new Uint8Array(new TextEncoder().encode(plaintext));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return {
      iv: ChatCryptoService.toBase64(iv),
      ciphertext: ChatCryptoService.toBase64(new Uint8Array(ciphertext)),
      algorithm: 'AES-GCM',
    };
  }

  /** Descifra texto cifrado con la clave compartida. Devuelve `null` si no se puede descifrar. */
  async decryptText(
    peerUid: string,
    ivBase64: string,
    ciphertextBase64: string,
  ): Promise<string | null> {
    const key = await this.sharedKey(peerUid);
    if (!key) return null;
    try {
      const iv = ChatCryptoService.fromBase64(ivBase64);
      const data = ChatCryptoService.fromBase64(ciphertextBase64);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      return new TextDecoder().decode(plain);
    } catch {
      return null;
    }
  }

  /** Cifra un binario completo (nota de voz). Lanza si falta la clave pública del destinatario. */
  async encryptBlob(peerUid: string, blob: Blob): Promise<EncryptedBlobPayload> {
    const key = await this.sharedKey(peerUid);
    if (!key) {
      throw new Error('PEER_KEY_MISSING');
    }
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
    const bytes = await blob.arrayBuffer();
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return {
      iv: ChatCryptoService.toBase64(iv),
      data,
      algorithm: 'AES-GCM',
    };
  }

  /** Descifra un binario (nota de voz) con la clave compartida. Devuelve `null` si no se puede. */
  async decryptBlob(
    peerUid: string,
    ivBase64: string,
    data: ArrayBuffer,
    mimeType: string,
  ): Promise<Blob | null> {
    const key = await this.sharedKey(peerUid);
    if (!key) return null;
    try {
      const iv = ChatCryptoService.fromBase64(ivBase64);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      return new Blob([plain], { type: mimeType || 'application/octet-stream' });
    } catch {
      return null;
    }
  }

  /** La otra punta del `chatId` (`uidA__uidB`) relativa a nuestra uid actual. */
  peerUidFor(chatId: string, myUid: string): string {
    return chatId.split('__').find((uid) => uid !== myUid) ?? '';
  }

  /** Clave privada no extraíble desde IndexedDB (o nuevo par si no existe). */
  private async myKeyPair(): Promise<CryptoKeyPair | null> {
    if (this.keyPairPromise) return this.keyPairPromise;
    this.keyPairPromise = this.loadOrCreateKeyPair();
    const pair = await this.keyPairPromise;
    if (!pair) this.keyPairPromise = null;
    return pair;
  }

  private async loadOrCreateKeyPair(): Promise<CryptoKeyPair | null> {
    const db = await this.openDb();
    if (db) {
      const stored = await this.idbGet<CryptoKey>(db, PRIVATE_KEY_ID);
      if (stored) {
        try {
          const jwk = JSON.parse(await this.exportPairPublicKeyHint());
          const publicKey = await this.importPeerPublicKey(jwk);
          if (publicKey) return { publicKey, privateKey: stored };
        } catch (error) {
          // NUNCA regenerar ni sobrescribir: si la restauración falla, este
          // dispositivo simplemente no puede leer el historial; destruir el par
          // publicada llevaría a que el usuario perdiera el acceso a TODO.
          console.warn('[carxy] No se pudo restaurar el par E2E local. El cifrado queda desactivado en esta sesión.', error);
          return null;
        }
      }
    }
    if (!crypto?.subtle) return null;
    try {
      const pair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        ['deriveKey'],
      );
      if (db) {
        await this.idbPut(db, PRIVATE_KEY_ID, pair.privateKey);
        await this.idbPut(db, this.publicHintKey(), await this.exportPublicKey(pair.publicKey));
      }
      return pair;
    } catch {
      return null;
    }
  }

  private async exportPairPublicKeyHint(): Promise<string> {
    const db = await this.openDb();
    const hint = db ? await this.idbGet<string>(db, this.publicHintKey()) : null;
    if (!hint) throw new Error('PUBLIC_KEY_HINT_MISSING');
    return hint;
  }

  private publicHintKey(): string {
    return `${PRIVATE_KEY_ID}-public-jwk`;
  }

  private async exportPublicKey(key: CryptoKey): Promise<string> {
    const jwk = await crypto.subtle.exportKey('jwk', key);
    return JSON.stringify(jwk);
  }

  private async uploadMyPublicKey(publicKey: CryptoKey): Promise<void> {
    const firestore = this.firestore;
    const uid = await this.currentUid();
    if (!firestore || !uid) return;
    // Solo subimos si falta (primera publicación) o la existente es EXACTAMENTE la
    // nuestra. Nunca se pisa la clave de otra sesión/origen: eso deja CIFRADO
    // ROTO para todos los dispositivos.
    try {
      const refDoc = doc(firestore, PUBLIC_KEY_DOC, uid);
      const existing = await getDoc(refDoc);
      const jwk = await this.exportPublicKey(publicKey);
      if (existing.exists()) {
        const existingKey = String((existing.data() as { key?: unknown })['key'] ?? '');
        if (existingKey === jwk) return; // ya está publicada la nuestra
        console.warn('[carxy] Este navegador tiene una clave pública distinta a la publicada. No se sobrescribe: el historial se abrirá en la sesión original.');
        return;
      }
      await setDoc(refDoc, { key: jwk, createdAt: Date.now() });
    } catch (error) {
      // Es best effort (al enviar/abrir el chat se reintenta explícitamente),
      // pero se registra para no fallar en silencio como antes.
      console.warn('[carxy] No se pudo subir la clave pública E2E.', error);
    }
  }

  private async peerPublicKey(peerUid: string): Promise<JsonWebKey | null> {
    let cached = this.peerPublicKeys.get(peerUid);
    if (!cached) {
      cached = this.fetchPeerPublicKey(peerUid);
      this.peerPublicKeys.set(peerUid, cached);
    }
    const jwk = await cached;
    // No cacheamos negativos: otro dispositivo puede subir la clave en cualquier momento.
    if (!jwk) this.peerPublicKeys.delete(peerUid);
    return jwk;
  }

  private async fetchPeerPublicKey(peerUid: string): Promise<JsonWebKey | null> {
    const firestore = this.firestore;
    if (!firestore || !peerUid) return null;
    try {
      const snap = await getDoc(doc(firestore, PUBLIC_KEY_DOC, peerUid));
      if (!snap.exists()) return null;
      const raw = (snap.data() as { key?: unknown })['key'];
      if (typeof raw !== 'string' || raw.length > 1000) return null;
      return JSON.parse(raw) as JsonWebKey;
    } catch {
      return null;
    }
  }

  private async sharedKey(peerUid: string): Promise<CryptoKey | null> {
    if (!peerUid || !this.isSupported()) return null;
    let cached = this.sharedKeys.get(peerUid);
    if (!cached) {
      cached = this.deriveSharedKey(peerUid);
      this.sharedKeys.set(peerUid, cached);
    }
    const key = await cached;
    if (!key) this.sharedKeys.delete(peerUid);
    return key;
  }

  private async deriveSharedKey(peerUid: string): Promise<CryptoKey | null> {
    const pair = await this.myKeyPair();
    if (!pair) return null;
    const jwk = await this.peerPublicKey(peerUid);
    if (!jwk) return null;
    try {
      const peerPublic = await this.importPeerPublicKey(jwk);
      if (!peerPublic) return null;
      return await crypto.subtle.deriveKey(
        { name: 'ECDH', public: peerPublic },
        pair.privateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    } catch {
      return null;
    }
  }

  private async importPeerPublicKey(jwk: JsonWebKey): Promise<CryptoKey | null> {
    try {
      // Pubkeys son públicas: se importan exportables para poder volver a
      // serializarlas (la restauración de IndexedDB las re-exporta para subir).
      return await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        [],
      );
    } catch {
      return null;
    }
  }

  /* ------------------------- IndexedDB mínimo ------------------------- */

  private openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') {
          resolve(null);
          return;
        }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(DB_STORE, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  private idbGet<T>(db: IDBDatabase, id: string): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readonly');
        const request = tx.objectStore(DB_STORE).get(id);
        request.onsuccess = () => {
          const record = request.result as { id: string; key?: T; value?: T } | undefined;
          if (!record) resolve(null);
          else resolve((record.key ?? record.value) ?? null);
        };
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private idbPut(db: IDBDatabase, id: string, value: CryptoKey | string): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readwrite');
        const record: { id: string; key?: CryptoKey; value?: string } =
          typeof CryptoKey !== 'undefined' && value instanceof CryptoKey
            ? { id, key: value }
            : { id, value: value as string };
        tx.objectStore(DB_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private idbDelete(db: IDBDatabase, id: string): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /* --------------------------- base64 helpers -------------------------- */

  static toBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x2000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return btoa(binary);
  }

  static fromBase64(value: string): Uint8Array<ArrayBuffer> {
    const binary = atob(value);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
}
