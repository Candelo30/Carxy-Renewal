import { AsyncPipe } from '@angular/common';
import { Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { OnboardingService } from '../../../core/services/onboarding';
import { NotificationService } from '../../../core/services/notifications';
import { I18nService } from '../../../core/services/i18n';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [AsyncPipe, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.css',
})
export class OnboardingComponent {
  readonly onboarding = inject(OnboardingService);
  readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);

  readonly step = input<string>('welcome');
  readonly onComplete = output<void>();

  readonly currentStep = this.onboarding.currentStep$;
  readonly stepLabel = this.onboarding.getStepLabel.bind(this.onboarding);

  isActive(step: string): boolean {
    return this.onboarding.state.value.currentStep === step;
  }

  isCompleted(step: string): boolean {
    return this.onboarding.state.value.completedSteps.includes(step as any);
  }

  isLastStep(): boolean {
    return this.onboarding.state.value.currentStep === 'completed';
  }

  next(): void {
    this.onboarding.nextStep();
  }

  skip(): void {
    this.onboarding.skip();
    this.onComplete.emit();
    this.notifications.info(
      this.i18n.translate('Tutorial omitido. Puedes volver a activarlo desde los ajustes.'),
      this.i18n.translate('Tutorial'),
    );
  }

  finish(): void {
    this.onComplete.emit();
    this.notifications.success(
      this.i18n.translate('¡Tutorial completado! Ya puedes crear y publicar modelos 3D.'),
      this.i18n.translate('Tutorial'),
    );
  }

  getStepNumber(step: string): number {
    const order: string[] = ['welcome', 'add-primitive', 'transform', 'material', 'publish', 'collaborate', 'completed'];
    return order.indexOf(step) + 1;
  }

  getTotalSteps(): number {
    return 6;
  }

  getProgressPercent(): number {
    const order: string[] = ['welcome', 'add-primitive', 'transform', 'material', 'publish', 'collaborate', 'completed'];
    const idx = order.indexOf(this.onboarding.state.value.currentStep);
    return Math.round(((idx) / (order.length - 1)) * 100);
  }
}
