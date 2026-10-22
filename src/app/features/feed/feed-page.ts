import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, firstValueFrom, of, startWith, take } from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { FileHandler } from '../../core/services/file-handler';
import { SocialService } from '../../core/services/social';
import { NotificationService } from '../../core/services/notifications';
import { Comment, Post3D, User } from '../../core/models/social.models';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { AccountMenuComponent } from '../../shared/components/account-menu/account-menu';
import { ModelPreviewComponent } from '../../shared/components/model-preview/model-preview';
import { ActivityNotificationsComponent } from '../../shared/components/activity-notifications/activity-notifications';

@Component({
  selector: 'app-feed-page',
  standalone: true,
  imports: [
    AccountMenuComponent,
    ActivityNotificationsComponent,
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
    startWith(null),
  );
  readonly user$ = inject(AuthService).user$;
  readonly social = this.socialService;
  readonly commentDrafts: Record<string, string> = {};
  readonly previewModes: Record<string, 'image' | '3d'> = {};
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
    try {
      await this.social.like(post, user);
      this.notifications.success(`Marcaste “${post.title}” como favorito.`, 'Favorito guardado');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'No se pudo marcar como favorito.';
      this.notifications.error(this.error);
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

  useFallbackAvatar(event: Event): void {
    const image = event.target;
    if (image instanceof HTMLImageElement) image.src = '/user-avatar.svg';
  }
}
