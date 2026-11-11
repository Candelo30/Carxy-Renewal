import { isPlatformBrowser } from '@angular/common';
import { Component, OnDestroy, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, Subscription, take } from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { ModelEditor } from '../model-editor/model-editor';
import { ModelViewer } from '../model-viewer/model-viewer';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { PublishModalComponent } from '../publish-modal/publish-modal';
import { OnboardingComponent } from '../../shared/components/onboarding/onboarding';
import { OnboardingService } from '../../core/services/onboarding';
import { ThreeEngineService } from '../../core/services/three-engine';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { I18nService } from '../../core/services/i18n';
import { EditorStatusService } from '../../core/services/editor-status.service';

interface SavedView {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  createdAt: number;
}

@Component({
  selector: 'app-editor-page',
  standalone: true,
  imports: [
    ModelEditor,
    ModelViewer,
    ShellHeaderComponent,
    PublishModalComponent,
    OnboardingComponent,
    TranslatePipe,
  ],
  templateUrl: './editor-page.html',
  styleUrl: './editor-page.css',
})
export class EditorPage implements OnInit, OnDestroy {
  presentationMode = false;
  publishModalOpen = false;
  modelEditorOpen = true;
  mobileMenuOpen = false;
  onboardingOpen = false;
  onboardingStep = 'welcome';

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly onboarding = inject(OnboardingService);
  private readonly threeEngine = inject(ThreeEngineService);
  private readonly i18n = inject(I18nService);
  private readonly subscription = new Subscription();
  readonly editorStatus = inject(EditorStatusService);

  readonly savedViews = signal<SavedView[]>([]);

  private hasAddedPrimitive = false;
  private hasTransformed = false;
  private hasChangedMaterial = false;
  private tutorialRequested = false;

  ngOnInit(): void {
    this.subscription.add(this.route.queryParamMap.subscribe((params) => {
      if (params.get('publish') === '1') this.publishModalOpen = true;
      if (params.get('tutorial') === '1') {
        this.tutorialRequested = true;
        this.openTutorial();
        // Quitar el parámetro para que una recarga normal no vuelva a abrir el tutorial.
        if (isPlatformBrowser(this.platformId)) {
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { tutorial: null },
            queryParamsHandling: 'merge',
            replaceUrl: true,
          });
        }
      }
    }));

    // Mantener el paso actual sincronizado con el servicio.
    this.subscription.add(this.onboarding.state$.subscribe((state) => {
      this.onboardingStep = state.currentStep;
    }));

    // Primera visita: abrir el tutorial una sola vez. `start()` marca el estado
    // como visto para que no reaparezca en cada recarga. Solo se decide en el
    // navegador porque el servidor no tiene acceso al almacenamiento local.
    this.loadSavedViews();
    if (isPlatformBrowser(this.platformId) && !this.tutorialRequested && !this.onboarding.state.value.seen) {
      this.openTutorial();
    }

    // Detectar pasos automáticamente del motor 3D
    this.subscription.add(this.threeEngine.sceneChanged$.subscribe(() => {
      if (!this.hasAddedPrimitive && this.threeEngine.getSceneObjects().length > 0) {
        this.hasAddedPrimitive = true;
        if (this.onboardingStep === 'add-primitive') {
          this.onboarding.nextStep();
        }
      }
    }));

    this.subscription.add(this.threeEngine.transformChanged$.subscribe(() => {
      if (!this.hasTransformed) {
        this.hasTransformed = true;
        if (this.onboardingStep === 'transform') {
          this.onboarding.nextStep();
        }
      }
    }));

    this.subscription.add(this.threeEngine.materialsLoaded$.subscribe(() => {
      if (!this.hasChangedMaterial) {
        this.hasChangedMaterial = true;
        if (this.onboardingStep === 'material') {
          this.onboarding.nextStep();
        }
      }
    }));
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

  onPresentationChange(enabled: boolean): void {
    this.presentationMode = enabled;
    // Sincronizar el modo presentación con el motor 3D para que la cámara
    // orbital se detenga al presentar y vuelva a habilitarse al salir.
    if (this.threeEngine.presentationEnabled !== enabled) {
      this.threeEngine.togglePresentation();
    }
  }

  saveViewPrompt(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const state = this.threeEngine.getCameraState();
    if (!state) return;
    const name = window.prompt(
      this.i18n.translate('editor.views.namePrompt'),
      this.i18n.translate('editor.views.defaultName', { n: this.savedViews().length + 1 }),
    );
    if (!name?.trim()) return;
    const view = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      position: state.position,
      target: state.target,
      createdAt: Date.now(),
    };
    this.savedViews.update((views) => [...views, view].slice(-12));
    this.persistSavedViews();
  }

  applyView(view: SavedView): void {
    this.threeEngine.restoreCameraState(view);
  }

  deleteView(view: SavedView): void {
    this.savedViews.update((views) => views.filter((v) => v.id !== view.id));
    this.persistSavedViews();
  }

  trackView(_index: number, view: SavedView): string {
    return view.id;
  }

  private loadSavedViews(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const raw = localStorage.getItem('forma-3d-saved-views');
      if (raw) this.savedViews.set(JSON.parse(raw));
    } catch {
      this.savedViews.set([]);
    }
  }

  private persistSavedViews(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem('forma-3d-saved-views', JSON.stringify(this.savedViews()));
    } catch {
      // Una vista actualizada solo no se persiste si no hay espacio;
      // seguimos operando con la copia en memoria sin romper la UI.
    }
  }

  async onPublishClick(): Promise<void> {
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    if (user) {
      this.publishModalOpen = true;
      // Si el onboarding está en el paso de publicación, avanzar
      if (this.onboardingStep === 'publish') {
        this.onboarding.nextStep();
      }
      return;
    }
    await this.router.navigate(['/login'], { queryParams: { returnUrl: '/editor?publish=1' } });
  }

  onOnboardingComplete(): void {
    this.onboardingOpen = false;
    this.onboarding.skip(); // Marcar como completado para que no vuelva a aparecer
  }

  private openTutorial(): void {
    this.onboarding.reset();
    this.onboardingStep = 'welcome';
    this.onboardingOpen = true;
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
