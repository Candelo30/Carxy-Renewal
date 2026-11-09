import { AsyncPipe } from '@angular/common';
import { afterNextRender, Component, EventEmitter, inject, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, take } from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { FileHandler } from '../../core/services/file-handler';
import { SocialService } from '../../core/services/social';
import { ThreeEngineService } from '../../core/services/three-engine';
import { LocalStateService } from '../../core/services/local-state';
import { NotificationService } from '../../core/services/notifications';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';

export type PublishStep = 1 | 2 | 3 | 4;

@Component({
  selector: 'app-publish-modal',
  standalone: true,
  imports: [FormsModule, LoadingSpinner],
  templateUrl: './publish-modal.html',
  styleUrl: './publish-modal.css',
})
export class PublishModalComponent {
  readonly closed = output<void>();
  readonly published = output<{ title: string; id: string }>();

  readonly user$ = inject(AuthService).user$;
  private readonly auth = inject(AuthService);
  private readonly fileHandler = inject(FileHandler);
  private readonly social = inject(SocialService);
  private readonly engine = inject(ThreeEngineService);
  private readonly localState = inject(LocalStateService);
  private readonly notifications = inject(NotificationService);

  currentStep: PublishStep = 1;
  title = '';
  description = '';
  tags = '';
  isPrivate = false;
  error = '';
  busy = false;
  preview: string | null = null;
  shareCode: string | null = null;
  publishedPostId: string | null = null;
  publishedPostTitle: string | null = null;

  constructor() {
    afterNextRender(() => {
      this.preview = this.engine.captureImageDataUrl();
    });
  }

  close(): void {
    if (!this.busy) this.closed.emit();
  }

  nextStep(): void {
    if (this.currentStep < 4) {
      this.currentStep = this.currentStep + 1 as PublishStep;
      this.error = '';
    }
  }

  prevStep(): void {
    if (this.currentStep > 1) {
      this.currentStep = this.currentStep - 1 as PublishStep;
      this.error = '';
    }
  }

  get tagsArray(): string[] {
    return [...new Set(this.tags.split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 12);
  }

  async publish(): Promise<void> {
    this.error = '';
    const author = await firstValueFrom(this.auth.user$.pipe(take(1)));
    if (!author) {
      this.error = 'Inicia sesión para publicar tu modelo.';
      this.notifications.warning(this.error);
      return;
    }
    if (!this.title.trim()) {
      this.error = 'Escribe un título para la publicación.';
      this.notifications.warning(this.error);
      return;
    }
    if (!this.preview) {
      this.error = 'El visor todavía no está listo para capturar la imagen.';
      this.notifications.warning(this.error);
      return;
    }

    this.busy = true;
    try {
      const model = await this.fileHandler.createCurrentSceneBlob();
      this.localState.saveDraft(this.engine.serializeScene());

      const post = await this.social.publish(
        this.title,
        this.description,
        model,
        this.preview,
        author,
        this.tagsArray,
        this.isPrivate,
      );

      this.publishedPostId = post.id;
      this.publishedPostTitle = post.title;
      this.shareCode = this.engine.exportSceneWithMetadata({
        title: this.title,
        description: this.description,
        authorId: author.uid,
        authorName: author.displayName,
      });

      this.currentStep = 4;
      this.notifications.success('¡Tu modelo está publicado en la comunidad!', 'Publicado');
      this.published.emit({ title: post.title, id: post.id });
    } catch (error) {
      console.error('No se pudo publicar el modelo.', error);
      this.error = error instanceof Error ? error.message : 'No se pudo publicar el modelo.';
      this.notifications.error(this.error, 'No se pudo publicar');
    } finally {
      this.busy = false;
    }
  }

  copyShareCode(): void {
    if (!this.shareCode) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(this.shareCode).then(() => {
      this.notifications.success('Código de escena copiado al portapapeles.', 'Compartir');
    });
  }

  get stepLabel(): string {
    const labels: Record<PublishStep, string> = {
      1: 'Datos del modelo',
      2: 'Etiquetas y visibilidad',
      3: 'Vista previa',
      4: 'Publicar y compartir',
    };
    return labels[this.currentStep];
  }

  get progressPercent(): number {
    return (this.currentStep / 4) * 100;
  }
}
