import { AsyncPipe, DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Component, effect, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  Subject,
  catchError,
  combineLatest,
  debounceTime,
  firstValueFrom,
  map,
  of,
  startWith,
  take,
} from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { FileHandler } from '../../core/services/file-handler';
import { I18nService } from '../../core/services/i18n';
import { SocialService } from '../../core/services/social';
import { NotificationService } from '../../core/services/notifications';
import { Comment, Post3D, ReportReason, User } from '../../core/models/social.models';
import { absoluteAppUrl, shareOrCopy } from '../../core/utils/share';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { AccountMenuComponent } from '../../shared/components/account-menu/account-menu';
import { ModelPreviewComponent } from '../../shared/components/model-preview/model-preview';
import { ActivityNotificationsComponent } from '../../shared/components/activity-notifications/activity-notifications';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

type FeedSort = 'recent' | 'likes' | 'views' | 'remixes';

interface FeedViewModel {
  items: Post3D[];
  total: number;
  hasMore: boolean;
  stats: { likes: number; views: number; remixes: number };
}

const FEED_PAGE_SIZE = 9;

@Component({
  selector: 'app-feed-page',
  standalone: true,
  imports: [
    TranslatePipe,
    ShellHeaderComponent,
    AsyncPipe,
    DatePipe,
    FormsModule,
    LoadingSpinner,
    ModelPreviewComponent,
    RouterLink,
    SiteFooterComponent,
  ],
  templateUrl: './feed-page.html',
  styleUrl: './feed-page.css',
})
export class FeedPage {
  private readonly socialService = inject(SocialService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly files = inject(FileHandler);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  readonly user$ = this.auth.user$;
  readonly social = this.socialService;
  readonly sortOptions: { value: FeedSort; label: string }[] = [
    { value: 'recent', label: 'Más recientes' },
    { value: 'likes', label: 'Más gustados' },
    { value: 'views', label: 'Más vistos' },
    { value: 'remixes', label: 'Más remixeados' },
  ];
  readonly reportReasons: { value: ReportReason; label: string }[] = [
    { value: 'spam', label: 'Spam' },
    { value: 'inappropriate', label: 'Contenido inapropiado' },
    { value: 'copyright', label: 'Derechos de autor' },
    { value: 'other', label: 'Otro' },
  ];

  private readonly search$ = new BehaviorSubject('');
  private readonly tag$ = new BehaviorSubject('');
  private readonly sort$ = new BehaviorSubject<FeedSort>('recent');
  private readonly visibleCount$ = new BehaviorSubject(FEED_PAGE_SIZE);
  private readonly urlSync$ = new Subject<void>();
  private readonly viewedPosts = new Set<string>();
  private pendingScrollPostId: string | null = null;

  readonly commentDrafts: Record<string, string> = {};
  readonly previewModes: Record<string, 'image' | '3d'> = {};
  readonly likeBusy: Record<string, boolean> = {};
  readonly highlightedPostId = signal<string | null>(null);
  searchTerm = '';
  selectedTag = '';
  sort: FeedSort = 'recent';
  communitySectionOpen = true;
  reportPostTarget: Post3D | null = null;
  reportReason: ReportReason = 'spam';
  reportDetails = '';
  reporting = false;
  error = '';
  mobileMenuOpen = false;

  readonly posts$: Observable<FeedViewModel | null> = combineLatest([
    this.socialService.posts$.pipe(
      catchError((error: unknown) => {
        console.error('No se pudo cargar el feed de la comunidad.', error);
        const message = error instanceof Error ? error.message : '';
        this.error = message.includes('The query requires an index')
          ? this.i18n.translate('Falta desplegar un índice de Firestore para el feed. Ejecuta `firebase deploy --only firestore:indexes`.')
          : message || this.i18n.translate('No se pudo cargar el feed.');
        this.notifications.error(this.error, this.i18n.translate('No se pudo cargar la comunidad'));
        return of([] as Post3D[]);
      }),
    ),
    this.search$,
    this.tag$,
    this.sort$,
    this.visibleCount$,
  ]).pipe(
    map(([posts, query, tag, sort, visible]) => {
      const term = query.trim().toLowerCase();
      let filtered = [...(posts ?? [])];

      if (term) {
        filtered = filtered.filter((post) => {
          const haystack = [
            post.title,
            post.description,
            post.author.displayName,
            ...(post.tags ?? []),
          ]
            .join(' ')
            .toLowerCase();
          return haystack.includes(term);
        });
      }

      if (tag) {
        filtered = filtered.filter((post) => (post.tags ?? []).includes(tag));
      }

      filtered.sort((a, b) => this.comparePosts(a, b, sort));

      const stats = filtered.reduce(
        (totals, post) => {
          totals.likes += post.likesCount ?? post.likes ?? 0;
          totals.views += post.viewsCount ?? 0;
          totals.remixes += post.remixCount ?? 0;
          return totals;
        },
        { likes: 0, views: 0, remixes: 0 },
      );

      return {
        items: filtered.slice(0, visible),
        total: filtered.length,
        hasMore: filtered.length > visible,
        stats,
      } satisfies FeedViewModel;
    }),
    startWith(null),
  );

  readonly feed = toSignal(this.posts$, { initialValue: null });

  readonly allTags$ = this.socialService.posts$.pipe(
    map((posts) => {
      const tags = new Set<string>();
      for (const post of posts ?? []) {
        for (const tag of post.tags ?? []) tags.add(tag);
      }
      return [...tags].sort();
    }),
    startWith([] as string[]),
  );

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const query = params.get('q') ?? '';
      const tag = params.get('tag') ?? '';
      const sort = this.normalizeSort(params.get('sort'));
      const postId = params.get('post');
      const filtersChanged =
        query !== this.searchTerm || tag !== this.selectedTag || sort !== this.sort;

      this.searchTerm = query;
      this.selectedTag = tag;
      this.sort = sort;
      this.search$.next(query);
      this.tag$.next(tag);
      this.sort$.next(sort);

      if (filtersChanged) {
        this.visibleCount$.next(FEED_PAGE_SIZE);
      }

      if (postId) {
        this.visibleCount$.next(200);
        this.pendingScrollPostId = postId;
        this.highlightedPostId.set(postId);
      }
    });

    this.urlSync$
      .pipe(debounceTime(350), takeUntilDestroyed())
      .subscribe(() => this.writeUrl());

    effect(() => {
      const vm = this.feed();
      const target = this.pendingScrollPostId;
      if (!vm || !target || !vm.items.some((post) => post.id === target)) return;

      this.pendingScrollPostId = null;
      if (!isPlatformBrowser(this.platformId)) return;

      setTimeout(() => {
        this.document
          .getElementById(`post-${target}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
      setTimeout(() => this.highlightedPostId.set(null), 5000);
    });
  }

  async like(post: Post3D): Promise<void> {
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    if (!user) {
      this.notifications.warning(this.i18n.translate('Inicia sesión para marcar modelos como favoritos.'));
      await this.router.navigate(['/login']);
      return;
    }
    if (this.likeBusy[post.id]) return;
    this.likeBusy[post.id] = true;
    try {
      const liked = await this.social.toggleLike(post, user);
      this.notifications.success(
        liked
          ? this.i18n.translate('Marcaste “{title}” como favorito.', { title: post.title })
          : this.i18n.translate('Quitaste “{title}” de favoritos.', { title: post.title }),
        liked ? this.i18n.translate('Favorito guardado') : this.i18n.translate('Favorito quitado'),
      );
    } catch (error) {
      this.error = error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el favorito.');
      this.notifications.error(this.error);
    } finally {
      this.likeBusy[post.id] = false;
    }
  }

  async share(post: Post3D): Promise<void> {
    const url = absoluteAppUrl(
      `feed?post=${encodeURIComponent(post.id)}`,
      this.document.baseURI,
    );
    try {
      const result = await shareOrCopy(
        url,
        `${post.title} · CARXY`,
        post.description || this.i18n.translate('Mira este modelo 3D en CARXY.'),
      );
      this.notifications.success(
        result === 'shared'
          ? this.i18n.translate('Compartiste el modelo.')
          : this.i18n.translate('Enlace copiado al portapapeles.'),
        this.i18n.translate('Compartir modelo'),
      );
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo compartir el modelo.'),
      );
    }
  }

  openReport(post: Post3D, dialog: HTMLDialogElement): void {
    this.reportPostTarget = post;
    this.reportReason = 'spam';
    this.reportDetails = '';
    dialog.showModal();
  }

  async submitReport(dialog: HTMLDialogElement): Promise<void> {
    if (!this.reportPostTarget) return;
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    if (!user) {
      this.notifications.warning(this.i18n.translate('Inicia sesión para reportar contenido.'));
      await this.router.navigate(['/login']);
      return;
    }
    this.reporting = true;
    try {
      await this.social.reportPost(this.reportPostTarget, user, this.reportReason, this.reportDetails);
      this.notifications.success(
        this.i18n.translate('Gracias. El equipo de moderación revisará el reporte.'),
        this.i18n.translate('Reporte enviado'),
      );
      this.reportPostTarget = null;
      dialog.close();
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo enviar el reporte.'),
      );
    } finally {
      this.reporting = false;
    }
  }

  async addComment(post: Post3D): Promise<void> {
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    if (!user) {
      this.notifications.warning(this.i18n.translate('Inicia sesión para comentar en la comunidad.'));
      await this.router.navigate(['/login']);
      return;
    }
    const text = this.commentDrafts[post.id]?.trim();
    if (!text) {
      this.notifications.warning(this.i18n.translate('Escribe un comentario antes de enviarlo.'));
      return;
    }
    try {
      await this.social.addComment(post.id, text, user, post);
      this.commentDrafts[post.id] = '';
      this.notifications.success(this.i18n.translate('Tu comentario se publicó.'));
    } catch (error) {
      this.error = error instanceof Error ? error.message : this.i18n.translate('No se pudo enviar el comentario.');
      this.notifications.error(this.error);
    }
  }

  async remix(post: Post3D): Promise<void> {
    try {
      const blob = await this.social.downloadModel(post);
      const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
      if (user && !user.isBanned) {
        await this.social.incrementRemixes(post);
        await this.social.incrementViews(post);
      }
      await this.router.navigate(['/editor']);
      await this.files.loadGLBBlob(blob, `Remix · ${post.title}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : this.i18n.translate('No se pudo abrir el modelo.');
      this.notifications.error(this.error, this.i18n.translate('No se pudo abrir el modelo'));
    }
  }

  trackComment(_index: number, comment: Comment): string {
    return comment.id;
  }

  setPreviewMode(post: Post3D, mode: 'image' | '3d'): void {
    this.previewModes[post.id] = mode;
    if (mode === '3d') void this.trackView(post);
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

  async toggleFollow(post: Post3D, user: User, following: boolean): Promise<void> {
    try {
      if (following) await this.social.unfollowUser(user.uid, post.author.uid);
      else await this.social.followUser(user, post.author.uid);
      this.notifications.success(
        following
          ? this.i18n.translate('Dejaste de seguir a este creador.')
          : this.i18n.translate('Ahora sigues a {name}.', { name: post.author.displayName }),
      );
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el seguimiento.'),
      );
    }
  }

  setSearch(term: string): void {
    this.searchTerm = term;
    this.search$.next(term);
    this.visibleCount$.next(FEED_PAGE_SIZE);
    this.urlSync$.next();
  }

  setTag(tag: string): void {
    const next = this.selectedTag === tag ? '' : tag;
    this.selectedTag = next;
    this.tag$.next(next);
    this.visibleCount$.next(FEED_PAGE_SIZE);
    this.urlSync$.next();
  }

  setSort(sort: FeedSort): void {
    this.sort = sort;
    this.sort$.next(sort);
    this.visibleCount$.next(FEED_PAGE_SIZE);
    this.urlSync$.next();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedTag = '';
    this.sort = 'recent';
    this.search$.next('');
    this.tag$.next('');
    this.sort$.next('recent');
    this.visibleCount$.next(FEED_PAGE_SIZE);
    this.writeUrl();
  }

  loadMore(): void {
    this.visibleCount$.next(this.visibleCount$.value + FEED_PAGE_SIZE);
  }

  hasActiveFilters(): boolean {
    return !!this.searchTerm.trim() || !!this.selectedTag || this.sort !== 'recent';
  }

  toggleCommunitySection(): void {
    this.communitySectionOpen = !this.communitySectionOpen;
  }

  useFallbackAvatar(event: Event): void {
    const image = event.target;
    if (image instanceof HTMLImageElement) image.src = 'user-avatar.svg';
  }

  private normalizeSort(value: string | null): FeedSort {
    return value === 'likes' || value === 'views' || value === 'remixes'
      ? value
      : 'recent';
  }

  private comparePosts(a: Post3D, b: Post3D, sort: FeedSort): number {
    const byDate = b.createdAt - a.createdAt;
    if (sort === 'likes') {
      return (b.likesCount ?? b.likes ?? 0) - (a.likesCount ?? a.likes ?? 0) || byDate;
    }
    if (sort === 'views') {
      return (b.viewsCount ?? 0) - (a.viewsCount ?? 0) || byDate;
    }
    if (sort === 'remixes') {
      return (b.remixCount ?? 0) - (a.remixCount ?? 0) || byDate;
    }
    return byDate;
  }

  private async trackView(post: Post3D): Promise<void> {
    if (this.viewedPosts.has(post.id)) return;
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    if (!user) return;
    this.viewedPosts.add(post.id);
    try {
      await this.social.incrementViews(post);
    } catch (error) {
      this.viewedPosts.delete(post.id);
      console.warn('No se pudo registrar la vista del modelo.', error);
    }
  }

  private writeUrl(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const queryParams: Record<string, string | null> = {
      q: this.searchTerm.trim() || null,
      tag: this.selectedTag || null,
      sort: this.sort === 'recent' ? null : this.sort,
      post: null,
    };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
