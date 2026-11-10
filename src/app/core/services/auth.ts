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
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
} from '@angular/fire/auth';
import type { User as FirebaseAuthUser } from 'firebase/auth';
import { BehaviorSubject, Observable, combineLatest, map, of, switchMap, tap } from 'rxjs';
import { Firestore, doc, docData, setDoc } from '@angular/fire/firestore';
import { LOCAL_KEYS, SOCIAL_COLLECTIONS } from '../config/app.constants';
import { User as SocialUser, UserProfile, UserRole } from '../models/social.models';
import { I18nService } from './i18n';

const DEFAULT_ROLE: UserRole = 'user';
const MIN_PASSWORD_LENGTH = 8;

export type PasswordStrength = 'weak' | 'fair' | 'strong';

export function evaluatePasswordStrength(password: string): PasswordStrength {
  const value = password ?? '';
  let score = 0;
  if (value.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  if (score <= 2) return 'weak';
  if (score <= 3) return 'fair';
  return 'strong';
}

export function isPasswordStrongEnough(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH
    && /[A-Za-z]/.test(password)
    && /\d/.test(password);
}

/**
 * Servicio de autenticación y perfil de usuario.
 *
 * Modos de operación:
 * - Firebase (Auth + Firestore): fuente canónica para sesión/perfil y datos privados.
 * - Solo Auth (sin Firestore): sesión remota con perfil mínimo derivado de Auth.
 * - Local/demo (sin Firebase): cuentas/sesión en `localStorage` del navegador.
 *
 * El modo local/demo es útil para desarrollo y pruebas manuales, pero no reemplaza
 * controles de seguridad del servidor, no sincroniza entre dispositivos y no debe
 * usarse para cuentas o datos reales en producción.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(Auth, { optional: true });
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly localUser = new BehaviorSubject<UserProfile | null>(this.loadLocalUser());

  /** Usuario de Firebase Auth actual (puede ser null si no está autenticado). */
  get currentUser() {
    return this.auth?.currentUser;
  }

  readonly user$: Observable<UserProfile | null> = this.auth && this.firestore
    ? authState(this.auth).pipe(
        switchMap((firebaseUser) => {
          if (!firebaseUser) return of(null);
          const publicProfileRef = doc(this.firestore!, SOCIAL_COLLECTIONS.users, firebaseUser.uid);
          const privateProfileRef = doc(this.firestore!, SOCIAL_COLLECTIONS.privateUsers, firebaseUser.uid);
          return combineLatest([docData(publicProfileRef), docData(privateProfileRef)]).pipe(
            tap(([profile, privateProfile]) => {
              this.ensureFirebaseProfileInitialized(
                firebaseUser,
                profile as Record<string, unknown> | undefined,
                privateProfile as Record<string, unknown> | undefined,
                publicProfileRef,
                privateProfileRef,
              );
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
          emailVerified: firebaseUser.emailVerified,
          providers: firebaseUser.providerData.map((provider) => provider.providerId),
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
    if (!account) throw new Error(this.i18n.translate('No existe una cuenta local con ese correo. Regístrate primero.'));
    if (!password) throw new Error(this.i18n.translate('Escribe tu contraseña.'));
    this.setLocalUser(account);
  }

  async register(email: string, password: string, displayName: string): Promise<void> {
    this.assertPasswordPolicy(password);
    if (this.auth) {
      const credential = await createUserWithEmailAndPassword(this.auth, email, password);
      await updateProfile(credential.user, { displayName });
      try {
        await sendEmailVerification(credential.user);
      } catch (error) {
        console.warn('No se pudo enviar el correo de verificación.', error);
      }
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
      throw new Error(this.i18n.translate('Ya existe una cuenta local con ese correo.'));
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
      emailVerified: true,
    };
    this.writeAccounts([...accounts, user]);
    this.setLocalUser(user);
  }

  async sendPasswordReset(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) throw new Error(this.i18n.translate('Escribe el correo de tu cuenta.'));
    if (!this.auth) {
      throw new Error(this.i18n.translate('La recuperación de contraseña requiere Firebase configurado.'));
    }
    await sendPasswordResetEmail(this.auth, normalized);
  }

  async sendVerificationEmail(): Promise<void> {
    const currentUser = this.auth?.currentUser;
    if (!currentUser) throw new Error(this.i18n.translate('Inicia sesión para verificar tu correo.'));
    if (currentUser.emailVerified) throw new Error(this.i18n.translate('Tu correo ya está verificado.'));
    await sendEmailVerification(currentUser);
  }

  get hasPasswordProvider(): boolean {
    return !!this.auth?.currentUser?.providerData.some((provider) => provider.providerId === 'password');
  }

  get emailVerified(): boolean {
    if (this.auth?.currentUser) return this.auth.currentUser.emailVerified;
    return this.localUser.value?.emailVerified !== false;
  }

  async changePassword(currentPassword: string, nextPassword: string): Promise<void> {
    this.assertPasswordPolicy(nextPassword);
    const currentUser = this.auth?.currentUser;
    if (!currentUser?.email) {
      throw new Error(this.i18n.translate('Cambia tu contraseña desde una cuenta con correo y contraseña.'));
    }
    if (!currentUser.providerData.some((provider) => provider.providerId === 'password')) {
      throw new Error(this.i18n.translate('Tu cuenta usa un proveedor externo. Gestiona la contraseña desde ese proveedor.'));
    }
    await reauthenticateWithCredential(
      currentUser,
      EmailAuthProvider.credential(currentUser.email, currentPassword),
    );
    await updatePassword(currentUser, nextPassword);
  }

  authErrorMessage(error: unknown): string {
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
    switch (code) {
      case 'auth/invalid-email':
        return this.i18n.translate('El correo no es válido.');
      case 'auth/user-disabled':
        return this.i18n.translate('Esta cuenta está deshabilitada. Contacta con soporte.');
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return this.i18n.translate('Correo o contraseña incorrectos.');
      case 'auth/email-already-in-use':
        return this.i18n.translate('Ya existe una cuenta con ese correo.');
      case 'auth/weak-password':
        return this.i18n.translate('La contraseña es demasiado débil. Usa al menos 8 caracteres con letras y números.');
      case 'auth/too-many-requests':
        return this.i18n.translate('Demasiados intentos. Espera unos minutos o restablece tu contraseña.');
      case 'auth/requires-recent-login':
        return this.i18n.translate('Por seguridad, vuelve a iniciar sesión e inténtalo de nuevo.');
      case 'auth/network-request-failed':
      case 'auth/operation-not-allowed':
        return this.i18n.translate('Firebase Authentication no está listo. En Firebase Console, habilita Email/Password (y Google si lo usas).');
      case 'auth/popup-closed-by-user':
        return this.i18n.translate('Se cerró la ventana de Google antes de completar el acceso.');
      default:
        return error instanceof Error ? error.message : this.i18n.translate('No se pudo completar la autenticación.');
    }
  }

  private assertPasswordPolicy(password: string): void {
    if (!isPasswordStrongEnough(password)) {
      throw new Error(this.i18n.translate('La contraseña debe tener al menos 8 caracteres, incluir letras y al menos un número.'));
    }
  }

  async loginWithGoogle(): Promise<void> {
    if (!this.auth) throw new Error(this.i18n.translate('El inicio con Google requiere configurar Firebase.'));
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
      throw new Error(this.i18n.translate('Inicia sesión para eliminar tu cuenta.'));
    }

    if (currentUser.providerData.some((provider) => provider.providerId === 'password')) {
      if (!currentUser.email || !password) throw new Error(this.i18n.translate('Escribe tu contraseña para confirmar la eliminación.'));
      await reauthenticateWithCredential(currentUser, EmailAuthProvider.credential(currentUser.email, password));
      return;
    }
    if (currentUser.providerData.some((provider) => provider.providerId === 'google.com')) {
      await reauthenticateWithPopup(currentUser, new GoogleAuthProvider());
      return;
    }
    throw new Error(this.i18n.translate('Vuelve a iniciar sesión con tu proveedor para eliminar la cuenta.'));
  }

  async deleteAccount(): Promise<void> {
    if (this.auth?.currentUser) {
      await deleteUser(this.auth.currentUser);
      return;
    }
    const current = this.localUser.value;
    if (!current) throw new Error(this.i18n.translate('Inicia sesión para eliminar tu cuenta.'));
    this.writeAccounts(this.readAccounts().filter((account) => account.uid !== current.uid));
    localStorage.removeItem(LOCAL_KEYS.user);
    this.localUser.next(null);
  }

  async updateUser(patch: Partial<Pick<SocialUser, 'displayName' | 'photoURL' | 'bio'>>): Promise<void> {
    const current = this.currentLocalUser();
    if (!current) throw new Error(this.i18n.translate('Inicia sesión antes de editar tu perfil.'));
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
        emailVerified: user.emailVerified !== false,
        providers: Array.isArray(user.providers) ? user.providers.filter((item): item is string => typeof item === 'string') : ['password'],
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

  private ensureFirebaseProfileInitialized(
    firebaseUser: FirebaseAuthUser,
    profile: Record<string, unknown> | undefined,
    privateProfile: Record<string, unknown> | undefined,
    publicProfileRef: ReturnType<typeof doc>,
    privateProfileRef: ReturnType<typeof doc>,
  ): void {
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
    if (!writes.length) return;
    void Promise.all(writes).catch((error: unknown) =>
      console.error('No se pudo inicializar el perfil de usuario.', error),
    );
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
      emailVerified: firebaseUser.emailVerified,
      providers: firebaseUser.providerData.map((provider) => provider.providerId),
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
