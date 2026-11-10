import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable, map, of, startWith, switchMap } from 'rxjs';
import { Post3D, UserProfile } from '../../core/models/social.models';
import { AuthService } from '../../core/services/auth';
import { FileHandler } from '../../core/services/file-handler';
import { I18nService } from '../../core/services/i18n';
import { SocialService } from '../../core/services/social';
import { NotificationService } from '../../core/services/notifications';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';import { TranslatePipe } from '../../shared/pipes/translate.pipe';


@Component({
  selector: 'app-my-models',
  standalone: true,
  imports: [
    TranslatePipe,
    ShellHeaderComponent,
    AsyncPipe,
    DatePipe,
    FormsModule,
    LoadingSpinner,
    RouterLink,
    SiteFooterComponent,
  ],
  templateUrl: './my-models.html',
  styleUrl: './my-models.css',
})
export class MyModelsComponent {
  readonly auth = inject(AuthService);
  mobileMenuOpen = false;
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
  private readonly i18n = inject(I18nService);

  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

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
      this.status = this.i18n.translate('Metadatos guardados.');
      this.notifications.success(this.status, this.i18n.translate('Cambios guardados'));
      dialog.close();
      this.editingPost = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : this.i18n.translate('No se pudieron guardar los cambios.');
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
      this.status = post.isPrivate
        ? this.i18n.translate('El modelo ahora es público.')
        : this.i18n.translate('El modelo ahora es privado.');
      this.notifications.success(this.status, this.i18n.translate('Visibilidad actualizada'));
    } catch (error) {
      this.error = error instanceof Error ? error.message : this.i18n.translate('No se pudo cambiar la privacidad.');
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
      this.status = this.i18n.translate('Se eliminó “{title}”.', { title: this.deletingPost.title });
      this.notifications.success(this.status, this.i18n.translate('Creación eliminada'));
      this.deletingPost = null;
      dialog.close();
    } catch (error) {
      console.error('No se pudo eliminar la creación.', error);
      this.error = error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar el modelo.');
      this.notifications.error(this.error, this.i18n.translate('No se pudo eliminar'));
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
      this.notifications.success(
        this.i18n.translate('“{title}” se cargó en el editor.', { title: post.title }),
        this.i18n.translate('Modelo cargado'),
      );
    } catch (error) {
      this.error = error instanceof Error ? error.message : this.i18n.translate('No se pudo cargar el modelo en el editor.');
      this.notifications.error(this.error, this.i18n.translate('No se pudo cargar el modelo'));
    } finally {
      this.busy = false;
    }
  }

  trackPost(_index: number, post: Post3D): string {
    return post.id;
  }
}
