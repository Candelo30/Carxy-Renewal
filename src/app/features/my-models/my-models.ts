import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable, map, of, startWith, switchMap } from 'rxjs';
import { Post3D, UserProfile } from '../../core/models/social.models';
import { AuthService } from '../../core/services/auth';
import { FileHandler } from '../../core/services/file-handler';
import { SocialService } from '../../core/services/social';
import { NotificationService } from '../../core/services/notifications';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { AccountMenuComponent } from '../../shared/components/account-menu/account-menu';
import { ActivityNotificationsComponent } from '../../shared/components/activity-notifications/activity-notifications';

@Component({
  selector: 'app-my-models',
  standalone: true,
  imports: [AccountMenuComponent, ActivityNotificationsComponent, AsyncPipe, DatePipe, FormsModule, LoadingSpinner, RouterLink],
  templateUrl: './my-models.html',
  styleUrl: './my-models.css',
})
export class MyModelsComponent {
  readonly auth = inject(AuthService);
  readonly vm$: Observable<{ user: UserProfile | null; posts: Post3D[] } | null> = this.auth.user$.pipe(
    switchMap((user) => {
      const viewModel$: Observable<{ user: UserProfile | null; posts: Post3D[] }> = user
        ? this.social.userPosts$(user.uid, true).pipe(map((posts) => ({ user, posts })))
        : of({ user: null, posts: [] });
      return viewModel$.pipe(startWith(null));
    }),
  );
  title = '';
  description = '';
  tagsText = '';
  editingPost: Post3D | null = null;
  deletingPost: Post3D | null = null;
  busy = false;
  error = '';
  status = '';
  private readonly social = inject(SocialService);
  private readonly files = inject(FileHandler);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  totalLikes(posts: Post3D[]): number {
    return posts.reduce((sum, post) => sum + (post.likesCount ?? post.likes), 0);
  }

  totalViews(posts: Post3D[]): number {
    return posts.reduce((sum, post) => sum + (post.viewsCount ?? 0), 0);
  }

  totalRemixes(posts: Post3D[]): number {
    return posts.reduce((sum, post) => sum + (post.remixCount ?? 0), 0);
  }

  edit(post: Post3D, dialog: HTMLDialogElement): void {
    this.editingPost = post;
    this.title = post.title;
    this.description = post.description;
    this.tagsText = (post.tags ?? []).join(', ');
    this.error = '';
    dialog.showModal();
  }

  async saveMetadata(dialog: HTMLDialogElement): Promise<void> {
    if (!this.editingPost) return;
    this.busy = true;
    this.error = '';
    try {
      const tags = [...new Set(this.tagsText.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 12);
      await this.social.updatePost(this.editingPost, {
        title: this.title.trim(),
        description: this.description.trim(),
        tags,
        isPrivate: this.editingPost.isPrivate ?? false,
      });
      this.status = 'Metadatos guardados.';
      this.notifications.success(this.status, 'Cambios guardados');
      dialog.close();
      this.editingPost = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'No se pudieron guardar los cambios.';
      this.notifications.error(this.error);
    } finally {
      this.busy = false;
    }
  }

  async togglePrivacy(post: Post3D): Promise<void> {
    this.error = '';
    this.status = '';
    try {
      await this.social.updatePost(post, {
        title: post.title,
        description: post.description,
        tags: post.tags ?? [],
        isPrivate: !post.isPrivate,
      });
      this.status = post.isPrivate ? 'El modelo ahora es público.' : 'El modelo ahora es privado.';
      this.notifications.success(this.status, 'Visibilidad actualizada');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'No se pudo cambiar la privacidad.';
      this.notifications.error(this.error);
    }
  }

  requestDelete(post: Post3D, dialog: HTMLDialogElement): void {
    this.deletingPost = post;
    this.error = '';
    dialog.showModal();
  }

  async confirmDelete(dialog: HTMLDialogElement): Promise<void> {
    if (!this.deletingPost) return;
    this.busy = true;
    this.error = '';
    try {
      await this.social.deletePost(this.deletingPost);
      this.status = `Se eliminó “${this.deletingPost.title}”.`;
      this.notifications.success(this.status, 'Creación eliminada');
      this.deletingPost = null;
      dialog.close();
    } catch (error) {
      console.error('No se pudo eliminar la creación.', error);
      this.error = error instanceof Error ? error.message : 'No se pudo eliminar el modelo.';
      this.notifications.error(this.error, 'No se pudo eliminar');
    } finally {
      this.busy = false;
    }
  }

  async openInEditor(post: Post3D): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      const blob = await this.social.downloadModel(post);
      await this.router.navigate(['/editor']);
      await this.files.loadGLBBlob(blob, post.title);
      this.notifications.success(`“${post.title}” se cargó en el editor.`, 'Modelo cargado');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'No se pudo cargar el modelo en el editor.';
      this.notifications.error(this.error, 'No se pudo cargar el modelo');
    } finally {
      this.busy = false;
    }
  }

  trackPost(_index: number, post: Post3D): string {
    return post.id;
  }
}
