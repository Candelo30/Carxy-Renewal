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
  runTransaction,
  setDoc,
  where,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import {
  Storage,
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from '@angular/fire/storage';
import { BehaviorSubject, Observable, combineLatest, distinctUntilChanged, map, of } from 'rxjs';
import { LOCAL_KEYS, SOCIAL_COLLECTIONS, SOCIAL_STORAGE_PATHS } from '../config/app.constants';
import { ActivityNotification, ChatConversation, ChatMessage, Comment, Follow, Post3D, User, UserProfile, UserRole } from '../models/social.models';
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
  return error instanceof Error ? error.message : 'No se pudo subir el modelo o la miniatura a Firebase Storage.';
}

@Injectable({ providedIn: 'root' })
export class SocialService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly storage = inject(Storage, { optional: true });
  private readonly localPosts = new BehaviorSubject<Post3D[]>(this.readLocal(LOCAL_KEYS.posts, []));
  private readonly commentStreams = new Map<string, BehaviorSubject<Comment[]>>();
  private readonly commentObservables = new Map<string, Observable<Comment[]>>();
  private readonly chatStreams = new Map<string, BehaviorSubject<ChatMessage[]>>();
  private readonly localChatChanges = new BehaviorSubject<void>(undefined);
  private readonly localFollows = new BehaviorSubject<Follow[]>(this.readLocal(LOCAL_KEYS.follows, []));
  private readonly localActivityNotifications = new BehaviorSubject<ActivityNotification[]>(
    this.readLocal(LOCAL_KEYS.activityNotifications, []),
  );

  readonly posts$: Observable<Post3D[]> = this.firestore
    ? collectionData(
        query(collection(this.firestore, SOCIAL_COLLECTIONS.posts), where('isPrivate', '==', false), orderBy('createdAt', 'desc')),
        { idField: 'id' },
      ).pipe(map((items) => items.map((item) => this.normalizePost(item as Record<string, unknown>))))
    : this.localPosts.asObservable().pipe(map((posts) => posts.filter((post) => !post.isPrivate)));

  readonly allPosts$: Observable<Post3D[]> = this.firestore
    ? collectionData(query(collection(this.firestore, SOCIAL_COLLECTIONS.posts), orderBy('createdAt', 'desc')), { idField: 'id' })
        .pipe(map((items) => items.map((item) => this.normalizePost(item as Record<string, unknown>))))
    : this.localPosts.asObservable();

  readonly adminUsers$: Observable<UserProfile[]> = this.firestore
    ? combineLatest([
        collectionData(collection(this.firestore, SOCIAL_COLLECTIONS.users), { idField: 'uid' }),
        collectionData(collection(this.firestore, SOCIAL_COLLECTIONS.privateUsers), { idField: 'uid' }),
      ]).pipe(map(([publicUsers, privateUsers]) => {
        const privateByUid = new Map(privateUsers.map((item) => [String(item['uid']), item]));
        return publicUsers.map((item) => this.normalizeAdminUser(
          item as Record<string, unknown>,
          privateByUid.get(String(item['uid'])) as Record<string, unknown> | undefined,
        ));
      }))
    : of(this.localAccounts());

  async publish(
    title: string,
    description: string,
    modelBlob: Blob,
    thumbnailDataUrl: string,
    author: User,
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
        throw new Error(formatStorageError(error), { cause: error });
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
          isPrivate: false,
          tags: [],
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
        isPrivate: false,
        tags: [],
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
      isPrivate: false,
      tags: [],
      createdAt,
    };
  }

  async like(post: Post3D, actor?: User): Promise<void> {
    if (this.firestore) {
      const batch = writeBatch(this.firestore);
      batch.update(doc(this.firestore, SOCIAL_COLLECTIONS.posts, post.id), {
        likes: increment(1),
        likesCount: increment(1),
      });
      if (actor && post.author.uid !== actor.uid) {
        const notificationRef = doc(collection(this.firestore, 'users', post.author.uid, 'notifications'));
        batch.set(notificationRef, this.notificationData(post.author.uid, actor, 'like', post.id));
      }
      await batch.commit();
      return;
    }
    this.persistLocalPosts(this.localPosts.value.map((item) =>
      item.id === post.id ? { ...item, likes: item.likes + 1 } : item,
    ));
    if (actor && post.author.uid !== actor.uid) {
      this.addLocalActivityNotification(post.author.uid, actor, 'like', post.id);
    }
  }

  comments$(postId: string): Observable<Comment[]> {
    const cached = this.commentObservables.get(postId);
    if (cached) return cached;
    if (this.firestore) {
      const comments = collection(this.firestore, 'posts', postId, 'comments');
      const stream = collectionData(query(comments, orderBy('createdAt', 'asc')), { idField: 'id' })
        .pipe(map((items) => items.map((item) => this.normalizeComment(item as Record<string, unknown>))));
      this.commentObservables.set(postId, stream);
      return stream;
    }
    const stream = this.getCommentStream(postId).asObservable();
    this.commentObservables.set(postId, stream);
    return stream;
  }

  async addComment(postId: string, text: string, author: User, post?: Post3D): Promise<void> {
    const comment: Comment = { id: crypto.randomUUID(), text: text.trim(), author, createdAt: Date.now() };
    if (this.firestore) {
      const batch = writeBatch(this.firestore);
      batch.set(doc(collection(this.firestore, 'posts', postId, 'comments')), {
        ...comment,
        author: this.publicUser(author),
      });
      if (post && post.author.uid !== author.uid) {
        const notificationRef = doc(collection(this.firestore, 'users', post.author.uid, 'notifications'));
        batch.set(notificationRef, this.notificationData(post.author.uid, author, 'comment', postId));
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
      this.addLocalActivityNotification(localPost.author.uid, author, 'comment', postId);
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
      ]).pipe(map(([followers, following]) => ({ followers: followers.length, following: following.length })));
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
      const notificationRef = doc(collection(this.firestore, 'users', targetUid, 'notifications'));
      await runTransaction(this.firestore, async (transaction) => {
        const existing = await transaction.get(followerRef);
        if (existing.exists()) return;
        const followData: Follow = { followerId: actor.uid, followingId: targetUid, createdAt: Date.now() };
        transaction.set(followerRef, followData);
        transaction.set(followingRef, followData);
        transaction.set(notificationRef, this.notificationData(targetUid, actor, 'follow'));
      });
      return;
    }
    if (this.localFollows.value.some((follow) =>
      follow.followerId === actor.uid && follow.followingId === targetUid,
    )) return;
    const next = [...this.localFollows.value, { followerId: actor.uid, followingId: targetUid, createdAt: Date.now() }];
    this.localFollows.next(next);
    this.writeLocal(LOCAL_KEYS.follows, next);
    this.addLocalActivityNotification(targetUid, actor, 'follow');
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
      ).pipe(map((items) => items as ActivityNotification[]));
    }
    return this.localActivityNotifications.pipe(
      map((items) => items.filter((item) => item.recipientId === uid).slice(0, 30)),
    );
  }

  async markActivityNotificationRead(uid: string, notificationId: string): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, 'users', uid, 'notifications', notificationId), { read: true });
      return;
    }
    const next = this.localActivityNotifications.value.map((item) =>
      item.id === notificationId ? { ...item, read: true } : item,
    );
    this.localActivityNotifications.next(next);
    this.writeLocal(LOCAL_KEYS.activityNotifications, next);
  }

  chatMessages$(chatId: string): Observable<ChatMessage[]> {
    if (this.firestore) {
      return collectionData(
        query(collection(this.firestore, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc')),
        { idField: 'id' },
      ).pipe(map((items) => items.map((item) => this.normalizeMessage(item as Record<string, unknown>))));
    }
    return this.getChatStream(chatId).asObservable();
  }

  chatConversations$(uid: string): Observable<ChatConversation[]> {
    if (this.firestore) {
      return collectionData(
        query(collection(this.firestore, SOCIAL_COLLECTIONS.chats), where('participantIds', 'array-contains', uid)),
        { idField: 'id' },
      ).pipe(
        map((items) => items
          .map((item) => this.normalizeChatConversation(item as Record<string, unknown>))
          .sort((first, second) => second.updatedAt - first.updatedAt)),
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

  async ensureChatConversation(chatId: string): Promise<void> {
    const participantIds = chatId.split('__');
    if (
      participantIds.length !== 2
      || participantIds[0] >= participantIds[1]
    ) {
      throw new Error('No se pudo validar la conversación.');
    }
    if (!this.firestore) return;

    const chatRef = doc(this.firestore, SOCIAL_COLLECTIONS.chats, chatId);
    const conversation = await getDoc(chatRef);
    const latestMessageSnapshot = await getDocs(query(
      collection(chatRef, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(1),
    ));
    const latestMessageDoc = latestMessageSnapshot.docs[0];
    const latestMessage = latestMessageDoc
      ? this.normalizeMessage({ ...latestMessageDoc.data(), id: latestMessageDoc.id })
      : undefined;
    if (conversation.exists()) {
      if (!conversation.data()['lastMessage'] && latestMessage) {
        await updateDoc(chatRef, {
          lastMessage: latestMessage,
          updatedAt: latestMessage.createdAt,
        });
      }
      return;
    }

    await setDoc(chatRef, {
      participantIds,
      updatedAt: latestMessage?.createdAt ?? Date.now(),
      ...(latestMessage ? { lastMessage: latestMessage } : {}),
    });
  }

  async sendMessage(chatId: string, message: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<void> {
    const participantIds = chatId.split('__');
    if (
      participantIds.length !== 2
      || participantIds[0] >= participantIds[1]
      || !participantIds.includes(message.senderId)
      || !message.text.trim()
    ) {
      throw new Error('No se pudo validar la conversación y el remitente del mensaje.');
    }
    const entry: ChatMessage = { ...message, id: crypto.randomUUID(), createdAt: Date.now() };
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
      return;
    }
    const stream = this.getChatStream(chatId);
    const next = [...stream.value, entry];
    stream.next(next);
    this.writeLocal(LOCAL_KEYS.chats, { ...this.readLocal<Record<string, ChatMessage[]>>(LOCAL_KEYS.chats, {}), [chatId]: next });
    this.localChatChanges.next();
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
      ).pipe(map((items) => items.map((item) => this.normalizePost(item as Record<string, unknown>))));
    }
    return this.localPosts.asObservable().pipe(map((posts) => posts.filter((post) =>
      (post.authorId === uid || post.author.uid === uid) && (includePrivate || !post.isPrivate),
    )));
  }

  async setUserRole(uid: string, role: UserRole): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.users, uid), { role });
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
      const comments = await getDocs(collection(this.firestore, SOCIAL_COLLECTIONS.posts, post.id, 'comments'));
      await Promise.all(comments.docs.map((comment) => deleteDoc(comment.ref)));
      await deleteDoc(doc(this.firestore, SOCIAL_COLLECTIONS.posts, post.id));
      return;
    }
    this.persistLocalPosts(this.localPosts.value.filter((item) => item.id !== post.id));
    const comments = this.readLocal<Record<string, Comment[]>>(LOCAL_KEYS.comments, {});
    delete comments[post.id];
    this.writeLocal(LOCAL_KEYS.comments, comments);
    await this.deleteLocalBlob(post.id);
  }

  async deleteAccountData(uid: string): Promise<void> {
    if (!uid) throw new Error('No se pudo validar la cuenta que se va a eliminar.');

    if (!this.firestore) {
      const ownedPosts = this.localPosts.value.filter((post) => post.authorId === uid || post.author.uid === uid);
      this.persistLocalPosts(this.localPosts.value.filter((post) => !ownedPosts.includes(post)));
      const deletedPostIds = new Set(ownedPosts.map((post) => post.id));
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
    const commentRefs: DocumentReference[] = [];
    for (const post of postsById.values()) {
      const comments = await getDocs(collection(post.ref, 'comments'));
      const isOwnedPost = post.data()['authorId'] === uid
        || (post.data()['author'] as Record<string, unknown> | undefined)?.['uid'] === uid;
      for (const comment of comments.docs) {
        if (isOwnedPost || (comment.data()['author'] as Record<string, unknown> | undefined)?.['uid'] === uid) {
          commentRefs.push(comment.ref);
        }
      }
    }

    const followings = await getDocs(collection(userRef, 'following'));
    const followers = await getDocs(collection(userRef, 'followers'));
    const notifications = await getDocs(collection(userRef, 'notifications'));
    const conversations = await getDocs(query(
      collection(this.firestore, SOCIAL_COLLECTIONS.chats),
      where('participantIds', 'array-contains', uid),
    ));

    for (const conversation of conversations.docs) {
      const messages = await getDocs(collection(conversation.ref, 'messages'));
      const authoredMessages = messages.docs.filter((message) => message.data()['senderId'] === uid);
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
    await this.deleteFirestoreDocuments(ownPostsSnapshot.docs.map((post) => post.ref));

    const relationshipRefs: DocumentReference[] = [
      ...followers.docs.map((follow) => follow.ref),
      ...followings.docs.map((follow) => follow.ref),
      ...notifications.docs.map((notification) => notification.ref),
      ...followings.docs.map((follow) => doc(userRef, 'followers', follow.id)),
    ];
    await this.deleteFirestoreDocuments(relationshipRefs);
    await deleteDoc(doc(this.firestore, SOCIAL_COLLECTIONS.privateUsers, uid));
    await deleteDoc(userRef);
  }

  async incrementViews(post: Post3D): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.posts, post.id), { viewsCount: increment(1) });
      return;
    }
    this.persistLocalPosts(this.localPosts.value.map((item) => item.id === post.id
      ? { ...item, viewsCount: (item.viewsCount ?? 0) + 1 }
      : item));
  }

  async incrementRemixes(post: Post3D): Promise<void> {
    if (this.firestore) {
      await updateDoc(doc(this.firestore, SOCIAL_COLLECTIONS.posts, post.id), { remixCount: increment(1) });
      return;
    }
    this.persistLocalPosts(this.localPosts.value.map((item) => item.id === post.id
      ? { ...item, remixCount: (item.remixCount ?? 0) + 1 }
      : item));
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

  private addLocalActivityNotification(
    recipientId: string,
    actor: User,
    kind: ActivityNotification['kind'],
    targetId?: string,
  ): void {
    const notification: ActivityNotification = {
      ...this.notificationData(recipientId, actor, kind, targetId),
      id: crypto.randomUUID(),
    };
    const next = [notification, ...this.localActivityNotifications.value];
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
