import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BehaviorSubject, Observable, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { ContentReport, CommunityQuestion, FeedbackMessage, FeedbackStatus, Post3D, ReportStatus, UserProfile, UserRole } from '../../core/models/social.models';
import { AuthService } from '../../core/services/auth';
import { CommunityService } from '../../core/services/community';
import { I18nService } from '../../core/services/i18n';
import { SocialService } from '../../core/services/social';
import { NotificationService } from '../../core/services/notifications';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';import { TranslatePipe } from '../../shared/pipes/translate.pipe';


@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    TranslatePipe,
    ShellHeaderComponent,
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
  readonly community = inject(CommunityService);
  mobileMenuOpen = false;
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  readonly vm$: Observable<{
    user: UserProfile | null;
    users: UserProfile[];
    posts: Post3D[];
    reports: ContentReport[];
    feedback: FeedbackMessage[];
    questions: CommunityQuestion[];
  } | null> = combineLatest([this.auth.user$, this.refresh$]).pipe(
    switchMap(([user]) =>
      combineLatest([
        user?.role === 'admin' ? this.social.adminUsers$ : of([] as UserProfile[]),
        this.social.allPosts$,
        this.social.reports$,
        this.community.feedback$,
        this.community.questions$,
      ]).pipe(
        map(([users, posts, reports, feedback, questions]) => ({
          user,
          users,
          posts,
          reports,
          feedback,
          questions,
        })),
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
      const feedback = vm.feedback ?? [];
      const questions = vm.questions ?? [];
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
        totalFeedback: feedback.length,
        newFeedback: feedback.filter((item) => item.status === 'new').length,
        totalQuestions: questions.length,
        openQuestions: questions.filter((item) => !item.resolved).length,
      };
    }),
    startWith(null),
  );

  readonly roles: UserRole[] = ['user', 'moderator', 'admin'];
  tab: 'users' | 'content' | 'feedback' | 'help' = 'users';
  error = '';
  status = '';
  moderationOnly = false;
  postToDelete: Post3D | null = null;

  private readonly route = inject(ActivatedRoute);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);

  refresh(): void {
    this.refresh$.next(undefined);
  }

  ngOnInit(): void {
    this.moderationOnly = this.route.snapshot.data['moderationOnly'] === true;
    if (this.moderationOnly) this.tab = 'content';
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
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
      this.status = this.i18n.translate('Rol actualizado para {name}.', { name: user.displayName });
      this.notifications.success(this.status, this.i18n.translate('Rol actualizado'));
    } catch (error) {
      this.error = error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el rol.');
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
          ? this.i18n.translate('Se restauró la cuenta de {name}.', { name: user.displayName })
          : this.i18n.translate('Se suspendió la cuenta de {name}.', { name: user.displayName }),
        user.isBanned ? this.i18n.translate('Cuenta restaurada') : this.i18n.translate('Cuenta suspendida'),
      );
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el estado de la cuenta.');
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
      this.status = this.i18n.translate('Se eliminó “{title}” y sus archivos.', { title: this.postToDelete.title });
      this.notifications.success(this.status, this.i18n.translate('Publicación eliminada'));
      this.postToDelete = null;
      dialog.close();
    } catch (error) {
      console.error('Falló la eliminación moderada del modelo.', error);
      this.error = error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar el modelo.');
      this.notifications.error(this.error, this.i18n.translate('No se pudo eliminar'));
    }
  }

  async resolveReport(report: ContentReport, status: Exclude<ReportStatus, 'open'>): Promise<void> {
    this.error = '';
    try {
      await this.social.resolveReport(report.id, status);
      this.refresh();
      this.notifications.success(
        status === 'resolved'
          ? this.i18n.translate('Reporte marcado como resuelto.')
          : this.i18n.translate('Reporte descartado.'),
        this.i18n.translate('Reporte actualizado'),
      );
    } catch (error) {
      this.error = error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el reporte.');
      this.notifications.error(this.error);
    }
  }

  async setFeedbackStatus(feedback: FeedbackMessage, status: FeedbackStatus): Promise<void> {
    this.error = '';
    try {
      await this.community.updateFeedbackStatus(feedback.id, status);
      this.refresh();
      this.notifications.success(
        this.i18n.translate('Estado del mensaje actualizado.'),
        this.i18n.translate('Feedback actualizado'),
      );
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el mensaje.');
      this.notifications.error(this.error);
    }
  }

  async deleteFeedback(feedback: FeedbackMessage): Promise<void> {
    if (
      typeof confirm === 'function' &&
      !confirm(this.i18n.translate('¿Eliminar este mensaje de feedback? Esta acción no se puede deshacer.'))
    ) {
      return;
    }
    this.error = '';
    try {
      await this.community.deleteFeedback(feedback.id);
      this.refresh();
      this.notifications.success(
        this.i18n.translate('Mensaje de feedback eliminado.'),
        this.i18n.translate('Feedback actualizado'),
      );
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar el mensaje.');
      this.notifications.error(this.error);
    }
  }

  async toggleQuestionPinned(question: CommunityQuestion): Promise<void> {
    this.error = '';
    try {
      await this.community.setQuestionPinned(question.id, !question.pinned);
      this.refresh();
      this.notifications.success(
        this.i18n.translate(question.pinned ? 'Pregunta desafijada.' : 'Pregunta fijada.'),
        this.i18n.translate('Pregunta actualizada'),
      );
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar la pregunta.');
      this.notifications.error(this.error);
    }
  }

  async toggleQuestionLocked(question: CommunityQuestion): Promise<void> {
    this.error = '';
    try {
      await this.community.setQuestionLocked(question.id, !question.locked);
      this.refresh();
      this.notifications.success(
        this.i18n.translate(
          question.locked ? 'La pregunta se desbloqueó.' : 'La pregunta se bloqueó.',
        ),
        this.i18n.translate('Pregunta actualizada'),
      );
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar la pregunta.');
      this.notifications.error(this.error);
    }
  }

  async toggleQuestionResolved(question: CommunityQuestion): Promise<void> {
    this.error = '';
    try {
      await this.community.setQuestionResolved(question.id, !question.resolved);
      this.refresh();
      this.notifications.success(
        this.i18n.translate(
          question.resolved ? 'La pregunta se reabrió.' : 'La pregunta se marcó como resuelta.',
        ),
        this.i18n.translate('Pregunta actualizada'),
      );
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar la pregunta.');
      this.notifications.error(this.error);
    }
  }

  async deleteQuestion(question: CommunityQuestion): Promise<void> {
    if (
      typeof confirm === 'function' &&
      !confirm(
        this.i18n.translate('¿Eliminar esta pregunta y todas sus respuestas? Esta acción no se puede deshacer.'),
      )
    ) {
      return;
    }
    this.error = '';
    try {
      await this.community.deleteQuestion(question);
      this.refresh();
      this.notifications.success(
        this.i18n.translate('Pregunta eliminada.'),
        this.i18n.translate('communityHelp.delete'),
      );
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar la pregunta.');
      this.notifications.error(this.error);
    }
  }

  trackUser(_index: number, user: UserProfile): string {
    return user.uid;
  }

  trackPost(_index: number, post: Post3D): string {
    return post.id;
  }

  trackFeedback(_index: number, feedback: FeedbackMessage): string {
    return feedback.id;
  }

  trackQuestion(_index: number, question: CommunityQuestion): string {
    return question.id;
  }
}
