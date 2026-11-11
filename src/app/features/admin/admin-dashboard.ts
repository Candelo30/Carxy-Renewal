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
  | 'dashboard'
  | 'users'
  | 'content'
  | 'reports'
  | 'feedback'
  | 'help'
  | 'projects'
  | 'helpArticles';

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

  readonly user$: Observable<UserProfile | null> = this.auth.user$;
  mobileMenuOpen = false;
  readonly now = Date.now();

  private readonly vmSubject = new BehaviorSubject<{
    user: UserProfile | null;
    users: UserProfile[];
    posts: Post3D[];
    reports: ContentReport[];
    feedback: FeedbackMessage[];
    questions: CommunityQuestion[];
    projects: Project[];
    helpArticles: HelpArticle[];
  }>({
    user: null,
    users: [],
    posts: [],
    reports: [],
    feedback: [],
    questions: [],
    projects: [],
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
    // Real-time updates every 10 seconds
    setInterval(() => {
      this.loadData();
      if (this.selectedProjectId) {
        this.selectProject(this.selectedProjectId);
      }
    }, 10000);
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
          helpArticles: [],
        });
        return;
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

      combineLatest([users$, posts$, reports$, feedback$, questions$, projects$, helpArticles$]).subscribe(
        ([users, posts, reports, feedback, questions, projects, helpArticles]) => {
          this.vmSubject.next({
            user,
            users: users ?? [],
            posts: posts ?? [],
            reports: reports ?? [],
            feedback: feedback ?? [],
            questions: questions ?? [],
            projects: projects ?? [],
            helpArticles: helpArticles ?? [],
          });
          if (this._tab === 'projects' && !this.selectedProjectId && projects?.length) {
            this.selectProject(projects[0].id);
          }
        },
      );
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
  );

  readonly chartUsersByRole$ = this.vm$.pipe(
    map((vm) => this.toBars([
      { label: 'Usuarios', value: vm.users.filter((u) => u.role === 'user').length, color: '#60a5fa' },
      { label: 'Moderadores', value: vm.users.filter((u) => u.role === 'moderator').length, color: '#a78bfa' },
      { label: 'Admins', value: vm.users.filter((u) => u.role === 'admin').length, color: '#f59e0b' },
    ])),
  );

  readonly chartPostsVisibility$ = this.vm$.pipe(
    map((vm) => this.toBars([
      { label: 'Públicos', value: vm.posts.filter((p) => !p.isPrivate).length, color: '#34d399' },
      { label: 'Privados', value: vm.posts.filter((p) => p.isPrivate).length, color: '#f87171' },
    ])),
  );

  readonly chartReports$ = this.vm$.pipe(
    map((vm) => this.toBars([
      { label: 'Abiertos', value: vm.reports.filter((r) => r.status === 'open').length, color: '#f59e0b' },
      { label: 'Resueltos', value: vm.reports.filter((r) => r.status === 'resolved').length, color: '#34d399' },
      { label: 'Descartados', value: vm.reports.filter((r) => r.status === 'dismissed').length, color: '#94a3b8' },
    ])),
  );

  readonly chartFeedback$ = this.vm$.pipe(
    map((vm) => this.toBars([
      { label: 'Nuevos', value: vm.feedback.filter((f) => f.status === 'new').length, color: '#60a5fa' },
      { label: 'En revisión', value: vm.feedback.filter((f) => f.status === 'reviewing').length, color: '#f59e0b' },
      { label: 'Resueltos', value: vm.feedback.filter((f) => f.status === 'resolved').length, color: '#34d399' },
    ])),
  );

  readonly chartQuestions$ = this.vm$.pipe(
    map((vm) => this.toBars([
      { label: 'Abiertas', value: vm.questions.filter((q) => !q.resolved).length, color: '#60a5fa' },
      { label: 'Resueltas', value: vm.questions.filter((q) => q.resolved).length, color: '#34d399' },
      { label: 'Fijadas', value: vm.questions.filter((q) => q.pinned).length, color: '#f59e0b' },
    ])),
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
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el rol.'),
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
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el estado de la cuenta.'),
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
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar la visibilidad.'),
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
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el reporte.'),
      );
    }
  }

  async setFeedbackStatus(feedback: FeedbackMessage, status: FeedbackStatus): Promise<void> {
    try {
      await this.community.updateFeedbackStatus(feedback.id, status);
      this.refresh();
      this.notifications.success(this.i18n.translate('Estado del mensaje actualizado.'));
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el mensaje.'),
      );
    }
  }

  async deleteFeedback(feedback: FeedbackMessage): Promise<void> {
    if (typeof confirm === 'function' && !confirm(this.i18n.translate('¿Eliminar este mensaje de feedback?'))) return;
    try {
      await this.community.deleteFeedback(feedback.id);
      this.refresh();
      this.notifications.success(this.i18n.translate('Mensaje de feedback eliminado.'));
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar el mensaje.'),
      );
    }
  }

  async toggleQuestionPinned(question: CommunityQuestion): Promise<void> {
    try {
      await this.community.setQuestionPinned(question.id, !question.pinned);
      this.refresh();
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar la pregunta.'));
    }
  }

  async toggleQuestionLocked(question: CommunityQuestion): Promise<void> {
    try {
      await this.community.setQuestionLocked(question.id, !question.locked);
      this.refresh();
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar la pregunta.'));
    }
  }

  async toggleQuestionResolved(question: CommunityQuestion): Promise<void> {
    try {
      await this.community.setQuestionResolved(question.id, !question.resolved);
      this.refresh();
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar la pregunta.'));
    }
  }

  async deleteQuestion(question: CommunityQuestion): Promise<void> {
    if (typeof confirm === 'function' && !confirm(this.i18n.translate('¿Eliminar esta pregunta y sus respuestas?'))) return;
    try {
      await this.community.deleteQuestion(question);
      this.refresh();
      this.notifications.success(this.i18n.translate('Pregunta eliminada.'));
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar la pregunta.'));
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
      this.postToDelete = null;
      this.refresh();
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar el modelo.'),
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
      this.selectProject(projectId);
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el rol.'));
    }
  }

  async removeMember(projectId: string, memberId: string): Promise<void> {
    if (!confirm(this.i18n.translate('¿Eliminar miembro del proyecto?'))) return;
    try {
      await this.collaboration.removeMember(projectId, memberId);
      this.notifications.success(this.i18n.translate('Miembro eliminado.'));
      this.selectProject(projectId);
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar el miembro.'));
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    if (!confirm(this.i18n.translate('¿Eliminar proyecto? Esta acción no se puede deshacer.'))) return;
    try {
      await this.collaboration.deleteProject(projectId);
      this.selectedProjectId = '';
      this.projectMembers = [];
      this.refresh();
      this.notifications.success(this.i18n.translate('Proyecto eliminado.'));
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar el proyecto.'));
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

  trackUser(_index: number, user: UserProfile): string { return user.uid; }
  trackPost(_index: number, post: Post3D): string { return post.id; }
  trackFeedback(_index: number, feedback: FeedbackMessage): string { return feedback.id; }
  trackQuestion(_index: number, question: CommunityQuestion): string { return question.id; }
  trackProject(_index: number, project: Project): string { return project.id; }
  trackMember(_index: number, member: ProjectMember): string { return member.id; }
  trackArticle(_index: number, article: HelpArticle): string { return article.id; }
  trackReport(_index: number, report: ContentReport): string { return report.id; }
  trackBar(_index: number, bar: ChartBar): string { return bar.label; }

  get isDashboard(): boolean { return this._tab === 'dashboard'; }
  get isUsers(): boolean { return this._tab === 'users'; }
  get isContent(): boolean { return this._tab === 'content'; }
  get isFeedback(): boolean { return this._tab === 'feedback'; }
  get isHelp(): boolean { return this._tab === 'help'; }
  get isProjects(): boolean { return this._tab === 'projects'; }
  get isReports(): boolean { return this._tab === 'reports'; }
  get isHelpArticles(): boolean { return this._tab === 'helpArticles'; }

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
      } else {
        await this.community.createHelpArticle({ ...articleData, createdAt: Date.now() } as Omit<HelpArticle, 'id'>);
        this.notifications.success(this.i18n.translate('Artículo creado correctamente.'));
      }
      this.resetNewArticle();
      this.refresh();
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo guardar el artículo.'));
    }
  }

  async deleteHelpArticle(id: string): Promise<void> {
    if (!confirm(this.i18n.translate('¿Eliminar artículo?'))) return;
    try {
      await this.community.deleteHelpArticle(id);
      if (this.newArticle.id === id) this.resetNewArticle();
      this.refresh();
      this.notifications.success(this.i18n.translate('Artículo eliminado.'));
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar el artículo.'));
    }
  }

  async toggleArticlePublish(article: HelpArticle): Promise<void> {
    try {
      await this.community.updateHelpArticle({ ...article, isPublished: !article.isPublished, updatedAt: Date.now() });
      this.refresh();
      this.notifications.success(article.isPublished ? this.i18n.translate('Artículo despublicado.') : this.i18n.translate('Artículo publicado.'));
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el artículo.'));
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

  readonly filteredUsers$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.users;
      const query = q.toLowerCase();
      return vm.users.filter((u) =>
        u.displayName.toLowerCase().includes(query) || u.email.toLowerCase().includes(query) || u.uid.toLowerCase().includes(query),
      );
    }),
    startWith([] as UserProfile[]),
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
  );

  readonly filteredProjects$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.projects;
      const query = q.toLowerCase();
      return vm.projects.filter((p) => p.name.toLowerCase().includes(query) || (p.description || '').toLowerCase().includes(query) || p.id.toLowerCase().includes(query));
    }),
    startWith([] as Project[]),
  );

  readonly filteredFeedback$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.feedback;
      const query = q.toLowerCase();
      return vm.feedback.filter((f) => f.subject.toLowerCase().includes(query) || f.message.toLowerCase().includes(query) || f.name.toLowerCase().includes(query) || (f.email || '').toLowerCase().includes(query));
    }),
    startWith([] as FeedbackMessage[]),
  );

  readonly filteredQuestions$ = combineLatest([this.vm$, this.searchQuery$]).pipe(
    map(([vm, q]) => {
      if (!q) return vm.questions;
      const query = q.toLowerCase();
      return vm.questions.filter((item) => item.title.toLowerCase().includes(query) || item.body.toLowerCase().includes(query) || item.authorName.toLowerCase().includes(query) || (item.tags || []).some((t) => t.toLowerCase().includes(query)));
    }),
    startWith([] as CommunityQuestion[]),
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
  );
}
