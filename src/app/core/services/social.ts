import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  DocumentReference,
  doc,
  docData,
  deleteDoc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  Query,
  QueryDocumentSnapshot,
  runTransaction,
  setDoc,
  where,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Storage,
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from '@angular/fire/storage';
import { BehaviorSubject, Observable, catchError, combineLatest, distinctUntilChanged, firstValueFrom, map, of, retry, shareReplay, switchMap, take, timer, throwError } from 'rxjs';
import { LOCAL_KEYS, SOCIAL_COLLECTIONS, SOCIAL_STORAGE_PATHS } from '../config/app.constants';
import { firebaseErrorMessage } from '../utils/firebase-error';
import { AuthService } from './auth';
import { I18nService } from './i18n';
import {
  ActivityNotification,
  ChatConversation,
  ChatMessage,
  Comment,
  ContentReport,
  Follow,
  Post3D,
  ReportReason,
  ReportStatus,
  User,
  UserProfile,
  UserRole,
  AccountDeletionAudit,
  UserActivity,
} from '../models/social.models';
import { environment } from '../../../environments/environment';

export function formatStorageError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : '';
  if (code === 'storage/bucket-not-found') {
    return 'El bucket de Firebase Storage no existe. Confirma el nombre exacto en Firebase Console > Storage y en public/firebase-config.js.';
  }
  if (code === 'storage/unauthorized') {
    return 'Firebase Storage rechazó la subida. Comprueba que iniciaste sesión y que storage.rules esté desplegado.';
  }
  if (code === 'storage/canceled') {
    return 'La subida del archivo fue cancelada.';
  }
  if (code === 'storage/retry-limit-exceeded' || code === 'storage/unknown') {
    return 'Firebase Storage no pudo completar la subida. Comprueba que el bucket de public/firebase-config.js existe y revisa la respuesta HTTP en DevTools > Network antes de cambiar CORS.';
  }
  return firebaseErrorMessage(error)
    ?? (error instanceof Error ? error.message : 'No se pudo subir el modelo o la miniatura a Firebase Storage.');
}

/**
 * Servicio social y de contenido (posts, likes, comentarios, chat, reportes, etc.).
 *
 * Modos de operación:
 * - Firebase (Firestore + Storage): datos compartidos y persistencia remota.
 * - Local/demo (sin Firebase): datos en `localStorage`/IndexedDB y contenido demo.
 *
 * El modo local/demo no comparte datos entre dispositivos, no aplica reglas de
 * Firestore/Storage y puede diferir funcionalmente del comportamiento en Firebase.
 * No debe considerarse una fuente fiable para datos reales de usuarios.
 */
@Injectable({ providedIn: 'root' })
export class SocialService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly storage = inject(Storage, { optional: true });
  private readonly functions = this.firestore && typeof getFunctions === 'function' ? getFunctions() : null;
  private readonly i18n = inject(I18nService);
  private readonly localPosts = new BehaviorSubject<Post3D[]>(this.readLocal(LOCAL_KEYS.posts, []));
  private readonly commentStreams = new Map<string, BehaviorSubject<Comment[]>>();
  private readonly commentObservables = new Map<string, Observable<Comment[]>>();
  private readonly chatStreams = new Map<string, BehaviorSubject<ChatMessage[]>>();
  /** Streams de presencia cacheados por uid (ver `userPresence$`). */
  private readonly presenceStreams = new Map<string, Observable<UserActivity | null>>();
  /** Streams de posts cacheados por id (ver `postById$`). */
  private readonly postStreams = new Map<string, Observable<Post3D | null>>();
  private readonly localChatChanges = new BehaviorSubject<void>(undefined);
  private readonly localFollows = new BehaviorSubject<Follow[]>(this.readLocal(LOCAL_KEYS.follows, []));
  private readonly localLikes = new BehaviorSubject<Record<string, string[]>>(
    this.readLocal(LOCAL_KEYS.likes, {}),
  );
  private readonly localReports = new BehaviorSubject<ContentReport[]>(
    this.readLocal(LOCAL_KEYS.reports, []),
  );
  private readonly localActivityNotifications = new BehaviorSubject<ActivityNotification[]>(
    this.readLocal(LOCAL_KEYS.activityNotifications, []),
  );
  private readonly localUserActivity = new BehaviorSubject<UserActivity[]>(
    this.readLocal(LOCAL_KEYS.userActivity, []),
  );
  private readonly localDeletionAudit = new BehaviorSubject<AccountDeletionAudit[]>(
    this.readLocal(LOCAL_KEYS.accountDeletionAudit, []),
  );
  private readonly auth = inject(AuthService, { optional: true });
  private lastActivityWrite = 0;
  private readonly likeInFlight = new Set<string>();
  private static readonly LIKE_COOLDOWN_MS = 2000;
  /** Límite de caracteres por mensaje de chat (debe coincidir con `firestore.rules`). */
  static readonly MAX_MESSAGE_LENGTH = 2000;
  readonly INACTIVE_DELETE_DAYS = 30;
  /** Máx. documentos del feed público que el listener de Firestore carga de golpe (con orden por createdAt desc). */
  readonly POSTS_FEED_LIMIT = 120;
  private readonly likeRateLimit = new Map<string, number>();
  private readonly countedViews = new Set<string>();
  private readonly countedRemixes = new Set<string>();

  readonly posts$: Observable<Post3D[]> = this.firestore
    ? collectionData(
        query(
          collection(this.firestore, SOCIAL_COLLECTIONS.posts),
          where('isPrivate', '==', false),
          orderBy('createdAt', 'desc'),
          limit(this.POSTS_FEED_LIMIT),
        ),
        { idField: 'id' },
      ).pipe(map((items) => items.map((item) => this.normalizePost(item as Record<string, unknown>))))
    : this.localPosts.asObservable().pipe(map((posts) => posts.filter((post) => !post.isPrivate)));

  /**
   * Ventana en vivo del feed público: emite los `limit` posts más recientes
   * (isPrivate == false, ordenados por createdAt desc) y se actualiza en tiempo
   * real con los cambios de Firestore. Usar junto a `feedLimit$` para la paginación
   * "Cargar más" (el límite crece con cada clic; siempre relee la ventana completa).
   */
  getRecentPublicPosts(max: number): Observable<Post3D[]> {
    if (!this.firestore) {
      return this.localPosts.asObservable().pipe(
        map((posts) => posts.filter((post) => !post.isPrivate).slice(0, max)),
      );
    }
    return collectionData(
      query(
        collection(this.firestore, SOCIAL_COLLECTIONS.posts),
        where('isPrivate', '==', false),
        orderBy('createdAt', 'desc'),
        limit(Math.max(1, max)),
      ),
      { idField: 'id' },
    ).pipe(
      map((items) => items.map((item) => this.normalizePost(item as Record<string, unknown>))),
    );
  }

  /**
   * Todos los posts visibles para el usuario actual.
   *
   * Una consulta sin filtros sobre `posts` no se puede demostrar contra la regla
   * de lectura (Firestore la rechaza con "Missing or insufficient permissions"
   * si la regla no se cumple para todos los documentos posibles). Por eso se
   * separa: los públicos siempre, y los privados solo para moderadores/admins,
   * que sí pueden demostrar la regla a través de `canModerate()`.
   */
  readonly allPosts$: Observable<Post3D[]> = this.firestore
    ? (this.auth?.role$ ?? of(null)).pipe(
        distinctUntilChanged(),
        switchMap((role) => {
          const postsRef = collection(this.firestore!, SOCIAL_COLLECTIONS.posts);
          const public$ = collectionData(
            query(postsRef, where('isPrivate', '==', false), orderBy('createdAt', 'desc')),
            { idField: 'id' },
          );
          if (role !== 'admin' && role !== 'moderator') return public$;
          const private$ = collectionData(
            query(postsRef, where('isPrivate', '==', true), orderBy('createdAt', 'desc')),
            { idField: 'id' },
          );
          return combineLatest([public$, private$]).pipe(
            map(([pub, priv]) => [...pub, ...priv].sort(
              (a, b) => Number(b['createdAt'] ?? 0) - Number(a['createdAt'] ?? 0),
            )),
          );
        }),
        map((items) => items.map((item) => this.normalizePost(item as Record<string, unknown>))),
        catchError(() => of([] as Post3D[])),
      )
    : this.demoPosts();

  private demoPosts(): Observable<Post3D[]> {
    const stored = this.localPosts.value;
    if (stored.length > 0) return this.localPosts.asObservable();
    const demoAuthor: User = {
      uid: 'demo-user-1',
      displayName: 'Creador Demo',
      email: 'creator@carxy.demo',
      photoURL: null,
      bio: '',
    };
    const posts: Post3D[] = [
      {
        id: 'demo-post-1',
        title: 'Mi primera escena 3D',
        description: 'Una escena básica con cubo, esfera y cilindro. Modelo de demostración para el panel de administración.',
        modelUrl: 'local-model://demo-post-1',
        thumbnailUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGWWj6JrwAAAABJRU5ErkJggg==',
        author: demoAuthor,
        authorId: 'demo-user-1',
        authorName: 'Creador Demo',
        likes: 5,
        likesCount: 5,
        viewsCount: 24,
        remixCount: 2,
        isPrivate: false,
        tags: ['demo', 'primitivas', '3d'],
        createdAt: Date.now() - 86400000 * 2,
      },
      {
        id: 'demo-post-2',
        title: 'Concepto de vehículo eléctrico',
        description: 'Modelo conceptual de vehículo eléctrico creado en el editor 3D de CARXY.',
        modelUrl: 'local-model://demo-post-2',
        thumbnailUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGWWj6JrwAAAABJRU5ErkJggg==',
        author: demoAuthor,
        authorId: 'demo-user-1',
        authorName: 'Creador Demo',
        likes: 12,
        likesCount: 12,
        viewsCount: 56,
        remixCount: 3,
        isPrivate: false,
        tags: ['vehículo', 'concepto', 'demo'],
        createdAt: Date.now() - 86400000 * 5,
      },
      {
        id: 'demo-post-3',
        title: 'Modelo privado de prueba',
        description: 'Este es un modelo privado solo para pruebas del administrador.',
        modelUrl: 'local-model://demo-post-3',
        thumbnailUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGWWj6JrwAAAABJRU5ErkJggg==',
        author: demoAuthor,
        authorId: 'demo-user-1',
        authorName: 'Creador Demo',
        likes: 0,
        likesCount: 0,
        viewsCount: 1,
        remixCount: 0,
        isPrivate: true,
        tags: ['privado', 'demo'],
        createdAt: Date.now() - 86400000 * 1,
      },
    ];
    return of(posts);
  }

  private readonly adminUsersRefresh$ = new BehaviorSubject<void>(undefined);

  readonly adminUsers$: Observable<UserProfile[]> = this.firestore
    ? combineLatest([
        this.adminUsersRefresh$,
        collectionData(collection(this.firestore, SOCIAL_COLLECTIONS.users), { idField: 'uid' }),
        collectionData(collection(this.firestore, SOCIAL_COLLECTIONS.privateUsers), { idField: 'uid' }),
      ]).pipe(map(([_, publicUsers, privateUsers]) => {
        const privateByUid = new Map(privateUsers.map((item) => [String(item['uid']), item]));
        return publicUsers.map((item) => this.normalizeAdminUser(
          item as Record<string, unknown>,
          privateByUid.get(String(item['uid'])) as Record<string, unknown> | undefined,
        ));
      }))
    : of(this.demoUsers());

  readonly userActivity$: Observable<UserActivity[]> = this.firestore
    ? (collectionData(collection(this.firestore, SOCIAL_COLLECTIONS.userActivity))
        .pipe(
          map((items) => items.map((item) => this.normalizeActivity(item as Record<string, unknown>))),
          catchError(() => of([] as UserActivity[])),
        ))
    : this.localUserActivity.asObservable();

  readonly deletionAudit$: Observable<AccountDeletionAudit[]> = this.firestore
    ? (collectionData(collection(this.firestore, SOCIAL_COLLECTIONS.accountDeletionAudit))
        .pipe(
          map((items) => items.map((item) => this.normalizeAudit(item as Record<string, unknown>))),
          catchError(() => of([] as AccountDeletionAudit[])),
        ))
    : this.localDeletionAudit.asObservable();

  /**
   * Un post concreto, cacheado por id.
   *
   * La plantilla del chat lo usa para pintar la tarjeta de un modelo
   * compartido. Como la plantilla se redibuja en cada ciclo de detección de
   * cambios, devolver un observable nuevo abriría y cerraría un listener de
   * Firestore por ciclo: se cachea por id y se comparte.
   */
  postById$(postId: string): Observable<Post3D | null> {
    if (!this.firestore || !postId) return of(null);
    let stream = this.postStreams.get(postId);
    if (!stream) {
      stream = docData(doc(this.firestore, SOCIAL_COLLECTIONS.posts, postId)).pipe(
        map((data) => (data ? this.normalizePost({ ...data, id: postId }) : null)),
        retry({ count: 2, delay: (_error, index) => timer(800 * (index + 1)) }),
        catchError(() => of(null)),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
      this.postStreams.set(postId, stream);
    }
    return stream;
  }

  /**
   * Presencia (última actividad) de un usuario concreto.
   *
   * La colección `userActivity` solo se puede LISTAR por administradores, pero
   * leer el documento de un interlocutor sí está permitido para cualquier
   * usuario autenticado. El chat usa esto para mostrar "visto hace" sin pedir
   * un permiso que no tiene (y así evitar "Missing or insufficient
   * permissions" en usuarios y moderadores).
   */
  userActivityOf$(uid: string): Observable<UserActivity | null> {
    if (!this.firestore || !uid) return of(null);
    return docData(doc(this.firestore, SOCIAL_COLLECTIONS.userActivity, uid)).pipe(
      map((data) => (data ? this.normalizeActivity(data as Record<string, unknown>) : null)),
      retry({ count: 3, delay: (_error, index) => timer(800 * (index + 1)) }),
      catchError(() => of(null)),
    );
  }

  /**
   * Presencia de un interlocutor, cacheada por `uid`.
   *
   * La plantilla del chat llama a este método en cada fila de la lista y en la
   * cabecera. Si devolviera un observable nuevo en cada llamada, el `AsyncPipe`
   * se desuscribiría y volvería a suscribirse en cada ciclo de detección de
   * cambios, abriendo y cerrando listeners de Firestore sin parar. Se cachea
   * además con `shareReplay` para que el mismo usuario no abra dos listeners.
   */
  userPresence$(uid: string): Observable<UserActivity | null> {
    if (!uid) return of(null);
    let stream = this.presenceStreams.get(uid);
    if (!stream) {
      stream = this.userActivityOf$(uid).pipe(shareReplay({ bufferSize: 1, refCount: true }));
      this.presenceStreams.set(uid, stream);
    }
    return stream;
  }

  /**
   * Usuarios sin actividad registrada en los últimos INACTIVE_DELETE_DAYS días.
   * Se excluyen admins y cuentas ya suspendidas.
   */
  readonly inactiveUsers$: Observable<UserProfile[]> = combineLatest([this.adminUsers$, this.userActivity$]).pipe(
    map(([users, activity]) => {
      const now = Date.now();
      const limitMs = this.INACTIVE_DELETE_DAYS * 24 * 60 * 60 * 1000;
      const lastSeenByUid = new Map<string, number>();
      for (const entry of activity ?? []) {
        const current = lastSeenByUid.get(entry.uid) ?? 0;
        if (entry.lastSeenAt > current) lastSeenByUid.set(entry.uid, entry.lastSeenAt);
      }
      return (users ?? []).filter((u) => {
        if (u.role === 'admin' || u.isBanned) return false;
        const lastSeen = lastSeenByUid.get(u.uid);
        return !!lastSeen && now - lastSeen > limitMs;
      });
    }),
  );

  /**
   * Detecta emails compartidos por más de una cuenta activa.
   */
  findDuplicateEmails(users: UserProfile[]): Array<{ email: string; uids: string[]; users: UserProfile[] }> {
    const byEmail = new Map<string, UserProfile[]>();
    for (const user of users ?? []) {
      const email = (user.email ?? '').trim().toLowerCase();
      if (!email) continue;
      const list = byEmail.get(email) ?? [];
      list.push(user);
      byEmail.set(email, list);
    }
    const duplicates: Array<{ email: string; uids: string[]; users: UserProfile[] }> = [];
    for (const [email, list] of byEmail) {
      if (list.length > 1) {
        duplicates.push({ email, uids: list.map((u) => u.uid), users: list });
      }
    }
    return duplicates.sort((a, b) => b.users.length - a.users.length);
  }

  /**
   * Elimina (soft-delete con auditoría) las cuentas inactivas hace más de
   * INACTIVE_DELETE_DAYS días. Devuelve cuántas se eliminaron y cuáles fallaron.
   */
  async deleteInactiveUsers(deletedByUid: string): Promise<{
    deleted: number;
    skipped: string[];
    deletedUids: string[];
  }> {
    const [users, activity] = await Promise.all([
      firstValueFrom(this.adminUsers$),
      firstValueFrom(this.userActivity$),
    ]);
    const now = Date.now();
    const limitMs = this.INACTIVE_DELETE_DAYS * 24 * 60 * 60 * 1000;
    const lastSeenByUid = new Map<string, number>();
    for (const entry of activity ?? []) {
      const current = lastSeenByUid.get(entry.uid) ?? 0;
      if (entry.lastSeenAt > current) lastSeenByUid.set(entry.uid, entry.lastSeenAt);
    }
    const targets = (users ?? []).filter((u) => {
      if (u.role === 'admin' || u.isBanned) return false;
      const lastSeen = lastSeenByUid.get(u.uid);
      return !!lastSeen && now - lastSeen > limitMs;
    });
    let deleted = 0;
    const skipped: string[] = [];
    const deletedUids: string[] = [];
    for (const user of targets) {
      try {
        await this.deleteAccountData(user.uid, 'inactivity', deletedByUid);
        deleted++;
        deletedUids.push(user.uid);
      } catch (error) {
        skipped.push(user.uid);
        console.warn(`No se pudo eliminar la cuenta inactiva ${user.uid}.`, error);
      }
    }
    this.adminUsersRefresh$.next(undefined);
    return { deleted, skipped, deletedUids };
  }

  /**
   * Borra un usuario de Firebase Authentication mediante la Cloud Function
   * deleteFirebaseAuthUser (solo admins). Devuelve true si se borró.
   */
  async deleteAuthUser(uid: string): Promise<boolean> {
    if (!this.functions) return false;
    try {
      const callable = httpsCallable(this.functions, 'deleteFirebaseAuthUser');
      await callable({ uid });
      return true;
    } catch (error: any) {
      console.warn(`No se pudo borrar el usuario de Auth ${uid}.`, error);
      return false;
    }
  }

  private demoUsers(): UserProfile[] {
    const stored = this.localAccounts();
    if (stored.length > 0) return stored;
    return [
      {
        uid: 'demo-admin-1',
        displayName: 'Administrador',
        email: 'admin@carxy.demo',
        photoURL: null,
        bio: 'Administrador del sistema',
        role: 'admin',
        isBanned: false,
        createdAt: Date.now() - 86400000 * 30,
      },
      {
        uid: 'demo-mod-1',
        displayName: 'Moderador Demo',
        email: 'mod@carxy.demo',
        photoURL: null,
        bio: 'Moderador de contenido',
        role: 'moderator',
        isBanned: false,
        createdAt: Date.now() - 86400000 * 15,
      },
      {
        uid: 'demo-user-1',
        displayName: 'Creador Demo',
        email: 'creator@carxy.demo',
        photoURL: null,
        bio: 'Creador de contenido 3D',
        role: 'user',
        isBanned: false,
        createdAt: Date.now() - 86400000 * 7,
      },
      {
        uid: 'demo-user-2',
        displayName: 'Usuario Suspendido',
        email: 'suspended@carxy.demo',
        photoURL: null,
        bio: 'Cuenta suspendida por violar reglas',
        role: 'user',
        isBanned: true,
        createdAt: Date.now() - 86400000 * 3,
      },
    ];
  }

  async publish(
    title: string,
    description: string,
    modelBlob: Blob,
    thumbnailDataUrl: string,
    author: User,
    tags: string[] = [],
    isPrivate = false,
  ): Promise<Post3D> {
    if (modelBlob.size > environment.uploads.maxModelBytes) {
      throw new Error(`El modelo supera el límite de ${this.formatMegabytes(environment.uploads.maxModelBytes)} MB.`);
    }
    const thumbnailBlob = this.dataUrlToBlob(thumbnailDataUrl);
    if (thumbnailBlob.type !== environment.uploads.thumbnailContentType) {
      throw new Error('La captura debe estar en formato PNG.');
    }
    if (thumbnailBlob.size > environment.uploads.maxThumbnailBytes) {
      throw new Error(`La captura supera el límite de ${this.formatMegabytes(environment.uploads.maxThumbnailBytes)} MB.`);
    }
    const postId = crypto.randomUUID();
    const createdAt = Date.now();
    let modelUrl = `local-model://${postId}`;
    let thumbnailUrl = thumbnailDataUrl;

    const cleanTags = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 12);

    if (this.firestore && this.storage) {
      const modelPath = SOCIAL_STORAGE_PATHS.model(author.uid, postId);
      const thumbnailPath = SOCIAL_STORAGE_PATHS.thumbnail(author.uid, postId);
      const modelRef = ref(this.storage, modelPath);
      const thumbnailRef = ref(this.storage, thumbnailPath);
      const uploadedRefs: ReturnType<typeof ref>[] = [];
      try {
        const uploadResults = await Promise.allSettled([
          uploadBytes(modelRef, modelBlob, { contentType: environment.uploads.modelContentType }),
          uploadBytes(thumbnailRef, thumbnailBlob, { contentType: environment.uploads.thumbnailContentType }),
        ]);
        uploadResults.forEach((result, index) => {
          if (result.status === 'fulfilled') uploadedRefs.push(index === 0 ? modelRef : thumbnailRef);
        });
        const uploadFailure = uploadResults.find((result) => result.status === 'rejected');
        if (uploadFailure?.status === 'rejected') throw uploadFailure.reason;
      } catch (error) {
        const cleanup = await Promise.allSettled(uploadedRefs.map((storageRef) => this.deleteStorageObject(storageRef)));
        if (cleanup.some((result) => result.status === 'rejected')) {
          console.error('Falló la limpieza de archivos después de un error de subida.', cleanup);
        }
        throw new Error(this.i18n.translate(formatStorageError(error)), { cause: error });
      }

      try {
        [modelUrl, thumbnailUrl] = await Promise.all([
          getDownloadURL(modelRef),
          getDownloadURL(thumbnailRef),
        ]);
        await setDoc(doc(this.firestore, 'posts', postId), {
          title: title.trim(),
          description: description.trim(),
          modelUrl,
          thumbnailUrl,
          author: this.publicUser(author),
          authorId: author.uid,
          authorName: author.displayName,
          likes: 0,
          likesCount: 0,
          viewsCount: 0,
          remixCount: 0,
          isPrivate,
          tags: cleanTags,
          modelPath,
          thumbnailPath,
          createdAt,
        });
      } catch (error) {
        const cleanup = await Promise.allSettled(uploadedRefs.map((storageRef) => this.deleteStorageObject(storageRef)));
        if (cleanup.some((result) => result.status === 'rejected')) {
          console.error('Falló la limpieza de archivos después de un error al guardar la publicación.', cleanup);
        }
        throw error;
      }
    } else {
      await this.storeBlob(postId, modelBlob);
      const post: Post3D = {
        id: postId,
        title: title.trim(),
        description: description.trim(),
        modelUrl,
        thumbnailUrl,
        author,
        likes: 0,
        authorId: author.uid,
        authorName: author.displayName,
        likesCount: 0,
        viewsCount: 0,
        remixCount: 0,
        isPrivate,
        tags: cleanTags,
        createdAt,
      };
      this.persistLocalPosts([post, ...this.localPosts.value]);
      return post;
    }

    return {
      id: postId,
      title: title.trim(),
      description: description.trim(),
      modelUrl,
      thumbnailUrl,
      author: this.publicUser(author),
      likes: 0,
      authorId: author.uid,
      authorName: author.displayName,
      likesCount: 0,
      viewsCount: 0,
      remixCount: 0,
      isPrivate,
      tags: cleanTags,
      createdAt,
    };
  }

  isLiked$(postId: string, uid: string | null | undefined): Observable<boolean> {
    if (!uid) return of(false);
    if (this.firestore) {
      return docData(doc(this.firestore, SOCIAL_COLLECTIONS.posts, postId, 'likes', uid)).pipe(
        map((like) => !!like),
        distinctUntilChanged(),
      );
    }
    return this.localLikes.pipe(
      map((likes) => (likes[uid] ?? []).includes(postId)),
      distinctUntilChanged(),
    );
  }

  /**
   * Devuelve los posts públicos que el usuario ha marcado como favorito.
   * Requiere que se escriba en users/{uid}/likedPosts/{postId} al dar/quitar like.
   */
  userLikedPosts$(uid: string): Observable<Post3D[]> {
    if (!uid) return of([]);
    if (!this.firestore) {
      return combineLatest([this.localLikes, this.localPosts]).pipe(
        map(([likes, posts]) => {
          const likedIds = new Set(likes[uid] ?? []);
          return posts
            .filter((post) => likedIds.has(post.id) && !post.isPrivate)
            .sort((a, b) => b.createdAt - a.createdAt);
        }),
      );
    }
    const firestore = this.firestore;
    return collectionData(
      query(
        collection(firestore, `users/${uid}/likedPosts`),
        orderBy('createdAt', 'desc'),
      ),
      { idField: 'postId' },
    ).pipe(
      switchMap((likes) => {
        if (!likes.length) return of([]);
        const postIds = likes
          .map((item) => String(item['postId']))
          .filter(Boolean);
        if (!postIds.length) return of([]);
        // Firestore 'in' soporta máximo 30 valores por consulta.
        const chunks: string[][] = [];
        for (let i = 0; i < postIds.length; i += 30) {
          chunks.push(postIds.slice(i, i + 30));
        }
        return combineLatest(
          chunks.map((chunk) =>
            collectionData(
              query(
                collection(firestore, SOCIAL_COLLECTIONS.posts),
                where('__name__', 'in', chunk),
                where('isPrivate', '==', false),
              ),
              { idField: 'id' },
            ).pipe(
              map((items) =>
                items.map((item) => this.normalizePost(item as Record<string, unknown>)),
              ),
            ),
          ),
        ).pipe(
          map((arrays) =>
            arrays
              .flat()
              .sort((a, b) => b.createdAt - a.createdAt),
          ),
        );
      }),
    );
  }

  /** @deprecated Use toggleLike — kept for callers that still import like() */
  async like(post: Post3D, actor?: User): Promise<boolean> {
    return this.toggleLike(post, actor);
  }

  async toggleLike(post: Post3D, actor?: User): Promise<boolean> {
    if (!actor) throw new Error('Inicia sesión para marcar favoritos.');
    if (actor.uid === post.author.uid) {
      throw new Error('No puedes marcar como favorito tu propio modelo.');
    }
    const lockKey = `${actor.uid}:${post.id}`;
    if (this.likeInFlight.has(lockKey)) return this.isLikedSync(post.id, actor.uid);
    const lastLike = this.likeRateLimit.get(lockKey);
    if (lastLike != null && Date.now() - lastLike < SocialService.LIKE_COOLDOWN_MS) {
      throw new Error('Espera un momento antes de volver a darle like a este modelo.');
    }
    this.likeInFlight.add(lockKey);
    try {
      if (this.firestore) {
        const likeRef = doc(this.firestore, SOCIAL_COLLECTIONS.posts, post.id, 'likes', actor.uid);
        const postRef = doc(this.firestore, SOCIAL_COLLECTIONS.posts, post.id);
        const userLikeRef = doc(
          this.firestore,
          `users/${actor.uid}/likedPosts`,
          post.id,
        );
        let liked = false;
        await runTransaction(this.firestore, async (transaction) => {
          const existing = await transaction.get(likeRef);
          if (existing.exists()) {
            transaction.delete(likeRef);
            transaction.delete(userLikeRef);
            transaction.update(postRef, {
              likes: increment(-1),
              likesCount: increment(-1),
            });
            liked = false;
            return;
          }
          transaction.set(likeRef, {
            uid: actor.uid,
            createdAt: Date.now(),
          });
          transaction.set(userLikeRef, {
            postId: post.id,
            createdAt: Date.now(),
          });
          transaction.update(postRef, {
            likes: increment(1),
            likesCount: increment(1),
          });
          liked = true;
        });
        this.likeRateLimit.set(lockKey, Date.now());
        if (liked && post.author.uid !== actor.uid) {
          const notificationId = this.notificationId('like', actor.uid, post.id);
          try {
            await setDoc(
              doc(this.firestore, 'users', post.author.uid, 'notifications', notificationId),
              { ...this.notificationData(post.author.uid, actor, 'like', post.id), id: notificationId },
              { merge: true },
            );
          } catch (error) {
            // La notificación es un detalle; el like ya quedó aplicado.
            console.warn('[carxy] No se pudo avisar del like al autor.', error);
          }
        }
        return liked;
      }

      const likedPosts = new Set(this.localLikes.value[actor.uid] ?? []);
      const currentlyLiked = likedPosts.has(post.id);
      if (currentlyLiked) likedPosts.delete(post.id);
      else likedPosts.add(post.id);
      const nextLikes = { ...this.localLikes.value, [actor.uid]: [...likedPosts] };
      this.localLikes.next(nextLikes);
      this.writeLocal(LOCAL_KEYS.likes, nextLikes);
      this.likeRateLimit.set(lockKey, Date.now());
      this.persistLocalPosts(this.localPosts.value.map((item) => {
        if (item.id !== post.id) return item;
        const next = Math.max(0, item.likes + (currentlyLiked ? -1 : 1));
        return { ...item, likes: next, likesCount: next };
      }));
      if (!currentlyLiked && post.author.uid !== actor.uid) {
        this.addLocalActivityNotification(post.author.uid, actor, 'like', post.id, this.notificationId('like', actor.uid, post.id));
      }
      return !currentlyLiked;
    } finally {
      this.likeInFlight.delete(lockKey);
    }
  }

  private isLikedSync(postId: string, uid: string): boolean {
    return (this.localLikes.value[uid] ?? []).includes(postId);
  }

  readonly reports$: Observable<ContentReport[]> = this.firestore
    ? collectionData(
        query(collection(this.firestore, SOCIAL_COLLECTIONS.reports), orderBy('createdAt', 'desc'), limit(100)),
        { idField: 'id' },
      ).pipe(map((items) => items.map((item) => this.normalizeReport(item as Record<string, unknown>))))
    : this.demoReports();

  private demoReports(): Observable<ContentReport[]> {
    const stored = this.localReports.value;
    if (stored.length > 0) return this.localReports.asObservable();
    const items: ContentReport[] = [
      {
        id: 'demo-report-1',
        postId: 'demo-post-1',
        postTitle: 'Mi primera escena 3D',
        reporterId: 'demo-user-2',
        reporterName: 'Usuario Suspendido',
        reason: 'inappropriate',
        details: 'El modelo contiene contenido inapropiado.',
        status: 'open',
        createdAt: Date.now() - 86400000 * 1,
      },
      {
        id: 'demo-report-2',
        postId: 'demo-post-2',
        postTitle: 'Concepto de vehículo eléctrico',
        reporterId: 'demo-user-1',
        reporterName: 'Creador Demo',
        reason: 'spam',
        details: 'Este modelo parece ser spam.',
        status: 'resolved',
        createdAt: Date.now() - 86400000 * 4,
        resolvedAt: Date.now() - 86400000 * 3,
      },
    ];
    return of(items);
  }

  async reportPost(
    post: Post3D,
    reporter: User,
    reason: ReportReason,
    details = '',
  ): Promise<void> {
    const report: ContentReport = {
      id: crypto.randomUUID(),
      postId: post.id,
      postTitle: post.title,
      reporterId: reporter.uid,
      reporterName: reporter.displayName,
      reason,
      details: details.trim().slice(0, 500),
      status: 'open',
      createdAt: Date.now(),
    };
    if (this.firestore) {
      await setDoc(doc(this.firestore, SOCIAL_COLLECTIONS.reports, report.id), {
        postId: report.postId,
        postTitle: report.postTitle,
        reporterId: report.reporterId,
        reporterName: report.reporterName,
        reason: report.reason,
        details: report.details,
        status: report.status,
        createdAt: report.createdAt,
      });
      return;
    }
    const next = [report, ...this.localReports.value];
    this.localReports.next(next);
    this.writeLocal(LOCAL_KEYS.reports, next);
  }

  async resolveReport(reportId: string, status: Exclude<ReportStatus, 'open'>): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.reports, reportId), {
        status,
        resolvedAt: Date.now(),
      });
      return;
    }
    const next = this.localReports.value.map((item) =>
      item.id === reportId ? { ...item, status, resolvedAt: Date.now() } : item,
    );
    this.localReports.next(next);
    this.writeLocal(LOCAL_KEYS.reports, next);
  }

  async setPostHidden(post: Post3D, isPrivate: boolean): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.posts, post.id), { isPrivate });
      return;
    }
    this.persistLocalPosts(this.localPosts.value.map((item) =>
      item.id === post.id ? { ...item, isPrivate } : item,
    ));
  }

  comments$(postId: string): Observable<Comment[]> {
    const cached = this.commentObservables.get(postId);
    if (cached) return cached;
    if (this.firestore) {
      const comments = collection(this.firestore, 'posts', postId, 'comments');
      const stream = collectionData(query(comments, orderBy('createdAt', 'asc')), { idField: 'id' })
        .pipe(
          map((items) => items.map((item) => this.normalizeComment(item as Record<string, unknown>))),
          catchError(() => of([] as Comment[])),
        );
      this.commentObservables.set(postId, stream);
      return stream;
    }
    const stream = this.getCommentStream(postId).asObservable();
    this.commentObservables.set(postId, stream);
    return stream;
  }

  async addComment(postId: string, text: string, author: User, post?: Post3D): Promise<void> {
    const commentId = crypto.randomUUID();
    const comment: Comment = { id: commentId, text: text.trim(), author, createdAt: Date.now() };
    if (this.firestore) {
      const batch = writeBatch(this.firestore);
      const commentRef = doc(this.firestore, 'posts', postId, 'comments', commentId);
      batch.set(commentRef, {
        ...comment,
        author: this.publicUser(author),
      });
      if (post && post.author.uid !== author.uid) {
        const notificationId = this.notificationId('comment', author.uid, `${postId}_${commentId}`);
        const notificationRef = doc(this.firestore, 'users', post.author.uid, 'notifications', notificationId);
        batch.set(notificationRef, { ...this.notificationData(post.author.uid, author, 'comment', postId), id: notificationId });
      }
      await batch.commit();
      return;
    }
    const stream = this.getCommentStream(postId);
    const next = [...stream.value, comment];
    stream.next(next);
    this.writeLocal(LOCAL_KEYS.comments, {
      ...this.readLocal<Record<string, Comment[]>>(LOCAL_KEYS.comments, {}),
      [postId]: next,
    });
    const localPost = post ?? this.localPosts.value.find((item) => item.id === postId);
    if (localPost && localPost.author.uid !== author.uid) {
      this.addLocalActivityNotification(
        localPost.author.uid,
        author,
        'comment',
        postId,
        this.notificationId('comment', author.uid, `${postId}_${commentId}`),
      );
    }
  }

  isFollowing$(followerId: string, followingId: string): Observable<boolean> {
    if (followerId === followingId) return of(false);
    if (this.firestore) {
      return docData(doc(this.firestore, 'users', followingId, 'followers', followerId))
        .pipe(map((follow) => !!follow));
    }
    return this.localFollows.pipe(
      map((follows) => follows.some((follow) => follow.followerId === followerId && follow.followingId === followingId)),
      distinctUntilChanged(),
    );
  }

  followCounts$(uid: string): Observable<{ followers: number; following: number }> {
    if (this.firestore) {
      return combineLatest([
        collectionData(collection(this.firestore, 'users', uid, 'followers')),
        collectionData(collection(this.firestore, 'users', uid, 'following')),
      ]).pipe(
        map(([followers, following]) => ({ followers: followers.length, following: following.length })),
        catchError(() => of({ followers: 0, following: 0 })),
      );
    }
    return this.localFollows.pipe(map((follows) => ({
      followers: follows.filter((follow) => follow.followingId === uid).length,
      following: follows.filter((follow) => follow.followerId === uid).length,
    })));
  }

  async followUser(actor: User, targetUid: string): Promise<void> {
    if (!targetUid || targetUid === actor.uid) throw new Error('No puedes seguirte a ti mismo.');
    if (this.firestore) {
      const followerRef = doc(this.firestore, 'users', targetUid, 'followers', actor.uid);
      const followingRef = doc(this.firestore, 'users', actor.uid, 'following', targetUid);
      const notificationId = this.notificationId('follow', actor.uid, targetUid);
      const notificationRef = doc(this.firestore, 'users', targetUid, 'notifications', notificationId);
      await runTransaction(this.firestore, async (transaction) => {
        const existing = await transaction.get(followerRef);
        if (existing.exists()) return;
        const followData: Follow = { followerId: actor.uid, followingId: targetUid, createdAt: Date.now() };
        transaction.set(followerRef, followData);
        transaction.set(followingRef, followData);
        transaction.set(notificationRef, { ...this.notificationData(targetUid, actor, 'follow'), id: notificationId });
      });
      return;
    }
    if (this.localFollows.value.some((follow) =>
      follow.followerId === actor.uid && follow.followingId === targetUid,
    )) return;
    const next = [...this.localFollows.value, { followerId: actor.uid, followingId: targetUid, createdAt: Date.now() }];
    this.localFollows.next(next);
    this.writeLocal(LOCAL_KEYS.follows, next);
    this.addLocalActivityNotification(targetUid, actor, 'follow', undefined, this.notificationId('follow', actor.uid, targetUid));
  }

  async unfollowUser(followerId: string, followingId: string): Promise<void> {
    if (this.firestore) {
      await Promise.all([
        deleteDoc(doc(this.firestore, 'users', followingId, 'followers', followerId)),
        deleteDoc(doc(this.firestore, 'users', followerId, 'following', followingId)),
      ]);
      return;
    }
    const next = this.localFollows.value.filter((follow) =>
      follow.followerId !== followerId || follow.followingId !== followingId,
    );
    this.localFollows.next(next);
    this.writeLocal(LOCAL_KEYS.follows, next);
  }

  activityNotifications$(uid: string): Observable<ActivityNotification[]> {
    if (this.firestore) {
      return collectionData(
        query(collection(this.firestore, 'users', uid, 'notifications'), orderBy('createdAt', 'desc'), limit(30)),
        { idField: 'id' },
      ).pipe(
        map((items) => items
          .map((item) => this.normalizeActivityNotification(item as Record<string, unknown>))
          .filter((item): item is ActivityNotification => item !== null)),
        // Si la lectura falla (permisos, índice, red) la campana debe mostrarlo
        // como estado de error, no como bandeja vacía.
        catchError((error: unknown) => {
          console.warn('[carxy] No se pudieron cargar las notificaciones.', error);
          return throwError(() => error);
        }),
      );
    }
    return this.localActivityNotifications.pipe(
      map((items) => items.filter((item) => item.recipientId === uid).slice(0, 30)),
    );
  }

  async markActivityNotificationRead(uid: string, notificationId: string): Promise<void> {
    if (this.firestore) {
      try {
        await updateDoc(doc(this.firestore, 'users', uid, 'notifications', notificationId), { read: true });
      } catch (error) {
        // La notificación pudo eliminarse entre la lectura y la escritura:
        // para la interfaz ya está leída, así que no es un error real.
        if (!this.isNotFoundError(error)) throw error;
      }
      return;
    }
    const next = this.localActivityNotifications.value.map((item) =>
      item.id === notificationId ? { ...item, read: true } : item,
    );
    this.localActivityNotifications.next(next);
    this.writeLocal(LOCAL_KEYS.activityNotifications, next);
  }

  async markMessageNotificationsRead(uid: string, actorUid: string): Promise<void> {
    if (this.firestore) {
      const q = query(
        collection(this.firestore, 'users', uid, 'notifications'),
        where('actorId', '==', actorUid),
        where('kind', '==', 'message'),
        where('read', '==', false),
      );
      const snapshot = await getDocs(q);
      if (snapshot.empty) return;
      const batch = writeBatch(this.firestore);
      for (const document of snapshot.docs) {
        batch.update(document.ref, { read: true });
      }
      await batch.commit();
      return;
    }
    const targetIds = new Set(
      this.localActivityNotifications.value
        .filter((item) => item.recipientId === uid && item.actorId === actorUid && item.kind === 'message' && !item.read)
        .map((item) => item.id),
    );
    if (!targetIds.size) return;
    const next = this.localActivityNotifications.value.map((item) =>
      targetIds.has(item.id) ? { ...item, read: true } : item,
    );
    this.localActivityNotifications.next(next);
    this.writeLocal(LOCAL_KEYS.activityNotifications, next);
  }

  /**
   * Marca varias notificaciones como leídas en bloque (batch atómico).
   * Los fallos individuales se toleran en silencio para la señalización visual;
   * el batch fallará todo junto si las reglas las rechazan (mejor dar feedback).
   */
  async markAllActivityNotificationsRead(uid: string, notificationIds: string[]): Promise<void> {
    if (!notificationIds.length) return;
    if (this.firestore) {
      const CHUNK = 400;
      for (let start = 0; start < notificationIds.length; start += CHUNK) {
        const batch = writeBatch(this.firestore);
        for (const id of notificationIds.slice(start, start + CHUNK)) {
          batch.update(doc(this.firestore, 'users', uid, 'notifications', id), { read: true });
        }
        await batch.commit();
      }
      return;
    }
    const target = new Set(notificationIds);
    const next = this.localActivityNotifications.value.map((item) =>
      target.has(item.id) ? { ...item, read: true } : item,
    );
    this.localActivityNotifications.next(next);
    this.writeLocal(LOCAL_KEYS.activityNotifications, next);
  }

  /**
   * Borra todas las notificaciones ya leídas del buzón del usuario.
   * Solo toca las marcadas como leídas (no son no leídas colapsables).
   */
  async clearReadActivityNotifications(uid: string): Promise<number> {
    if (this.firestore) {
      const q = query(
        collection(this.firestore, 'users', uid, 'notifications'),
        where('read', '==', true),
      );
      const snapshot = await getDocs(q);
      if (snapshot.empty) return 0;
      const CHUNK = 400;
      const docs = snapshot.docs;
      for (let start = 0; start < docs.length; start += CHUNK) {
        const batch = writeBatch(this.firestore);
        for (const document of docs.slice(start, start + CHUNK)) {
          batch.delete(document.ref);
        }
        await batch.commit();
      }
      return docs.length;
    }
    const removed = this.localActivityNotifications.value.filter(
      (item) => item.recipientId === uid && item.read,
    ).length;
    const next = this.localActivityNotifications.value.filter(
      (item) => !(item.recipientId === uid && item.read),
    );
    this.localActivityNotifications.next(next);
    this.writeLocal(LOCAL_KEYS.activityNotifications, next);
    return removed;
  }

  private isNotFoundError(error: unknown): boolean {
    return !!error
      && typeof error === 'object'
      && 'code' in error
      && String((error as { code: unknown }).code).includes('not-found');
  }

  private normalizeActivityNotification(
    data: Record<string, unknown>,
  ): ActivityNotification | null {
    const kind = data['kind'];
    if (kind !== 'follow' && kind !== 'like' && kind !== 'comment' && kind !== 'message') {
      // Kind desconocido/corrupto: no se inventa un texto ruidoso, simplemente
      // no se muestra la notificación.
      return null;
    }
    return {
      id: String(data['id'] ?? ''),
      recipientId: String(data['recipientId'] ?? ''),
      actorId: String(data['actorId'] ?? ''),
      actorName: String(data['actorName'] ?? ''),
      actorPhotoURL: typeof data['actorPhotoURL'] === 'string' ? data['actorPhotoURL'] : null,
      kind,
      ...(typeof data['targetId'] === 'string' ? { targetId: data['targetId'] } : {}),
      createdAt: this.normalizeTimestamp(data['createdAt']),
      read: data['read'] === true,
    };
  }

  chatMessages$(chatId: string): Observable<ChatMessage[]> {
    if (this.firestore) {
      return collectionData(
        query(collection(this.firestore, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc')),
        { idField: 'id' },
      ).pipe(
        map((items) => items.map((item) => this.normalizeMessage(item as Record<string, unknown>))),
        // Un fallo transitorio (red, refreshing del token) no puede dejar el
        // hilo congelado para siempre: se reintenta con espera creciente y,
        // si el error persiste, se propaga para que la interfaz lo muestre en
        // lugar de quedarse con una lista vacía y sin reintentos.
        retry({ count: 3, delay: (_error, index) => timer(800 * (index + 1)) }),
        // Un solo listener de Firestore aunque varias partes de la plantilla
        // se suscriban al mismo hilo.
        shareReplay({ bufferSize: 1, refCount: true }),
      );
    }
    return this.getChatStream(chatId).asObservable();
  }

  /**
   * Lista las conversaciones visibles para `uid`.
   *
   * La colección `chats` no puede consultarse desde el cliente: Firestore
   * evalúa las reglas de una consulta frente a TODOS los documentos que
   * podrían devolver, y la regla `list` anidada en `match /chats/{chatId}`
   * no alcanza a la ruta de la colección (`/chats`). La única forma de abrir
   * la colección entera sería `allow list: if signedIn()` para cualquiera,
   * lo que expondría el `lastMessage` de conversaciones privadas de terceros.
   *
   * En su lugar se mantiene un índice por usuario
   * (`users/{uid}/recentChats/{chatId}`) que el propio cliente actualiza al
   * escribir/abrir un chat; la consulta accede a subcolecciones acotadas a
   * `uid`, con reglas estándar de pertenencia.
   */
  recentChats$(uid: string): Observable<ChatConversation[]> {
    if (this.firestore) {
      return collectionData(
        query(
          collection(this.firestore, 'users', uid, 'recentChats'),
          orderBy('updatedAt', 'desc'),
          limit(30),
        ),
        { idField: 'id' },
      ).pipe(
        map((items) => items
          .map((item) => this.normalizeChatConversation(item as Record<string, unknown>))
          .sort((first, second) => second.updatedAt - first.updatedAt)),
        retry({ count: 3, delay: (_error, index) => timer(800 * (index + 1)) }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
    }

    return this.localChatChanges.pipe(map(() => {
      const chats = this.readLocal<Record<string, ChatMessage[]>>(LOCAL_KEYS.chats, {});
      return Object.entries(chats)
        .filter(([chatId]) => chatId.split('__').includes(uid))
        .flatMap(([id, messages]) => {
          const lastMessage = messages.at(-1);
          if (!lastMessage) return [];
          return [{
            id,
            participantIds: id.split('__'),
            lastMessage,
            updatedAt: lastMessage.createdAt,
          }];
        })
        .sort((first, second) => second.updatedAt - first.updatedAt);
    }));
  }

  /**
   * Mantiene el índice por usuario (`users/{uid}/recentChats/{chatId}`) que
   * alimenta la lista de conversaciones. Se escribe el índice de los DOS
   * participantes: cada uno lee únicamente el suyo.
   *
   * Best effort: si una escritura falla (p. ej. reglas sin desplegar), el
   * mensaje se entrega igualmente y el índice se repone en el siguiente
   * envío o al abrir el chat.
   */
  private async writeRecentChats(
    chatId: string,
    participantIds: string[],
    updatedAt: number,
    writtenBy: string,
    lastMessage?: ChatMessage,
  ): Promise<void> {
    if (!this.firestore || !writtenBy) return;
    try {
      await Promise.all(participantIds.map((owner) =>
        setDoc(
          doc(this.firestore!, 'users', owner, 'recentChats', chatId),
          {
            participantIds,
            updatedAt,
            writtenBy,
            ...(lastMessage ? { lastMessage } : {}),
          },
          { merge: true },
        )));
    } catch (error) {
      console.warn('[carxy] No se pudo actualizar el índice de chats recientes', error);
    }
  }

  async ensureChatConversation(chatId: string, writtenBy?: string): Promise<void> {
    const participantIds = chatId.split('__');
    if (
      participantIds.length !== 2
      || participantIds[0] >= participantIds[1]
    ) {
      throw new Error('No se pudo validar la conversación.');
    }
    if (!this.firestore) return;

    const chatRef = doc(this.firestore, SOCIAL_COLLECTIONS.chats, chatId);
    const latestMessageSnapshot = await getDocs(query(
      collection(chatRef, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(1),
    ));
    const latestMessageDoc = latestMessageSnapshot.docs[0];
    const latestMessage = latestMessageDoc
      ? this.normalizeMessage({ ...latestMessageDoc.data(), id: latestMessageDoc.id })
      : undefined;

    // La escritura va dentro de una transacción para no pisar un `lastMessage`
    // o un `updatedAt` más reciente que haya escrito `sendMessage` en paralelo.
    let needsPreviewRepair = false;
    await runTransaction(this.firestore, async (transaction) => {
      const conversation = await transaction.get(chatRef);
      if (conversation.exists()) {
        needsPreviewRepair = !conversation.data()['lastMessage'] && !!latestMessage;
        return;
      }
      transaction.set(chatRef, {
        participantIds,
        updatedAt: latestMessage?.createdAt ?? Date.now(),
        ...(latestMessage ? { lastMessage: latestMessage } : {}),
      });
    });

    // Rellenar el `lastMessage` de una conversación que se quedó sin él es una
    // mejora cosmética (la lista mostraría "Conversación abierta"). Si las
    // reglas la rechazan no debe tumbar el chat, así que va aislado: el
    // siguiente mensaje ya rellena el campo por su cuenta.
    if (needsPreviewRepair && latestMessage) {
      try {
        await updateDoc(chatRef, {
          lastMessage: latestMessage,
          updatedAt: latestMessage.createdAt,
        });
      } catch {
        // La conversación sigue funcionando sin vista previa.
      }
    }

    // Índice por usuario: es lo que alimenta "Recientes". Cada apertura repone
    // las filas de ambos participantes (idempotente), así una conversación
    // antigua también aparece tras desplegar el fix.
    if (writtenBy) {
      await this.writeRecentChats(
        chatId,
        participantIds,
        latestMessage?.createdAt ?? Date.now(),
        writtenBy,
        latestMessage,
      );
    }
  }

  async sendMessage(chatId: string, message: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<void> {
    const participantIds = chatId.split('__');
    const text = (message.text ?? '').trim();
    if (
      participantIds.length !== 2
      || participantIds[0] >= participantIds[1]
      || !participantIds.includes(message.senderId)
      || !text
    ) {
      throw new Error('No se pudo validar la conversación y el remitente del mensaje.');
    }
    if (text.length > SocialService.MAX_MESSAGE_LENGTH) {
      throw new Error(
        `El mensaje supera el límite de ${SocialService.MAX_MESSAGE_LENGTH} caracteres.`,
      );
    }
    const entry: ChatMessage = {
      ...message,
      text,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    if (this.firestore) {
      const chatRef = doc(this.firestore, SOCIAL_COLLECTIONS.chats, chatId);
      const messageRef = doc(collection(chatRef, 'messages'));
      const batch = writeBatch(this.firestore);
      batch.set(chatRef, {
        participantIds,
        updatedAt: entry.createdAt,
        lastMessage: entry,
      }, { merge: true });
      batch.set(messageRef, entry);
      await batch.commit();
      // Índice por usuario (habitación de "Recientes"): tras el commit el chat
      // doc ya existe, así que las reglas pueden validar la autoría.
      await this.writeRecentChats(chatId, participantIds, entry.createdAt, entry.senderId, entry);
      // Avisa al interlocutor: sin esto no hay forma de enterarse de un
      // mensaje nuevo si no se tiene el chat abierto.
      await this.notifyChatMessage(chatId, entry, participantIds);
      return;
    }
    const stream = this.getChatStream(chatId);
    const next = [...stream.value, entry];
    stream.next(next);
    this.writeLocal(LOCAL_KEYS.chats, { ...this.readLocal<Record<string, ChatMessage[]>>(LOCAL_KEYS.chats, {}), [chatId]: next });
    this.localChatChanges.next();
    const recipientId = participantIds.find((id) => id !== entry.senderId);
    if (recipientId) {
      this.addLocalActivityNotification(
        recipientId,
        {
          uid: entry.senderId,
          displayName: entry.senderName,
          email: '',
          photoURL: entry.senderPhotoURL ?? null,
          bio: '',
        },
        'message',
        chatId,
        this.notificationId('message', entry.senderId, chatId),
      );
    }
  }

  /**
   * Notifica al interlocutor de un mensaje nuevo.
   *
   * La notificación es "best effort": si las reglas aún no permiten el tipo
   * `message`, el mensaje debe enviarse igual, así que el error se ignora.
   */
  private async notifyChatMessage(
    chatId: string,
    entry: ChatMessage,
    participantIds: string[],
  ): Promise<void> {
    const recipientId = participantIds.find((id) => id !== entry.senderId);
    if (!this.firestore || !recipientId) return;
    const actor: User = {
      uid: entry.senderId,
      displayName: entry.senderName,
      email: '',
      photoURL: entry.senderPhotoURL ?? null,
      bio: '',
    };
    const notificationId = this.notificationId('message', entry.senderId, chatId);
    try {
      await setDoc(
        doc(this.firestore, 'users', recipientId, 'notifications', notificationId),
        { ...this.notificationData(recipientId, actor, 'message', chatId), id: notificationId },
        { merge: true },
      );
    } catch {
      // Sin permiso (reglas sin desplegar) el mensaje se entrega igualmente.
    }
  }

  async downloadModel(post: Post3D): Promise<Blob> {
    if (post.modelUrl.startsWith('local-model://')) return this.readBlob(post.id);
    const response = await fetch(post.modelUrl);
    if (!response.ok) throw new Error(`No se pudo descargar el modelo (${response.status}).`);
    return response.blob();
  }

  profile$(uid: string): Observable<User | null> {
    if (this.firestore) {
      return docData(doc(this.firestore, SOCIAL_COLLECTIONS.users, uid)).pipe(
        map((profile) => profile ? this.publicUser(profile as User) : null),
      );
    }
    const profile = this.localPosts.value.find((post) => post.author.uid === uid)?.author ?? null;
    return of(profile);
  }

  userPosts$(uid: string, includePrivate = false): Observable<Post3D[]> {
    if (this.firestore) {
      const constraints = [
        where('authorId', '==', uid),
        ...(includePrivate ? [] : [where('isPrivate', '==', false)]),
        orderBy('createdAt', 'desc'),
      ];
      return collectionData(
        query(collection(this.firestore, SOCIAL_COLLECTIONS.posts), ...constraints),
        { idField: 'id' },
      ).pipe(
        map((items) => items.map((item) => this.normalizePost(item as Record<string, unknown>))),
        catchError(() => of([] as Post3D[])),
      );
    }
    return this.localPosts.asObservable().pipe(map((posts) => posts.filter((post) =>
      (post.authorId === uid || post.author.uid === uid) && (includePrivate || !post.isPrivate),
    )));
  }

  async setUserRole(uid: string, role: UserRole): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.users, uid), { role });
      this.adminUsersRefresh$.next(undefined);
      return;
    }
    throw new Error('La gestión de roles requiere Firebase configurado.');
  }

  async setUserBanned(uid: string, isBanned: boolean): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.users, uid), { isBanned });
      return;
    }
    throw new Error('La moderación de cuentas requiere Firebase configurado.');
  }

  async updatePost(post: Post3D, patch: Pick<Post3D, 'title' | 'description' | 'tags' | 'isPrivate'>): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.posts, post.id), patch);
      return;
    }
    this.persistLocalPosts(this.localPosts.value.map((item) => item.id === post.id ? { ...item, ...patch } : item));
  }

  async deletePost(post: Post3D): Promise<void> {
    if (this.firestore) {
      if (!this.storage) throw new Error('Firebase Storage no está configurado.');
      const modelRef = post.modelPath
        ? ref(this.storage, post.modelPath)
        : post.modelUrl.startsWith('http') ? ref(this.storage, post.modelUrl) : null;
      const thumbnailRef = post.thumbnailPath
        ? ref(this.storage, post.thumbnailPath)
        : post.thumbnailUrl.startsWith('http') ? ref(this.storage, post.thumbnailUrl) : null;
      await Promise.all([
        modelRef ? this.deleteStorageObject(modelRef) : Promise.resolve(),
        thumbnailRef ? this.deleteStorageObject(thumbnailRef) : Promise.resolve(),
      ]);
      const [comments, likes] = await Promise.all([
        getDocs(collection(this.firestore, SOCIAL_COLLECTIONS.posts, post.id, 'comments')),
        getDocs(collection(this.firestore, SOCIAL_COLLECTIONS.posts, post.id, 'likes')),
      ]);
      await this.deleteFirestoreDocuments([
        ...comments.docs.map((comment) => comment.ref),
        ...likes.docs.map((like) => like.ref),
      ]);
      await deleteDoc(doc(this.firestore, SOCIAL_COLLECTIONS.posts, post.id));
      return;
    }
    this.persistLocalPosts(this.localPosts.value.filter((item) => item.id !== post.id));
    const comments = this.readLocal<Record<string, Comment[]>>(LOCAL_KEYS.comments, {});
    delete comments[post.id];
    this.writeLocal(LOCAL_KEYS.comments, comments);
    await this.deleteLocalBlob(post.id);
  }

  async deleteAccountData(uid: string, reason: 'self' | 'inactivity' | 'admin' = 'self', deletedBy?: string): Promise<void> {
    if (!uid) throw new Error('No se pudo validar la cuenta que se va a eliminar.');
    await this.logDeletionAudit(uid, reason, deletedBy);

    if (!this.firestore) {
      const ownedPosts = this.localPosts.value.filter((post) => post.authorId === uid || post.author.uid === uid);
      const likedPostIds = new Set(this.localLikes.value[uid] ?? []);
      const ownedIds = new Set(ownedPosts.map((post) => post.id));

      // Decrementa los likes de los posts que el usuario haya marcado (no propios)
      // y filtra los posts propios, antes de persistir.
      const postsAfterDelete = this.localPosts.value
        .filter((post) => !ownedIds.has(post.id))
        .map((item) => {
          if (!likedPostIds.has(item.id)) return item;
          const next = Math.max(0, item.likes - 1);
          return { ...item, likes: next, likesCount: next };
        });
      this.persistLocalPosts(postsAfterDelete);
      this.writeLocal(LOCAL_KEYS.likes, { ...this.localLikes.value, [uid]: [] });
      this.localLikes.next({ ...this.localLikes.value, [uid]: [] });

      const deletedPostIds = ownedIds;
      const comments = this.readLocal<Record<string, Comment[]>>(LOCAL_KEYS.comments, {});
      for (const [postId, entries] of Object.entries(comments)) {
        const remaining = entries.filter((comment) => comment.author.uid !== uid);
        if (deletedPostIds.has(postId) || !remaining.length) delete comments[postId];
        else comments[postId] = remaining;
      }
      this.writeLocal(LOCAL_KEYS.comments, comments);
      this.writeLocal(LOCAL_KEYS.follows, this.localFollows.value.filter(
        (follow) => follow.followerId !== uid && follow.followingId !== uid,
      ));
      this.localFollows.next(this.readLocal(LOCAL_KEYS.follows, []));
      const notifications = this.localActivityNotifications.value.filter(
        (item) => item.recipientId !== uid && item.actorId !== uid,
      );
      this.localActivityNotifications.next(notifications);
      this.writeLocal(LOCAL_KEYS.activityNotifications, notifications);

      const chats = this.readLocal<Record<string, ChatMessage[]>>(LOCAL_KEYS.chats, {});
      for (const [chatId, messages] of Object.entries(chats)) {
        if (!chatId.split('__').includes(uid)) continue;
        chats[chatId] = messages.map((message) => message.senderId === uid
          ? { ...message, senderId: 'deleted-account', senderName: 'Cuenta eliminada' }
          : message);
        this.chatStreams.get(chatId)?.next(chats[chatId]);
      }
      this.writeLocal(LOCAL_KEYS.chats, chats);
      await Promise.all(ownedPosts.map((post) => this.deleteLocalBlob(post.id)));
      try {
        const accounts = this.readLocal<any[]>(LOCAL_KEYS.accounts, []);
        if (Array.isArray(accounts)) {
          const filtered = accounts.filter((u) => u?.uid !== uid);
          this.writeLocal(LOCAL_KEYS.accounts, filtered);
        }
      } catch {
        // ignore
      }
      this.localChatChanges.next();
      return;
    }

    const userRef = doc(this.firestore, SOCIAL_COLLECTIONS.users, uid);
    const ownPostsSnapshot = await getDocs(query(
      collection(this.firestore, SOCIAL_COLLECTIONS.posts),
      where('authorId', '==', uid),
    ));
    if (ownPostsSnapshot.size && !this.storage) {
      throw new Error('Firebase Storage no está configurado; no se puede eliminar de forma segura el contenido de la cuenta.');
    }
    const publicPostsSnapshot = await getDocs(query(
      collection(this.firestore, SOCIAL_COLLECTIONS.posts),
      where('isPrivate', '==', false),
    ));
    const postsById = new Map([
      ...ownPostsSnapshot.docs.map((post) => [post.id, post] as const),
      ...publicPostsSnapshot.docs.map((post) => [post.id, post] as const),
    ]);

    // 1) Limpia los likes dados por el usuario sobre posts de otros (y propios).
    //    `likedPosts` guarda los postIds liked, incluidos los privados, así que
    //    cubrimos más que solo los públicos. Se decrementa el contador.
    const likedPostsSnapshot = await getDocs(collection(this.firestore, `users/${uid}/likedPosts`));
    for (const likeDoc of likedPostsSnapshot.docs) {
      const postId = likeDoc.id;
      const postRef = doc(this.firestore, SOCIAL_COLLECTIONS.posts, postId);
      const likeRef = doc(postRef, 'likes', uid);
      const [postSnap, existingLike] = await Promise.all([getDoc(postRef), getDoc(likeRef)]);
      if (postSnap.exists() && existingLike.exists()) {
        await deleteDoc(likeRef);
        await updateDoc(postRef, { likes: increment(-1), likesCount: increment(-1) });
      }
      await deleteDoc(likeDoc.ref);
    }
    // Barrido defensivo: por si `likedPosts` no está sincronizado, revisa likes
    // del usuario en los posts que ya tenemos cargados (propios y públicos).
    for (const post of postsById.values()) {
      const likeRef = doc(post.ref, 'likes', uid);
      const existingLike = await getDoc(likeRef);
      if (existingLike.exists()) {
        await deleteDoc(likeRef);
        await updateDoc(post.ref, { likes: increment(-1), likesCount: increment(-1) });
      }
    }

    const commentRefs: DocumentReference[] = [];
    for (const post of postsById.values()) {
      const comments = await getDocs(collection(post.ref, 'comments'));
      const isOwnedPost = post.data()['authorId'] === uid
        || (post.data()['author'] as Record<string, unknown> | undefined)?.['uid'] === uid;
      if (isOwnedPost) continue; // Los posts propios borran sus subcolecciones completas más abajo.
      for (const comment of comments.docs) {
        if ((comment.data()['author'] as Record<string, unknown> | undefined)?.['uid'] === uid) {
          commentRefs.push(comment.ref);
        }
      }
    }

    // Cada lectura se aísla: si Firestore rechaza una de estas consultas
    // (p. ej. un admin limpiando la cuenta de otro usuario), el borrado debe
    // continuar con el resto en lugar de abortar con
    // "Missing or insufficient permissions".
    const followings = await this.safeDocs(collection(userRef, 'following'));
    const followers = await this.safeDocs(collection(userRef, 'followers'));
    const notifications = await this.safeDocs(collection(userRef, 'notifications'));
    const conversations = await this.safeDocs(query(
      collection(this.firestore, SOCIAL_COLLECTIONS.chats),
      where('participantIds', 'array-contains', uid),
    ));

    for (const conversation of conversations) {
      const messages = await this.safeDocs(collection(conversation.ref, 'messages'));
      const authoredMessages = messages.filter((message) => message.data()['senderId'] === uid);
      await Promise.all(authoredMessages.map((message) => updateDoc(message.ref, {
        senderId: 'deleted-account',
        senderName: 'Cuenta eliminada',
      })));

      const data = conversation.data();
      const participantIds = (data['participantIds'] as string[]).map((participantId) =>
        participantId === uid ? 'deleted-account' : participantId,
      );
      const lastMessage = data['lastMessage'] as Record<string, unknown> | undefined;
      await updateDoc(conversation.ref, {
        participantIds,
        ...(lastMessage?.['senderId'] === uid
          ? { lastMessage: { ...lastMessage, senderId: 'deleted-account', senderName: 'Cuenta eliminada' } }
          : {}),
      });
    }

    const ownedPosts = ownPostsSnapshot.docs.map((post) =>
      this.normalizePost({ ...post.data(), id: post.id }),
    );
    await Promise.all(ownedPosts.map(async (post) => {
      if (this.storage) {
        const modelRef = post.modelPath
          ? ref(this.storage, post.modelPath)
          : post.modelUrl.startsWith('http') ? ref(this.storage, post.modelUrl) : null;
        const thumbnailRef = post.thumbnailPath
          ? ref(this.storage, post.thumbnailPath)
          : post.thumbnailUrl.startsWith('http') ? ref(this.storage, post.thumbnailUrl) : null;
        await Promise.all([
          modelRef ? this.deleteStorageObject(modelRef) : Promise.resolve(),
          thumbnailRef ? this.deleteStorageObject(thumbnailRef) : Promise.resolve(),
        ]);
      }
    }));
    await this.deleteFirestoreDocuments(commentRefs);

    // Vacía subcolecciones de los posts propios (comentarios y likes) antes de borrarlos.
    const ownedSubRefs: DocumentReference[] = [];
    for (const post of ownPostsSnapshot.docs) {
      const [comments, likes] = await Promise.all([
        this.safeDocs(collection(post.ref, 'comments')),
        this.safeDocs(collection(post.ref, 'likes')),
      ]);
      ownedSubRefs.push(...comments.map((doc) => doc.ref), ...likes.map((doc) => doc.ref));
    }
    if (ownedSubRefs.length) {
      await this.deleteFirestoreDocuments(ownedSubRefs);
    }

    await this.deleteFirestoreDocuments(ownPostsSnapshot.docs.map((post) => post.ref));

    const relationshipRefs: DocumentReference[] = [
      ...followers.map((follow) => follow.ref),
      ...followings.map((follow) => follow.ref),
      ...notifications.map((notification) => notification.ref),
      ...followings.map((follow) => doc(userRef, 'followers', follow.id)),
    ];
    await this.deleteFirestoreDocuments(relationshipRefs);

    // Anonimiza o elimina la pertenencia del usuario en proyectos colaborativos.
    // - En proyectos donde es dueño/a, conserva la fila pero anonimiza el nombre/foto
    //   para no dejar huérfanos proyectos a medio dueño.
    // - En el resto, elimina la fila: el usuario ya no tendrá acceso y no
    //   aparecerá como colaborador.
    const db = this.firestore;
    if (!db) throw new Error('Firestore no está disponible.');
    const memberships = await this.safeDocs(query(
      collection(db, SOCIAL_COLLECTIONS.projectMembers),
      where('userId', '==', uid),
    ));
    const ownedMemberIds: string[] = [];
    for (const membership of memberships) {
      const data = membership.data() as Record<string, unknown>;
      if (data['role'] === 'owner' || (data['projectId'] && await this.isProjectOwner(String(data['projectId']), uid))) {
        ownedMemberIds.push(membership.id);
        continue;
      }
      await deleteDoc(membership.ref);
    }
    await Promise.all(ownedMemberIds.map((memberId) => updateDoc(
      doc(db, SOCIAL_COLLECTIONS.projectMembers, memberId),
      { userName: 'Cuenta eliminada', userPhotoURL: null },
    )));

    // La ficha de actividad (presencia) también debe desaparecer, o la cuenta
    // borrada seguiría apareciendo como activa en el panel y en el chat.
    try {
      await deleteDoc(doc(this.firestore, SOCIAL_COLLECTIONS.userActivity, uid));
    } catch (error) {
      console.warn('No se pudo eliminar el registro de actividad de la cuenta.', error);
    }

    await deleteDoc(doc(this.firestore, SOCIAL_COLLECTIONS.privateUsers, uid));
    await deleteDoc(userRef);
  }

  async incrementViews(post: Post3D): Promise<void> {
    if (!post?.id || this.countedViews.has(post.id)) return;
    this.countedViews.add(post.id);
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.posts, post.id), { viewsCount: increment(1) });
      return;
    }
    this.persistLocalPosts(this.localPosts.value.map((item) => item.id === post.id
      ? { ...item, viewsCount: (item.viewsCount ?? 0) + 1 }
      : item));
  }

  async incrementRemixes(post: Post3D): Promise<void> {
    if (!post?.id || this.countedRemixes.has(post.id)) return;
    this.countedRemixes.add(post.id);
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.posts, post.id), { remixCount: increment(1) });
      // Avisar al autor del remix: solo la primera vez por sesión (el mapa de
      // una sesión evita spam). Es best-effort, el remix ya quedó contado.
      const actor = await this.socialActor();
      if (actor && !actor.isBanned && post.author.uid !== actor.uid) {
        const notificationId = this.notificationId('remix', actor.uid, post.id);
        try {
          await setDoc(
            doc(this.firestore, 'users', post.author.uid, 'notifications', notificationId),
            { ...this.notificationData(post.author.uid, actor, 'remix', post.id), id: notificationId },
            { merge: true },
          );
        } catch (error) {
          console.warn('[carxy] No se pudo avisar del remix al autor.', error);
        }
      }
      return;
    }
    this.persistLocalPosts(this.localPosts.value.map((item) => item.id === post.id
      ? { ...item, remixCount: (item.remixCount ?? 0) + 1 }
      : item));
    const actor = await this.socialActor();
    if (actor && !actor.isBanned && post.author?.uid && post.author.uid !== actor.uid) {
      const localPost = post;
      this.addLocalActivityNotification(
        localPost.author.uid,
        actor,
        'remix',
        post.id,
        this.notificationId('remix', actor.uid, post.id),
      );
    }
  }

  /**
   * Avisa al dueño de un proyecto cuando otra persona se une por un enlace de
   * acceso. Se ejecuta solo en altas nuevas (no en reingresos ni en mejoras
   * de rol). Es best-effort: el alta real ya se hizo, este es un detalle.
   */
  async notifyShareJoined(projectId: string, ownerId: string, actor: User): Promise<void> {
    if (!ownerId || ownerId === actor.uid) return;
    const notificationId = this.notificationId('share', actor.uid, projectId);
    if (this.firestore) {
      try {
        await setDoc(
          doc(this.firestore, 'users', ownerId, 'notifications', notificationId),
          { ...this.notificationData(ownerId, actor, 'share', projectId), id: notificationId },
          { merge: true },
        );
      } catch (error) {
        console.warn('[carxy] No se pudo avisar al dueño del proyecto del join por enlace.', error);
      }
      return;
    }
    this.addLocalActivityNotification(ownerId, actor, 'share', projectId, this.notificationId('share', actor.uid, projectId));
  }

  private async socialActor(): Promise<User | null> {
    const stream = this.auth?.user$;
    if (!stream) return null;
    try {
      return await firstValueFrom(stream.pipe(take(1)));
    } catch {
      return null;
    }
  }

  private notificationData(
    recipientId: string,
    actor: User,
    kind: ActivityNotification['kind'],
    targetId?: string,
  ): Omit<ActivityNotification, 'id'> {
    return {
      recipientId,
      actorId: actor.uid,
      actorName: actor.displayName,
      actorPhotoURL: actor.photoURL ?? null,
      kind,
      ...(targetId ? { targetId } : {}),
      createdAt: Date.now(),
      read: false,
    };
  }

  private notificationId(kind: ActivityNotification['kind'], actorId: string, targetId = ''): string {
    const suffix = targetId ? `_${targetId}` : '';
    return `${kind}_${actorId}${suffix}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 500);
  }

  private addLocalActivityNotification(
    recipientId: string,
    actor: User,
    kind: ActivityNotification['kind'],
    targetId?: string,
    id: string = crypto.randomUUID(),
  ): void {
    const base = this.notificationData(recipientId, actor, kind, targetId);
    const notification: ActivityNotification = { ...base, id };
    const withoutDuplicate = this.localActivityNotifications.value.filter((item) => item.id !== id);
    const next = [notification, ...withoutDuplicate];
    this.localActivityNotifications.next(next);
    this.writeLocal(LOCAL_KEYS.activityNotifications, next);
  }

  private getCommentStream(postId: string): BehaviorSubject<Comment[]> {
    let stream = this.commentStreams.get(postId);
    if (!stream) {
      const saved = this.readLocal<Record<string, Comment[]>>(LOCAL_KEYS.comments, {})[postId] ?? [];
      stream = new BehaviorSubject(saved);
      this.commentStreams.set(postId, stream);
    }
    return stream;
  }

  private getChatStream(chatId: string): BehaviorSubject<ChatMessage[]> {
    let stream = this.chatStreams.get(chatId);
    if (!stream) {
      const saved = this.readLocal<Record<string, ChatMessage[]>>(LOCAL_KEYS.chats, {})[chatId] ?? [];
      stream = new BehaviorSubject(saved);
      this.chatStreams.set(chatId, stream);
    }
    return stream;
  }

  private persistLocalPosts(posts: Post3D[]): void {
    this.writeLocal(LOCAL_KEYS.posts, posts);
    this.localPosts.next(posts);
  }

  private localAccounts(): UserProfile[] {
    return this.readLocal<UserProfile[]>(LOCAL_KEYS.accounts, []).map((account) => ({
      ...account,
      role: 'user',
      createdAt: account.createdAt ?? Date.now(),
    }));
  }

  private normalizeActivity(item: Record<string, unknown>): UserActivity {
    return {
      uid: String(item['uid'] ?? ''),
      email: String(item['email'] ?? ''),
      displayName: String(item['displayName'] ?? ''),
      lastSeenAt: Number(item['lastSeenAt'] ?? 0),
      lastSeenPath: String(item['lastSeenPath'] ?? ''),
      updatedAt: Number(item['updatedAt'] ?? 0),
    };
  }

  private normalizeAudit(item: Record<string, unknown>): AccountDeletionAudit {
    return {
      id: String(item['id'] ?? ''),
      uid: String(item['uid'] ?? ''),
      email: String(item['email'] ?? ''),
      displayName: String(item['displayName'] ?? ''),
      deletedAt: Number(item['deletedAt'] ?? 0),
      deletedBy: String(item['deletedBy'] ?? ''),
      reason: String(item['reason'] ?? ''),
    };
  }

  async recordActivity(lastSeenPath: string = ''): Promise<void> {
    try {
      if (typeof localStorage === 'undefined') return;
      const stored = this.readLocal<{ uid?: string; email?: string; displayName?: string }>(LOCAL_KEYS.user, {});
      const current = this.auth?.currentUser;
      const uid = current?.uid ?? stored?.uid ?? '';
      if (!uid) return;
      const now = Date.now();
      if (this.lastActivityWrite && now - this.lastActivityWrite < 5 * 60 * 1000) return;
      this.lastActivityWrite = now;
      // No se guarda el correo: `userActivity` es legible por cualquier usuario
      // autenticado. Se escribe el documento completo (sin `merge`) para que los
      // documentos antiguos que aún guardaban el correo se limpien solos.
      const entry: UserActivity = {
        uid,
        displayName: current?.displayName ?? stored?.displayName ?? '',
        lastSeenAt: now,
        lastSeenPath,
        updatedAt: now,
      };
      if (this.firestore) {
        await setDoc(doc(this.firestore, SOCIAL_COLLECTIONS.userActivity, uid), entry);
      } else {
        const next = [...this.localUserActivity.value.filter((item) => item.uid !== uid), entry];
        this.localUserActivity.next(next);
        this.writeLocal(LOCAL_KEYS.userActivity, next);
      }
    } catch (error) {
      console.warn('No se pudo registrar la actividad del usuario.', error);
    }
  }

  private async logDeletionAudit(uid: string, reason: 'self' | 'inactivity' | 'admin' = 'self', deletedBy?: string): Promise<void> {
    try {
      const stored = this.readLocal<{ uid?: string; email?: string; displayName?: string }>(LOCAL_KEYS.user, {});
      const current = this.auth?.currentUser;
      const audit: AccountDeletionAudit = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        uid,
        email: current?.email ?? stored?.email ?? '',
        displayName: current?.displayName ?? stored?.displayName ?? '',
        deletedAt: Date.now(),
        deletedBy: deletedBy ?? uid,
        reason,
      };
      if (this.firestore) {
        await addDoc(collection(this.firestore, SOCIAL_COLLECTIONS.accountDeletionAudit), audit);
      } else {
        const next = [...this.localDeletionAudit.value, audit];
        this.localDeletionAudit.next(next);
        this.writeLocal(LOCAL_KEYS.accountDeletionAudit, next);
      }
    } catch (error) {
      console.warn('No se pudo registrar la auditoría de eliminación.', error);
    }
  }

  private normalizeAdminUser(
    data: Record<string, unknown>,
    privateData: Record<string, unknown> | undefined,
  ): UserProfile {
    const role = data['role'];
    return {
      uid: String(data['uid'] ?? ''),
      displayName: String(data['displayName'] ?? 'Creador'),
      email: String(privateData?.['email'] ?? ''),
      photoURL: typeof data['photoURL'] === 'string' ? data['photoURL'] : null,
      bio: String(data['bio'] ?? ''),
      role: role === 'admin' || role === 'moderator' ? role : 'user',
      isBanned: data['isBanned'] === true,
      createdAt: this.normalizeTimestamp(data['createdAt']),
    };
  }

  private async deleteStorageObject(storageRef: ReturnType<typeof ref>): Promise<void> {
    try {
      await deleteObject(storageRef);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error
        && error.code === 'storage/object-not-found') return;
      throw error;
    }
  }

  private async isProjectOwner(projectId: string, uid: string): Promise<boolean> {
    if (!this.firestore) return false;
    try {
      const projectSnap = await getDoc(doc(this.firestore, SOCIAL_COLLECTIONS.projects, projectId));
      return projectSnap.exists() && projectSnap.data()?.['ownerId'] === uid;
    } catch {
      return false;
    }
  }

  /**
   * Lee una colección devolviendo una lista vacía si Firestore rechaza la
   * consulta. Evita que un único "Missing or insufficient permissions" aborta
   * un flujo de limpieza completo (p. ej. eliminar la cuenta).
   */
  private async safeDocs(queryRef: Query): Promise<QueryDocumentSnapshot[]> {
    try {
      const snapshot = await getDocs(queryRef);
      return snapshot.docs;
    } catch (error) {
      console.warn('No se pudo leer una colección de Firestore.', error);
      return [];
    }
  }

  private async deleteFirestoreDocuments(references: DocumentReference[]): Promise<void> {
    if (!this.firestore) return;
    for (let offset = 0; offset < references.length; offset += 450) {
      const batch = writeBatch(this.firestore);
      for (const reference of references.slice(offset, offset + 450)) batch.delete(reference);
      await batch.commit();
    }
  }

  private async deleteLocalBlob(key: string): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    const db = await this.openBlobDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction('models', 'readwrite').objectStore('models').delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('No se pudo eliminar el modelo local.'));
    });
    db.close();
  }

  private readLocal<T>(key: string, fallback: T): T {
    if (typeof localStorage === 'undefined') return fallback;
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) as T : fallback;
    } catch (error) {
      console.warn(`No se pudo recuperar el almacenamiento local: ${key}`, error);
      localStorage.removeItem(key);
      return fallback;
    }
  }

  private writeLocal(key: string, value: unknown): void {
    localStorage.setItem(key, JSON.stringify(value));
  }

  private dataUrlToBlob(dataUrl: string): Blob {
    const [header, encoded] = dataUrl.split(',');
    const mime = header?.match(/^data:(image\/png);base64$/)?.[1];
    if (!mime || !encoded) throw new Error('La captura no es una imagen PNG válida.');
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new Blob([bytes], { type: mime });
  }

  private formatMegabytes(bytes: number): number {
    return Math.round(bytes / (1024 * 1024));
  }

  private async storeBlob(key: string, value: Blob): Promise<void> {
    const db = await this.openBlobDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction('models', 'readwrite').objectStore('models').put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('No se pudo guardar el modelo local.'));
    });
    db.close();
  }

  private async readBlob(key: string): Promise<Blob> {
    const db = await this.openBlobDatabase();
    const result = await new Promise<Blob | undefined>((resolve, reject) => {
      const request = db.transaction('models').objectStore('models').get(key);
      request.onsuccess = () => resolve(request.result as Blob | undefined);
      request.onerror = () => reject(request.error ?? new Error('No se pudo leer el modelo local.'));
    });
    db.close();
    if (!result) throw new Error('El modelo local ya no está disponible en este navegador.');
    return result;
  }

  private openBlobDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(LOCAL_KEYS.modelDatabase, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('models');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('No se pudo abrir la base local de modelos.'));
    });
  }

  private normalizeReport(data: Record<string, unknown>): ContentReport {
    const reason = data['reason'];
    const status = data['status'];
    return {
      id: String(data['id'] ?? ''),
      postId: String(data['postId'] ?? ''),
      postTitle: String(data['postTitle'] ?? ''),
      reporterId: String(data['reporterId'] ?? ''),
      reporterName: String(data['reporterName'] ?? ''),
      reason: reason === 'spam' || reason === 'inappropriate' || reason === 'copyright' || reason === 'other'
        ? reason
        : 'other',
      details: String(data['details'] ?? ''),
      status: status === 'resolved' || status === 'dismissed' ? status : 'open',
      createdAt: this.normalizeTimestamp(data['createdAt']),
      resolvedAt: data['resolvedAt'] == null ? undefined : this.normalizeTimestamp(data['resolvedAt']),
    };
  }

  private normalizePost(data: Record<string, unknown>): Post3D {
    const author = this.publicUser(data['author'] as User);
    const likes = Number(data['likesCount'] ?? data['likes'] ?? 0);
    return {
      ...data,
      id: String(data['id'] ?? ''),
      title: String(data['title'] ?? ''),
      description: String(data['description'] ?? ''),
      modelUrl: String(data['modelUrl'] ?? ''),
      thumbnailUrl: String(data['thumbnailUrl'] ?? ''),
      author,
      authorId: String(data['authorId'] ?? author.uid),
      authorName: String(data['authorName'] ?? author.displayName),
      likes,
      likesCount: likes,
      viewsCount: Number(data['viewsCount'] ?? 0),
      remixCount: Number(data['remixCount'] ?? 0),
      isPrivate: data['isPrivate'] === true,
      tags: Array.isArray(data['tags']) ? data['tags'].filter((tag): tag is string => typeof tag === 'string') : [],
      createdAt: this.normalizeTimestamp(data['createdAt']),
    };
  }

  private normalizeComment(data: Record<string, unknown>): Comment {
    return {
      ...data,
      id: String(data['id'] ?? ''),
      text: String(data['text'] ?? ''),
      author: this.publicUser(data['author'] as User),
      createdAt: this.normalizeTimestamp(data['createdAt']),
    } as Comment;
  }

  private normalizeMessage(data: Record<string, unknown>): ChatMessage {
    return {
      ...data,
      id: String(data['id'] ?? ''),
      text: String(data['text'] ?? ''),
      senderId: String(data['senderId'] ?? ''),
      senderName: String(data['senderName'] ?? ''),
      createdAt: this.normalizeTimestamp(data['createdAt']),
    } as ChatMessage;
  }

  private normalizeChatConversation(data: Record<string, unknown>): ChatConversation {
    const lastMessageData = data['lastMessage'];
    return {
      id: String(data['id'] ?? ''),
      participantIds: Array.isArray(data['participantIds'])
        ? data['participantIds'].filter((uid): uid is string => typeof uid === 'string')
        : [],
      lastMessage: lastMessageData && typeof lastMessageData === 'object'
        ? this.normalizeMessage(lastMessageData as Record<string, unknown>)
        : undefined,
      updatedAt: this.normalizeTimestamp(data['updatedAt']),
    };
  }

  private normalizeTimestamp(value: unknown): number {
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    if (value && typeof value === 'object' && 'toMillis' in value
      && typeof value.toMillis === 'function') {
      return value.toMillis();
    }
    return Date.now();
  }

  private publicUser(user: User): User {
    const safeUser = user ?? { uid: '', displayName: 'Creador', email: '', photoURL: null, bio: '' };
    return {
      uid: safeUser.uid,
      displayName: safeUser.displayName,
      email: '',
      photoURL: safeUser.photoURL ?? null,
      bio: safeUser.bio ?? '',
    };
  }
}
