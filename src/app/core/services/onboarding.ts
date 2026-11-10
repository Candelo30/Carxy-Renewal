import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { LOCAL_KEYS } from '../config/app.constants';
import { I18nService } from './i18n';

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

const ONBOARDING_STEPS: OnboardingStep[] = [
  'welcome',
  'add-primitive',
  'transform',
  'material',
  'publish',
  'completed',
];

function normalizeState(value: unknown): OnboardingState {
  const saved = value && typeof value === 'object'
    ? value as Partial<OnboardingState>
    : {};
  const currentStep = saved.currentStep && ONBOARDING_STEPS.includes(saved.currentStep)
    ? saved.currentStep
    : 'welcome';
  const completedSteps = Array.isArray(saved.completedSteps)
    ? [...new Set(saved.completedSteps.filter(
      (step): step is OnboardingStep => ONBOARDING_STEPS.includes(step as OnboardingStep),
    ))]
    : [];
  return {
    seen: saved.seen === true,
    currentStep,
    completedSteps,
    dismissedAt: typeof saved.dismissedAt === 'number' ? saved.dismissedAt : undefined,
  };
}

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
  private readonly i18n = inject(I18nService);
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
      const raw = localStorage.getItem(LOCAL_KEYS.onboarding);
      if (raw) return normalizeState(JSON.parse(raw));

      // Migración: versiones anteriores guardaban el onboarding dentro de las
      // preferencias del editor, donde podía sobrescribirse al guardar temas.
      const legacyRaw = localStorage.getItem(LOCAL_KEYS.preferences);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw) as { onboarding?: unknown };
        if (legacy.onboarding) {
          const migrated = normalizeState(legacy.onboarding);
          localStorage.setItem(LOCAL_KEYS.onboarding, JSON.stringify(migrated));
          return migrated;
        }
      }
    } catch (error) {
      console.warn('No se pudo recuperar el estado de onboarding.', error);
    }
    return { ...DEFAULT_STATE };
  }

  private writeLocal(next: OnboardingState): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(LOCAL_KEYS.onboarding, JSON.stringify(next));
    } catch (error) {
      console.warn('No se pudo guardar el estado de onboarding.', error);
    }
  }

  getStepLabel(step: OnboardingStep): { title: string; description: string } {
    const label = STEP_LABELS[step];
    return {
      title: this.i18n.translate(label.title),
      description: this.i18n.translate(label.description),
    };
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
