import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { LOCAL_KEYS } from '../config/app.constants';

export type OnboardingStep =
  | 'welcome'
  | 'add-primitive'
  | 'transform'
  | 'material'
  | 'publish'
  | 'completed';

export interface OnboardingState {
  seen: boolean;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  dismissedAt?: number;
}

const DEFAULT_STATE: OnboardingState = {
  seen: false,
  currentStep: 'welcome',
  completedSteps: [],
};

const STEP_LABELS: Record<OnboardingStep, { title: string; description: string }> = {
  welcome: {
    title: 'Bienvenido a CARXY 3D STUDIO',
    description: 'Vamos a crear tu primera escena 3D en menos de un minuto.',
  },
  'add-primitive': {
    title: 'Agrega tu primera forma',
    description: 'Haz clic en cualquiera de las formas de la barra de primitivas para añadirla a la escena.',
  },
  transform: {
    title: 'Mueve, rota y escala',
    description: 'Usa el gizmo o los controles de posición, rotación y escala para manipular el objeto.',
  },
  material: {
    title: 'Dale color y material',
    description: 'Selecciona el objeto y edita su color, rugosidad y opacidad en el panel de materiales.',
  },
  publish: {
    title: 'Publica tu creación',
    description: 'Cuando estés listo, haz clic en "Publicar" para compartir tu modelo con la comunidad.',
  },
  completed: {
    title: '¡Listo!',
    description: 'Ya conoces lo básico. Puedes seguir creando o explorar la comunidad.',
  },
};

@Injectable({ providedIn: 'root' })
export class OnboardingService {
  readonly state = new BehaviorSubject<OnboardingState>(
    this.readLocal()
  );
  readonly state$ = this.state.asObservable();

  readonly currentStep$ = this.state.pipe(
    map((s) => s.currentStep)
  );
  readonly isCompleted$ = this.state.pipe(
    map((s) => s.currentStep === 'completed' || s.seen && s.completedSteps.length >= 5)
  );

  private readLocal(): OnboardingState {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_STATE };
    try {
      const raw = localStorage.getItem(LOCAL_KEYS.preferences);
      if (!raw) return { ...DEFAULT_STATE };
      const saved = JSON.parse(raw) as { onboarding?: OnboardingState };
      return saved.onboarding ?? { ...DEFAULT_STATE };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private writeLocal(next: OnboardingState): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(LOCAL_KEYS.preferences);
      const saved = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      localStorage.setItem(
        LOCAL_KEYS.preferences,
        JSON.stringify({ ...saved, onboarding: next })
      );
    } catch (error) {
      console.warn('No se pudo guardar el estado de onboarding.', error);
    }
  }

  getStepLabel(step: OnboardingStep): { title: string; description: string } {
    return STEP_LABELS[step];
  }

  start(): void {
    const next: OnboardingState = {
      ...this.state.value,
      seen: true,
      currentStep: 'welcome',
      completedSteps: [],
    };
    this.state.next(next);
    this.writeLocal(next);
  }

  nextStep(): void {
    const order: OnboardingStep[] = [
      'welcome',
      'add-primitive',
      'transform',
      'material',
      'publish',
      'completed',
    ];
    const current = this.state.value.currentStep;
    const idx = order.indexOf(current);
    const nextIdx = idx + 1;
    const nextStep = order[nextIdx] ?? 'completed';

    const completed = [...this.state.value.completedSteps];
    if (!completed.includes(current)) completed.push(current);

    const next: OnboardingState = {
      ...this.state.value,
      currentStep: nextStep,
      completedSteps: completed,
    };
    this.state.next(next);
    this.writeLocal(next);
  }

  skip(): void {
    const next: OnboardingState = {
      ...this.state.value,
      currentStep: 'completed',
      seen: true,
      dismissedAt: Date.now(),
    };
    this.state.next(next);
    this.writeLocal(next);
  }

  reset(): void {
    this.start();
  }

  isStepActive(step: OnboardingStep): boolean {
    return this.state.value.currentStep === step;
  }

  isStepCompleted(step: OnboardingStep): boolean {
    return this.state.value.completedSteps.includes(step);
  }
}
