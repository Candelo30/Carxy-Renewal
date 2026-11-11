import { DOCUMENT } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth';
import { I18nService } from '../../../core/services/i18n';
import { LocalStateService } from '../../../core/services/local-state';
import { NotificationService } from '../../../core/services/notifications';
import { ThemeService } from '../../../core/services/theme.service';
import { copyText } from '../../../core/utils/share';
import { TranslatePipe } from '../../pipes/translate.pipe';

type CommandGroup = 'Navegación' | 'Recursos' | 'Acciones' | 'Editor';
type Theme = 'dark' | 'light' | 'system';

interface CommandItem {
  id: string;
  label: string;
  description: string;
  group: CommandGroup;
  icon: string;
  keywords: string;
  run: () => void | Promise<void>;
}

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.css',
})
export class CommandPaletteComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly localState = inject(LocalStateService);
  private readonly notifications = inject(NotificationService);
  private readonly themeService = inject(ThemeService);
  private readonly document = inject(DOCUMENT);

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  readonly user = toSignal(this.auth.user$, { initialValue: null });
  readonly isOpen = signal(false);
  readonly query = signal('');
  readonly activeIndex = signal(0);

  readonly commands = computed<CommandItem[]>(() => {
    // Leer el idioma dentro del computed hace que los comandos se recalculen
    // cuando el usuario cambia de idioma.
    this.i18n.language();
    const tr = (text: string) => this.i18n.translate(text);
    const user = this.user();
    const items: CommandItem[] = [
      {
        id: 'editor',
        label: tr('Abrir el editor 3D'),
        description: tr('Crea, importa y edita una escena'),
        group: 'Navegación',
        icon: '◇',
        keywords: 'editor 3d crear modelar escena create model scene',
        run: () => this.go('/editor'),
      },
      {
        id: 'feed',
        label: tr('Explorar la comunidad'),
        description: tr('Descubre y remixea modelos publicados'),
        group: 'Navegación',
        icon: '◎',
        keywords: 'feed comunidad explorar galeria modelos community explore gallery',
        run: () => this.go('/feed'),
      },
      {
        id: 'my-models',
        label: tr('Mis creaciones'),
        description: tr('Gestiona tu portafolio y su visibilidad'),
        group: 'Navegación',
        icon: '▤',
        keywords: 'mis modelos portafolio publicaciones my models portfolio posts',
        run: () => this.go('/my-models'),
      },
      {
        id: 'getting-started',
        label: tr('Guía de inicio'),
        description: tr('Tu primera creación paso a paso'),
        group: 'Recursos',
        icon: '✦',
        keywords: 'guia inicio empezar tutorial primeros pasos getting started guide',
        run: () => this.go('/getting-started'),
      },
      {
        id: 'help',
        label: tr('Centro de ayuda'),
        description: tr('Documentación y preguntas frecuentes'),
        group: 'Recursos',
        icon: '?',
        keywords: 'ayuda documentacion soporte preguntas help center docs faq support',
        run: () => this.go('/help'),
      },
      {
        id: 'community-help',
        label: tr('Ayuda comunitaria'),
        description: tr('Preguntas y respuestas de la comunidad'),
        group: 'Recursos',
        icon: '◍',
        keywords: 'ayuda comunidad preguntas respuestas foro community help questions answers',
        run: () => this.go('/community-help'),
      },
      {
        id: 'contact',
        label: tr('Contacto'),
        description: tr('Escríbenos y cuéntanos qué necesitas'),
        group: 'Recursos',
        icon: '✉',
        keywords: 'contacto soporte escribir mensaje contact support write message',
        run: () => this.go('/contact'),
      },
      {
        id: 'editor-save',
        label: tr('Guardar escena'),
        description: tr('Guarda el progreso actual en el editor'),
        group: 'Editor',
        icon: '💾',
        keywords: 'guardar salvar escena save guardar escena save scene guardar proyecto',
        run: () => this.go('/editor', { queryParams: { action: 'save' } }),
      },
      {
        id: 'editor-capture',
        label: tr('Capturar imagen'),
        description: tr('Descarga una captura PNG del viewport'),
        group: 'Editor',
        icon: '📷',
        keywords: 'captura screenshot imagen png exportar captura capture screenshot',
        run: () => this.go('/editor', { queryParams: { action: 'capture' } }),
      },
      {
        id: 'editor-undo',
        label: tr('Deshacer en el editor'),
        description: tr('Deshace el cambio más reciente'),
        group: 'Editor',
        icon: '↩',
        keywords: 'deshacer undo deshacer deshacer cambio revertir',
        run: () => this.go('/editor', { queryParams: { action: 'undo' } }),
      },
      {
        id: 'editor-redo',
        label: tr('Rehacer en el editor'),
        description: tr('Rehace el cambio más reciente'),
        group: 'Editor',
        icon: '↪',
        keywords: 'rehacer redo rehacer deshacer restaurar',
        run: () => this.go('/editor', { queryParams: { action: 'redo' } }),
      },
      {
        id: 'editor-duplicate',
        label: tr('Duplicar objeto'),
        description: tr('Duplica la selección actual del editor'),
        group: 'Editor',
        icon: '⇲',
        keywords: 'duplicar copiar objeto duplicar duplicate copy objeto en editor',
        run: () => this.go('/editor', { queryParams: { action: 'duplicate' } }),
      },
      {
        id: 'editor-present',
        label: tr('Activar modo presentación'),
        description: tr('Inicia un turntable automático'),
        group: 'Editor',
        icon: '🎬',
        keywords: 'presentacion presentation turntable auto orbitar cine present',
        run: () => this.go('/editor', { queryParams: { action: 'present' } }),
      },
      {
        id: 'gizmo-translate',
        label: tr('Gizmo: mover'),
        description: tr('Cambia el gizmo a modo Mover'),
        group: 'Editor',
        icon: '↕',
        keywords: 'gizmo mover translate mover objeto move gizmo mover',
        run: () => this.go('/editor', { queryParams: { action: 'gizmo-translate' } }),
      },
      {
        id: 'gizmo-rotate',
        label: tr('Gizmo: rotar'),
        description: tr('Cambia el gizmo a modo Rotar'),
        group: 'Editor',
        icon: '↻',
        keywords: 'gizmo rotar rotate rotar objeto rotate gizmo rotar',
        run: () => this.go('/editor', { queryParams: { action: 'gizmo-rotate' } }),
      },
      {
        id: 'gizmo-scale',
        label: tr('Gizmo: escalar'),
        description: tr('Cambia el gizmo a modo Escalar'),
        group: 'Editor',
        icon: '⤡',
        keywords: 'gizmo escalar scale escalar objeto resize scale gizmo escalar',
        run: () => this.go('/editor', { queryParams: { action: 'gizmo-scale' } }),
      },
      {
        id: 'shortcuts',
        label: tr('Atajos de teclado'),
        description: tr('Consulta los atajos del editor'),
        group: 'Recursos',
        icon: '⌘',
        keywords: 'atajos teclado shortcuts comandos keyboard',
        run: () => this.go('/help', { fragment: 'atajos' }),
      },
      {
        id: 'security',
        label: tr('Cuenta y seguridad'),
        description: tr('Contraseñas, privacidad y datos'),
        group: 'Recursos',
        icon: '◈',
        keywords: 'seguridad cuenta privacidad datos contrasena account security privacy data password',
        run: () => this.go('/help', { fragment: 'seguridad' }),
      },
      {
        id: 'about',
        label: tr('Sobre el proyecto'),
        description: tr('Conoce CARXY, su stack y su roadmap'),
        group: 'Recursos',
        icon: '◌',
        keywords: 'sobre nosotros about proyecto carxy project stack roadmap',
        run: () => this.go('/about'),
      },
      {
        id: 'theme',
        label: tr('Cambiar tema'),
        description: tr('Alterna entre tema claro y oscuro'),
        group: 'Acciones',
        icon: '◐',
        keywords: 'tema oscuro claro apariencia color theme dark light appearance',
        run: () => this.toggleTheme(),
      },
      {
        id: 'tutorial',
        label: tr('Relanzar el tutorial'),
        description: tr('Abre el tutorial guiado del editor'),
        group: 'Acciones',
        icon: '✧',
        keywords: 'tutorial onboarding guia editor aprender guided tour',
        run: () => this.go('/editor', { queryParams: { tutorial: '1' } }),
      },
      {
        id: 'publish',
        label: tr('Publicar un modelo'),
        description: tr('Abre el editor con el formulario de publicación'),
        group: 'Acciones',
        icon: '↑',
        keywords: 'publicar compartir modelo subir publish share model upload',
        run: () => this.go('/editor', { queryParams: { publish: '1' } }),
      },
      {
        id: 'copy-link',
        label: tr('Copiar enlace actual'),
        description: tr('Copia esta página al portapapeles'),
        group: 'Acciones',
        icon: '⧉',
        keywords: 'copiar enlace compartir url portapapeles copy link clipboard',
        run: () => this.copyCurrentLink(),
      },
    ];

    if (user) {
      items.splice(3, 0,
        {
          id: 'favorites',
          label: tr('Mis favoritos'),
          description: tr('Modelos que guardaste para volver a verlos'),
          group: 'Navegación',
          icon: '♡',
          keywords: 'favoritos likes guardados favorites saved',
          run: () => this.go('/favorites'),
        },
        {
          id: 'messages',
          label: tr('Mensajes'),
          description: tr('Conversaciones con otros creadores'),
          group: 'Navegación',
          icon: '✉',
          keywords: 'chat mensajes conversaciones messages conversations',
          run: () => this.go('/chat'),
        },
        {
          id: 'profile',
          label: tr('Mi perfil'),
          description: tr('Abre tu perfil público de creador'),
          group: 'Navegación',
          icon: '◉',
          keywords: 'perfil cuenta creador my profile account creator',
          run: () => this.go(['/profile', user.uid]),
        },
      );

      if (user.role === 'admin') {
        items.push({
          id: 'admin',
          label: tr('Panel de administración'),
          description: tr('Usuarios, moderación y reportes'),
          group: 'Navegación',
          icon: '⚙',
          keywords: 'admin administracion panel moderacion users reports',
          run: () => this.go('/admin'),
        });
      } else if (user.role === 'moderator') {
        items.push({
          id: 'moderation',
          label: tr('Panel de moderación'),
          description: tr('Revisa reportes y contenido'),
          group: 'Navegación',
          icon: '⚑',
          keywords: 'moderacion moderar reportes moderation reports content',
          run: () => this.go('/moderation'),
        });
      }

      items.push({
        id: 'logout',
        label: tr('Cerrar sesión'),
        description: tr('Salir de tu cuenta en este dispositivo'),
        group: 'Acciones',
        icon: '⏻',
        keywords: 'logout salir cerrar sesion sign out',
        run: () => this.logout(),
      });
    } else {
      items.push(
        {
          id: 'login',
          label: tr('Iniciar sesión'),
          description: tr('Entra en tu cuenta de CARXY'),
          group: 'Acciones',
          icon: '→',
          keywords: 'login entrar iniciar sesion cuenta sign in',
          run: () => this.go('/login'),
        },
        {
          id: 'register',
          label: tr('Crear cuenta'),
          description: tr('Regístrate para publicar y comentar'),
          group: 'Acciones',
          icon: '+',
          keywords: 'registro crear cuenta signup create account',
          run: () => this.go('/register'),
        },
      );
    }

    return items;
  });

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.commands();
    return this.commands().filter((item) =>
      `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(q),
    );
  });

  readonly grouped = computed(() => {
    const groups: { name: CommandGroup; items: CommandItem[] }[] = [];
    for (const item of this.filtered()) {
      let group = groups.find((entry) => entry.name === item.group);
      if (!group) {
        group = { name: item.group, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  });

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'k') {
      event.preventDefault();
      this.toggle();
      return;
    }

    if (!this.isOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void this.execute(this.activeCommand());
    }
  }

  open(): void {
    if (this.isOpen()) return;
    this.query.set('');
    this.activeIndex.set(0);
    this.isOpen.set(true);
    setTimeout(() => this.searchInput?.nativeElement.focus(), 30);
  }

  close(): void {
    this.isOpen.set(false);
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  onQueryChange(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
  }

  indexOf(item: CommandItem): number {
    return this.filtered().indexOf(item);
  }

  activeCommand(): CommandItem | null {
    const items = this.filtered();
    if (!items.length) return null;
    return items[Math.min(this.activeIndex(), items.length - 1)] ?? null;
  }

  move(delta: number): void {
    const length = this.filtered().length;
    if (!length) return;
    this.activeIndex.set((this.activeIndex() + delta + length) % length);
  }

  async execute(item: CommandItem | null): Promise<void> {
    if (!item) return;
    this.close();
    try {
      await item.run();
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo ejecutar el comando.'),
        this.i18n.translate('Acción no completada'),
      );
    }
  }

  private go(
    path: string | string[],
    extras?: { queryParams?: Record<string, string>; fragment?: string },
  ): void {
    void this.router.navigate(Array.isArray(path) ? path : [path], {
      ...extras,
      queryParamsHandling: 'merge',
    });
  }

  private toggleTheme(): void {
    const preferences = this.localState.loadPreferences();
    const themeOrder: Theme[] = ['dark', 'light', 'system'];
    const currentIndex = themeOrder.indexOf(preferences.theme);
    const theme = themeOrder[(currentIndex + 1) % themeOrder.length];
    this.localState.savePreferences({ ...preferences, theme });
    this.themeService.apply({ theme, accentColor: preferences.accentColor });
    this.notifications.success(
      this.i18n.translate('Tema {theme} activado.', {
        theme: this.i18n.translate(theme === 'dark' ? 'oscuro' : theme === 'light' ? 'claro' : 'sistema'),
      }),
      this.i18n.translate('Apariencia actualizada'),
    );
  }

  private async copyCurrentLink(): Promise<void> {
    await copyText(this.document.location.href);
    this.notifications.success(
      this.i18n.translate('Enlace copiado al portapapeles.'),
      this.i18n.translate('Compartir'),
    );
  }

  private async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
