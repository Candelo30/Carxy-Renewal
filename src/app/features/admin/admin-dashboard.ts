import { AsyncPipe, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of, startWith } from 'rxjs';
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
  'dashboard' | 'users' | 'content' | 'feedback' | 'help' | 'projects' | 'reports' | 'helpArticles';

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

  readonly user$: Observable<UserProfile | null> = this.auth.user$;
  mobileMenuOpen = false;
  readonly now = Date.now();
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  // VM único con todos los datos
  private readonly vmSubject = new BehaviorSubject<{
    user: UserProfile | null;
    users: UserProfile[];
    posts: Post3D[];
    reports: ContentReport[];
    feedback: FeedbackMessage[];
    questions: CommunityQuestion[];
    projects: Project[];
    members: ProjectMember[];
    helpArticles: HelpArticle[];
  }>({
    user: null,
    users: [],
    posts: [],
    reports: [],
    feedback: [],
    questions: [],
    projects: [],
    members: [],
    helpArticles: [],
  });

  readonly vm$ = this.vmSubject.asObservable();

  readonly roles: UserRole[] = ['user', 'moderator', 'admin'];
  readonly projectRoles: ProjectRole[] = ['owner', 'editor', 'viewer'];
  readonly helpCategories: HelpArticleCategory[] = [
    'primeros-pasos',
    'editor',
    'publicacion',
    'comunidad',
    'colaboracion',
    'cuenta',
  ];

  error = '';
  status = '';
  moderationOnly = false;
  postToDelete: Post3D | null = null;
  articleToEdit: HelpArticle | null = null;
  private readonly searchQuery$ = new BehaviorSubject<string>('');

  selectedUsers: Set<string> = new Set();
  selectedPosts: Set<string> = new Set();
  selectedArticles: Set<string> = new Set();

  private _tab: AdminTab = 'dashboard';
  selectedProjectId = '';
  projectMembers: ProjectMember[] = [];
  reportFilter: 'all' | 'open' | 'resolved' | 'dismissed' = 'all';

  articleBodyText = '';
  newArticle: Partial<HelpArticle> & { id?: string } = {
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

  statsValue: any = null;

  constructor(private readonly route: ActivatedRoute) {
    this.moderationOnly = this.route.snapshot.data['moderationOnly'] === true;
    if (this.moderationOnly) {
      this._tab = 'content';
    }

    this.loadData();
    this.stats$.subscribe((s) => (this.statsValue = s));
  }

  private loadData(): void {
    this.auth.user$.subscribe((user) => {
      const isAdmin = user?.role === 'admin';
      const isModerator = user?.role === 'moderator' || isAdmin;

      if (!isAdmin && !isModerator) {
        this.vmSubject.next({
          user,
          users: [],
          posts: [],
          reports: [],
          feedback: [],
          questions: [],
          projects: [],
          members: [],
          helpArticles: [],
        });
        return;
      }

      const users$ = (isAdmin ? this.social.adminUsers$ : of([] as UserProfile[])).pipe(
        catchError(() => of([] as UserProfile[])),
      );
      const posts$ = this.social.allPosts$.pipe(catchError(() => of([] as Post3D[])));
      const reports$ = this.social.reports$.pipe(catchError(() => of([] as ContentReport[])));
      const feedback$ = this.community.feedback$.pipe(
        catchError(() => of([] as FeedbackMessage[])),
      );
      const questions$ = this.community.questions$.pipe(
        catchError(() => of([] as CommunityQuestion[])),
      );
      const projects$ = (
        isAdmin ? this.collaboration.getAllProjects() : this.collaboration.getProjects()
      ).pipe(catchError(() => of([] as Project[])));
      const helpArticles$ = this.community
        .getHelpArticles()
        .pipe(catchError(() => of([] as HelpArticle[])));

      combineLatest([
        users$,
        posts$,
        reports$,
        feedback$,
        questions$,
        projects$,
        helpArticles$,
      ]).subscribe(([users, posts, reports, feedback, questions, projects, helpArticles]) => {
        this.vmSubject.next({
          user,
          users: users ?? [],
          posts: posts ?? [],
          reports: reports ?? [],
          feedback: feedback ?? [],
          questions: questions ?? [],
          projects: projects ?? [],
          members: [],
          helpArticles: helpArticles ?? [],
        });

        // Si estamos en la pestaña projects y aún no hay proyecto seleccionado, auto-seleccionar el primero
        if (
          this._tab === 'projects' &&
          !this.selectedProjectId &&
          projects &&
          projects.length > 0
        ) {
          this.selectProject(projects[0].id);
        }
      });
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
        totalLikes: posts.reduce((sum, p) => sum + (p.likesCount ?? p.likes ?? 0), 0),
        totalViews: posts.reduce((sum, p) => sum + (p.viewsCount ?? 0), 0),
        totalRemixes: posts.reduce((sum, p) => sum + (p.remixCount ?? 0), 0),
        totalFeedback: feedback.length,
        newFeedback: feedback.filter((item) => item.status === 'new').length,
        totalQuestions: questions.length,
        openQuestions: questions.filter((item) => !item.resolved).length,
        totalProjects: projects.length,
        totalHelpArticles: helpArticles.length,
        publishedArticles: helpArticles.filter((a) => a.isPublished).length,
        unpublishedArticles: helpArticles.filter((a) => !a.isPublished).length,
      };
    }),
  );

  get tab(): AdminTab {
    return this._tab;
  }
  set tab(value: AdminTab) {
    this._tab = value;
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

  refresh(): void {
    this.refresh$.next(undefined);
    this.loadData();
    if (this.selectedProjectId) {
      this.selectProject(this.selectedProjectId);
    }
  }

  setTab(tab: AdminTab): void {
    this.tab = tab;
    this.selectedUsers.clear();
    this.selectedPosts.clear();
    this.selectedArticles.clear();
    if (tab === 'projects') {
      const vm = this.vmSubject.value;
      if (vm.projects.length > 0 && !this.selectedProjectId) {
        this.selectProject(vm.projects[0].id);
      }
    }
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
      this.error =
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo actualizar el rol.');
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
        user.isBanned
          ? this.i18n.translate('Cuenta restaurada')
          : this.i18n.translate('Cuenta suspendida'),
      );
    } catch (error) {
      this.error =
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo actualizar el estado de la cuenta.');
      this.notifications.error(this.error);
    }
  }

  getFilteredReports(reports: ContentReport[]): ContentReport[] {
    const list = reports ?? [];
    if (this.reportFilter === 'all') return list;
    return list.filter((r) => r.status === this.reportFilter);
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
      this.error =
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo actualizar el reporte.');
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
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo actualizar el mensaje.');
      this.notifications.error(this.error);
    }
  }

  async deleteFeedback(feedback: FeedbackMessage): Promise<void> {
    if (
      typeof confirm === 'function' &&
      !confirm(
        this.i18n.translate(
          '¿Eliminar este mensaje de feedback? Esta acción no se puede deshacer.',
        ),
      )
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
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo eliminar el mensaje.');
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
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo actualizar la pregunta.');
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
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo actualizar la pregunta.');
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
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo actualizar la pregunta.');
      this.notifications.error(this.error);
    }
  }

  async deleteQuestion(question: CommunityQuestion): Promise<void> {
    if (
      typeof confirm === 'function' &&
      !confirm(
        this.i18n.translate(
          '¿Eliminar esta pregunta y todas sus respuestas? Esta acción no se puede deshacer.',
        ),
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
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo eliminar la pregunta.');
      this.notifications.error(this.error);
    }
  }

  requestDelete(post: Post3D, dialog?: HTMLDialogElement): void {
    this.postToDelete = post;
    if (dialog) {
      dialog.showModal();
    } else {
      if (confirm(this.i18n.translate('¿Eliminar publicación y archivos definitivamente?'))) {
        void this.confirmDelete();
      }
    }
  }

  async confirmDelete(dialog?: HTMLDialogElement): Promise<void> {
    if (!this.postToDelete) return;
    this.error = '';
    try {
      await this.social.deletePost(this.postToDelete);
      this.refresh();
      this.status = this.i18n.translate('Se eliminó “{title}” y sus archivos.', {
        title: this.postToDelete.title,
      });
      this.notifications.success(this.status, this.i18n.translate('Publicación eliminada'));
      this.postToDelete = null;
      if (dialog) {
        dialog.close();
      }
    } catch (error) {
      console.error('Falló la eliminación moderada del modelo.', error);
      this.error =
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo eliminar el modelo.');
      this.notifications.error(this.error, this.i18n.translate('No se pudo eliminar'));
    }
  }

  toggleUserSelection(uid: string): void {
    if (this.selectedUsers.has(uid)) {
      this.selectedUsers.delete(uid);
    } else {
      this.selectedUsers.add(uid);
    }
  }

  toggleAllUsers(allUsers: UserProfile[]): void {
    if (this.selectedUsers.size === allUsers.length && allUsers.length > 0) {
      this.selectedUsers.clear();
    } else {
      allUsers.forEach((u) => this.selectedUsers.add(u.uid));
    }
  }

  togglePostSelection(postId: string): void {
    if (this.selectedPosts.has(postId)) {
      this.selectedPosts.delete(postId);
    } else {
      this.selectedPosts.add(postId);
    }
  }

  async bulkDeleteUsers(): Promise<void> {
    if (
      !confirm(
        this.i18n.translate('¿Suspender usuarios seleccionados? Esta acción no se puede deshacer.'),
      )
    )
      return;
    this.error = '';
    try {
      for (const uid of this.selectedUsers) {
        await this.social.setUserBanned(uid, true);
      }
      this.selectedUsers.clear();
      this.refresh();
      this.notifications.success(this.i18n.translate('Usuarios suspendidos correctamente.'));
    } catch (error) {
      this.error =
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudieron suspender los usuarios.');
      this.notifications.error(this.error);
    }
  }

  async bulkDeletePosts(): Promise<void> {
    if (
      !confirm(
        this.i18n.translate(
          '¿Eliminar publicaciones seleccionadas? Esta acción no se puede deshacer.',
        ),
      )
    )
      return;
    this.error = '';
    try {
      for (const postId of this.selectedPosts) {
        await this.social.deletePost({ id: postId } as Post3D);
      }
      this.selectedPosts.clear();
      this.refresh();
      this.notifications.success(this.i18n.translate('Publicaciones eliminadas correctamente.'));
    } catch (error) {
      this.error =
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudieron eliminar las publicaciones.');
      this.notifications.error(this.error);
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
    } catch (error) {
      this.error =
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo actualizar el rol.');
      this.notifications.error(this.error);
    }
  }

  async removeMember(projectId: string, memberId: string): Promise<void> {
    if (!confirm(this.i18n.translate('¿Eliminar miembro del proyecto?'))) return;
    try {
      await this.collaboration.removeMember(projectId, memberId);
      this.notifications.success(this.i18n.translate('Miembro eliminado.'));
      this.selectProject(projectId);
    } catch (error) {
      this.error =
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo eliminar el miembro.');
      this.notifications.error(this.error);
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    if (!confirm(this.i18n.translate('¿Eliminar proyecto? Esta acción no se puede deshacer.')))
      return;
    try {
      await this.collaboration.deleteProject(projectId);
      this.selectedProjectId = '';
      this.projectMembers = [];
      this.refresh();
      this.notifications.success(this.i18n.translate('Proyecto eliminado.'));
    } catch (error) {
      this.error =
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo eliminar el proyecto.');
      this.notifications.error(this.error);
    }
  }

  get postToDeleteTitle(): string {
    return this.postToDelete?.title ?? '';
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
  trackProject(_index: number, project: Project): string {
    return project.id;
  }
  trackMember(_index: number, member: ProjectMember): string {
    return member.id;
  }
  trackArticle(_index: number, article: HelpArticle): string {
    return article.id;
  }

  isUserSelected(uid: string): boolean {
    return this.selectedUsers.has(uid);
  }

  get isDashboard(): boolean {
    return this._tab === 'dashboard';
  }
  get isUsers(): boolean {
    return this._tab === 'users';
  }
  get isContent(): boolean {
    return this._tab === 'content';
  }
  get isFeedback(): boolean {
    return this._tab === 'feedback';
  }
  get isHelp(): boolean {
    return this._tab === 'help';
  }
  get isProjects(): boolean {
    return this._tab === 'projects';
  }
  get isReports(): boolean {
    return this._tab === 'reports';
  }
  get isHelpArticles(): boolean {
    return this._tab === 'helpArticles';
  }

  resetNewArticle(): void {
    this.articleToEdit = null;
    this.articleBodyText = '';
    this.newArticle = {
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

  editHelpArticle(article: HelpArticle): void {
    this.articleToEdit = article;
    this.articleBodyText = Array.isArray(article.body)
      ? article.body.join('\n\n')
      : article.body || '';
    this.newArticle = {
      id: article.id,
      category: article.category,
      title: article.title,
      subtitle: article.subtitle,
      icon: article.icon || '📄',
      keywords: article.keywords || '',
      body: Array.isArray(article.body) ? article.body : [article.body || ''],
      order: article.order ?? 0,
      isPublished: article.isPublished ?? true,
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
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const articleData = {
      ...this.newArticle,
      title: this.newArticle.title.trim(),
      subtitle: this.newArticle.subtitle?.trim() || '',
      icon: this.newArticle.icon || '📄',
      keywords: this.newArticle.keywords || '',
      body: paragraphs.length > 0 ? paragraphs : [this.newArticle.title.trim()],
      updatedAt: Date.now(),
    };

    try {
      if (this.newArticle.id) {
        await this.community.updateHelpArticle(articleData as HelpArticle);
        this.notifications.success(this.i18n.translate('Artículo actualizado.'));
      } else {
        await this.community.createHelpArticle({
          ...articleData,
          createdAt: Date.now(),
        } as Omit<HelpArticle, 'id'>);
        this.notifications.success(this.i18n.translate('Artículo creado correctamente.'));
      }
      this.resetNewArticle();
      this.refresh();
    } catch (error) {
      this.error =
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo guardar el artículo.');
      this.notifications.error(this.error);
    }
  }

  async deleteHelpArticle(id: string): Promise<void> {
    if (!confirm(this.i18n.translate('¿Eliminar artículo? Esta acción no se puede deshacer.')))
      return;
    try {
      await this.community.deleteHelpArticle(id);
      if (this.newArticle.id === id) {
        this.resetNewArticle();
      }
      this.refresh();
      this.notifications.success(this.i18n.translate('Artículo eliminado.'));
    } catch (error) {
      this.error =
        error instanceof Error
          ? error.message
          : this.i18n.translate('No se pudo eliminar el artículo.');
      this.notifications.error(this.error);
    }
  }

  toggleArticlePublish(article: HelpArticle): void {
    const updated = { ...article, isPublished: !article.isPublished, updatedAt: Date.now() };
    this.community
      .updateHelpArticle(updated)
      .then(() => {
        this.refresh();
        this.notifications.success(
          this.i18n.translate(
            article.isPublished ? 'Artículo despublicado.' : 'Artículo publicado.',
          ),
        );
      })
      .catch((err) => {
        this.error =
          err instanceof Error
            ? err.message
            : this.i18n.translate('No se pudo actualizar el artículo.');
        this.notifications.error(this.error);
      });
  }

  getCategoryIcon(category: HelpArticleCategory): string {
    const icons: Record<HelpArticleCategory, string> = {
      'primeros-pasos': '🚀',
      editor: '🧊',
      publicacion: '📤',
      comunidad: '🌐',
      colaboracion: '🤝',
      cuenta: '🛡',
    };
    return icons[category] || '📄';
  }

  getCategoryLabel(category: HelpArticleCategory): string {
    return CATEGORY_LABELS[category] || category;
  }

  reportStatusLabel(report: ContentReport): string {
    switch (report.status) {
      case 'resolved':
        return 'admin.status.resolved';
      case 'dismissed':
        return 'admin.status.dismissed';
      case 'open':
      default:
        return 'admin.status.new';
    }
  }

  trackReport(_index: number, report: ContentReport): string {
    return report.id;
  }

  set searchQuery(value: string) {
    this.searchQuery$.next(value);
  }

  get searchQuery(): string {
    return this.searchQuery$.value;
  }

  readonly filteredUsers$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.users;
      const query = q.toLowerCase();
      return vm.users.filter(
        (u) =>
          u.displayName.toLowerCase().includes(query) ||
          u.email.toLowerCase().includes(query) ||
          u.uid.toLowerCase().includes(query),
      );
    }),
    startWith([] as UserProfile[]),
  );

  readonly filteredPosts$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.posts;
      const query = q.toLowerCase();
      return vm.posts.filter(
        (p) =>
          p.title.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.author.displayName.toLowerCase().includes(query) ||
          (p.authorId ?? '').toLowerCase().includes(query),
      );
    }),
    startWith([] as Post3D[]),
  );

  readonly filteredProjects$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.projects;
      const query = q.toLowerCase();
      return vm.projects.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          (p.description || '').toLowerCase().includes(query) ||
          p.id.toLowerCase().includes(query),
      );
    }),
    startWith([] as Project[]),
  );

  readonly filteredFeedback$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.feedback;
      const query = q.toLowerCase();
      return vm.feedback.filter(
        (f) =>
          f.subject.toLowerCase().includes(query) ||
          f.message.toLowerCase().includes(query) ||
          f.name.toLowerCase().includes(query) ||
          (f.email || '').toLowerCase().includes(query),
      );
    }),
    startWith([] as FeedbackMessage[]),
  );

  readonly filteredQuestions$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.questions;
      const query = q.toLowerCase();
      return vm.questions.filter(
        (item) =>
          item.title.toLowerCase().includes(query) ||
          item.body.toLowerCase().includes(query) ||
          item.authorName.toLowerCase().includes(query) ||
          (item.tags || []).some((t) => t.toLowerCase().includes(query)),
      );
    }),
    startWith([] as CommunityQuestion[]),
  );

  readonly filteredArticles$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.helpArticles;
      const query = q.toLowerCase();
      return vm.helpArticles.filter(
        (a) =>
          a.title.toLowerCase().includes(query) ||
          a.subtitle.toLowerCase().includes(query) ||
          (CATEGORY_LABELS[a.category] || a.category).toLowerCase().includes(query),
      );
    }),
    startWith([] as HelpArticle[]),
  );
}
