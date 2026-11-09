import { AsyncPipe } from '@angular/common';
import { Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OnboardingService } from '../../../core/services/onboarding';
import { NotificationService } from '../../../core/services/notifications';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [AsyncPipe, FormsModule],
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.css',
})
export class OnboardingComponent {
  readonly onboarding = inject(OnboardingService);
  readonly notifications = inject(NotificationService);

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
    this.notifications.info('Tutorial omitido. Puedes volver a activarlo desde los ajustes.', 'Tutorial');
  }

  finish(): void {
    this.onComplete.emit();
    this.notifications.success('¡Tutorial completado! Ya puedes crear y publicar modelos 3D.', 'Tutorial');
  }

  getStepNumber(step: string): number {
    const order: string[] = ['welcome', 'add-primitive', 'transform', 'material', 'publish', 'completed'];
    return order.indexOf(step) + 1;
  }

  getTotalSteps(): number {
    return 5;
  }

  getProgressPercent(): number {
    const order: string[] = ['welcome', 'add-primitive', 'transform', 'material', 'publish', 'completed'];
    const idx = order.indexOf(this.onboarding.state.value.currentStep);
    return Math.round(((idx) / (order.length - 1)) * 100);
  }
}
