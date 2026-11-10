import { Injectable, inject } from '@angular/core';
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
  orderBy,
  limit,
} from '@angular/fire/firestore';
import { firstValueFrom, BehaviorSubject, Observable, of, switchMap } from 'rxjs';
import { SOCIAL_COLLECTIONS } from '../config/app.constants';
import { I18nService } from './i18n';
import { AuthService } from './auth';
import {
  Project,
  ProjectMember,
  ProjectInvitation,
  ProjectActivity,
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
export class CollaborationService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly auth = inject(AuthService, { optional: true });
  private readonly i18n = inject(I18nService);

  private readonly membersStreams = new Map<string, { stream: BehaviorSubject<ProjectMember[]>; unsub: () => void }>();

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
        const q = query(
          collection(db, SOCIAL_COLLECTIONS.projects),
          where('ownerId', '==', user.uid),
          orderBy('updatedAt', 'desc'),
          limit(50)
        );
        return collectionData(q, { idField: 'id' }) as Observable<Project[]>;
      })
    );
  }

  getProject(projectId: string): Observable<Project | undefined> {
    const db = this.firestore;
    if (!db) return of(undefined);
    return docData(doc(db, `${SOCIAL_COLLECTIONS.projects}/${projectId}`), { idField: 'id' }) as Observable<Project | undefined>;
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
    if (!db) return of([]);
    if (!this.membersStreams.has(projectId)) {
      const q = query(
        collection(db, SOCIAL_COLLECTIONS.projectMembers),
        where('projectId', '==', projectId),
        orderBy('role', 'asc')
      );
      const stream = new BehaviorSubject<ProjectMember[]>([]);
      const subscription = collectionData(q, { idField: 'id' }).subscribe((members) =>
        stream.next(members as ProjectMember[])
      );
      this.membersStreams.set(projectId, { stream, unsub: () => subscription.unsubscribe() });
    }
    return this.membersStreams.get(projectId)!.stream as Observable<ProjectMember[]>;
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
    const ref = doc(collection(db, SOCIAL_COLLECTIONS.projectMembers));
    const member: ProjectMember = {
      id: ref.id,
      projectId,
      userId,
      userName,
      userPhotoURL,
      role,
      joinedAt: now,
    };
    await setDoc(ref, member);
    return ref.id;
  }

  async inviteMember(projectId: string, invitedEmail: string, role: ProjectRole): Promise<string> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para invitar miembros.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    const canWrite = await this.canUserWrite(projectId, user.uid);
    if (!canWrite) throw new Error(this.i18n.translate('No tienes permiso para invitar a este proyecto.'));

    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 días
    const ref = doc(collection(db, SOCIAL_COLLECTIONS.projectInvitations));
    const invitation: ProjectInvitation = {
      id: ref.id,
      projectId,
      projectName: '',
      invitedBy: user.uid,
      invitedByName: user.displayName,
      invitedEmail,
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
    await setDoc(ref, invitation);
    return ref.id;
  }

  async acceptInvitation(invitationId: string): Promise<void> {
    const user = await this.currentUser();
    if (!user) throw new Error(this.i18n.translate('Inicia sesión para aceptar la invitación.'));
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));

    const invSnap = await getDoc(doc(db, `${SOCIAL_COLLECTIONS.projectInvitations}/${invitationId}`));
    if (!invSnap.exists()) throw new Error(this.i18n.translate('Invitación no encontrada.'));
    const inv = invSnap.data() as ProjectInvitation;
    if (inv.status !== 'pending') throw new Error(this.i18n.translate('La invitación ya no está pendiente.'));
    if (inv.expiresAt < Date.now()) throw new Error(this.i18n.translate('La invitación ha expirado.'));

    await runTransaction(db, async (tx) => {
      const invRef = doc(db, `${SOCIAL_COLLECTIONS.projectInvitations}/${invitationId}`);
      tx.update(invRef, { status: 'accepted', respondedAt: Date.now(), invitedUid: user.uid });

      const memberRef = doc(collection(db, SOCIAL_COLLECTIONS.projectMembers));
      tx.set(memberRef, {
        id: memberRef.id,
        projectId: inv.projectId,
        userId: user.uid,
        userName: user.displayName,
        userPhotoURL: user.photoURL,
        role: inv.role,
        joinedAt: Date.now(),
      });
    });
  }

  async rejectInvitation(invitationId: string): Promise<void> {
    const db = this.firestore;
    if (!db) throw new Error(this.i18n.translate('Firebase no está configurado.'));
    await updateDoc(doc(db, `${SOCIAL_COLLECTIONS.projectInvitations}/${invitationId}`), {
      status: 'rejected',
      respondedAt: Date.now(),
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
        const q = query(
          collection(db, SOCIAL_COLLECTIONS.projectInvitations),
          where('invitedEmail', '==', user.email),
          where('status', '==', 'pending'),
          orderBy('createdAt', 'desc')
        );
        return collectionData(q, { idField: 'id' }) as Observable<ProjectInvitation[]>;
      })
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
