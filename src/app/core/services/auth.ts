import { Injectable, inject } from '@angular/core';
import {
  Auth,
  authState,
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from '@angular/fire/auth';
import type { User as FirebaseAuthUser } from 'firebase/auth';
import { BehaviorSubject, Observable, combineLatest, map, of, switchMap, tap } from 'rxjs';
import { Firestore, doc, docData, setDoc } from '@angular/fire/firestore';
import { LOCAL_KEYS, SOCIAL_COLLECTIONS } from '../config/app.constants';
import { User as SocialUser, UserProfile, UserRole } from '../models/social.models';

const DEFAULT_ROLE: UserRole = 'user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth, { optional: true });
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly localUser = new BehaviorSubject<UserProfile | null>(this.loadLocalUser());

  readonly user$: Observable<UserProfile | null> = this.auth && this.firestore
    ? authState(this.auth).pipe(
        switchMap((firebaseUser) => {
          if (!firebaseUser) return of(null);
          const publicProfileRef = doc(this.firestore!, SOCIAL_COLLECTIONS.users, firebaseUser.uid);
          const privateProfileRef = doc(this.firestore!, SOCIAL_COLLECTIONS.privateUsers, firebaseUser.uid);
          return combineLatest([docData(publicProfileRef), docData(privateProfileRef)]).pipe(
            tap(([profile, privateProfile]) => {
              const writes: Promise<void>[] = [];
              const createdAt = Date.now();
              if (profile === undefined) {
                writes.push(setDoc(publicProfileRef, {
                    uid: firebaseUser.uid,
                    displayName: firebaseUser.displayName ?? firebaseUser.email?.split('@')[0] ?? 'Creador',
                    photoURL: firebaseUser.photoURL,
                    bio: '',
                    role: DEFAULT_ROLE,
                    isBanned: false,
                    createdAt,
                  }));
              }
              if (privateProfile === undefined) {
                writes.push(setDoc(privateProfileRef, { email: firebaseUser.email ?? '', createdAt }));
              }
              if (writes.length) void Promise.all(writes)
                .catch((error: unknown) => console.error('No se pudo inicializar el perfil de usuario.', error));
            }),
            map(([profile]) => this.firebaseProfile(firebaseUser, profile)),
          );
        }),
      )
    : this.auth
      ? authState(this.auth).pipe(map((firebaseUser) => firebaseUser ? {
          uid: firebaseUser.uid,
          displayName: firebaseUser.displayName ?? firebaseUser.email?.split('@')[0] ?? 'Creador',
          email: firebaseUser.email ?? '',
          photoURL: firebaseUser.photoURL,
          bio: '',
          role: DEFAULT_ROLE,
          isBanned: false,
          createdAt: Date.now(),
        } : null))
      : this.localUser.asObservable();

  readonly role$: Observable<UserRole | null> = this.user$.pipe(map((user) => user?.role ?? null));

  readonly isConfigured = !!this.auth;

  waitForAuthReady(): Promise<void> {
    return this.auth?.authStateReady() ?? Promise.resolve();
  }

  async login(email: string, password: string): Promise<void> {
    if (this.auth) {
      await signInWithEmailAndPassword(this.auth, email, password);
      return;
    }
    const accounts = this.readAccounts();
    const account = accounts.find((item) => item.email === email.trim().toLowerCase());
    if (!account) throw new Error('No existe una cuenta local con ese correo. Regístrate primero.');
    this.setLocalUser(account);
  }

  async register(email: string, password: string, displayName: string): Promise<void> {
    if (this.auth) {
      const credential = await createUserWithEmailAndPassword(this.auth, email, password);
      await updateProfile(credential.user, { displayName });
      if (this.firestore) {
        await setDoc(doc(this.firestore, 'users', credential.user.uid), {
          uid: credential.user.uid,
          displayName,
          photoURL: null,
          bio: '',
          role: DEFAULT_ROLE,
          isBanned: false,
          createdAt: Date.now(),
        });
      }
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    const accounts = this.readAccounts();
    if (accounts.some((item) => item.email === normalizedEmail)) {
      throw new Error('Ya existe una cuenta local con ese correo.');
    }
    const user: UserProfile = {
      uid: `local-${crypto.randomUUID()}`,
      displayName: displayName.trim(),
      email: normalizedEmail,
      photoURL: null,
      bio: '',
      role: DEFAULT_ROLE,
      isBanned: false,
      createdAt: Date.now(),
    };
    this.writeAccounts([...accounts, user]);
    this.setLocalUser(user);
  }

  async loginWithGoogle(): Promise<void> {
    if (!this.auth) throw new Error('El inicio con Google requiere configurar Firebase.');
    await signInWithPopup(this.auth, new GoogleAuthProvider());
  }

  async logout(): Promise<void> {
    if (this.auth) {
      await signOut(this.auth);
      return;
    }
    localStorage.removeItem(LOCAL_KEYS.user);
    this.localUser.next(null);
  }

  get requiresPasswordForAccountDeletion(): boolean {
    return !!this.auth?.currentUser?.providerData.some((provider) => provider.providerId === 'password');
  }

  async reauthenticateForAccountDeletion(password = ''): Promise<void> {
    const currentUser = this.auth?.currentUser;
    if (!currentUser) {
      if (!this.auth && this.localUser.value) return;
      throw new Error('Inicia sesión para eliminar tu cuenta.');
    }

    if (currentUser.providerData.some((provider) => provider.providerId === 'password')) {
      if (!currentUser.email || !password) throw new Error('Escribe tu contraseña para confirmar la eliminación.');
      await reauthenticateWithCredential(currentUser, EmailAuthProvider.credential(currentUser.email, password));
      return;
    }
    if (currentUser.providerData.some((provider) => provider.providerId === 'google.com')) {
      await reauthenticateWithPopup(currentUser, new GoogleAuthProvider());
      return;
    }
    throw new Error('Vuelve a iniciar sesión con tu proveedor para eliminar la cuenta.');
  }

  async deleteAccount(): Promise<void> {
    if (this.auth?.currentUser) {
      await deleteUser(this.auth.currentUser);
      return;
    }
    const current = this.localUser.value;
    if (!current) throw new Error('Inicia sesión para eliminar tu cuenta.');
    this.writeAccounts(this.readAccounts().filter((account) => account.uid !== current.uid));
    localStorage.removeItem(LOCAL_KEYS.user);
    this.localUser.next(null);
  }

  async updateUser(patch: Partial<Pick<SocialUser, 'displayName' | 'photoURL' | 'bio'>>): Promise<void> {
    const current = this.currentLocalUser();
    if (!current) throw new Error('Inicia sesión antes de editar tu perfil.');
    if (this.auth?.currentUser) {
      await updateProfile(this.auth.currentUser, {
        displayName: patch.displayName ?? current.displayName,
        photoURL: patch.photoURL ?? current.photoURL,
      });
      if (this.firestore) {
        await setDoc(doc(this.firestore, 'users', current.uid), {
          uid: current.uid,
          displayName: patch.displayName ?? current.displayName,
          photoURL: patch.photoURL ?? current.photoURL,
          bio: patch.bio ?? current.bio,
        }, { merge: true });
      }
    }
    const updated = { ...current, ...patch };
    this.setLocalUser(updated);
    if (!this.auth) {
      this.writeAccounts(this.readAccounts().map((account) => account.uid === updated.uid ? updated : account));
    }
  }

  private loadLocalUser(): UserProfile | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const value = localStorage.getItem(LOCAL_KEYS.user);
      if (!value) return null;
      const user = JSON.parse(value) as Partial<UserProfile>;
      return {
        uid: String(user.uid ?? ''),
        displayName: String(user.displayName ?? 'Creador'),
        email: String(user.email ?? ''),
        photoURL: user.photoURL ?? null,
        bio: String(user.bio ?? ''),
        role: DEFAULT_ROLE,
        isBanned: user.isBanned === true,
        createdAt: typeof user.createdAt === 'number' ? user.createdAt : Date.now(),
      };
    } catch (error) {
      console.warn('La sesión local estaba dañada y se cerró.', error);
      localStorage.removeItem(LOCAL_KEYS.user);
      return null;
    }
  }

  private currentLocalUser(): UserProfile | null {
    return this.auth?.currentUser
      ? {
          uid: this.auth.currentUser.uid,
          displayName: this.auth.currentUser.displayName ?? 'Creador',
          email: this.auth.currentUser.email ?? '',
          photoURL: this.auth.currentUser.photoURL,
          bio: '',
          role: DEFAULT_ROLE,
          isBanned: false,
          createdAt: Date.now(),
        }
      : this.localUser.value;
  }

  private setLocalUser(user: UserProfile): void {
    localStorage.setItem(LOCAL_KEYS.user, JSON.stringify(user));
    this.localUser.next(user);
  }

  private readAccounts(): UserProfile[] {
    try {
      const raw = localStorage.getItem(LOCAL_KEYS.accounts);
      if (!raw) return [];
      return (JSON.parse(raw) as Partial<UserProfile>[]).map((account) => ({
        uid: String(account.uid ?? ''),
        displayName: String(account.displayName ?? 'Creador'),
        email: String(account.email ?? ''),
        photoURL: account.photoURL ?? null,
        bio: String(account.bio ?? ''),
        role: DEFAULT_ROLE,
        isBanned: false,
        createdAt: typeof account.createdAt === 'number' ? account.createdAt : Date.now(),
      }));
    } catch (error) {
      console.error('No se pudieron leer las cuentas locales.', error);
      return [];
    }
  }

  private writeAccounts(accounts: UserProfile[]): void {
    localStorage.setItem(LOCAL_KEYS.accounts, JSON.stringify(accounts));
  }

  private firebaseProfile(
    firebaseUser: FirebaseAuthUser,
    profile: Record<string, unknown> | undefined,
  ): UserProfile | null {
    if (!firebaseUser) return null;
    const role = profile?.['role'];
    const createdAt = profile?.['createdAt'];
    return {
      uid: firebaseUser.uid,
      displayName: String(profile?.['displayName'] ?? firebaseUser.displayName ?? firebaseUser.email?.split('@')[0] ?? 'Creador'),
      email: firebaseUser.email ?? '',
      photoURL: typeof profile?.['photoURL'] === 'string' ? profile['photoURL'] : firebaseUser.photoURL,
      bio: String(profile?.['bio'] ?? ''),
      role: role === 'admin' || role === 'moderator' ? role : DEFAULT_ROLE,
      isBanned: profile?.['isBanned'] === true,
      createdAt: this.timestampToMillis(createdAt),
    };
  }

  private timestampToMillis(value: unknown): number {
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    if (value && typeof value === 'object' && 'toMillis' in value
      && typeof value.toMillis === 'function') return value.toMillis();
    return Date.now();
  }
}
