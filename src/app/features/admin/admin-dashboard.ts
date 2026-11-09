import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BehaviorSubject, Observable, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { ContentReport, Post3D, ReportStatus, UserProfile, UserRole } from '../../core/models/social.models';
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
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  readonly vm$: Observable<{
    user: UserProfile | null;
    users: UserProfile[];
    posts: Post3D[];
    reports: ContentReport[];
  } | null> = combineLatest([this.auth.user$, this.refresh$]).pipe(
    switchMap(([user]) =>
      combineLatest([
        user?.role === 'admin' ? this.social.adminUsers$ : of([] as UserProfile[]),
        this.social.allPosts$,
        this.social.reports$,
      ]).pipe(
        map(([users, posts, reports]) => ({ user, users, posts, reports })),
        startWith(null),
      ),
    ),
  );

  readonly stats$ = this.vm$.pipe(
    map((vm) => {
      if (!vm) return null;
      const users = vm.users;
      const posts = vm.posts;
      const reports = vm.reports ?? [];
      return {
        totalUsers: users.length,
        activeUsers: users.filter((u) => !u.isBanned).length,
        suspendedUsers: users.filter((u) => u.isBanned).length,
        adminUsers: users.filter((u) => u.role === 'admin').length,
        moderatorUsers: users.filter((u) => u.role === 'moderator').length,
        totalPosts: posts.length,
        publicPosts: posts.filter((p) => !p.isPrivate).length,
        privatePosts: posts.filter((p) => p.isPrivate).length,
        openReports: reports.filter((r) => r.status === 'open').length,
        totalLikes: posts.reduce((sum, p) => sum + (p.likesCount ?? p.likes), 0),
        totalViews: posts.reduce((sum, p) => sum + (p.viewsCount ?? 0), 0),
        totalRemixes: posts.reduce((sum, p) => sum + (p.remixCount ?? 0), 0),
      };
    }),
    startWith(null),
  );

  readonly roles: UserRole[] = ['user', 'moderator', 'admin'];
  tab: 'users' | 'content' = 'users';
  error = '';
  status = '';
  moderationOnly = false;
  postToDelete: Post3D | null = null;

  private readonly route = inject(ActivatedRoute);
  private readonly notifications = inject(NotificationService);

  refresh(): void {
    this.refresh$.next(undefined);
  }

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
      this.refresh();
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
      this.refresh();
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
      this.refresh();
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

  async resolveReport(report: ContentReport, status: Exclude<ReportStatus, 'open'>): Promise<void> {
    this.error = '';
    try {
      await this.social.resolveReport(report.id, status);
      this.refresh();
      this.notifications.success(
        status === 'resolved' ? 'Reporte marcado como resuelto.' : 'Reporte descartado.',
        'Reporte actualizado',
      );
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'No se pudo actualizar el reporte.';
      this.notifications.error(this.error);
    }
  }

  trackUser(_index: number, user: UserProfile): string {
    return user.uid;
  }

  trackPost(_index: number, post: Post3D): string {
    return post.id;
  }
}
