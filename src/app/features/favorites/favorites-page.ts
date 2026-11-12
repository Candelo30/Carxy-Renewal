import { AsyncPipe, DatePipe, DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  catchError,
  firstValueFrom,
  map,
  of,
  startWith,
  switchMap,
  take,
} from 'rxjs';
import { Post3D } from '../../core/models/social.models';
import { AuthService } from '../../core/services/auth';
import { FileHandler } from '../../core/services/file-handler';
import { I18nService } from '../../core/services/i18n';
import { NotificationService } from '../../core/services/notifications';
import { SocialService } from '../../core/services/social';
import { absoluteAppUrl, shareOrCopy } from '../../core/utils/share';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { ModelPreviewComponent } from '../../shared/components/model-preview/model-preview';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-favorites-page',
  standalone: true,
  imports: [
    TranslatePipe,
    AsyncPipe,
    DatePipe,
    LoadingSpinner,
    ModelPreviewComponent,
    RouterLink,
    ShellHeaderComponent,
    SiteFooterComponent,
  ],
  templateUrl: './favorites-page.html',
  styleUrl: './favorites-page.css',
})
export class FavoritesPage {
  private readonly auth = inject(AuthService);
  private readonly socialService = inject(SocialService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly files = inject(FileHandler);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly viewedPosts = new Set<string>();

  readonly user$ = this.auth.user$;
  readonly social = this.socialService;
  readonly previewModes: Record<string, 'image' | '3d'> = {};
  readonly likeBusy: Record<string, boolean> = {};
  error = '';

  readonly favorites$ = this.auth.user$.pipe(
    switchMap((user) => (user ? this.socialService.userLikedPosts$(user.uid) : of([]))),
    map((posts) => posts ?? []),
    catchError((error: unknown) => {
      console.error('No se pudieron cargar los favoritos.', error);
      this.error = this.i18n.firebaseError(error, 'No se pudieron cargar tus modelos favoritos.');
      this.notifications.error(this.error, this.i18n.translate('Favoritos no disponibles'));
      return of([] as Post3D[]);
    }),
    startWith(null as Post3D[] | null),
  );

  totalLikes(posts: Post3D[]): number {
    return posts.reduce((total, post) => total + (post.likesCount ?? post.likes ?? 0), 0);
  }

  totalViews(posts: Post3D[]): number {
    return posts.reduce((total, post) => total + (post.viewsCount ?? 0), 0);
  }

  setPreviewMode(post: Post3D, mode: 'image' | '3d'): void {
    this.previewModes[post.id] = mode;
    if (mode === '3d') void this.trackView(post);
  }

  async remove(post: Post3D): Promise<void> {
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    if (!user) {
      await this.router.navigate(['/login']);
      return;
    }
    if (this.likeBusy[post.id]) return;
    this.likeBusy[post.id] = true;
    try {
      await this.social.toggleLike(post, user);
      this.notifications.success(
        this.i18n.translate('Quitaste “{title}” de favoritos.', { title: post.title }),
        this.i18n.translate('Favorito quitado'),
      );
    } catch (error) {
      this.notifications.error(
        this.i18n.firebaseError(error, 'No se pudo quitar el favorito.'),
      );
    } finally {
      this.likeBusy[post.id] = false;
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
      this.notifications.error(
        this.i18n.firebaseError(error, 'No se pudo abrir el modelo.'),
        this.i18n.translate('No se pudo abrir el modelo'),
      );
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
        result === 'shared' ? this.i18n.translate('Compartiste el modelo.') : this.i18n.translate('Enlace copiado al portapapeles.'),
        this.i18n.translate('Compartir modelo'),
      );
    } catch (error) {
      this.notifications.error(
        this.i18n.firebaseError(error, 'No se pudo compartir el modelo.'),
      );
    }
  }

  useFallbackAvatar(event: Event): void {
    const image = event.target;
    if (image instanceof HTMLImageElement) image.src = 'user-avatar.svg';
  }

  trackCreator(_index: number, post: Post3D): string {
    return post.author.uid;
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
}
