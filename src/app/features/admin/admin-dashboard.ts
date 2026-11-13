import { AsyncPipe, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BehaviorSubject, Observable, Subscription, catchError, combineLatest, firstValueFrom, map, of, shareReplay, startWith, switchMap } from 'rxjs';
import {
  ContentReport,
  CommunityQuestion,
  FeedbackMessage,
  FeedbackStatus,
  Post3D,
  ReportStatus,
  UserProfile,
  UserRole,
  HelpArticle,
  HelpArticleCategory,
  Project,
  ProjectMember,
  ProjectRole,
  UserActivity,
  AccountDeletionAudit,
  AdminAction,
  AdminActionKind,
} from '../../core/models/social.models';
import { AuthService } from '../../core/services/auth';
import { CommunityService } from '../../core/services/community';
import { I18nService } from '../../core/services/i18n';
import { SocialService } from '../../core/services/social';
import { NotificationService } from '../../core/services/notifications';
import { CollaborationService } from '../../core/services/collaboration';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

export type AdminTab =
  | 'dashboard'
  | 'users'
  | 'content'
  | 'reports'
  | 'feedback'
  | 'help'
  | 'projects'
  | 'helpArticles'
  | 'sistema'
  | 'auditoria';

interface ChartBar {
  label: string;
  value: number;
  pct: number;
  color: string;
}

const CATEGORY_LABELS: Record<HelpArticleCategory, string> = {
  'primeros-pasos': 'Primeros pasos',
  editor: 'Editor 3D',
  publicacion: 'Publicación',
  comunidad: 'Comunidad',
  colaboracion: 'Colaboración',
  cuenta: 'Cuenta y seguridad',
};

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
    NgIf,
    NgFor,
  ],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css',
})
export class AdminDashboardComponent {
  readonly auth = inject(AuthService);
  readonly social = inject(SocialService);
  readonly community = inject(CommunityService);
  readonly collaboration = inject(CollaborationService);
  readonly i18n = inject(I18nService);
  readonly notifications = inject(NotificationService);

  /**
   * Los listeners de Firestore de este panel se cancelan al destruir el
   * componente. Sin esto, cada `refresh()` y cada visita a `/admin` dejaba
   * activos 9 `collectionData` nuevos, y cada cancelación provocaba el
   * unlisten/relisten que dispara la carrera de target IDs del SDK.
   */
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Suscripción de la carga de datos actual (`loadData()`). Se cancela antes
   * de recargar y al destruir el componente.
   */
  private dataSub?: Subscription;

  readonly user$: Observable<UserProfile | null> = this.auth.user$;
  mobileMenuOpen = false;

  private readonly vmSubject = new BehaviorSubject<{
    user: UserProfile | null;
    users: UserProfile[];
    posts: Post3D[];
    reports: ContentReport[];
    feedback: FeedbackMessage[];
    questions: CommunityQuestion[];
    projects: Project[];
    helpArticles: HelpArticle[];
    activity: UserActivity[];
    audit: AccountDeletionAudit[];
    actions: AdminAction[];
  }>({
    user: null,
    users: [],
    posts: [],
    reports: [],
    feedback: [],
    questions: [],
    projects: [],
    helpArticles: [],
    activity: [],
    audit: [],
    actions: [],
  });

  readonly vm$ = this.vmSubject.asObservable();

  readonly roles: UserRole[] = ['user', 'moderator', 'admin'];
  readonly inactiveDeleteDays = this.social.INACTIVE_DELETE_DAYS;
  readonly inactiveUsers$ = this.social.inactiveUsers$;
  readonly adminActions$ = this.social.adminActions$;
  duplicateEmails: { email: string; uids: string[]; count: number }[] = [];
  readonly projectRoles: ProjectRole[] = ['owner', 'editor', 'viewer'];
  readonly helpCategories: HelpArticleCategory[] = [
    'primeros-pasos',
    'editor',
    'publicacion',
    'comunidad',
    'colaboracion',
    'cuenta',
  ];
  readonly feedbackStatuses: FeedbackStatus[] = ['new', 'reviewing', 'resolved'];

  error = '';
  status = '';
  moderationOnly = false;
  postToDelete: Post3D | null = null;
  articleToEdit: HelpArticle | null = null;
  private readonly searchQuery$ = new BehaviorSubject<string>('');

  selectedUsers = new Set<string>();
  selectedPosts = new Set<string>();

  private _tab: AdminTab = 'dashboard';
  selectedProjectId = '';
  projectMembers: ProjectMember[] = [];
  reportFilter: 'all' | 'open' | 'resolved' | 'dismissed' = 'all';

  articleBodyText = '';
  articleStepsText = '';
  articleTipText = '';
  newArticle: Partial<HelpArticle> & { id?: string } = this.emptyArticle();

  constructor(private readonly route: ActivatedRoute) {
    this.moderationOnly = this.route.snapshot.data['moderationOnly'] === true;
    if (this.moderationOnly) {
      this._tab = 'reports';
    }
    this.loadData();
    this.vm$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((vm) => {
      this.duplicateEmails = this.social.findDuplicateEmails(vm.users).map((d) => ({
        email: d.email,
        uids: d.uids,
        count: d.users.length,
      }));
    });
    // Los datos se mantienen reactivos mediante los observables de Firestore
    // (collectionData). El botón "Refrescar" permite actualización manual bajo demanda.
  }

  private emptyArticle(): Partial<HelpArticle> & { id?: string } {
    return {
      category: 'primeros-pasos',
      title: '',
      subtitle: '',
      icon: '📄',
      keywords: '',
      body: [],
      order: 0,
      isPublished: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private loadData(): void {
    // Cancela la carga anterior antes de crear los listeners nuevos. De lo
    // contrario cada `refresh()` añade 9 `collectionData` adicionales sin
    // cancelar los previos, y al desmontar el panel se cancelan todos a la
    // vez: ese unlisten/relisten masivo es justo lo que dispara la carrera de
    // target IDs del SDK (aserción interna `ca9`).
    this.dataSub?.unsubscribe();
    this.dataSub = this.auth.user$
      .pipe(
        // `switchMap` cancela el `combineLatest` anterior cuando `user$`
        // vuelve a emitir, de modo que no quedan listeners huérfanos.
        switchMap((user) => {
          const isAdmin = user?.role === 'admin';
          const isModerator = user?.role === 'moderator' || isAdmin;

          if (!isAdmin && !isModerator) {
            return of({
              user,
              users: [] as UserProfile[],
              posts: [] as Post3D[],
              reports: [] as ContentReport[],
              feedback: [] as FeedbackMessage[],
              questions: [] as CommunityQuestion[],
              projects: [] as Project[],
              helpArticles: [] as HelpArticle[],
              activity: [] as UserActivity[],
              audit: [] as AccountDeletionAudit[],
              actions: [] as AdminAction[],
            });
          }

          const users$ = (isAdmin ? this.social.adminUsers$ : of([] as UserProfile[])).pipe(
            catchError(() => of([] as UserProfile[])),
          );
          const posts$ = this.social.allPosts$.pipe(catchError(() => of([] as Post3D[])));
          const reports$ = this.social.reports$.pipe(catchError(() => of([] as ContentReport[])));
          const feedback$ = this.community.feedback$.pipe(catchError(() => of([] as FeedbackMessage[])));
          const questions$ = this.community.questions$.pipe(catchError(() => of([] as CommunityQuestion[])));
          const projects$ = (isAdmin ? this.collaboration.getAllProjects() : this.collaboration.getProjects()).pipe(
            catchError(() => of([] as Project[])),
          );
          const helpArticles$ = this.community.getHelpArticles().pipe(catchError(() => of([] as HelpArticle[])));
          const activity$ = (isAdmin ? this.social.userActivity$ : of([] as UserActivity[])).pipe(catchError(() => of([] as UserActivity[])));
          const audit$ = (isAdmin ? this.social.deletionAudit$ : of([] as AccountDeletionAudit[])).pipe(catchError(() => of([] as AccountDeletionAudit[])));
          const actions$ = (isAdmin ? this.social.adminActions$ : of([] as AdminAction[])).pipe(catchError(() => of([] as AdminAction[])));

          return combineLatest([users$, posts$, reports$, feedback$, questions$, projects$, helpArticles$, activity$, audit$, actions$]).pipe(
            map(([users, posts, reports, feedback, questions, projects, helpArticles, activity, audit, actions]) => ({
              user,
              users: users ?? [],
              posts: posts ?? [],
              reports: reports ?? [],
              feedback: feedback ?? [],
              questions: questions ?? [],
              projects: projects ?? [],
              helpArticles: helpArticles ?? [],
              activity: activity ?? [],
              audit: audit ?? [],
              actions: actions ?? [],
            })),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((vm) => {
        this.vmSubject.next(vm);
        if (this._tab === 'projects' && !this.selectedProjectId && vm.projects?.length) {
          this.selectProject(vm.projects[0].id);
        }
      });
  }

  readonly stats$ = this.vm$.pipe(
    map((vm) => {
      const users = vm.users ?? [];
      const posts = vm.posts ?? [];
      const reports = vm.reports ?? [];
      const feedback = vm.feedback ?? [];
      const questions = vm.questions ?? [];
      const projects = vm.projects ?? [];
      const helpArticles = vm.helpArticles ?? [];
      const activity = vm.activity ?? [];
      const audit = vm.audit ?? [];
      const DAY = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const lastSeenByUid = new Map<string, number>();
      for (const entry of activity) {
        const current = lastSeenByUid.get(entry.uid) ?? 0;
        if (entry.lastSeenAt > current) lastSeenByUid.set(entry.uid, entry.lastSeenAt);
      }
      const activeToday = users.filter((u) => now - (lastSeenByUid.get(u.uid) ?? 0) <= DAY).length;
      const active7d = users.filter((u) => now - (lastSeenByUid.get(u.uid) ?? 0) <= 7 * DAY).length;
      const active30d = users.filter((u) => now - (lastSeenByUid.get(u.uid) ?? 0) <= 30 * DAY).length;
      const inactive30d = users.filter((u) => now - (lastSeenByUid.get(u.uid) ?? 0) > 30 * DAY).length;
      return {
        totalUsers: users.length,
        activeUsers: users.filter((u) => !u.isBanned).length,
        suspendedUsers: users.filter((u) => u.isBanned).length,
        adminUsers: users.filter((u) => u.role === 'admin').length,
        moderatorUsers: users.filter((u) => u.role === 'moderator').length,
        activeToday: activeToday,
        active7d,
        active30d,
        inactive30d,
        deletedAudit: audit.length,
        totalPosts: posts.length,
        publicPosts: posts.filter((p) => !p.isPrivate).length,
        privatePosts: posts.filter((p) => p.isPrivate).length,
        openReports: reports.filter((r) => r.status === 'open').length,
        resolvedReports: reports.filter((r) => r.status === 'resolved').length,
        dismissedReports: reports.filter((r) => r.status === 'dismissed').length,
        totalLikes: posts.reduce((sum, p) => sum + (p.likesCount ?? p.likes ?? 0), 0),
        totalViews: posts.reduce((sum, p) => sum + (p.viewsCount ?? 0), 0),
        totalRemixes: posts.reduce((sum, p) => sum + (p.remixCount ?? 0), 0),
        totalFeedback: feedback.length,
        newFeedback: feedback.filter((item) => item.status === 'new').length,
        reviewingFeedback: feedback.filter((item) => item.status === 'reviewing').length,
        resolvedFeedback: feedback.filter((item) => item.status === 'resolved').length,
        totalQuestions: questions.length,
        openQuestions: questions.filter((item) => !item.resolved).length,
        resolvedQuestions: questions.filter((item) => item.resolved).length,
        totalProjects: projects.length,
        totalHelpArticles: helpArticles.length,
        publishedArticles: helpArticles.filter((a) => a.isPublished).length,
        unpublishedArticles: helpArticles.filter((a) => !a.isPublished).length,
      };
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly chartUsersByRole$ = this.vm$.pipe(
    map((vm) => this.toBars([
      { label: 'Usuarios', value: vm.users.filter((u) => u.role === 'user').length, color: '#60a5fa' },
      { label: 'Moderadores', value: vm.users.filter((u) => u.role === 'moderator').length, color: '#a78bfa' },
      { label: 'Admins', value: vm.users.filter((u) => u.role === 'admin').length, color: '#f59e0b' },
    ])),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly chartPostsVisibility$ = this.vm$.pipe(
    map((vm) => this.toBars([
      { label: 'Públicos', value: vm.posts.filter((p) => !p.isPrivate).length, color: '#34d399' },
      { label: 'Privados', value: vm.posts.filter((p) => p.isPrivate).length, color: '#f87171' },
    ])),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly chartReports$ = this.vm$.pipe(
    map((vm) => this.toBars([
      { label: 'Abiertos', value: vm.reports.filter((r) => r.status === 'open').length, color: '#f59e0b' },
      { label: 'Resueltos', value: vm.reports.filter((r) => r.status === 'resolved').length, color: '#34d399' },
      { label: 'Descartados', value: vm.reports.filter((r) => r.status === 'dismissed').length, color: '#94a3b8' },
    ])),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly chartFeedback$ = this.vm$.pipe(
    map((vm) => this.toBars([
      { label: 'Nuevos', value: vm.feedback.filter((f) => f.status === 'new').length, color: '#60a5fa' },
      { label: 'En revisión', value: vm.feedback.filter((f) => f.status === 'reviewing').length, color: '#f59e0b' },
      { label: 'Resueltos', value: vm.feedback.filter((f) => f.status === 'resolved').length, color: '#34d399' },
    ])),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly chartQuestions$ = this.vm$.pipe(
    map((vm) => this.toBars([
      { label: 'Abiertas', value: vm.questions.filter((q) => !q.resolved).length, color: '#60a5fa' },
      { label: 'Resueltas', value: vm.questions.filter((q) => q.resolved).length, color: '#34d399' },
      { label: 'Fijadas', value: vm.questions.filter((q) => q.pinned).length, color: '#f59e0b' },
    ])),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private toBars(items: { label: string; value: number; color: string }[]): ChartBar[] {
    const max = Math.max(1, ...items.map((i) => i.value));
    return items.map((i) => ({ ...i, pct: Math.round((i.value / max) * 100) }));
  }

  get tab(): AdminTab {
    return this._tab;
  }
  set tab(value: AdminTab) {
    this._tab = value;
  }

  get pageTitle(): string {
    const titles: Record<AdminTab, string> = {
      dashboard: this.i18n.translate('admin.dashboard'),
      users: this.i18n.translate('admin.users'),
      content: this.i18n.translate('admin.content'),
      reports: this.i18n.translate('admin.reports'),
      feedback: this.i18n.translate('admin.feedback'),
      help: this.i18n.translate('admin.questions'),
      projects: this.i18n.translate('admin.projects'),
      helpArticles: this.i18n.translate('admin.help'),
      sistema: this.i18n.translate('Sistema'),
      auditoria: this.i18n.translate('Auditoría'),
    };
    return titles[this._tab] ?? this.i18n.translate('admin.panelTitle');
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen = false;
  }

  refresh(): void {
    this.loadData();
    if (this.selectedProjectId) {
      this.selectProject(this.selectedProjectId);
    }
  }

  async purgeInactiveUsers(): Promise<void> {
    const currentUser = this.vmSubject.value.user;
    if (!currentUser || currentUser.role !== 'admin') return;
    const inactive = await firstValueFrom(this.inactiveUsers$);
    const count = inactive.length;
    if (!count) {
      this.notifications.info(
        this.i18n.translate('No hay cuentas inactivas desde hace más de {days} días.', { days: this.inactiveDeleteDays }),
        this.i18n.translate('Cuentas inactivas'),
      );
      return;
    }
    if (!confirm(this.i18n.translate('¿Eliminar {count} cuenta(s) sin actividad en más de {days} días? Esta acción es irreversible y borra también la cuenta de Firebase Auth.', { count, days: this.inactiveDeleteDays }))) return;
    try {
      const result = await this.social.deleteInactiveUsers(currentUser.uid);

      // También borra las cuentas de Firebase Auth (solo se puede desde el servidor)
      let authDeleted = 0;
      let authFailed = 0;
      for (const uid of result.deletedUids) {
        const ok = await this.social.deleteAuthUser(uid);
        if (ok) authDeleted++;
        else authFailed++;
      }

      this.refresh();
      this.notifications.success(
        this.i18n.translate('Se eliminaron {deleted} cuenta(s) inactivas.', { deleted: result.deleted }),
        this.i18n.translate('Limpieza de inactividad'),
      );
      void this.log('inactive_users_purged', 'system', `purge-${Date.now()}`, `Limpieza de inactividad: ${result.deleted} cuenta(s)`, `Firestore: ${result.deleted} eliminadas, ${result.skipped.length} omitidas; Auth: ${authDeleted} eliminadas, ${authFailed} fallidas`);
      if (authDeleted) {
        this.notifications.success(
          this.i18n.translate('Se borraron {deleted} cuenta(s) de Firebase Auth.', { deleted: authDeleted }),
          this.i18n.translate('Cuentas de Auth eliminadas'),
        );
      }
      if (result.skipped.length) {
        this.notifications.warning(
          this.i18n.translate('No se pudo eliminar {count} cuenta(s) de Firestore.', { count: result.skipped.length }),
          this.i18n.translate('Algunas cuentas no se pudieron eliminar'),
        );
      }
      if (authFailed) {
        this.notifications.warning(
          this.i18n.translate('No se pudo borrar {count} cuenta(s) de Firebase Auth. Hágalo desde Firebase Console.', { count: authFailed }),
          this.i18n.translate('Algunas cuentas de Auth no se pudieron borrar'),
        );
      }
    } catch (error) {
      this.notifications.error(
        this.i18n.firebaseError(error, 'No se pudo completar la limpieza de inactividad.'),
        this.i18n.translate('Error'),
      );
    }
  }

  setTab(tab: AdminTab): void {
    if (this.moderationOnly && !['dashboard', 'content', 'reports', 'feedback', 'help'].includes(tab)) {
      return;
    }
    this.tab = tab;
    this.selectedUsers.clear();
    this.selectedPosts.clear();
    this.closeMobileMenu();
    if (tab === 'projects') {
      const vm = this.vmSubject.value;
      if (vm.projects.length > 0 && !this.selectedProjectId) {
        this.selectProject(vm.projects[0].id);
      }
    }
  }

  async changeRole(user: UserProfile, event: Event, currentUser: UserProfile | null): Promise<void> {
    const role = (event.target as HTMLSelectElement).value as UserRole;
    if (!this.roles.includes(role) || user.uid === currentUser?.uid) return;
    try {
      await this.social.setUserRole(user.uid, role);
      this.refresh();
      this.notifications.success(
        this.i18n.translate('Rol actualizado para {name}.', { name: user.displayName }),
        this.i18n.translate('Rol actualizado'),
      );
      void this.log('role_changed', 'user', user.uid, user.displayName, `Rol: ${user.role} → ${role}`);
    } catch (error) {
      this.notifications.error(
        this.i18n.firebaseError(error, 'No se pudo actualizar el rol.'),
      );
      (event.target as HTMLSelectElement).value = user.role;
    }
  }

  async toggleBan(user: UserProfile, currentUser: UserProfile | null): Promise<void> {
    if (user.uid === currentUser?.uid) return;
    try {
      await this.social.setUserBanned(user.uid, !user.isBanned);
      this.refresh();
      this.notifications.success(
        user.isBanned
          ? this.i18n.translate('Se restauró la cuenta de {name}.', { name: user.displayName })
          : this.i18n.translate('Se suspendió la cuenta de {name}.', { name: user.displayName }),
      );
      void this.log(user.isBanned ? 'user_restored' : 'user_banned', 'user', user.uid, user.displayName, user.isBanned ? 'Restaurada' : 'Suspendida');
    } catch (error) {
      this.notifications.error(
        this.i18n.firebaseError(error, 'No se pudo actualizar el estado de la cuenta.'),
      );
    }
  }

  async togglePostVisibility(post: Post3D): Promise<void> {
    try {
      await this.social.setPostHidden(post, !post.isPrivate);
      this.refresh();
      this.notifications.success(
        post.isPrivate
          ? this.i18n.translate('Publicación visible para la comunidad.')
          : this.i18n.translate('Publicación marcada como privada.'),
      );
      void this.log('post_visibility_changed', 'post', post.id, post.title, post.isPrivate ? 'Pública' : 'Privada');
    } catch (error) {
      this.notifications.error(
        this.i18n.firebaseError(error, 'No se pudo actualizar la visibilidad.'),
      );
    }
  }

  getFilteredReports(reports: ContentReport[]): ContentReport[] {
    const list = reports ?? [];
    if (this.reportFilter === 'all') return list;
    return list.filter((r) => r.status === this.reportFilter);
  }

  async resolveReport(report: ContentReport, status: Exclude<ReportStatus, 'open'>): Promise<void> {
    try {
      await this.social.resolveReport(report.id, status);
      this.refresh();
      this.notifications.success(
        status === 'resolved' ? this.i18n.translate('Reporte resuelto.') : this.i18n.translate('Reporte descartado.'),
        this.i18n.translate('Reporte actualizado'),
      );
      void this.log(status === 'resolved' ? 'report_resolved' : 'report_dismissed', 'report', report.id, report.postTitle, `Motivo: ${report.reason}`);
    } catch (error) {
      this.notifications.error(
        this.i18n.firebaseError(error, 'No se pudo actualizar el reporte.'),
      );
    }
  }

  async setFeedbackStatus(feedback: FeedbackMessage, status: FeedbackStatus): Promise<void> {
    try {
      await this.community.updateFeedbackStatus(feedback.id, status);
      this.refresh();
      this.notifications.success(this.i18n.translate('Estado del mensaje actualizado.'));
      void this.log('feedback_status_changed', 'feedback', feedback.id, feedback.subject, `Estado: ${feedback.status} → ${status}`);
    } catch (error) {
      this.notifications.error(
        this.i18n.firebaseError(error, 'No se pudo actualizar el mensaje.'),
      );
    }
  }

  async deleteFeedback(feedback: FeedbackMessage): Promise<void> {
    if (typeof confirm === 'function' && !confirm(this.i18n.translate('¿Eliminar este mensaje de feedback?'))) return;
    try {
      await this.community.deleteFeedback(feedback.id);
      this.refresh();
      this.notifications.success(this.i18n.translate('Mensaje de feedback eliminado.'));
      void this.log('feedback_deleted', 'feedback', feedback.id, feedback.subject, `De: ${feedback.name}`);
    } catch (error) {
      this.notifications.error(
        this.i18n.firebaseError(error, 'No se pudo eliminar el mensaje.'),
      );
    }
  }

  async toggleQuestionPinned(question: CommunityQuestion): Promise<void> {
    try {
      await this.community.setQuestionPinned(question.id, !question.pinned);
      this.refresh();
      void this.log('question_pinned', 'question', question.id, question.title, question.pinned ? 'Desfijada' : 'Fijada');
    } catch (error) {
      this.notifications.error(this.i18n.firebaseError(error, 'No se pudo actualizar la pregunta.'));
    }
  }

  async toggleQuestionLocked(question: CommunityQuestion): Promise<void> {
    try {
      await this.community.setQuestionLocked(question.id, !question.locked);
      this.refresh();
      void this.log('question_locked', 'question', question.id, question.title, question.locked ? 'Desbloqueada' : 'Bloqueada');
    } catch (error) {
      this.notifications.error(this.i18n.firebaseError(error, 'No se pudo actualizar la pregunta.'));
    }
  }

  async toggleQuestionResolved(question: CommunityQuestion): Promise<void> {
    try {
      await this.community.setQuestionResolved(question.id, !question.resolved);
      this.refresh();
      void this.log('question_resolved', 'question', question.id, question.title, question.resolved ? 'Abierta' : 'Resuelta');
    } catch (error) {
      this.notifications.error(this.i18n.firebaseError(error, 'No se pudo actualizar la pregunta.'));
    }
  }

  async deleteQuestion(question: CommunityQuestion): Promise<void> {
    if (typeof confirm === 'function' && !confirm(this.i18n.translate('¿Eliminar esta pregunta y sus respuestas?'))) return;
    try {
      await this.community.deleteQuestion(question);
      this.refresh();
      this.notifications.success(this.i18n.translate('Pregunta eliminada.'));
      void this.log('question_deleted', 'question', question.id, question.title, '');
    } catch (error) {
      this.notifications.error(this.i18n.firebaseError(error, 'No se pudo eliminar la pregunta.'));
    }
  }

  requestDelete(post: Post3D): void {
    this.postToDelete = post;
  }

  cancelDelete(): void {
    this.postToDelete = null;
  }

  async confirmDelete(): Promise<void> {
    if (!this.postToDelete) return;
    try {
      await this.social.deletePost(this.postToDelete);
      this.notifications.success(
        this.i18n.translate('Se eliminó “{title}”.', { title: this.postToDelete.title }),
        this.i18n.translate('Publicación eliminada'),
      );
      void this.log('post_deleted', 'post', this.postToDelete.id, this.postToDelete.title, '');
      this.postToDelete = null;
      this.refresh();
    } catch (error) {
      this.notifications.error(
        this.i18n.firebaseError(error, 'No se pudo eliminar el modelo.'),
      );
    }
  }

  selectProject(projectId: string | null): void {
    this.selectedProjectId = projectId ?? '';
    if (this.selectedProjectId) {
      this.collaboration
        .getMembers(this.selectedProjectId)
        .pipe(catchError(() => of([] as ProjectMember[])))
        .subscribe((members) => {
          this.projectMembers = members;
        });
    } else {
      this.projectMembers = [];
    }
  }

  async onRoleChange(projectId: string, memberId: string, event: Event): Promise<void> {
    const value = (event.target as HTMLSelectElement).value as ProjectRole;
    try {
      await this.collaboration.updateMemberRole(projectId, memberId, value);
      this.notifications.success(this.i18n.translate('Rol actualizado.'));
      const project = this.vmSubject.value.projects.find((p) => p.id === projectId);
      const member = this.projectMembers.find((m) => m.id === memberId);
      void this.log('project_member_role_changed', 'project', projectId, project?.name ?? projectId, `${member?.userName ?? memberId} → ${value}`);
      this.selectProject(projectId);
    } catch (error) {
      this.notifications.error(this.i18n.firebaseError(error, 'No se pudo actualizar el rol.'));
    }
  }

  async removeMember(projectId: string, memberId: string): Promise<void> {
    if (!confirm(this.i18n.translate('¿Eliminar miembro del proyecto?'))) return;
    try {
      await this.collaboration.removeMember(projectId, memberId);
      this.notifications.success(this.i18n.translate('Miembro eliminado.'));
      const project = this.vmSubject.value.projects.find((p) => p.id === projectId);
      const member = this.projectMembers.find((m) => m.id === memberId);
      void this.log('project_member_removed', 'project', projectId, project?.name ?? projectId, member?.userName ?? memberId);
      this.selectProject(projectId);
    } catch (error) {
      this.notifications.error(this.i18n.firebaseError(error, 'No se pudo eliminar el miembro.'));
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    if (!confirm(this.i18n.translate('¿Eliminar proyecto? Esta acción no se puede deshacer.'))) return;
    try {
      const project = this.vmSubject.value.projects.find((p) => p.id === projectId);
      await this.collaboration.deleteProject(projectId);
      this.selectedProjectId = '';
      this.projectMembers = [];
      this.refresh();
      this.notifications.success(this.i18n.translate('Proyecto eliminado.'));
      void this.log('project_deleted', 'project', projectId, project?.name ?? projectId, '');
    } catch (error) {
      this.notifications.error(this.i18n.firebaseError(error, 'No se pudo eliminar el proyecto.'));
    }
  }

  isDeletedMember(member: ProjectMember): boolean {
    if (member.userName === 'Cuenta eliminada') return true;
    const vm = this.vmSubject.value;
    // Solo para admins (ven la lista completa de usuarios). Moderadores no la cargan.
    if (vm.user?.role !== 'admin') return false;
    if (!vm.users.length) return false;
    return !vm.users.some((user) => user.uid === member.userId);
  }

  activityFor(uid: string): UserActivity | null {
    return this.vmSubject.value.activity.find((entry) => entry.uid === uid) ?? null;
  }

  activityLabel(user: UserProfile): string {
    if (user.isBanned) return 'Suspendida';
    const entry = this.activityFor(user.uid);
    if (!entry) return 'Sin actividad';
    const DAY = 24 * 60 * 60 * 1000;
    const days = Math.floor((Date.now() - entry.lastSeenAt) / DAY);
    if (days <= 30) return days <= 1 ? 'Hoy' : `Hace ${days} días`;
    return `${days} días sin actividad`;
  }

  activityClass(user: UserProfile): 'active' | 'inactive' | 'suspended' | 'unknown' {
    if (user.isBanned) return 'suspended';
    const entry = this.activityFor(user.uid);
    if (!entry) return 'unknown';
    const DAY = 24 * 60 * 60 * 1000;
    return Date.now() - entry.lastSeenAt <= 30 * DAY ? 'active' : 'inactive';
  }

  get deletionAudit(): AccountDeletionAudit[] {
    return [...(this.vmSubject.value.audit ?? [])].sort((a, b) => b.deletedAt - a.deletedAt);
  }

  trackUser(_index: number, user: UserProfile): string { return user.uid; }
  trackAudit(_index: number, item: AccountDeletionAudit): string { return item.id; }
  trackPost(_index: number, post: Post3D): string { return post.id; }
  trackFeedback(_index: number, feedback: FeedbackMessage): string { return feedback.id; }
  trackQuestion(_index: number, question: CommunityQuestion): string { return question.id; }
  trackProject(_index: number, project: Project): string { return project.id; }
  trackMember(_index: number, member: ProjectMember): string { return member.id; }
  trackArticle(_index: number, article: HelpArticle): string { return article.id; }
  trackReport(_index: number, report: ContentReport): string { return report.id; }
  trackAction(_index: number, action: AdminAction): string { return action.id; }
  trackBar(_index: number, bar: ChartBar): string { return bar.label; }

  get isDashboard(): boolean { return this._tab === 'dashboard'; }
  get isUsers(): boolean { return this._tab === 'users'; }
  get isContent(): boolean { return this._tab === 'content'; }
  get isFeedback(): boolean { return this._tab === 'feedback'; }
  get isHelp(): boolean { return this._tab === 'help'; }
  get isProjects(): boolean { return this._tab === 'projects'; }
  get isReports(): boolean { return this._tab === 'reports'; }
  get isHelpArticles(): boolean { return this._tab === 'helpArticles'; }
  get isSistema(): boolean { return this._tab === 'sistema'; }
  get isAuditoria(): boolean { return this._tab === 'auditoria'; }

  openReportsCount(reports: ContentReport[]): number {
    return (reports ?? []).filter((report) => report.status === 'open').length;
  }

  newFeedbackCount(feedback: FeedbackMessage[]): number {
    return (feedback ?? []).filter((item) => item.status === 'new').length;
  }

  openQuestionsCount(questions: CommunityQuestion[]): number {
    return (questions ?? []).filter((question) => !question.resolved).length;
  }

  resetNewArticle(): void {
    this.articleToEdit = null;
    this.articleBodyText = '';
    this.articleStepsText = '';
    this.articleTipText = '';
    this.newArticle = this.emptyArticle();
  }

  editHelpArticle(article: HelpArticle): void {
    this.articleToEdit = article;
    this.articleBodyText = Array.isArray(article.body) ? article.body.join('\n\n') : String(article.body || '');
    this.articleStepsText = Array.isArray(article.steps) ? article.steps.join('\n') : '';
    this.articleTipText = article.tip || '';
    this.newArticle = {
      id: article.id,
      category: article.category,
      title: article.title,
      subtitle: article.subtitle,
      icon: article.icon || '📄',
      keywords: article.keywords || '',
      body: Array.isArray(article.body) ? article.body : [String(article.body || '')],
      steps: article.steps,
      tip: article.tip,
      order: article.order ?? 0,
      isPublished: article.isPublished !== false,
      createdAt: article.createdAt,
      updatedAt: Date.now(),
    };
  }

  async saveHelpArticle(): Promise<void> {
    if (!this.newArticle.title?.trim()) {
      this.notifications.error(this.i18n.translate('El título del artículo es obligatorio.'));
      return;
    }
    const paragraphs = this.articleBodyText
      .split(/\n\s*\n|\r?\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const steps = this.articleStepsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const tip = this.articleTipText.trim();
    const articleData: Partial<HelpArticle> & { id?: string } = {
      ...this.newArticle,
      title: this.newArticle.title.trim(),
      subtitle: this.newArticle.subtitle?.trim() || '',
      icon: (this.newArticle.icon || '📄').trim() || '📄',
      keywords: (this.newArticle.keywords || '').trim(),
      body: paragraphs.length > 0 ? paragraphs : [this.newArticle.title.trim()],
      order: Number(this.newArticle.order ?? 0),
      isPublished: this.newArticle.isPublished !== false,
      updatedAt: Date.now(),
    };
    if (steps.length) articleData.steps = steps;
    else delete (articleData as any).steps;
    if (tip) articleData.tip = tip;
    else delete (articleData as any).tip;

    try {
      if (articleData.id) {
        await this.community.updateHelpArticle(articleData as HelpArticle);
        this.notifications.success(this.i18n.translate('Artículo actualizado.'));
        void this.log('help_article_updated', 'help-article', articleData.id, articleData.title ?? '', '');
      } else {
        await this.community.createHelpArticle({ ...articleData, createdAt: Date.now() } as Omit<HelpArticle, 'id'>);
        this.notifications.success(this.i18n.translate('Artículo creado correctamente.'));
        void this.log('help_article_created', 'help-article', articleData.title ?? 'unknown', articleData.title ?? '', '');
      }
      this.resetNewArticle();
      this.refresh();
    } catch (error) {
      this.notifications.error(this.i18n.firebaseError(error, 'No se pudo guardar el artículo.'));
    }
  }

  async deleteHelpArticle(id: string): Promise<void> {
    if (!confirm(this.i18n.translate('¿Eliminar artículo?'))) return;
    try {
      const article = this.vmSubject.value.helpArticles.find((a) => a.id === id);
      await this.community.deleteHelpArticle(id);
      if (this.newArticle.id === id) this.resetNewArticle();
      this.refresh();
      this.notifications.success(this.i18n.translate('Artículo eliminado.'));
      void this.log('help_article_deleted', 'help-article', id, article?.title ?? id, '');
    } catch (error) {
      this.notifications.error(this.i18n.firebaseError(error, 'No se pudo eliminar el artículo.'));
    }
  }

  async toggleArticlePublish(article: HelpArticle): Promise<void> {
    try {
      await this.community.updateHelpArticle({ ...article, isPublished: !article.isPublished, updatedAt: Date.now() });
      this.refresh();
      this.notifications.success(article.isPublished ? this.i18n.translate('Artículo despublicado.') : this.i18n.translate('Artículo publicado.'));
      void this.log('help_article_published_toggled', 'help-article', article.id, article.title, article.isPublished ? 'Despublicado' : 'Publicado');
    } catch (error) {
      this.notifications.error(this.i18n.firebaseError(error, 'No se pudo actualizar el artículo.'));
    }
  }

  getCategoryIcon(category: HelpArticleCategory): string {
    const icons: Record<HelpArticleCategory, string> = {
      'primeros-pasos': '🚀', editor: '🧊', publicacion: '📤', comunidad: '🌐', colaboracion: '🤝', cuenta: '🛡',
    };
    return icons[category] || '📄';
  }

  getCategoryLabel(category: HelpArticleCategory): string {
    const labels: Record<HelpArticleCategory, string> = {
      'primeros-pasos': this.i18n.translate('guide.title').includes('Guía') ? 'Primeros pasos' : this.i18n.translate('help.all'),
      editor: 'Editor 3D',
      publicacion: this.i18n.translate('nav.publish'),
      comunidad: this.i18n.translate('nav.community'),
      colaboracion: this.i18n.translate('colaboracion'),
      cuenta: this.i18n.translate('nav.accountSecurity'),
    };
    // Fallback to stored labels if translation doesn't give good result
    const translated = labels[category];
    if (translated && translated !== category) return translated;
    return CATEGORY_LABELS[category] || category;
  }

  reportStatusLabel(report: ContentReport): string {
    if (report.status === 'resolved') return 'admin.status.resolved';
    if (report.status === 'dismissed') return 'admin.status.dismissed';
    return 'admin.status.new';
  }

  set searchQuery(value: string) { this.searchQuery$.next(value); }
  get searchQuery(): string { return this.searchQuery$.value; }

  activityFilter: 'all' | 'active' | 'inactive' | 'suspended' = 'all';
  private readonly activityFilter$ = new BehaviorSubject<'all' | 'active' | 'inactive' | 'suspended'>('all');

  get activityFilterValue(): 'all' | 'active' | 'inactive' | 'suspended' { return this.activityFilter$.value; }
  set activityFilterValue(value: 'all' | 'active' | 'inactive' | 'suspended') { this.activityFilter = value; this.activityFilter$.next(value); }

  readonly filteredUsers$ = combineLatest([this.vm$, this.searchQuery$, this.activityFilter$]).pipe(
    map(([vm, q, filter]) => {
      let list = vm.users;
      if (filter === 'suspended') {
        list = list.filter((u) => u.isBanned);
      } else if (filter === 'active') {
        const now = Date.now();
        const DAY = 24 * 60 * 60 * 1000;
        const lastSeenByUid = new Map<string, number>();
        for (const entry of (vm.activity ?? [])) lastSeenByUid.set(entry.uid, Math.max(lastSeenByUid.get(entry.uid) ?? 0, entry.lastSeenAt));
        list = list.filter((u) => now - (lastSeenByUid.get(u.uid) ?? 0) <= 30 * DAY && !u.isBanned);
      } else if (filter === 'inactive') {
        const now = Date.now();
        const DAY = 24 * 60 * 60 * 1000;
        const lastSeenByUid = new Map<string, number>();
        for (const entry of (vm.activity ?? [])) lastSeenByUid.set(entry.uid, Math.max(lastSeenByUid.get(entry.uid) ?? 0, entry.lastSeenAt));
        list = list.filter((u) => now - (lastSeenByUid.get(u.uid) ?? 0) > 30 * DAY);
      }
      if (!q) return list;
      const query = q.toLowerCase();
      return list.filter((u) =>
        u.displayName.toLowerCase().includes(query) || u.email.toLowerCase().includes(query) || u.uid.toLowerCase().includes(query),
      );
    }),
    startWith([] as UserProfile[]),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly filteredPosts$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.posts;
      const query = q.toLowerCase();
      return vm.posts.filter((p) =>
        p.title.toLowerCase().includes(query) || p.description.toLowerCase().includes(query) || p.author.displayName.toLowerCase().includes(query) || (p.authorId ?? '').toLowerCase().includes(query),
      );
    }),
    startWith([] as Post3D[]),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly filteredProjects$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.projects;
      const query = q.toLowerCase();
      return vm.projects.filter((p) => p.name.toLowerCase().includes(query) || (p.description || '').toLowerCase().includes(query) || p.id.toLowerCase().includes(query));
    }),
    startWith([] as Project[]),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly filteredFeedback$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.feedback;
      const query = q.toLowerCase();
      return vm.feedback.filter((f) => f.subject.toLowerCase().includes(query) || f.message.toLowerCase().includes(query) || f.name.toLowerCase().includes(query) || (f.email || '').toLowerCase().includes(query));
    }),
    startWith([] as FeedbackMessage[]),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly filteredQuestions$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.questions;
      const query = q.toLowerCase();
      return vm.questions.filter((item) => item.title.toLowerCase().includes(query) || item.body.toLowerCase().includes(query) || item.authorName.toLowerCase().includes(query) || (item.tags || []).some((t) => t.toLowerCase().includes(query)));
    }),
    startWith([] as CommunityQuestion[]),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private readonly helpArticleFilter$ = new BehaviorSubject<'all' | 'published' | 'draft'>('all');
  private readonly helpArticleCategoryFilter$ = new BehaviorSubject<'all' | HelpArticleCategory>('all');

  set helpArticleFilter(value: 'all' | 'published' | 'draft') { this.helpArticleFilter$.next(value); }
  get helpArticleFilter(): 'all' | 'published' | 'draft' { return this.helpArticleFilter$.value; }
  set helpArticleCategoryFilter(value: 'all' | HelpArticleCategory) { this.helpArticleCategoryFilter$.next(value); }
  get helpArticleCategoryFilter(): 'all' | HelpArticleCategory { return this.helpArticleCategoryFilter$.value; }

  readonly filteredArticles$ = combineLatest([
    this.vm$,
    this.searchQuery$,
    this.helpArticleFilter$,
    this.helpArticleCategoryFilter$,
  ]).pipe(
    map(([vm, q, status, category]) => {
      let list = vm.helpArticles ?? [];
      if (status === 'published') list = list.filter((a) => a.isPublished);
      if (status === 'draft') list = list.filter((a) => !a.isPublished);
      if (category !== 'all') list = list.filter((a) => a.category === category);
      if (!q) return list;
      const query = q.toLowerCase();
      return list.filter((a) =>
        (a.title || '').toLowerCase().includes(query) ||
        (a.subtitle || '').toLowerCase().includes(query) ||
        (a.keywords || '').toLowerCase().includes(query) ||
        (CATEGORY_LABELS[a.category] || a.category).toLowerCase().includes(query)
      );
    }),
    startWith([] as HelpArticle[]),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly filteredReports$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      let list = this.getFilteredReports(vm.reports);
      if (!q) return list;
      const query = q.toLowerCase();
      return list.filter((r) =>
        r.postTitle.toLowerCase().includes(query) || r.reporterName.toLowerCase().includes(query) || r.reason.toLowerCase().includes(query) || r.postId.toLowerCase().includes(query),
      );
    }),
    startWith([] as ContentReport[]),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  // ---------------------------------------------------------------------
  // Nuevas capacidades: auditoría, ordenación, CSV export, vista Sistema,
  // acciones masivas y campanita de moderación.
  // ---------------------------------------------------------------------

  readonly auditFilter$ = new BehaviorSubject<'all' | AdminActionKind>('all');
  private readonly sortVersion$ = new BehaviorSubject<number>(0);
  private readonly selectionVersion$ = new BehaviorSubject<number>(0);
  get auditFilter(): 'all' | AdminActionKind { return this.auditFilter$.value; }
  set auditFilter(value: 'all' | AdminActionKind) { this.auditFilter$.next(value); }
  readonly auditKinds: AdminActionKind[] = [
    'role_changed', 'user_banned', 'user_restored', 'post_deleted', 'post_visibility_changed',
    'report_resolved', 'report_dismissed', 'feedback_deleted', 'feedback_status_changed',
    'question_deleted', 'question_pinned', 'question_locked', 'question_resolved',
    'project_deleted', 'project_member_role_changed', 'project_member_removed',
    'help_article_created', 'help_article_updated', 'help_article_deleted',
    'help_article_published_toggled', 'inactive_users_purged',
  ];

  readonly filteredActions$ = combineLatest([this.vm$, this.auditFilter$]).pipe(
    map(([vm, filter]) => {
      let list = vm.actions ?? [];
      if (filter !== 'all') list = list.filter((a) => a.action === filter);
      return [...list].sort((a, b) => b.createdAt - a.createdAt);
    }),
    startWith([] as AdminAction[]),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private async log(action: AdminActionKind, targetType: AdminAction['targetType'], targetId: string, targetLabel: string, detail: string): Promise<void> {
    try {
      const currentUser = this.vmSubject.value.user;
      if (!currentUser) return;
      await this.social.logAdminAction({
        adminId: currentUser.uid,
        adminName: currentUser.displayName,
        action,
        targetType,
        targetId,
        targetLabel,
        detail,
      });
    } catch (error) {
      console.warn('No se pudo registrar la acción administrativa.', error);
    }
  }

  private currentUserUid(): string | null {
    return this.vmSubject.value.user?.uid ?? null;
  }

  readonly bulkToggleAllUsers$ = combineLatest([this.filteredUsers$, this.selectionVersion$]).pipe(
    map(([users]) => {
      const total = users.length;
      const selected = users.filter((u) => this.selectedUsers.has(u.uid)).length;
      return { total, selected, allSelected: total > 0 && selected === total };
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly bulkToggleAllPosts$ = combineLatest([this.filteredPosts$, this.selectionVersion$]).pipe(
    map(([posts]) => {
      const total = posts.length;
      const selected = posts.filter((p) => this.selectedPosts.has(p.id)).length;
      return { total, selected, allSelected: total > 0 && selected === total };
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  toggleBulkUser(uid: string): void {
    if (this.selectedUsers.has(uid)) this.selectedUsers.delete(uid);
    else this.selectedUsers.add(uid);
    this.selectionVersion$.next(this.selectionVersion$.value + 1);
  }

  toggleBulkPost(id: string): void {
    if (this.selectedPosts.has(id)) this.selectedPosts.delete(id);
    else this.selectedPosts.add(id);
    this.selectionVersion$.next(this.selectionVersion$.value + 1);
  }

  toggleBulkUsers(allSelected: boolean): void {
    this.filteredUsers$.subscribe((list) => {
      if (allSelected) {
        for (const u of list) this.selectedUsers.delete(u.uid);
      } else {
        for (const u of list) this.selectedUsers.add(u.uid);
      }
      this.selectionVersion$.next(this.selectionVersion$.value + 1);
    });
  }

  toggleBulkPosts(allSelected: boolean): void {
    this.filteredPosts$.subscribe((list) => {
      if (allSelected) {
        for (const p of list) this.selectedPosts.delete(p.id);
      } else {
        for (const p of list) this.selectedPosts.add(p.id);
      }
      this.selectionVersion$.next(this.selectionVersion$.value + 1);
    });
  }

  async bulkBanUsers(): Promise<void> {
    const currentUser = this.vmSubject.value.user;
    if (!currentUser) return;
    if (!confirm(this.i18n.translate('¿Suspender las {count} cuenta(s) seleccionadas?', { count: this.selectedUsers.size }))) return;
    let ok = 0;
    let failed = 0;
    for (const uid of Array.from(this.selectedUsers)) {
      if (uid === currentUser.uid) continue;
      try {
        const user = this.vmSubject.value.users.find((u) => u.uid === uid);
        if (!user || user.isBanned) { failed++; continue; }
        await this.social.setUserBanned(uid, true);
        this.selectedUsers.delete(uid);
        ok++;
      } catch {
        failed++;
      }
    }
    this.selectionVersion$.next(this.selectionVersion$.value + 1);
    this.refresh();
    await this.log('user_banned', 'bulk', `bulk-${Date.now()}`, `Suspender ${ok} cuenta(s)`, `ok=${ok} failed=${failed}`);
    this.notifications.success(this.i18n.translate('Suspendidas {count} cuenta(s).', { count: ok }), this.i18n.translate('Suspensión masiva'));
  }

  async bulkRestoreUsers(): Promise<void> {
    const currentUser = this.vmSubject.value.user;
    if (!currentUser) return;
    if (!confirm(this.i18n.translate('¿Restaurar las {count} cuenta(s) seleccionadas?', { count: this.selectedUsers.size }))) return;
    let ok = 0;
    let failed = 0;
    for (const uid of Array.from(this.selectedUsers)) {
      if (uid === currentUser.uid) continue;
      try {
        await this.social.setUserBanned(uid, false);
        this.selectedUsers.delete(uid);
        ok++;
      } catch {
        failed++;
      }
    }
    this.selectionVersion$.next(this.selectionVersion$.value + 1);
    this.refresh();
    await this.log('user_restored', 'bulk', `bulk-${Date.now()}`, `Restaurar ${ok} cuenta(s)`, `ok=${ok} failed=${failed}`);
    this.notifications.success(this.i18n.translate('Restauradas {count} cuenta(s).', { count: ok }), this.i18n.translate('Restauración masiva'));
  }

  async bulkDeletePosts(): Promise<void> {
    if (!this.selectedPosts.size) return;
    if (!confirm(this.i18n.translate('¿Eliminar las {count} publicación(es) seleccionadas?', { count: this.selectedPosts.size }))) return;
    let ok = 0;
    let failed = 0;
    for (const postId of Array.from(this.selectedPosts)) {
      try {
        const post = this.vmSubject.value.posts.find((p) => p.id === postId);
        if (!post) { failed++; continue; }
        await this.social.deletePost(post);
        this.selectedPosts.delete(postId);
        ok++;
      } catch {
        failed++;
      }
    }
    this.selectionVersion$.next(this.selectionVersion$.value + 1);
    this.refresh();
    await this.log('post_deleted', 'bulk', `bulk-${Date.now()}`, `Eliminar ${ok} publicación(es)`, `ok=${ok} failed=${failed}`);
    this.notifications.success(this.i18n.translate('Eliminadas {count} publicación(es).', { count: ok }), this.i18n.translate('Borrado masivo'));
  }

  async bulkSetPostVisibility(hidden: boolean): Promise<void> {
    const selected = Array.from(this.selectedPosts);
    if (!selected.length) return;
    if (!confirm(this.i18n.translate(hidden ? '¿Ocultar las {count} publicación(es)?' : '¿Hacer públicas las {count} publicación(es)?', { count: selected.length }))) return;
    let ok = 0;
    let failed = 0;
    for (const postId of selected) {
      try {
        const post = this.vmSubject.value.posts.find((p) => p.id === postId);
        if (!post) { failed++; continue; }
        await this.social.setPostHidden(post, hidden);
        ok++;
      } catch {
        failed++;
      }
    }
    this.refresh();
    await this.log('post_visibility_changed', 'bulk', `bulk-${Date.now()}`, `Visibilidad ${hidden ? 'oculta' : 'pública'} para ${ok} publicación(es)`, `ok=${ok} failed=${failed}`);
    this.notifications.success(this.i18n.translate(hidden ? 'Ocultadas {count} publicación(es).' : 'Publicadas {count} publicación(es).', { count: ok }), this.i18n.translate('Visibilidad masiva'));
  }

  userSortKey: 'displayName' | 'createdAt' | 'lastSeen' | 'role' = 'createdAt';
  userSortDir: 'asc' | 'desc' = 'desc';
  postSortKey: 'title' | 'createdAt' | 'viewsCount' | 'likesCount' | 'remixCount' = 'createdAt';
  postSortDir: 'asc' | 'desc' = 'desc';
  reportSortKey: 'createdAt' | 'status' | 'reason' = 'createdAt';
  reportSortDir: 'asc' | 'desc' = 'desc';

  toggleUserSort(key: typeof this.userSortKey): void {
    if (this.userSortKey === key) this.userSortDir = this.userSortDir === 'asc' ? 'desc' : 'asc';
    else { this.userSortKey = key; this.userSortDir = 'desc'; }
    this.sortVersion$.next(this.sortVersion$.value + 1);
  }

  togglePostSort(key: typeof this.postSortKey): void {
    if (this.postSortKey === key) this.postSortDir = this.postSortDir === 'asc' ? 'desc' : 'asc';
    else { this.postSortKey = key; this.postSortDir = 'desc'; }
    this.sortVersion$.next(this.sortVersion$.value + 1);
  }

  toggleReportSort(key: typeof this.reportSortKey): void {
    if (this.reportSortKey === key) this.reportSortDir = this.reportSortDir === 'asc' ? 'desc' : 'asc';
    else { this.reportSortKey = key; this.reportSortDir = 'desc'; }
    this.sortVersion$.next(this.sortVersion$.value + 1);
  }

  readonly sortedUsers$ = combineLatest([this.filteredUsers$, this.sortVersion$]).pipe(
    map(([users]) => {
      const list = [...users];
      const dir = this.userSortDir === 'asc' ? 1 : -1;
      const key = this.userSortKey;
      const act = new Map<string, number>();
      for (const entry of this.vmSubject.value.activity ?? []) act.set(entry.uid, entry.lastSeenAt);
      if (key === 'displayName') list.sort((a, b) => dir * a.displayName.localeCompare(b.displayName));
      else if (key === 'createdAt') list.sort((a, b) => dir * ((a.createdAt ?? 0) - (b.createdAt ?? 0)));
      else if (key === 'role') list.sort((a, b) => dir * a.role.localeCompare(b.role));
      else if (key === 'lastSeen') list.sort((a, b) => dir * ((act.get(a.uid) ?? 0) - (act.get(b.uid) ?? 0)));
      return list;
    }),
    startWith([] as UserProfile[]),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly sortedPosts$ = combineLatest([this.filteredPosts$, this.sortVersion$]).pipe(
    map(([posts]) => {
      const list = [...posts];
      const dir = this.postSortDir === 'asc' ? 1 : -1;
      const key = this.postSortKey;
      if (key === 'title') list.sort((a, b) => dir * a.title.localeCompare(b.title));
      else if (key === 'createdAt') list.sort((a, b) => dir * (a.createdAt - b.createdAt));
      else if (key === 'viewsCount') list.sort((a, b) => dir * ((a.viewsCount ?? 0) - (b.viewsCount ?? 0)));
      else if (key === 'likesCount') list.sort((a, b) => dir * ((a.likesCount ?? a.likes ?? 0) - (b.likesCount ?? b.likes ?? 0)));
      else if (key === 'remixCount') list.sort((a, b) => dir * ((a.remixCount ?? 0) - (b.remixCount ?? 0)));
      return list;
    }),
    startWith([] as Post3D[]),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly sortedReports$ = combineLatest([this.filteredReports$, this.sortVersion$]).pipe(
    map(([reports]) => {
      const list = [...reports];
      const dir = this.reportSortDir === 'asc' ? 1 : -1;
      const key = this.reportSortKey;
      if (key === 'createdAt') list.sort((a, b) => dir * (a.createdAt - b.createdAt));
      else if (key === 'status') list.sort((a, b) => dir * a.status.localeCompare(b.status));
      else if (key === 'reason') list.sort((a, b) => dir * a.reason.localeCompare(b.reason));
      return list;
    }),
    startWith([] as ContentReport[]),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private toCsvRow(v: string | number | null | undefined): string {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  private toCsv(rows: string[][]): string {
    return rows.map((row) => row.map((v) => this.toCsvRow(v)).join(',')).join('\r\n');
  }

  private downloadCsv(filename: string, rows: string[][]): void {
    if (typeof document === 'undefined') return;
    const bom = '\ufeff';
    const blob = new Blob([bom + this.toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  exportUsersCsv(): void {
    const users = this.vmSubject.value.users;
    if (!users.length) return;
    const rows: string[][] = [['uid', 'displayName', 'email', 'role', 'isBanned', 'createdAt']];
    for (const u of users) {
      rows.push([u.uid, u.displayName, u.email ?? '', u.role, String(u.isBanned), String(u.createdAt ?? '')]);
    }
    this.downloadCsv(`carxy-usuarios-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    void this.log('inactive_users_purged', 'system', `export-${Date.now()}`, 'Exportación CSV de usuarios', `CSV export de ${users.length} usuario(s)`);
  }

  exportPostsCsv(): void {
    const posts = this.vmSubject.value.posts;
    if (!posts.length) return;
    const rows: string[][] = [['id', 'title', 'author', 'visibility', 'likes', 'views', 'remixes', 'createdAt']];
    for (const p of posts) {
      rows.push([p.id, p.title, p.author?.displayName ?? '', p.isPrivate ? 'private' : 'public', String(p.likesCount ?? p.likes ?? 0), String(p.viewsCount ?? 0), String(p.remixCount ?? 0), String(p.createdAt)]);
    }
    this.downloadCsv(`carxy-modelos-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    void this.log('inactive_users_purged', 'system', `export-${Date.now()}`, 'Exportación CSV de publicaciones', `CSV export de ${posts.length} publicación(es)`);
  }

  exportReportsCsv(): void {
    const reports = this.vmSubject.value.reports;
    if (!reports.length) return;
    const rows: string[][] = [['id', 'postTitle', 'reporter', 'reason', 'status', 'createdAt']];
    for (const r of reports) {
      rows.push([r.id, r.postTitle, r.reporterName, r.reason, r.status, String(r.createdAt)]);
    }
    this.downloadCsv(`carxy-reportes-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    void this.log('inactive_users_purged', 'system', `export-${Date.now()}`, 'Exportación CSV de reportes', `CSV export de ${reports.length} reporte(s)`);
  }

  exportFeedbackCsv(): void {
    const feedback = this.vmSubject.value.feedback;
    if (!feedback.length) return;
    const rows: string[][] = [['id', 'type', 'name', 'email', 'subject', 'status', 'createdAt']];
    for (const f of feedback) {
      rows.push([f.id, f.type, f.name, f.email ?? '', f.subject, f.status, String(f.createdAt)]);
    }
    this.downloadCsv(`carxy-feedback-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    void this.log('inactive_users_purged', 'system', `export-${Date.now()}`, 'Exportación CSV de feedback', `CSV export de ${feedback.length} mensaje(s)`);
  }

  exportQuestionsCsv(): void {
    const questions = this.vmSubject.value.questions;
    if (!questions.length) return;
    const rows: string[][] = [['id', 'title', 'author', 'resolved', 'pinned', 'locked', 'createdAt']];
    for (const q of questions) {
      rows.push([q.id, q.title, q.authorName ?? '', String(q.resolved), String(q.pinned), String(q.locked), String(q.createdAt)]);
    }
    this.downloadCsv(`carxy-preguntas-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    void this.log('inactive_users_purged', 'system', `export-${Date.now()}`, 'Exportación CSV de preguntas', `CSV export de ${questions.length} pregunta(s)`);
  }

  get pendingModeration(): number {
    const vm = this.vmSubject.value;
    const openReports = (vm.reports ?? []).filter((r) => r.status === 'open').length;
    const newFeedback = (vm.feedback ?? []).filter((f) => f.status === 'new').length;
    const openQuestions = (vm.questions ?? []).filter((q) => !q.resolved).length;
    return openReports + newFeedback + openQuestions + this.duplicateEmails.length;
  }

  get topAuthorsByPosts(): Array<{ name: string; posts: number }> {
    const counts = new Map<string, { name: string; posts: number }>();
    for (const p of this.vmSubject.value.posts) {
      const id = p.author?.uid ?? 'unknown';
      const name = p.author?.displayName ?? 'Cuenta eliminada';
      const entry = counts.get(id) ?? { name, posts: 0 };
      entry.posts++;
      counts.set(id, entry);
    }
    return [...counts.values()].sort((a, b) => b.posts - a.posts).slice(0, 8);
  }

  get topLikedPosts(): Array<{ title: string; likes: number; author: string }> {
    return [...(this.vmSubject.value.posts ?? [])]
      .sort((a, b) => (b.likesCount ?? b.likes ?? 0) - (a.likesCount ?? a.likes ?? 0))
      .slice(0, 6)
      .map((p) => ({ title: p.title, likes: p.likesCount ?? p.likes ?? 0, author: p.author?.displayName ?? '' }));
  }

  get registrationTrend(): Array<{ label: string; value: number; color: string; pct: number }> {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const buckets = new Array(14).fill(0);
    const fmt = new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' });
    const labels: string[] = [];
    for (let i = 13; i >= 0; i--) { labels.push(fmt.format(new Date(now - i * DAY))); }
    for (const u of this.vmSubject.value.users) {
      const age = now - (u.createdAt ?? 0);
      const days = Math.floor(age / DAY);
      if (days >= 0 && days < 14) buckets[13 - days]++;
    }
    const max = Math.max(1, ...buckets);
    return buckets.map((v, i) => ({
      label: labels[i],
      value: v,
      color: i === 13 ? '#a78bfa' : '#60a5fa',
      pct: Math.max(5, Math.round((v / max) * 100)),
    }));
  }

  getAuditLabel(action: AdminActionKind): string {
    const map: Record<AdminActionKind, string> = {
      role_changed: 'Rol actualizado',
      user_banned: 'Usuario suspendido',
      user_restored: 'Usuario restaurado',
      post_deleted: 'Publicación eliminada',
      post_visibility_changed: 'Visibilidad cambiada',
      report_resolved: 'Reporte resuelto',
      report_dismissed: 'Reporte descartado',
      feedback_deleted: 'Feedback eliminado',
      feedback_status_changed: 'Estado de feedback',
      question_deleted: 'Pregunta eliminada',
      question_pinned: 'Pregunta fijada',
      question_locked: 'Pregunta bloqueada',
      question_resolved: 'Pregunta resuelta',
      project_deleted: 'Proyecto eliminado',
      project_member_role_changed: 'Rol de miembro',
      project_member_removed: 'Miembro eliminado',
      help_article_created: 'Artículo creado',
      help_article_updated: 'Artículo actualizado',
      help_article_deleted: 'Artículo eliminado',
      help_article_published_toggled: 'Publicación alternada',
      inactive_users_purged: 'Limpieza / exportación',
    };
    return map[action] ?? action;
  }

  getAuditTargetType(targetType: AdminAction['targetType']): string {
    const map: Record<AdminAction['targetType'], string> = {
      user: 'Usuario',
      post: 'Publicación',
      report: 'Reporte',
      feedback: 'Feedback',
      question: 'Pregunta',
      project: 'Proyecto',
      'help-article': 'Artículo',
      bulk: 'Masivo',
      system: 'Sistema',
    };
    return map[targetType];
  }

  getAuditBadgeColor(action: AdminActionKind): string {
    if (action.startsWith('user_')) return 'badge-info';
    if (action.startsWith('post_')) return 'badge-warn';
    if (action.startsWith('report_')) return 'badge-warn';
    if (action.startsWith('feedback_')) return 'badge-info';
    if (action.startsWith('question_')) return 'badge-info';
    if (action.startsWith('project_')) return 'badge-danger';
    if (action.startsWith('help_article_')) return 'badge-success';
    if (action === 'inactive_users_purged') return 'badge-muted';
    return 'badge-muted';
  }

  private readonly _bellActive$ = new BehaviorSubject<boolean>(false);
  get bellActive(): boolean { return this._bellActive$.value; }
  toggleBell(): void { this._bellActive$.next(!this._bellActive$.value); }
  closeBell(): void { this._bellActive$.next(false); }
}
