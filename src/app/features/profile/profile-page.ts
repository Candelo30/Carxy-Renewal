import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, startWith, switchMap } from 'rxjs';
import { Post3D, User } from '../../core/models/social.models';
import { AuthService } from '../../core/services/auth';
import { SocialService } from '../../core/services/social';
import { NotificationService } from '../../core/services/notifications';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { AccountMenuComponent } from '../../shared/components/account-menu/account-menu';
import { ModelPreviewComponent } from '../../shared/components/model-preview/model-preview';
import { ActivityNotificationsComponent } from '../../shared/components/activity-notifications/activity-notifications';

@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [AccountMenuComponent, ActivityNotificationsComponent, AsyncPipe, DatePipe, FormsModule, LoadingSpinner, ModelPreviewComponent, RouterLink],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.css',
})
export class ProfilePage {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  readonly social = inject(SocialService);
  private readonly notifications = inject(NotificationService);
  readonly user$ = this.auth.user$;
  readonly posts$ = this.social.posts$.pipe(
    catchError((error: unknown) => {
      console.error('No se pudo cargar el portafolio del creador.', error);
      const message = error instanceof Error ? error.message : '';
      this.error = message.includes('The query requires an index')
        ? 'Falta desplegar un índice de Firestore para cargar los modelos. Ejecuta `firebase deploy --only firestore:indexes`.'
        : message || 'No se pudo cargar el portafolio.';
      this.notifications.error(this.error, 'No se pudo cargar el perfil');
      return of([]);
    }),
  );
  readonly profile$ = this.route.paramMap.pipe(switchMap((params) => {
    const uid = params.get('uid') ?? '';
    return combineLatest([this.posts$, this.auth.user$, this.social.profile$(uid)]).pipe(
      switchMap(([publicPosts, currentUser, remoteProfile]) => {
        const isOwner = currentUser?.uid === uid;
        const profile = isOwner
          ? { ...(remoteProfile ?? currentUser), ...currentUser, bio: remoteProfile?.bio ?? currentUser.bio }
          : remoteProfile ?? publicPosts.find((post) => post.author.uid === uid)?.author ?? null;
        const posts$ = isOwner
          ? this.social.userPosts$(uid, true)
          : of(publicPosts.filter((post) => post.authorId === uid || post.author.uid === uid));
        return combineLatest([posts$, this.social.followCounts$(uid)]).pipe(
          map(([posts, followCounts]) => ({ uid, profile, posts, currentUser, followCounts })),
        );
      }),
      startWith(null),
    );
  }));
  name = '';
  bio = '';
  photoURL = '';
  status = '';
  error = '';
  readonly previewModes: Record<string, boolean> = {};

  totalLikes(posts: Post3D[]): number {
    return posts.reduce((total, post) => total + post.likes, 0);
  }

  isOwner(profile: User | null, currentUser: User | null): boolean {
    return !!profile && profile.uid === currentUser?.uid;
  }

  async saveProfile(profile: User, dialog: HTMLDialogElement): Promise<void> {
    this.status = '';
    this.error = '';
    try {
      await this.auth.updateUser({
        displayName: this.name.trim(),
        bio: this.bio.trim(),
        photoURL: this.photoURL.trim() || null,
      });
      this.status = 'Perfil actualizado.';
      this.notifications.success(this.status, 'Perfil actualizado');
      dialog.close();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'No se pudo actualizar el perfil.';
      this.notifications.error(this.error);
    }
  }

  prepareEdit(profile: User): void {
    this.name = profile.displayName;
    this.bio = profile.bio;
    this.photoURL = profile.photoURL ?? '';
  }

  trackPost(_index: number, post: Post3D): string {
    return post.id;
  }

  useFallbackAvatar(event: Event): void {
    const image = event.target;
    if (image instanceof HTMLImageElement) image.src = '/user-avatar.svg';
  }

  async toggleFollow(profile: User, currentUser: User, following: boolean): Promise<void> {
    try {
      if (following) await this.social.unfollowUser(currentUser.uid, profile.uid);
      else await this.social.followUser(currentUser, profile.uid);
      this.notifications.success(following ? 'Dejaste de seguir a este creador.' : `Ahora sigues a ${profile.displayName}.`);
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'No se pudo actualizar el seguimiento.');
    }
  }

  togglePreview(postId: string): void {
    this.previewModes[postId] = !this.previewModes[postId];
  }
}
