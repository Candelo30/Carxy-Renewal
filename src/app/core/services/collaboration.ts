import { Injectable, OnDestroy, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  docData,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  limit,
} from '@angular/fire/firestore';
import { firstValueFrom, BehaviorSubject, Observable, of, switchMap, catchError, map, combineLatest, from } from 'rxjs';
import { SOCIAL_COLLECTIONS } from '../config/app.constants';
import { I18nService } from './i18n';
import { AuthService } from './auth';
import { EmailService } from './email';
import {
  Project,
  ProjectMember,
  ProjectInvitation,
  ProjectActivity,
  ProjectPresence,
  ProjectRole,
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
  private readonly emailService = inject(EmailService);

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
      })
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
    await deleteDoc(doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}`));
  }

  /* ------------------------------------------------------------------ */
  /*  Escena del proyecto                                               */
  /* ------------------------------------------------------------------ */

  getProjectScene(projectId: string): Observable<string | undefined> {
    const db = this.firestore;
    if (!db) return of(undefined);
    return docData(doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}`), { idField: 'id' }).pipe(
      switchMap((p) => of((p as Project)?.sceneJson))
    );
  }

  /** Observa cambios en tiempo real en la escena de un proyecto (para colaboración remota). */
  watchProjectScene(projectId: string): Observable<string | undefined> {
    return this.getProjectScene(projectId);
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
    const existing = await getDoc(ref);
    const member: ProjectMember = {
      id: memberId,
      projectId,
      userId,
      userName,
      userPhotoURL,
      role,
      joinedAt: existing.exists()
        ? (Number((existing.data() as Partial<ProjectMember>).joinedAt) || now)
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

  async inviteMember(projectId: string, invitedEmail: string, role: ProjectRole): Promise<string> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para invitar miembros.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    const canWrite = await this.canUserWrite(projectId, user.uid);
    if (!canWrite) throw new Error(this.i18n.translate('No tienes permiso para invitar a este proyecto.'));

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
      invitedUid: undefined,
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

    // Envío del correo de invitación decorado y dinámico
    try {
      const appUrl =
        typeof import.meta !== 'undefined' && import.meta.env
          ? String(import.meta.env['VITE_APP_URL'] ?? 'https://tu-app.web.app')
          : 'https://tu-app.web.app';
      await this.emailService.sendProjectInvitation({
        to: normalizedEmail,
        displayName: normalizedEmail,
        invitedByName: user.displayName,
        projectName: invitation.projectName,
        role,
        acceptUrl: `${appUrl}/proyectos/${projectId}/invitaciones/${invitationId}`,
        expiresIn: '7 días',
      });
    } catch (error) {
      console.warn('No se pudo enviar el correo de invitación.', error);
    }

    return ref.id;
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

    const canWrite = await this.canUserWrite(projectId, user.uid);
    if (!canWrite) throw new Error(this.i18n.translate('No tienes permiso para cambiar roles en este proyecto.'));
    await updateDoc(doc(db, `${SOCIAL_COLLECTIONS.projectMembers}/${memberId}`), { role });
  }

  async removeMember(projectId: string, memberId: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para eliminar miembros.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));
    const canWrite = await this.canUserWrite(projectId, user.uid);
    if (!canWrite) throw new Error(this.i18n.translate('No tienes permiso para eliminar miembros de este proyecto.'));
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
        if (!user?.email) return of([]);
        try {
          const q = query(
            collection(db, SOCIAL_COLLECTIONS.projectInvitations),
            where('invitedEmail', '==', user.email),
            where('status', '==', 'pending'),
            limit(100)
          );
          return (collectionData(q, { idField: 'id' }) as Observable<ProjectInvitation[]>).pipe(
            map((items) => [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))),
            catchError((err) => {
              console.warn('No se pudieron cargar tus invitaciones.', err);
              return of([] as ProjectInvitation[]);
            })
          );
        } catch {
          return of([] as ProjectInvitation[]);
        }
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
      snapshot,
      createdAt: Date.now(),
    });
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
    cursorY: number
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
      const subscription = collectionData(q, { idField: 'id' }).subscribe((presences) =>
        stream.next(presences as ProjectPresence[])
      );
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
  /*  Utilidades internas                                               */
  /* ------------------------------------------------------------------ */

  private async canUserWrite(projectId: string, userId: string): Promise<boolean> {
    const db = this.firestore;
    if (!db) return false;
    const memberSnap = await getDocs(
      query(
        collection(db, SOCIAL_COLLECTIONS.projectMembers),
        where('projectId', '==', projectId),
        where('userId', '==', userId)
      )
    );
    if (memberSnap.empty) return false;
    const member = memberSnap.docs[0].data() as ProjectMember;
    return hasPermission(member.role, 'write');
  }
}
