import { Injectable, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  deleteDoc,
  DocumentSnapshot,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  limit,
} from '@angular/fire/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { firstValueFrom, BehaviorSubject, Observable, of, switchMap, catchError, map, combineLatest, from, shareReplay } from 'rxjs';
import { SOCIAL_COLLECTIONS } from '../config/app.constants';
import { I18nService } from './i18n';
import { AuthService } from './auth';
import {
  Project,
  ProjectMember,
  ProjectInvitation,
  ProjectActivity,
  ProjectPresence,
  PresenceTransform,
  ProjectRole,
  ProjectShareLink,
  ProjectShareLinkRole,
} from '../models/social.models';

export type ProjectPermission = 'read' | 'write' | 'owner';

export const ROLE_PERMISSIONS: Record<ProjectRole, ProjectPermission[]> = {
  owner: ['read', 'write', 'owner'],
  editor: ['read', 'write'],
  viewer: ['read'],
};

export function hasPermission(role: ProjectRole, permission: ProjectPermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

@Injectable({ providedIn: 'root' })
export class CollaborationService implements OnDestroy {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly auth = inject(AuthService, { optional: true });
  private readonly i18n = inject(I18nService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly membersStreams = new Map<string, { stream: BehaviorSubject<ProjectMember[]>; unsub: () => void }>();
  private readonly presencesStreams = new Map<string, { stream: BehaviorSubject<ProjectPresence[]>; unsub: () => void }>();

  ngOnDestroy(): void {
    this.releaseAll();
  }

  private get authService(): AuthService {
    if (!this.auth) throw new Error(this.i18n.translate('Firebase no está configurado.'));
    return this.auth;
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                           */
  /* ------------------------------------------------------------------ */

  private async currentUserUid(): Promise<string | null> {
    const user = await firstValueFrom(this.authService.user$);
    return user?.uid ?? null;
  }

  /** Devuelve true si el usuario actual es admin global (rol 'admin' en su perfil). */
  private async isGlobalAdmin(): Promise<boolean> {
    try {
      const user = await firstValueFrom(this.authService.user$);
      return user?.role === 'admin';
    } catch {
      return false;
    }
  }

  private async currentUser(): Promise<{ uid: string; displayName: string; photoURL: string | null; email: string } | null> {
    const user = await firstValueFrom(this.authService.user$);
    if (!user) return null;
    return {
      uid: user.uid,
      displayName: user.displayName,
      photoURL: user.photoURL ?? null,
      email: user.email,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Proyectos                                                         */
  /* ------------------------------------------------------------------ */

  async createProject(name: string, description = '', isPublic = false): Promise<string> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para crear un proyecto.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    const now = Date.now();
    const projectRef = doc(collection(db, SOCIAL_COLLECTIONS.projects));
    const project: Project = {
      id: projectRef.id,
      ownerId: user.uid,
      name,
      description,
      isPublic,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(projectRef, project);
    await this.addMember(project.id, user.uid, user.displayName, user.photoURL, 'owner');
    return project.id;
  }

  getProjects(): Observable<Project[]> {
    const db = this.firestore;
    if (!db) return of([]);
    return this.authService.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);
        try {
          // Evita recrear el listener en `catchError`: una client-side sort es más estable.
          const q = query(
            collection(db, SOCIAL_COLLECTIONS.projects),
            where('ownerId', '==', user.uid),
            limit(100)
          );
          return (collectionData(q, { idField: 'id' }) as Observable<Project[]>).pipe(
            map((projects) => [...projects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))),
            catchError((err) => {
              console.warn('No se pudieron cargar tus proyectos.', err);
              return of([] as Project[]);
            })
          );
        } catch {
          return of([] as Project[]);
        }
      }),
      catchError(() => of([] as Project[]))
    );
  }

  /** Proyectos accesibles para el usuario actual: propios y aquellos donde es miembro. */
  getAccessibleProjects(): Observable<Project[]> {
    const db = this.firestore;
    if (!db) return of([]);
    return this.authService.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);

        const ownedQ = query(
          collection(db, SOCIAL_COLLECTIONS.projects),
          where('ownerId', '==', user.uid)
        );
        const memberQ = query(
          collection(db, SOCIAL_COLLECTIONS.projectMembers),
          where('userId', '==', user.uid)
        );

        const owned$ = (collectionData(ownedQ, { idField: 'id' }) as Observable<Project[]>).pipe(
          catchError(() => of([] as Project[]))
        );
        const memberships$ = (collectionData(memberQ, { idField: 'id' }) as Observable<ProjectMember[]>).pipe(
          catchError(() => of([] as ProjectMember[]))
        );

        return combineLatest([owned$, memberships$]).pipe(
          switchMap(([owned, memberships]) => {
            const mapById = new Map<string, Project>();
            for (const project of owned) mapById.set(project.id, project);

            const missingIds = memberships
              .map((member) => member.projectId)
              .filter((id) => id && !mapById.has(id));
            const uniqueMissing = [...new Set(missingIds)];
            if (!uniqueMissing.length) {
              return of([...mapById.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
            }

            const fetches = uniqueMissing.map(async (id) => {
              try {
                const snap = await getDoc(doc(db, `${SOCIAL_COLLECTIONS.projects}/${id}`));
                if (!snap.exists()) return null;
                return { ...(snap.data() as Project), id: snap.id } as Project;
              } catch {
                return null;
              }
            });

            return from(Promise.all(fetches)).pipe(
              map((shared) => {
                for (const project of shared) {
                  if (project) mapById.set(project.id, project);
                }
                return [...mapById.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
              })
            );
          }),
          catchError(() => of([] as Project[]))
        );
      }),
      catchError(() => of([] as Project[]))
    );
  }

  /** Obtiene todos los proyectos para administración o moderación. */
  getAllProjects(): Observable<Project[]> {
    const db = this.firestore;
    if (!db) return of([]);
    try {
      const q = query(
        collection(db, SOCIAL_COLLECTIONS.projects),
        limit(100)
      );
      return (collectionData(q, { idField: 'id' }) as Observable<Project[]>).pipe(
        map((projects) => [...projects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))),
        catchError((err) => {
          console.warn('No se pudieron cargar los proyectos.', err);
          return of([] as Project[]);
        })
      );
    } catch {
      return of([] as Project[]);
    }
  }

  getProject(projectId: string): Observable<Project | undefined> {
    const db = this.firestore;
    if (!db || !projectId) return of(undefined);
    return (docData(doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}`), { idField: 'id' }) as Observable<Project | undefined>).pipe(
      catchError((err) => {
        console.warn('No se pudo cargar el proyecto.', err);
        return of(undefined);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  async updateProject(projectId: string, patch: Partial<Pick<Project, 'name' | 'description' | 'isPublic'>>): Promise<void> {
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));
    await updateDoc(doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}`), {
      ...patch,
      updatedAt: Date.now(),
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    // Camino principal: Cloud Function `deleteProject` (admin SDK). En el
    // cliente el borrado en cascada no puede completarse con las reglas
    // vigentes y el proyecto quedaba huérfano a medio borrar.
    try {
      if (typeof getFunctions === 'function') {
        const functions = getFunctions();
        const callable = httpsCallable(functions, 'deleteProject');
        await callable({ projectId });
        return;
      }
    } catch (error) {
      // La función no está desplegada o rechaza: cascada de respaldo, mejor
      // esfuerzo (puede dejar datos asociados huérfanos; ver comentario en el
      // backend).
      console.warn('La función deleteProject no se pudo usar; intento cascada local.', error);
    }

    const safe = async (task: () => Promise<unknown>) => {
      try {
        await task();
      } catch (error) {
        console.warn('No se pudo limpiar un dato asociado al proyecto.', error);
      }
    };

    // Miembros del proyecto
    await safe(async () => {
      const q = query(
        collection(db, SOCIAL_COLLECTIONS.projectMembers),
        where('projectId', '==', projectId),
      );
      const snapshot = await getDocs(q);
      await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
    });

    // Invitaciones del proyecto
    await safe(async () => {
      const q = query(
        collection(db, SOCIAL_COLLECTIONS.projectInvitations),
        where('projectId', '==', projectId),
      );
      const snapshot = await getDocs(q);
      await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
    });

    // Enlaces de acceso del proyecto
    await safe(async () => {
      const q = query(
        collection(db, SOCIAL_COLLECTIONS.projectShareLinks),
        where('projectId', '==', projectId),
      );
      const snapshot = await getDocs(q);
      await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
    });

    // Actividad del proyecto
    await safe(async () => {
      const q = query(
        collection(db, SOCIAL_COLLECTIONS.projectActivity),
        where('projectId', '==', projectId),
      );
      const snapshot = await getDocs(q);
      await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
    });

    // Presencias del proyecto
    await safe(async () => {
      const q = query(
        collection(db, SOCIAL_COLLECTIONS.projectPresences),
        where('projectId', '==', projectId),
      );
      const snapshot = await getDocs(q);
      await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
    });

    await deleteDoc(doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}`));
  }

  /* ------------------------------------------------------------------ */
  /*  Escena del proyecto                                               */
  /* ------------------------------------------------------------------ */

  getProjectScene(projectId: string): Observable<string | undefined> {
    const db = this.firestore;
    if (!db) return of(undefined);
    return docData(doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}`), { idField: 'id' }).pipe(
      switchMap((p) => of((p as Project)?.sceneJson)),
      // Un usuario sin acceso al proyecto recibe "Missing or insufficient
      // permissions"; se resuelve con `undefined` para no romper la vista.
      catchError((error: unknown) => {
        console.warn('No se pudo cargar la escena del proyecto.', error);
        return of(undefined);
      }),
    );
  }

  /**
   * Lee la escena SOLO desde el servidor (sin la caché offline del SDK).
   * La primera emisión de `getProjectScene` puede salir de la caché local
   * (escena antigua); si se carga así y se re-guarda vía autosave, el
   * servidor quedaría sobrescrito con contenido obsoleto.
   */
  getProjectSceneOnce(projectId: string): Observable<string | undefined> {
    const db = this.firestore;
    if (!db) return of(undefined);
    return from(getDocFromServer(doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}`))).pipe(
      map((snapshot) => (snapshot.data() as Project | undefined)?.sceneJson),
      catchError((error: unknown) => {
        console.warn('No se pudo leer la escena del proyecto desde el servidor.', error);
        return of(undefined);
      }),
    );
  }

  /** Observa cambios en tiempo real en la escena de un proyecto (para colaboración remota). */
  watchProjectScene(projectId: string): Observable<string | undefined> {
    const db = this.firestore;
    if (!db) return of(undefined);
    return new Observable<string | undefined>((subscriber) => {
      const ref = doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}`);
      // Solo se aplican snapshots CONFIRMADOS por el servidor: los que llegan
      // de la caché offline (p.ej. la escena rancia al abrir la página)
      // sobrescribirían el trabajo actual y dispararían un autosave rancio.
      const unsubscribe = onSnapshot(
        ref,
        { includeMetadataChanges: true },
        (snapshot) => {
          if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
          const data = snapshot.data() as Project | undefined;
          subscriber.next(data?.sceneJson);
        },
        (error: unknown) => {
          console.warn('No se pudo observar la escena del proyecto.', error);
          subscriber.next(undefined);
        },
      );
      return unsubscribe;
    });
  }

  /** Historial de actividad de un proyecto (quién hizo qué y cuándo). */
  getProjectActivity(projectId: string): Observable<ProjectActivity[]> {
    const db = this.firestore;
    if (!db || !projectId) return of([]);
    try {
      const q = query(
        collection(db, `${SOCIAL_COLLECTIONS.projectActivity}`),
        where('projectId', '==', projectId),
        limit(100)
      );
      return (collectionData(q, { idField: 'id' }) as Observable<ProjectActivity[]>).pipe(
        map((items) => [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 50)),
        catchError((err) => {
          console.warn('No se pudo cargar el historial de actividad.', err);
          return of([] as ProjectActivity[]);
        })
      );
    } catch {
      return of([] as ProjectActivity[]);
    }
  }

  async saveProjectScene(projectId: string, sceneJson: string): Promise<void> {
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));
    await updateDoc(doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}`), {
      sceneJson,
      updatedAt: Date.now(),
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Bloqueo de objetos                                                */
  /* ------------------------------------------------------------------ */

  async lockObject(projectId: string, objectId: string, uid: string): Promise<boolean> {
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));
    const lockRef = doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}/locks/${objectId}`);
    const snap = await getDoc(lockRef);
    if (snap.exists()) return false;
    await setDoc(lockRef, { objectId, lockedBy: uid, lockedAt: Date.now() });
    return true;
  }

  async unlockObject(projectId: string, objectId: string): Promise<void> {
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));
    await deleteDoc(doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}/locks/${objectId}`));
  }

  /**
   * Observa en tiempo real todos los locks del proyecto (projects/{id}/locks).
   * Permite que los demás clientes sepan qué objetos están bloqueados por otros.
   */
  watchProjectLocks(projectId: string): Observable<{ objectId: string; lockedBy: string }[]> {
    const db = this.firestore;
    if (!db || !projectId) return of([]);
    try {
      const q = collection(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}/locks`);
      return collectionData(q, { idField: 'objectId' }).pipe(
        map((items) =>
          (items as Array<{ objectId: string; lockedBy?: string }>)
            .filter((item) => typeof item?.lockedBy === 'string' && item.lockedBy.length > 0)
            .map((item) => ({ objectId: item.objectId, lockedBy: item.lockedBy as string })),
        ),
        catchError((err) => {
          console.warn('No se pudieron observar los bloqueos del proyecto.', err);
          return of([] as { objectId: string; lockedBy: string }[]);
        }),
      );
    } catch {
      return of([]);
    }
  }

  getObjectLock(projectId: string, objectId: string): Observable<{ id: string; lockedBy: string } | undefined> {
    const db = this.firestore;
    if (!db) return of(undefined);
    return docData(doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}/locks/${objectId}`), { idField: 'id' }) as Observable<{ id: string; lockedBy: string } | undefined>;
  }

  /* ------------------------------------------------------------------ */
  /*  Miembros                                                          */
  /* ------------------------------------------------------------------ */

  getMembers(projectId: string): Observable<ProjectMember[]> {
    const db = this.firestore;
    if (!db || !projectId) return of([]);
    if (!this.membersStreams.has(projectId)) {
      const stream = new BehaviorSubject<ProjectMember[]>([]);
      const membersQuery = query(
        collection(db, SOCIAL_COLLECTIONS.projectMembers),
        where('projectId', '==', projectId)
      );

      const subscription = (collectionData(membersQuery, { idField: 'id' }) as Observable<ProjectMember[]>)
        .pipe(
          map((members) => this.sortMembersByRole(members as ProjectMember[])),
          catchError((err) => {
            console.warn('No se pudieron cargar los miembros del proyecto.', err);
            return of([] as ProjectMember[]);
          })
        )
        .subscribe((members) => stream.next(members));

      this.membersStreams.set(projectId, { stream, unsub: () => subscription.unsubscribe() });
    }
    return this.membersStreams.get(projectId)!.stream as Observable<ProjectMember[]>;
  }

  private sortMembersByRole(members: ProjectMember[]): ProjectMember[] {
    const priority: Record<ProjectRole, number> = { owner: 0, editor: 1, viewer: 2 };
    return [...members].sort((a, b) => {
      const roleDiff = (priority[a.role] ?? 99) - (priority[b.role] ?? 99);
      if (roleDiff !== 0) return roleDiff;
      const nameDiff = (a.userName || '').localeCompare(b.userName || '', undefined, { sensitivity: 'base' });
      if (nameDiff !== 0) return nameDiff;
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });
  }

  private async addMember(
    projectId: string,
    userId: string,
    userName: string,
    userPhotoURL: string | null,
    role: ProjectRole
  ): Promise<string> {
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));
    const now = Date.now();
    const memberId = `${projectId}_${userId}`;
    const ref = doc(db, `${SOCIAL_COLLECTIONS.projectMembers}/${memberId}`);
    // Las reglas no pueden evaluar `resource.data` sobre un documento
    // inexistente, y `get()` directamente rechaza leerlo: la primera vez que
    // alguien se convierte en miembro del proyecto (creador u alta por
    // enlace), `getDoc(ref)` falla con "Missing or insufficient permissions"
    // y la membresía nunca llegaba a escribirse. Se interpreta como
    // "todavía no existe" y se sigue con el alta.
    let existing: Partial<ProjectMember> | null = null;
    try {
      const existingSnap = await getDoc(ref);
      existing = existingSnap.exists()
        ? (existingSnap.data() as Partial<ProjectMember>)
        : null;
    } catch {
      existing = null;
    }
    const member: ProjectMember = {
      id: memberId,
      projectId,
      userId,
      userName,
      userPhotoURL,
      role,
      joinedAt: existing
        ? (Number(existing.joinedAt) || now)
        : now,
    };
    await setDoc(ref, member, { merge: true });
    return ref.id;
  }

  private normalizeInvitationEmail(email: string): string {
    return (email || '').trim().toLowerCase();
  }

  private invitationDocId(projectId: string, invitedEmail: string): string {
    return `${projectId}_${this.normalizeInvitationEmail(invitedEmail)}`;
  }

  /**
   * Invita a una persona que el usuario sigue usando su UID (el correo de
   * otro usuario vive en `userPrivate` y no se expone a nadie más). El owner
   * del proyecto usa su propio correo resuelto del token para la invitación,
   * pero la clave canónica es ahora el UID del seguidor invitado.
   *
   * Pasos:
   *   1) Crea/rehace la invitación (status pending, expiresAt=7d).
   *   2) Notifica al seguidor con kind=invite en su buzón.
   */
  async inviteFollower(projectId: string, targetUid: string, role: ProjectRole): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para invitar seguidores.'));
    if (user.uid === targetUid) throw new Error(this.i18n.translate('No puedes invitarte a ti mismo.'));

    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    const canWrite = await this.canUserWrite(projectId, user.uid);
    if (!canWrite) throw new Error(this.i18n.translate('No tienes permiso para invitar a este proyecto.'));

    // Solo el dueño (o un admin global) puede invitar a alguien como dueño.
    const isOwner = await this.isProjectOwnerRole(projectId, user.uid);
    const isGlobalAdmin = await this.isGlobalAdmin();
    if (role === 'owner' && !isOwner && !isGlobalAdmin) {
      throw new Error(this.i18n.translate('Solo el dueño puede invitar a un dueño.'));
    }

    const projectSnap = await getDoc(doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}`));
    const projectName = projectSnap.exists() ? String((projectSnap.data() as Record<string, unknown>)['name'] ?? 'CARXY') : 'CARXY';

    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 días
    const invitedEmail = targetUid; // la clave canónica del seguidor
    const invitationId = `${projectId}_${invitedEmail}`;
    const ref = doc(db, `${SOCIAL_COLLECTIONS.projectInvitations}/${invitationId}`);

    const invitation: ProjectInvitation = {
      id: invitationId,
      projectId,
      projectName,
      invitedBy: user.uid,
      invitedByName: user.displayName,
      invitedEmail,
      invitedUid: targetUid,
      role,
      status: 'pending',
      createdAt: now,
      expiresAt,
    };
    await setDoc(ref, invitation, { merge: true });

    // Notifica al seguidor como 'invite' (el buzón muestra "te quiere invitar").
    try {
      const notificationId = `invite_${user.uid}_${projectId}_${targetUid}`
        .replace(/[^A-Za-z0-9_-]/g, '_')
        .slice(0, 500);
      await setDoc(doc(db, 'users', targetUid, 'notifications', notificationId), {
        id: notificationId,
        recipientId: targetUid,
        actorId: user.uid,
        actorName: user.displayName || user.email || 'Usuario',
        actorPhotoURL: user.photoURL ?? null,
        kind: 'invite',
        targetId: projectId,
        createdAt: now,
        read: false,
      });
    } catch (error) {
      console.warn('[carxy] Invitación creada, pero no se pudo avisar al seguidor.', error);
    }
  }

  async inviteMember(projectId: string, invitedEmail: string, role: ProjectRole): Promise<{ id: string; emailSent: boolean }> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para invitar miembros.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    const canWrite = await this.canUserWrite(projectId, user.uid);
    if (!canWrite) throw new Error(this.i18n.translate('No tienes permiso para invitar a este proyecto.'));

    // Solo el dueño (o un admin global) puede invitar a alguien como dueño.
    const isOwner = await this.isProjectOwnerRole(projectId, user.uid);
    const isGlobalAdmin = await this.isGlobalAdmin();
    if (role === 'owner' && !isOwner && !isGlobalAdmin) {
      throw new Error(this.i18n.translate('Solo el dueño puede invitar a un dueño.'));
    }

    const normalizedEmail = this.normalizeInvitationEmail(invitedEmail);
    if (!normalizedEmail) throw new Error(this.i18n.translate('Indica un correo válido para la invitación.'));

    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 días
    const invitationId = this.invitationDocId(projectId, normalizedEmail);
    const ref = doc(db, `${SOCIAL_COLLECTIONS.projectInvitations}/${invitationId}`);
    const invitation: ProjectInvitation = {
      id: invitationId,
      projectId,
      projectName: '',
      invitedBy: user.uid,
      invitedByName: user.displayName,
      invitedEmail: normalizedEmail,
      invitedUid: null,
      role,
      status: 'pending',
      createdAt: now,
      expiresAt,
    };
    const projectSnap = await getDoc(doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}`));
    if (projectSnap.exists()) {
      invitation.projectName = (projectSnap.data() as Project).name;
    }
    await setDoc(ref, invitation, { merge: true });
    const emailSent = await this.sendInvitationEmail(invitation, role);
    return { id: ref.id, emailSent };
  }

  /**
   * Envía (best-effort) el correo de invitación vía Cloud Function sendProjectInvitation.
   * Devuelve true si el envío se completó con éxito. Si las functions no están
   * desplegadas, no bloquea la invitación: devuelve false y el invitado puede verla en "/projects".
   */
  private async sendInvitationEmail(invitation: ProjectInvitation, role: ProjectRole): Promise<boolean> {
    try {
      if (typeof getFunctions !== 'function') return false;
      const functions = getFunctions();
      const callable = httpsCallable(functions, 'sendProjectInvitation');
      const baseUrl = isPlatformBrowser(this.platformId)
        ? new URL('projects', document.baseURI).href
        : '/projects';
      await callable({
        to: invitation.invitedEmail,
        invitedByName: invitation.invitedByName,
        projectName: invitation.projectName || 'CARXY',
        role,
        acceptUrl: baseUrl,
        expiresIn: '7 días',
      });
      return true;
    } catch {
      // No bloquea la invitación si el correo falla o ni siquiera está configurado.
      return false;
    }
  }

  async acceptInvitation(invitationId: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para aceptar la invitación.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    const invRef = doc(db, `${SOCIAL_COLLECTIONS.projectInvitations}/${invitationId}`);
    const invSnap = await getDoc(invRef);
    if (!invSnap.exists()) throw new Error(this.i18n.translate('Invitación no encontrada.'));
    const inv = invSnap.data() as ProjectInvitation;
    if (inv.status !== 'pending') throw new Error(this.i18n.translate('La invitación ya no está pendiente.'));
    if (inv.expiresAt < Date.now()) throw new Error(this.i18n.translate('La invitación ha expirado.'));

    const memberId = `${inv.projectId}_${user.uid}`;
    await runTransaction(db, async (tx) => {
      const currentInvSnap = await tx.get(invRef);
      if (!currentInvSnap.exists()) throw new Error(this.i18n.translate('Invitación no encontrada.'));
      const currentInv = currentInvSnap.data() as ProjectInvitation;
      if (currentInv.status !== 'pending') throw new Error(this.i18n.translate('La invitación ya no está pendiente.'));
      if (currentInv.expiresAt < Date.now()) throw new Error(this.i18n.translate('La invitación ha expirado.'));

      const memberRef = doc(db, `${SOCIAL_COLLECTIONS.projectMembers}/${memberId}`);
      tx.update(invRef, { status: 'accepted', respondedAt: Date.now(), invitedUid: user.uid });
      tx.set(memberRef, {
        id: memberId,
        projectId: currentInv.projectId,
        userId: user.uid,
        userName: user.displayName,
        userPhotoURL: user.photoURL,
        role: currentInv.role,
        joinedAt: Date.now(),
      }, { merge: true });
    });
  }

  async rejectInvitation(invitationId: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para rechazar la invitación.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));
    await updateDoc(doc(db, `${SOCIAL_COLLECTIONS.projectInvitations}/${invitationId}`), {
      status: 'rejected',
      respondedAt: Date.now(),
      invitedUid: user.uid,
    });
  }

  async updateMemberRole(projectId: string, memberId: string, role: ProjectRole): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para cambiar roles.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    const isOwner = await this.isProjectOwnerRole(projectId, user.uid);
    const isGlobalAdmin = await this.isGlobalAdmin();
    if (!isOwner && !isGlobalAdmin) {
      throw new Error(this.i18n.translate('Solo el dueño puede cambiar roles en este proyecto.'));
    }
    // Evita que un proyecto se quede sin propietario
    if (role !== 'owner') {
      const target = await getDoc(doc(db, `${SOCIAL_COLLECTIONS.projectMembers}/${memberId}`));
      const targetData = target.exists() ? target.data() as { role?: string; userId?: string } : null;
      if (targetData?.role === 'owner') {
        const owners = await getDocs(query(
          collection(db, SOCIAL_COLLECTIONS.projectMembers),
          where('projectId', '==', projectId),
          where('role', '==', 'owner'),
        ));
        if (owners.size <= 1) {
          throw new Error(this.i18n.translate('El proyecto necesita al menos un propietario.'));
        }
      }
    }
    await updateDoc(doc(db, `${SOCIAL_COLLECTIONS.projectMembers}/${memberId}`), { role });
  }

  async removeMember(projectId: string, memberId: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para eliminar miembros.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    // Se permite eliminar tu propia membresía; para eliminar a otros hace falta ser dueño (o admin global).
    let targetUserId: string | null = null;
    let targetRole: string | null = null;
    try {
      const snap = await getDoc(doc(db, `${SOCIAL_COLLECTIONS.projectMembers}/${memberId}`));
      targetUserId = snap.exists() ? String((snap.data() as { userId?: unknown }).userId ?? '') : null;
      targetRole = snap.exists() ? String((snap.data() as { role?: unknown }).role ?? '') || null : null;
    } catch {
      targetUserId = null;
      targetRole = null;
    }
    // Evita dejar el proyecto sin propietario al eliminar al último owner
    if (targetRole === 'owner') {
      const owners = await getDocs(query(
        collection(db, SOCIAL_COLLECTIONS.projectMembers),
        where('projectId', '==', projectId),
        where('role', '==', 'owner'),
      ));
      if (owners.size <= 1) {
        throw new Error(this.i18n.translate('No puedes eliminar al último propietario del proyecto.'));
      }
    }
    const isOwner = await this.isProjectOwnerRole(projectId, user.uid);
    const isGlobalAdmin = await this.isGlobalAdmin();
    const isSelf = targetUserId === user.uid;
    if (!isOwner && !isGlobalAdmin && !isSelf) {
      throw new Error(this.i18n.translate('Solo el dueño puede eliminar otros miembros.'));
    }
    await deleteDoc(doc(db, `${SOCIAL_COLLECTIONS.projectMembers}/${memberId}`));
  }

  /* ------------------------------------------------------------------ */
  /*  Invitaciones pendientes del usuario                               */
  /* ------------------------------------------------------------------ */

  getMyInvitations(): Observable<ProjectInvitation[]> {
    const db = this.firestore;
    if (!db) return of([]);
    return this.authService.user$.pipe(
      switchMap((user) => {
        if (!user) return of([]);
        const invitedEmail = this.normalizeInvitationEmail(user.email);
        const queries: any[] = [];
        if (invitedEmail) {
          queries.push(query(
            collection(db, SOCIAL_COLLECTIONS.projectInvitations),
            where('invitedEmail', '==', invitedEmail),
            where('status', '==', 'pending'),
            limit(100),
          ));
        }
        // También las invitaciones dirigidas por uid (invitar a seguidores).
        if (user.uid) {
          queries.push(query(
            collection(db, SOCIAL_COLLECTIONS.projectInvitations),
            where('invitedUid', '==', user.uid),
            where('status', '==', 'pending'),
            limit(100),
          ));
        }

        if (!queries.length) return of([]);
        const streams = queries.map((q) =>
          (collectionData(q, { idField: 'id' }) as Observable<ProjectInvitation[]>).pipe(
            catchError(() => of([] as ProjectInvitation[])),
          ),
        );
        return combineLatest(streams).pipe(
          map((arrays) => {
            const seen = new Set<string>();
            const merged = arrays.flatMap((items) => items).filter((item) => {
              const id = (item as any)?.id;
              if (!id || seen.has(id)) return false;
              seen.add(id);
              return true;
            });
            return merged.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          }),
          catchError(() => of([] as ProjectInvitation[])),
        );
      }),
      catchError(() => of([] as ProjectInvitation[]))
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Actividad (para historial compartido futuro)                      */
  /* ------------------------------------------------------------------ */

  async logActivity(
    projectId: string,
    action: ProjectActivity['action'],
    objectId: string,
    objectType: string,
    snapshot?: string
  ): Promise<void> {
    const user = await this.currentUser();
    if (!user) return;
    const db = this.firestore;
    if (!db) return;
    const ref = doc(collection(db, SOCIAL_COLLECTIONS.projectActivity));
    await setDoc(ref, {
      id: ref.id,
      projectId,
      actorId: user.uid,
      actorName: user.displayName,
      action,
      objectId,
      objectType,
      ...(snapshot === undefined ? {} : { snapshot }),
      createdAt: Date.now(),
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Biblioteca de assets del usuario                                    */
  /* ------------------------------------------------------------------ */

  async saveAsset(name: string, json: string): Promise<string> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Debes iniciar sesión.'));
    const db = this.firestore;
    if (!db) throw new Error('Firebase no está configurado.');
    const ref = doc(collection(db, SOCIAL_COLLECTIONS.assets));
    await setDoc(ref, {
      ownerId: user.uid,
      name: name.trim().slice(0, 80),
      json,
      createdAt: Date.now(),
    });
    return ref.id;
  }

  async listAssets(): Promise<Array<{ id: string; name: string; createdAt: number }>> {
    const user = await this.currentUser();
    const db = this.firestore;
    if (!db || !user) return [];
    const q = query(
      collection(db, SOCIAL_COLLECTIONS.assets),
      where('ownerId', '==', user.uid),
      limit(60),
    );
    const snap = await getDocs(q);
    return snap.docs.map((item) => {
      const data = item.data() as { name?: unknown; createdAt?: unknown };
      return {
        id: item.id,
        name: typeof data['name'] === 'string' ? data['name'] : 'Asset',
        createdAt: typeof data['createdAt'] === 'number' ? data['createdAt'] : 0,
      };
    });
  }

  async getAssetJSON(assetId: string): Promise<string | null> {
    const user = await this.currentUser();
    const db = this.firestore;
    if (!db || !user) return null;
    const snap = await getDoc(doc(db, SOCIAL_COLLECTIONS.assets, assetId));
    if (!snap.exists()) return null;
    const data = snap.data() as { ownerId?: unknown; json?: unknown };
    if (data['ownerId'] !== user.uid) return null;
    return typeof data['json'] === 'string' && data['json'].length > 0 ? data['json'] : null;
  }

  async deleteAsset(assetId: string): Promise<void> {
    const user = await this.currentUser();
    const db = this.firestore;
    if (!db || !user) return;
    const ref = doc(db, SOCIAL_COLLECTIONS.assets, assetId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data() as { ownerId?: unknown };
    if (data['ownerId'] !== user.uid) throw new Error(this.i18n.translate('No tienes permisos para borrar este asset.'));
    await deleteDoc(ref);
  }

  /* ------------------------------------------------------------------ */
  /*  Presencia en tiempo real                                          */
  /* ------------------------------------------------------------------ */

  async setPresence(
    projectId: string,
    uid: string,
    displayName: string,
    photoURL: string | null,
    isOnline: boolean,
    currentObjectId: string | null,
    cursorX: number,
    cursorY: number,
    transform?: PresenceTransform | null
  ): Promise<void> {
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));
    const ref = doc(db, `${SOCIAL_COLLECTIONS.projectPresences}/${projectId}_${uid}`);
    await setDoc(ref, {
      uid,
      projectId,
      displayName,
      photoURL,
      isOnline,
      currentObjectId,
      cursorX,
      cursorY,
      transform,
      lastSeen: Date.now(),
    }, { merge: true });
  }

  getPresences(projectId: string): Observable<ProjectPresence[]> {
    const db = this.firestore;
    if (!db) return of([]);
    if (!this.presencesStreams.has(projectId)) {
      const q = query(
        collection(db, `${SOCIAL_COLLECTIONS.projectPresences}`),
        where('projectId', '==', projectId),
        where('isOnline', '==', true)
      );
      const stream = new BehaviorSubject<ProjectPresence[]>([]);
      const subscription = collectionData(q, { idField: 'id' }).subscribe({
        next: (presences) => stream.next(presences as ProjectPresence[]),
        // Un usuario que no es miembro del proyecto no puede leer las
        // presencias; se deja la lista vacía en vez de propagar
        // "Missing or insufficient permissions" a la consola en cada cambio.
        error: (error: unknown) => {
          console.warn('No se pudieron cargar las presencias del proyecto.', error);
          stream.next([]);
        },
      });
      const unsub = () => subscription.unsubscribe();
      this.presencesStreams.set(projectId, { stream, unsub });
    }
    return this.presencesStreams.get(projectId)!.stream as Observable<ProjectPresence[]>;
  }

  async clearPresence(projectId: string, uid: string): Promise<void> {
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));
    await updateDoc(doc(db, `${SOCIAL_COLLECTIONS.projectPresences}/${projectId}_${uid}`), {
      isOnline: false,
      lastSeen: Date.now(),
    });
  }

  releaseProject(projectId: string): void {
    if (!projectId) return;
    this.releaseCachedStream(this.membersStreams, projectId);
    this.releaseCachedStream(this.presencesStreams, projectId);
  }

  releaseAll(): void {
    for (const projectId of [...this.membersStreams.keys()]) {
      this.releaseCachedStream(this.membersStreams, projectId);
    }
    for (const projectId of [...this.presencesStreams.keys()]) {
      this.releaseCachedStream(this.presencesStreams, projectId);
    }
  }

  private releaseCachedStream<T>(
    cache: Map<string, { stream: BehaviorSubject<T[]>; unsub: () => void }>,
    projectId: string,
  ): void {
    const entry = cache.get(projectId);
    if (!entry) return;
    try {
      entry.unsub();
    } finally {
      entry.stream.complete();
      cache.delete(projectId);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Enlaces compartidos                                               */
  /* ------------------------------------------------------------------ */

  private randomShareToken(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`.slice(0, 20);
  }

  getShareLinks(projectId: string): Observable<ProjectShareLink[]> {
    const db = this.firestore;
    if (!db || !projectId) return of([]);
    try {
      const q = query(
        collection(db, SOCIAL_COLLECTIONS.projectShareLinks),
        where('projectId', '==', projectId),
      );
      return (collectionData(q, { idField: 'id' }) as Observable<ProjectShareLink[]>).pipe(
        map((items) => [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))),
        catchError((err) => {
          console.warn('No se pudieron cargar los enlaces compartidos.', err);
          return of([] as ProjectShareLink[]);
        }),
      );
    } catch {
      return of([] as ProjectShareLink[]);
    }
  }

  async createShareLink(projectId: string, role: ProjectShareLinkRole, label = ''): Promise<ProjectShareLink> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para crear un enlace.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    const isOwner = await this.isProjectOwnerRole(projectId, user.uid);
    const isGlobalAdmin = await this.isGlobalAdmin();
    if (!isOwner && !isGlobalAdmin) {
      throw new Error(this.i18n.translate('Solo el dueño puede crear enlaces de acceso.'));
    }

    const now = Date.now();
    const id = this.randomShareToken();
    const link: ProjectShareLink = {
      id,
      projectId,
      role,
      label: label.trim().slice(0, 60),
      createdBy: user.uid,
      createdByName: user.displayName || user.email || 'Usuario',
      createdAt: now,
      updatedAt: now,
      enabled: true,
    };
    await setDoc(doc(db, `${SOCIAL_COLLECTIONS.projectShareLinks}/${id}`), link);
    return link;
  }

  async updateShareLink(linkId: string, patch: { role?: ProjectShareLinkRole; enabled?: boolean; label?: string }): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para modificar el enlace.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    const ref = doc(db, `${SOCIAL_COLLECTIONS.projectShareLinks}/${linkId}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error(this.i18n.translate('El enlace no existe.'));
    const current = snap.data() as ProjectShareLink;

    const isOwner = await this.isProjectOwnerRole(current.projectId, user.uid);
    const isGlobalAdmin = await this.isGlobalAdmin();
    if (!isOwner && !isGlobalAdmin) {
      throw new Error(this.i18n.translate('Solo el dueño puede modificar este enlace.'));
    }

    const next: Partial<ProjectShareLink> = { updatedAt: Date.now() };
    if (patch.role === 'viewer' || patch.role === 'editor') next.role = patch.role;
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (typeof patch.label === 'string') next.label = patch.label.trim().slice(0, 60);
    await updateDoc(ref, next);
  }

  async deleteShareLink(linkId: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para eliminar el enlace.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    const ref = doc(db, `${SOCIAL_COLLECTIONS.projectShareLinks}/${linkId}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const current = snap.data() as ProjectShareLink;

    const isOwner = await this.isProjectOwnerRole(current.projectId, user.uid);
    const isGlobalAdmin = await this.isGlobalAdmin();
    if (!isOwner && !isGlobalAdmin) {
      throw new Error(this.i18n.translate('Solo el dueño puede eliminar este enlace.'));
    }
    await deleteDoc(ref);
  }

  async resolveShareLink(token: string): Promise<ProjectShareLink | null> {
    const db = this.firestore;
    if (!db || !token) return null;
    try {
      const snap = await getDoc(doc(db, `${SOCIAL_COLLECTIONS.projectShareLinks}/${token}`));
      if (!snap.exists()) return null;
      const link = { ...(snap.data() as ProjectShareLink), id: snap.id };
      return link.enabled ? link : null;
    } catch {
      return null;
    }
  }

  async joinViaShareLink(token: string): Promise<ProjectShareLink | null> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para usar el enlace de acceso.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    const link = await this.resolveShareLink(token);
    if (!link) return null;

    const memberId = `${link.projectId}_${user.uid}`;
    const memberRef = doc(db, `${SOCIAL_COLLECTIONS.projectMembers}/${memberId}`);
    // Si la ficha todavía no existe, Firestore responde con "Missing or
    // insufficient permissions" en lugar de "no existe" (la regla de lectura no
    // puede evaluar `resource.data` sobre un documento inexistente). Se
    // interpreta como "todavía no es miembro" y se continúa con el alta.
    let existing: DocumentSnapshot | null = null;
    try {
      const snapshot = await getDoc(memberRef);
      existing = snapshot.exists() ? snapshot : null;
    } catch {
      existing = null;
    }
    if (existing) {
      const current = existing.data() as ProjectMember;
      const rolePriority: Record<ProjectRole, number> = { viewer: 0, editor: 1, owner: 2 };
      // No degradar owners/roles superiores; elevar si el enlace da más acceso.
      if ((rolePriority[link.role] ?? 0) > (rolePriority[current.role] ?? 0)) {
        await updateDoc(memberRef, { role: link.role, joinedViaShareLink: link.id });
      }
      return link;
    }

    const now = Date.now();
    const member: ProjectMember = {
      id: memberId,
      projectId: link.projectId,
      userId: user.uid,
      userName: user.displayName || user.email || 'Usuario',
      userPhotoURL: user.photoURL ?? null,
      role: link.role,
      joinedAt: now,
      joinedViaShareLink: link.id,
    };
    await setDoc(memberRef, member);

    // Aviso al dueño del proyecto: alguien nuevo se unió por el enlace.
    try {
      const projectSnap = await getDoc(doc(db, `${SOCIAL_COLLECTIONS.projects}/${link.projectId}`));
      const project = projectSnap.exists() ? (projectSnap.data() as { ownerId?: string }) : null;
      const ownerId = project?.ownerId ?? '';
      if (ownerId && ownerId !== user.uid) {
        const notificationId = `share_${user.uid}_${link.projectId}_${now}`
          .replace(/[^A-Za-z0-9_-]/g, '_')
          .slice(0, 500);
        await setDoc(doc(db, 'users', ownerId, 'notifications', notificationId), {
          id: notificationId,
          recipientId: ownerId,
          actorId: user.uid,
          actorName: user.displayName || user.email || 'Usuario',
          actorPhotoURL: user.photoURL ?? null,
          kind: 'share',
          targetId: link.projectId,
          createdAt: now,
          read: false,
        });
      }
    } catch (error) {
      // El alta ya se hizo; avisar al dueño es un detalle best-effort.
      console.warn('[carxy] No se pudo avisar al dueño del proyecto de la admisión por enlace.', error);
    }
    return link;
  }

  /* ------------------------------------------------------------------ */
  /*  Utilidades internas                                               */
  /* ------------------------------------------------------------------ */

  private async canUserWrite(projectId: string, userId: string): Promise<boolean> {
    return this.getProjectMemberRole(projectId, userId)
      .then((role) => !!role && hasPermission(role, 'write'));
  }

  /** Devuelve el rol del usuario dentro del proyecto, o null si no es miembro. */
  private async getProjectMemberRole(projectId: string, userId: string): Promise<ProjectRole | null> {
    const db = this.firestore;
    if (!db) return null;
    const memberSnap = await getDocs(
      query(
        collection(db, SOCIAL_COLLECTIONS.projectMembers),
        where('projectId', '==', projectId),
        where('userId', '==', userId),
      ),
    );
    if (memberSnap.empty) return null;
    return (memberSnap.docs[0].data() as ProjectMember).role;
  }

  private async isProjectOwnerRole(projectId: string, userId: string): Promise<boolean> {
    return (await this.getProjectMemberRole(projectId, userId)) === 'owner';
  }
}
