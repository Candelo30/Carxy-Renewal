import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { Post3D, UserProfile, UserRole } from '../../core/models/social.models';
import { AuthService } from '../../core/services/auth';
import { SocialService } from '../../core/services/social';
import { NotificationService } from '../../core/services/notifications';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { AccountMenuComponent } from '../../shared/components/account-menu/account-menu';
import { ActivityNotificationsComponent } from '../../shared/components/activity-notifications/activity-notifications';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    AccountMenuComponent,
    ActivityNotificationsComponent,
    AsyncPipe,
    DatePipe,
    FormsModule,
    LoadingSpinner,
    RouterLink,
  ],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css',
})
export class AdminDashboardComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly social = inject(SocialService);
  readonly vm$: Observable<{
    user: UserProfile | null;
    users: UserProfile[];
    posts: Post3D[];
  } | null> = this.auth.user$.pipe(
    switchMap((user) =>
      combineLatest([
        user?.role === 'admin' ? this.social.adminUsers$ : of([] as UserProfile[]),
        this.social.allPosts$,
      ]).pipe(
        map(([users, posts]) => ({ user, users, posts })),
        startWith(null),
      ),
    ),
  );
  readonly roles: UserRole[] = ['user', 'moderator', 'admin'];
  tab: 'users' | 'content' = 'users';
  error = '';
  status = '';
  moderationOnly = false;
  postToDelete: Post3D | null = null;

  private readonly route = inject(ActivatedRoute);
  private readonly notifications = inject(NotificationService);

  ngOnInit(): void {
    this.moderationOnly = this.route.snapshot.data['moderationOnly'] === true;
    if (this.moderationOnly) this.tab = 'content';
  }

  async changeRole(
    user: UserProfile,
    event: Event,
    currentUser: UserProfile | null,
  ): Promise<void> {
    const role = (event.target as HTMLSelectElement).value as UserRole;
    if (!this.roles.includes(role) || user.uid === currentUser?.uid) return;
    this.error = '';
    this.status = '';
    try {
      await this.social.setUserRole(user.uid, role);
      this.status = `Rol actualizado para ${user.displayName}.`;
      this.notifications.success(this.status, 'Rol actualizado');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'No se pudo actualizar el rol.';
      this.notifications.error(this.error);
      (event.target as HTMLSelectElement).value = user.role;
    }
  }

  async toggleBan(user: UserProfile, currentUser: UserProfile | null): Promise<void> {
    if (user.uid === currentUser?.uid) return;
    this.error = '';
    try {
      await this.social.setUserBanned(user.uid, !user.isBanned);
      this.notifications.success(
        user.isBanned
          ? `Se restauró la cuenta de ${user.displayName}.`
          : `Se suspendió la cuenta de ${user.displayName}.`,
        user.isBanned ? 'Cuenta restaurada' : 'Cuenta suspendida',
      );
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'No se pudo actualizar el estado de la cuenta.';
      this.notifications.error(this.error);
    }
  }

  requestDelete(post: Post3D, dialog: HTMLDialogElement): void {
    this.postToDelete = post;
    dialog.showModal();
  }

  async confirmDelete(dialog: HTMLDialogElement): Promise<void> {
    if (!this.postToDelete) return;
    this.error = '';
    try {
      await this.social.deletePost(this.postToDelete);
      this.status = `Se eliminó “${this.postToDelete.title}” y sus archivos.`;
      this.notifications.success(this.status, 'Publicación eliminada');
      this.postToDelete = null;
      dialog.close();
    } catch (error) {
      console.error('Falló la eliminación moderada del modelo.', error);
      this.error = error instanceof Error ? error.message : 'No se pudo eliminar el modelo.';
      this.notifications.error(this.error, 'No se pudo eliminar');
    }
  }

  trackUser(_index: number, user: UserProfile): string {
    return user.uid;
  }

  trackPost(_index: number, post: Post3D): string {
    return post.id;
  }
}
