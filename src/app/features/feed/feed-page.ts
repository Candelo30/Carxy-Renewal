import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, firstValueFrom, map, of, startWith, take } from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { FileHandler } from '../../core/services/file-handler';
import { SocialService } from '../../core/services/social';
import { NotificationService } from '../../core/services/notifications';
import { Comment, Post3D, ReportReason, User } from '../../core/models/social.models';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { ModelPreviewComponent } from '../../shared/components/model-preview/model-preview';
import { CollectionService } from '../../core/services/collection';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';

@Component({
  selector: 'app-feed-page',
  standalone: true,
  imports: [
    ShellHeaderComponent,
    AsyncPipe,
    DatePipe,
    FormsModule,
    LoadingSpinner,
    ModelPreviewComponent,
    RouterLink,
  ],
  templateUrl: './feed-page.html',
  styleUrl: './feed-page.css',
})
export class FeedPage {
  private readonly socialService = inject(SocialService);
  readonly posts$ = this.socialService.posts$.pipe(
    catchError((error: unknown) => {
      console.error('No se pudo cargar el feed de la comunidad.', error);
      const message = error instanceof Error ? error.message : '';
      this.error = message.includes('The query requires an index')
        ? 'Falta desplegar un índice de Firestore para el feed. Ejecuta `firebase deploy --only firestore:indexes`.'
        : message || 'No se pudo cargar el feed.';
      this.notifications.error(this.error, 'No se pudo cargar la comunidad');
      return of([]);
    }),
    map((posts) => {
      if (!posts) return [];
      let filtered = posts;
      // Filtro por vista (recientes / destacados / tendencias)
      if (this.viewMode === 'featured') {
        filtered = filtered.filter((post) => post.featured === true);
      } else if (this.viewMode === 'trending') {
        filtered = filtered
          .filter((post) => (post.trendingScore ?? 0) > 0)
          .sort((a, b) => (b.trendingScore ?? 0) - (a.trendingScore ?? 0));
      }
      const q = this.searchTerm.trim().toLowerCase();
      if (q) {
        filtered = filtered.filter((post) =>
          post.title.toLowerCase().includes(q)
          || post.description.toLowerCase().includes(q)
          || post.author.displayName.toLowerCase().includes(q),
        );
      }
      if (this.selectedTag) {
        filtered = filtered.filter((post) => (post.tags ?? []).includes(this.selectedTag));
      }
      return filtered;
    }),
    startWith(null),
  );
  readonly user$ = inject(AuthService).user$;
  readonly social = this.socialService;
  readonly collection = inject(CollectionService);
  readonly commentDrafts: Record<string, string> = {};
  readonly previewModes: Record<string, 'image' | '3d'> = {};
  readonly likeBusy: Record<string, boolean> = {};
  searchTerm = '';
  selectedTag = '';
  viewMode: 'recent' | 'featured' | 'trending' = 'recent';
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
  readonly reportReasons: { value: ReportReason; label: string }[] = [
    { value: 'spam', label: 'Spam' },
    { value: 'inappropriate', label: 'Contenido inapropiado' },
    { value: 'copyright', label: 'Derechos de autor' },
    { value: 'other', label: 'Otro' },
  ];
  reportPostTarget: Post3D | null = null;
  reportReason: ReportReason = 'spam';
  reportDetails = '';
  reporting = false;
  error = '';
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly files = inject(FileHandler);
  private readonly router = inject(Router);

  async like(post: Post3D): Promise<void> {
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    if (!user) {
      this.notifications.warning('Inicia sesión para marcar modelos como favoritos.');
      await this.router.navigate(['/login']);
      return;
    }
    if (this.likeBusy[post.id]) return;
    this.likeBusy[post.id] = true;
    try {
      const liked = await this.social.toggleLike(post, user);
      this.notifications.success(
        liked
          ? `Marcaste “${post.title}” como favorito.`
          : `Quitaste “${post.title}” de favoritos.`,
        liked ? 'Favorito guardado' : 'Favorito quitado',
      );
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'No se pudo actualizar el favorito.';
      this.notifications.error(this.error);
    } finally {
      this.likeBusy[post.id] = false;
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
      this.notifications.warning('Inicia sesión para reportar contenido.');
      await this.router.navigate(['/login']);
      return;
    }
    this.reporting = true;
    try {
      await this.social.reportPost(this.reportPostTarget, user, this.reportReason, this.reportDetails);
      this.notifications.success('Gracias. El equipo de moderación revisará el reporte.', 'Reporte enviado');
      this.reportPostTarget = null;
      dialog.close();
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : 'No se pudo enviar el reporte.',
      );
    } finally {
      this.reporting = false;
    }
  }

  async addComment(post: Post3D): Promise<void> {
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    if (!user) {
      this.notifications.warning('Inicia sesión para comentar en la comunidad.');
      await this.router.navigate(['/login']);
      return;
    }
    const text = this.commentDrafts[post.id]?.trim();
    if (!text) {
      this.notifications.warning('Escribe un comentario antes de enviarlo.');
      return;
    }
    try {
      await this.social.addComment(post.id, text, user, post);
      this.commentDrafts[post.id] = '';
      this.notifications.success('Tu comentario se publicó.');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'No se pudo enviar el comentario.';
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
      this.error = error instanceof Error ? error.message : 'No se pudo abrir el modelo.';
      this.notifications.error(this.error, 'No se pudo abrir el modelo');
    }
  }

  trackComment(_index: number, comment: Comment): string {
    return comment.id;
  }

  setPreviewMode(post: Post3D, mode: 'image' | '3d'): void {
    this.previewModes[post.id] = mode;
  }

  async toggleFollow(post: Post3D, user: User, following: boolean): Promise<void> {
    try {
      if (following) await this.social.unfollowUser(user.uid, post.author.uid);
      else await this.social.followUser(user, post.author.uid);
      this.notifications.success(
        following
          ? 'Dejaste de seguir a este creador.'
          : `Ahora sigues a ${post.author.displayName}.`,
      );
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : 'No se pudo actualizar el seguimiento.',
      );
    }
  }

  setSearch(term: string): void {
    this.searchTerm = term;
  }

  setTag(tag: string): void {
    this.selectedTag = this.selectedTag === tag ? '' : tag;
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedTag = '';
  }

  hasActiveFilters(): boolean {
    return !!this.searchTerm.trim() || !!this.selectedTag;
  }

  setViewMode(mode: 'recent' | 'featured' | 'trending'): void {
    this.viewMode = mode;
    this.selectedTag = '';
    this.searchTerm = '';
  }

  toggleMobileMenu(): void {
    // El menú móvil se gestiona desde el shell-header; este método existe por consistencia.
  }

  isViewMode(mode: 'recent' | 'featured' | 'trending'): boolean {
    return this.viewMode === mode;
  }

  async toggleCollection(post: Post3D): Promise<void> {
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    if (!user) {
      this.notifications.warning('Inicia sesión para guardar modelos en colecciones.');
      await this.router.navigate(['/login']);
      return;
    }
    const collections = this.collection.getCollections(user.uid);
    if (collections.length === 0) {
      this.collection.createCollection('Mis favoritos', 'Modelos que me gustan', false, user.uid);
    }
    const defaultCollection = collections[0] ?? this.collection.getCollections(user.uid)[0];
    const already = this.collection.isInCollection(defaultCollection.id, post.id);
    if (already) {
      this.collection.removeFromCollection(defaultCollection.id, post.id);
      this.notifications.success('Eliminado de tu colección.', 'Colección');
    } else {
      this.collection.addToCollection(defaultCollection.id, post.id);
      this.notifications.success('Agregado a tu colección.', 'Colección');
    }
  }

  useFallbackAvatar(event: Event): void {
    const image = event.target;
    if (image instanceof HTMLImageElement) image.src = '/user-avatar.svg';
  }
}
