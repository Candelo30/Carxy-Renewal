import { Component, OnDestroy, OnInit, inject } from '@angular/core';
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

@Component({
  selector: 'app-editor-page',
  standalone: true,
  imports: [
    ModelEditor,
    ModelViewer,
    ShellHeaderComponent,
    PublishModalComponent,
    OnboardingComponent,
  ],
  templateUrl: './editor-page.html',
  styleUrl: './editor-page.css',
})
export class EditorPage implements OnInit, OnDestroy {
  language: 'es' | 'en' = 'es';
  presentationMode = false;
  publishModalOpen = false;
  modelEditorOpen = true;
  mobileMenuOpen = false;
  onboardingOpen = false;
  onboardingStep = 'welcome';

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly onboarding = inject(OnboardingService);
  private readonly threeEngine = inject(ThreeEngineService);
  private readonly subscription = new Subscription();

  private hasAddedPrimitive = false;
  private hasTransformed = false;
  private hasChangedMaterial = false;

  ngOnInit(): void {
    this.subscription.add(this.route.queryParamMap.subscribe((params) => {
      if (params.get('publish') === '1') this.publishModalOpen = true;
    }));

    // Iniciar onboarding si es la primera vez
    this.subscription.add(this.onboarding.state$.subscribe((state) => {
      this.onboardingOpen = !state.seen;
      this.onboardingStep = state.currentStep;
    }));

    // Si nunca se vio antes, iniciar
    if (!this.onboarding.state.value.seen) {
      this.onboarding.start();
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

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
