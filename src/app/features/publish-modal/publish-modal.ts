import { AsyncPipe } from '@angular/common';
import { afterNextRender, Component, EventEmitter, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, take } from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { FileHandler } from '../../core/services/file-handler';
import { SocialService } from '../../core/services/social';
import { ThreeEngineService } from '../../core/services/three-engine';
import { LocalStateService } from '../../core/services/local-state';
import { NotificationService } from '../../core/services/notifications';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';

@Component({
  selector: 'app-publish-modal',
  standalone: true,
  imports: [FormsModule, AsyncPipe, LoadingSpinner, RouterLink],
  templateUrl: './publish-modal.html',
  styleUrl: './publish-modal.css',
})
export class PublishModalComponent {
  @Output() closed = new EventEmitter<void>();
  title = '';
  description = '';
  error = '';
  busy = false;
  readonly user$ = inject(AuthService).user$;
  private readonly auth = inject(AuthService);
  private readonly fileHandler = inject(FileHandler);
  private readonly social = inject(SocialService);
  private readonly engine = inject(ThreeEngineService);
  private readonly localState = inject(LocalStateService);
  private readonly notifications = inject(NotificationService);
  preview: string | null = null;

  constructor() {
    afterNextRender(() => {
      this.preview = this.engine.captureImageDataUrl();
    });
  }

  close(): void {
    if (!this.busy) this.closed.emit();
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
      await this.social.publish(this.title, this.description, model, this.preview, author);
      this.notifications.success('Tu modelo ya está disponible en la comunidad.', 'Modelo publicado');
      this.closed.emit();
    } catch (error) {
      console.error('No se pudo publicar el modelo.', error);
      this.error = error instanceof Error ? error.message : 'No se pudo publicar el modelo.';
      this.notifications.error(this.error, 'No se pudo publicar');
    } finally {
      this.busy = false;
    }
  }
}
