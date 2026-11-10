import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FileHandler } from '../../core/services/file-handler';
import { AuthService } from '../../core/services/auth';
import { ThreeEngineService } from '../../core/services/three-engine';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { NotificationService } from '../../core/services/notifications';
import { AccountMenuComponent } from '../../shared/components/account-menu/account-menu';
import { ActivityNotificationsComponent } from '../../shared/components/activity-notifications/activity-notifications';
import { I18nService } from '../../core/services/i18n';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

@Component({
  imports: [ActivityNotificationsComponent, AsyncPipe, RouterLink, AccountMenuComponent, TranslatePipe],
  selector: 'app-top-toolbar',
  styleUrl: './top-toolbar.css',
  templateUrl: './top-toolbar.html',
})
export class TopToolbar implements OnInit, OnDestroy {
  readonly brand = environment.brand;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  readonly user$ = this.auth.user$;
  @Output() presentationChange = new EventEmitter<boolean>();
  @Output() publishClick = new EventEmitter<void>();
  public presentationEnabled = false;
  public statusMessage = '';
  private statusSubscription?: Subscription;

  constructor(
    private fileHandler: FileHandler,
    private threeEngine: ThreeEngineService, // Inyectar aquí
  ) {}

  ngOnInit(): void {
    this.statusSubscription = this.threeEngine.xrStatus$.subscribe((message) => {
      this.statusMessage = message;
    });
    this.statusSubscription.add(this.threeEngine.presentationChanged$.subscribe((enabled) => {
      this.presentationEnabled = enabled;
      this.presentationChange.emit(enabled);
    }));
  }

  onPresentation(): void {
    this.presentationEnabled = this.threeEngine.togglePresentation();
  }

  onRecordTurntable(): void {
    this.threeEngine.recordTurntable();
  }

  onStartAR(): void {
    void this.threeEngine.startAR();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      if (/\.(glb|gltf)$/i.test(file.name)) {
        this.fileHandler.loadLocalGLTF(file);
      } else {
        this.notifications.warning(
          this.i18n.translate('Selecciona un archivo con extensión .glb o .gltf.'),
          this.i18n.translate('Formato no compatible'),
        );
      }
      input.value = '';
    }
  }

  onExport(): void {
    this.fileHandler.exportCurrentModelGLB();
  }

  onTakeScreenshot(): void {
    this.threeEngine.captureImage();
  }

  // NUEVO MÉTODO: Centrar vista
  onResetCamera(): void {
    this.threeEngine.resetCamera();
  }

  async logout(): Promise<void> {
    try {
      await this.auth.logout();
      await this.router.navigate(['/login']);
      this.notifications.info(this.i18n.translate('Tu sesión se ha cerrado.'));
    } catch (error) {
      this.statusMessage = error instanceof Error
        ? this.i18n.translate('No se pudo cerrar sesión: {error}', { error: error.message })
        : this.i18n.translate('No se pudo cerrar sesión.');
      this.notifications.error(this.statusMessage, this.i18n.translate('Error al cerrar sesión'));
    }
  }

  ngOnDestroy(): void {
    this.statusSubscription?.unsubscribe();
  }
}
