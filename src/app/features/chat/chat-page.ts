import { AsyncPipe, DatePipe } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
  ElementRef,
  AfterViewChecked,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  Observable,
  Subscription,
  catchError,
  combineLatest,
  distinctUntilChanged,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs';
import { ChatConversation, ChatMessage, User, UserActivity } from '../../core/models/social.models';
import { AuthService } from '../../core/services/auth';
import { SocialService } from '../../core/services/social';
import { NotificationService } from '../../core/services/notifications';
import { I18nService } from '../../core/services/i18n';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import {
  ChatAccentOption,
  ChatFontScale,
} from '../../shared/components/chat-settings/chat-settings';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

/** Claves de preferencias del chat guardadas en `localStorage`. */
const CHAT_BACKGROUND_KEY = 'carxy:chat:bg';
const CHAT_BACKGROUND_PREFIX = 'carxy:chat:bg:';
const CHAT_PINNED_KEY = 'carxy:chat:pinned';
const CHAT_SEEN_KEY = 'carxy:chat:seen';
/** Preferencias del panel de ajustes del chat. */
const CHAT_SETTINGS_KEY = 'carxy:chat:settings';

export interface ChatSettings {
  fontScale: ChatFontScale;
  showTimestamps: boolean;
  accent: string;
  muted: string[];
}

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  fontScale: 'md',
  showTimestamps: true,
  accent: '#8b5cf6',
  muted: [],
};

/** Acentos que se pueden elegir para el chat (el primero es el de la app). */
const CHAT_ACCENTS: ChatAccentOption[] = [
  { value: '#8b5cf6', label: 'Violeta' },
  { value: '#0ea5e9', label: 'Azul' },
  { value: '#10b981', label: 'Verde' },
  { value: '#f59e0b', label: 'Ámbar' },
  { value: '#f43f5e', label: 'Rosa' },
  { value: '#64748b', label: 'Pizarra' },
];
/**
 * Evita reescribir `localStorage` en cada ciclo de detección de cambios:
 * `markSeen` se invoca desde `ngAfterViewChecked`.
 */
const SEEN_THROTTLE_MS = 5000;

export interface GroupedMessage {
  message: ChatMessage;
  firstOfRun: boolean;
}

export interface MessageGroup {
  key: string;
  label: string;
  messages: GroupedMessage[];
}

export interface ConversationWithPartner extends ChatConversation {
  partner?: User | null;
}

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [
    TranslatePipe,
    ShellHeaderComponent,
    AsyncPipe,
    DatePipe,
    FormsModule,
    LoadingSpinner,
    RouterLink,
  ],
  templateUrl: './chat-page.html',
  styleUrl: './chat-page.css',
})
export class ChatPage implements OnInit, OnDestroy, AfterViewChecked {
  readonly user$ = inject(AuthService).user$;
  readonly auth = inject(AuthService);
  /** Público para que la plantilla pueda resolver las tarjetas de modelo. */
  readonly social = inject(SocialService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  readonly emojis = ['😀', '😂', '😉', '😍', '🤝', '👍', '🙏', '🔥', '🎉', '❤️', '😢', '😎', '💡', '✅'];
  private readonly subscription = new Subscription();
  private readonly storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null;
  private readonly seenChats = signal<Record<string, number>>(this.loadSeenChats());
  private currentUser: User | null = null;
  mobileMenuOpen = false;
  @ViewChild('messageList') private messageListContainer?: ElementRef<HTMLElement>;
  @ViewChild('composer') private composer?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('settingsDialog') private settingsDialog?: ElementRef<HTMLDialogElement>;
  readonly conversations$ = this.user$.pipe(
    switchMap((user) =>
      user
        ? this.social
            .recentChats$(user.uid)
            .pipe(
              catchError((error: unknown) => {
                this.listError.set(this.describeStreamError(error, 'No se pudieron cargar tus conversaciones.'));
                return of([]);
              }),
              switchMap((conversations) =>
                conversations.length
                  ? combineLatest(
                      conversations.map((conversation) =>
                        this.social
                          .profile$(this.peerId(conversation, user.uid))
                          .pipe(map((partner) => ({ ...conversation, partner }))),
                      ),
                    )
                  : of([]),
              ),
            )
        : of([]),
    ),
    // La plantilla se suscribe varias veces (cabecera, lista y presencia) y
    // `activities$` también: sin compartir, cada suscripción abriría su propio
    // listener de perfiles.
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  /**
   * Presencia (última actividad) de los interlocutores.
   *
   * La lista completa de `userActivity` es exclusiva de administradores, así
   * que el chat lee el documento de cada interlocutor (permiso de lectura
   * individual). Así el chat funciona igual para usuarios, moderadores y
   * administradores sin pedir permisos que no corresponden al rol.
   *
   * El conjunto de interlocutores se filtra con `distinctUntilChanged` para
   * que un mensaje nuevo (que reordena la lista) no reabra los listeners de
   * presencia de todos los contactos.
   */
  readonly activities$ = combineLatest([this.user$, this.conversations$]).pipe(
    map(([user, conversations]) => (user
      ? [...new Set(conversations.map((conversation) => this.peerId(conversation, user.uid)).filter(Boolean))].sort()
      : [])),
    distinctUntilChanged((previous, next) =>
      previous.length === next.length && previous.every((uid, index) => uid === next[index])),
    switchMap((peers) => {
      if (!peers.length) return of(new Map<string, UserActivity>());
      return combineLatest(
        peers.map((peerUid) => this.social.userPresence$(peerUid).pipe(
          map((activity) => [peerUid, activity] as const),
        )),
      ).pipe(
        map((entries) => new Map(
          entries.filter((entry): entry is readonly [string, UserActivity] => !!entry[1]),
        )),
      );
    }),
    catchError(() => of(new Map<string, UserActivity>())),
  );
  partnerId = '';
  /**
   * Estado del chat expresado con signals: la aplicación usa detección de cambios
   * zoneless, así que las propiedades simples mutadas tras un `await` (por ejemplo
   * al vaciar el compositor tras enviar) no redibujarían la vista.
   */
  readonly message = signal('');
  readonly error = signal('');
  readonly copiedId = signal('');
  readonly copiedMessageId = signal('');
  /**
   * Errores de sincronización (conversaciones o hilo). Antes el `catchError`
   * devolvía una lista vacía sin avisar, así que un fallo de permisos o de
   * red dejaba el chat en blanco y sin explicación.
   */
  readonly listError = signal('');
  readonly threadError = signal('');
  search = '';
  /**
   * Estado de la conversación abierta.
   *
   * La aplicación usa detección de cambios zoneless: asignar una propiedad
   * simple no programa un render, así que abrir un chat podía no dibujarse
   * nunca (dependía del throttling de `markSeen` o del `AsyncPipe` de
   * `user$`). Con signals, cambiar de conversación siempre repinta.
   */
  readonly chatId = signal('');
  readonly messages = signal<Observable<MessageGroup[]> | undefined>(undefined);
  readonly partnerProfile = signal<Observable<User | null> | undefined>(undefined);
  messageQuery = '';
  messageSearchOpen = false;
  readonly pinned = new Set<string>(this.loadPinned());
  /** Preferencias del chat guardadas en `localStorage`. */
  private readonly settings: ChatSettings = this.loadChatSettings();
  /** Escala del texto del chat (compacto / normal / grande). */
  readonly chatFontScale = signal<ChatFontScale>(this.settings.fontScale);
  /** Mostrar la hora en cada burbuja. */
  readonly showTimestamps = signal(this.settings.showTimestamps);
  /** Color de acento propio del chat (independiente del de la app). */
  readonly chatAccent = signal(this.settings.accent);
  /** Conversaciones silenciadas (sin badge de no leídos). */
  readonly mutedChats = signal<string[]>(this.settings.muted);
  /**
   * ¿El hilo está pegado al final? Si no, aparece el botón "ir al último" y
   * los mensajes que llegan se marcan como nuevos en vez de hacer scroll.
   */
  readonly atBottom = signal(true);
  /** Mensajes recibidos por encima de la última posición leída. */
  readonly unreadCount = signal(0);
  /** Id del primer mensaje sin leer: marca el separador "Mensajes nuevos". */
  readonly firstUnreadId = signal('');
  /** Posición de la coincidencia resaltada en la búsqueda de la conversación. */
  readonly searchCursor = signal(-1);
  /** Aviso para lectores de pantalla cuando llegan mensajes sin estar al final. */
  readonly announcement = signal('');
  /** Mensajes de la conversación abierta (para exportar el historial). */
  readonly chatMessages = signal<ChatMessage[]>([]);
  /** Marca de la última lectura de la conversación abierta. */
  private lastReadAt = 0;
  /** `createdAt` del mensaje más reciente conocido. */
  private newestMessageAt = 0;
  /** Evita envíos duplicados por doble clic o Enter repetido. */
  readonly sending = signal(false);
  /** --- Notas de voz --- */
  readonly recording = signal(false);
  readonly recordSeconds = signal(0);
  readonly audioSending = signal(false);
  /** --- Reproductor de notas de voz (un solo elemento activo a la vez) --- */
  readonly audioNotePlayingId = signal<string | null>(null);
  readonly audioNoteCurrent = signal(0);
  readonly audioNoteDuration = signal(0);
  private audioElement?: HTMLAudioElement;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private recordInterval?: ReturnType<typeof setInterval>;
  private recordStartedAt = 0;
  private readonly MAX_AUDIO_SECONDS = 300;
  /** Acentos que se pueden elegir para el chat. */
  readonly chatAccents = CHAT_ACCENTS;
  readonly chatBackgrounds: { id: string; label: string; css: string }[] = [    {
      id: 'default',
      label: 'Predeterminado',
      css: 'radial-gradient(80% 55% at 50% 0%, color-mix(in srgb, var(--accent-color) 5%, transparent), transparent 55%), var(--surface-main)',
    },
    {
      id: 'aurora',
      label: 'Aurora',
      css: 'radial-gradient(90% 60% at 50% 0%, rgba(139, 92, 246, 0.22), transparent 60%), radial-gradient(60% 50% at 80% 100%, rgba(56, 189, 248, 0.16), transparent 60%), #0d0a1a',
    },
    {
      id: 'ocean',
      label: 'Océano',
      css: 'radial-gradient(90% 60% at 50% 0%, rgba(14, 165, 233, 0.18), transparent 60%), #0a1622',
    },
    {
      id: 'sunset',
      label: 'Atardecer',
      css: 'radial-gradient(90% 60% at 50% 0%, rgba(245, 158, 11, 0.16), transparent 60%), #171006',
    },
    {
      id: 'forest',
      label: 'Bosque',
      css: 'radial-gradient(90% 60% at 50% 0%, rgba(16, 185, 129, 0.14), transparent 60%), #07130f',
    },
  ];
  /** Caché de los fondos por conversación (evita leer `localStorage` en cada render). */
  private readonly backgroundOverrides = new Map<string, string>();
  /** Fondo efectivo de la conversación abierta. */
  chatBackgroundId = 'default';
  /** Fondo global por defecto; se restaura desde `localStorage`. */
  globalChatBackgroundId = this.loadGlobalChatBackground();
  private copyIdTimer?: ReturnType<typeof setTimeout>;
  private copyMessageTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.subscription.add(
      this.auth.user$.subscribe((user) => {
        this.currentUser = user;
        this.openRequestedConversation();
      }),
    );
    this.subscription.add(
      this.route.queryParamMap.subscribe((params) => {
        this.partnerId = params.get('peer') ?? '';
        this.openRequestedConversation();
      }),
    );
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

  openConversation(): void {
    const peer = this.partnerId.trim();
    if (!this.currentUser || !peer || peer === this.currentUser.uid || /[/.#$/\[\]]/.test(peer)) {
      this.error.set(this.i18n.translate('Ingresa un UID válido de otro creador.'));
      this.notifications.warning(this.error());
      return;
    }
    this.error.set('');
    this.listError.set('');
    this.threadError.set('');
    this.stopAudioNote();
    const nextChatId = [this.currentUser.uid, peer].sort().join('__');
    if (this.chatId() === nextChatId) {
      // Misma conversación: no se recrea el stream, pero se refresca el estado visual.
      this.chatBackgroundId = this.effectiveChatBackgroundId(this.chatId());
      return;
    }
    this.chatId.set(nextChatId);
    this.chatBackgroundId = this.effectiveChatBackgroundId(this.chatId());
    this.messages.set(
      this.social.chatMessages$(this.chatId()).pipe(
        tap((messages) => this.syncReadState(messages)),
        map((messages) => this.groupByDay(messages)),
        catchError((error: unknown) => {
          this.threadError.set(this.describeStreamError(error, 'No se pudo sincronizar la conversación.'));
          return of([] as MessageGroup[]);
        }),
      ),
    );
    this.partnerProfile.set(
      this.social.profile$(peer).pipe(
        catchError(() => of(null)),
      ),
    );
    this.atBottom.set(true);
    // Lo que ya existía al abrir la conversación está leído: solo cuentan
    // como nuevos los mensajes que lleguen después.
    this.lastReadAt = Date.now();
    this.newestMessageAt = 0;
    this.unreadCount.set(0);
    this.firstUnreadId.set('');
    this.searchCursor.set(-1);
    this.markSeen(this.chatId());
    // Que el badge de la campana no siga contando los mensajes del interlocutor
    // como pendientes una vez que fueron abiertos a través de aquí.
    void this.social.markMessageNotificationsRead(this.currentUser.uid, peer).catch(() => undefined);
    void this.social.ensureChatConversation(this.chatId(), this.currentUser?.uid).catch((error: unknown) => {
      this.error.set(this.i18n.firebaseError(error, 'No se pudo abrir la conversación.'));
      this.notifications.error(this.error());
    });
  }

  /**
   * Traduce un fallo de sincronización a un mensaje comprensible.
   * `i18n.firebaseError()` convierte los errores de Firebase ("Missing or
   * insufficient permissions") en texto que el usuario entienda.
   */
  private describeStreamError(error: unknown, fallback: string): string {
    return this.i18n.firebaseError(error, this.i18n.translate(fallback));
  }

  ngAfterViewChecked(): void {
    if (this.atBottom()) this.scrollToBottom();
    if (this.chatId()) this.markSeen(this.chatId());
  }

  onMessageListScroll(): void {
    const element = this.messageListContainer?.nativeElement;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
    this.atBottom.set(atBottom);
    if (atBottom) this.markMessagesRead();
  }

  /**
   * Recalcula qué mensajes siguen sin leer.
   *
   * Si el usuario está al final, lo que llega se considera leído (y el hilo
   * hace scroll). Si está leyendo historial, los mensajes nuevos se acumulan
   * y se marcan con un separador para no perderlos de vista.
   */
  private syncReadState(messages: ChatMessage[]): void {
    this.chatMessages.set(messages);
    this.newestMessageAt = messages.at(-1)?.createdAt ?? 0;
    if (this.atBottom()) {
      this.markMessagesRead();
      return;
    }
    const pending = messages.filter((message) => message.createdAt > this.lastReadAt);
    this.unreadCount.set(pending.length);
    this.firstUnreadId.set(pending[0]?.id ?? '');
    if (pending.length) {
      this.announcement.set(this.i18n.translate('{count} mensajes nuevos', { count: pending.length }));
    }
  }

  /** Marca todo lo que haya llegado hasta el final como leído. */
  private markMessagesRead(): void {
    if (!this.newestMessageAt) return;
    this.lastReadAt = this.newestMessageAt;
    this.unreadCount.set(0);
    this.firstUnreadId.set('');
  }

  /** Vuelve al final del hilo y salta al último mensaje. */
  scrollToLatest(): void {
    this.atBottom.set(true);
    this.markMessagesRead();
    this.scrollToBottom();
  }

  scrollToBottom(): void {
    const element = this.messageListContainer?.nativeElement;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }

  autoGrow(event: Event): void {
    const textarea = event.target;
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void this.send();
    }
  }

  deselectChat(): void {
    this.chatId.set('');
    this.partnerId = '';
    this.stopAudioNote();
    this.chatBackgroundId = this.effectiveChatBackgroundId('');
    this.messages.set(undefined);
    this.partnerProfile.set(undefined);
    this.error.set('');
    this.listError.set('');
    this.threadError.set('');
    this.copiedId.set('');
  }

  peerId(conversation: ChatConversation, uid: string): string {
    return conversation.participantIds.find((participantId) => participantId !== uid) ?? '';
  }

  selectConversation(conversation: ChatConversation, uid: string): void {
    this.partnerId = this.peerId(conversation, uid);
    this.markSeen(conversation.id);
    this.openConversation();
  }

  visibleConversations(
    list: ConversationWithPartner[] | null,
    uid: string,
  ): ConversationWithPartner[] {
    if (!list) return [];
    const query = this.search.trim().toLowerCase();
    if (!query) return list;
    return list.filter((item) => {
      const name = item.partner?.displayName?.toLowerCase() ?? '';
      const peer = this.peerId(item, uid).toLowerCase();
      return name.includes(query) || peer.includes(query);
    });
  }

  hasUnread(conversation: ChatConversation): boolean {
    if (this.isMuted(conversation.id)) return false;
    return conversation.updatedAt > (this.seenChats()[conversation.id] ?? 0);
  }

  /**
   * Fecha de la última actividad de una conversación, en el formato que más
   * ayuda: la hora si es de hoy, "Ayer", el día de la semana si es de esta
   * semana y la fecha a partir de entonces.
   */
  conversationDateLabel(timestamp: number): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
    const locale = this.localeFor(this.i18n.language());
    if (days <= 0) {
      return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
    }
    if (days === 1) return this.i18n.translate('Ayer');
    if (days < 7) {
      return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
    }
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
  }

  /**
   * Id del modelo compartido en un mensaje.
   *
   * El botón "Compartir modelo" del feed copia un enlace con `?post=<id>`; al
   * pegarlo en el chat se muestra como tarjeta con la miniatura y el título
   * en lugar de una URL suelta.
   */
  modelPostId(message: ChatMessage): string {
    return /[?&]post=([A-Za-z0-9_-]+)/.exec(message.text)?.[1] ?? '';
  }

  /** ¿Este mensaje contiene la búsqueda en curso? */
  isMatch(message: ChatMessage): boolean {
    const query = this.messageQuery.trim().toLowerCase();
    if (!query) return false;
    return message.text.toLowerCase().includes(query);
  }

  /** Reinicia el cursor al cambiar la búsqueda. */
  onMessageQueryChange(query: string): void {
    this.messageQuery = query;
    this.searchCursor.set(-1);
  }

  /** Salta a la siguiente coincidencia de la búsqueda. */
  goToNextMatch(): void {
    this.moveMatch(1);
  }

  /** Salta a la coincidencia anterior. */
  goToPreviousMatch(): void {
    this.moveMatch(-1);
  }

  private moveMatch(direction: 1 | -1): void {
    const container = this.messageListContainer?.nativeElement;
    if (!container) return;
    const matches = Array.from(container.querySelectorAll<HTMLElement>('[data-match]'));
    if (!matches.length) return;
    const current = this.searchCursor();
    const next = (current + direction + matches.length) % matches.length;
    this.searchCursor.set(next);
    matches.forEach((element) => element.classList.remove('is-current'));
    const target = matches[next];
    target.classList.add('is-current');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async copyPartnerId(): Promise<void> {
    const target = this.partnerId.trim();
    if (!target || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(target);
      this.copiedId.set('copied');
      if (this.copyIdTimer) clearTimeout(this.copyIdTimer);
      this.copyIdTimer = setTimeout(() => this.copiedId.set(''), 1800);
    } catch {
      this.notifications.warning(this.i18n.translate('No se pudo copiar.'));
    }
  }

  togglePin(conversation: ConversationWithPartner, event?: Event): void {
    event?.stopPropagation();
    event?.preventDefault();
    const id = conversation.id;
    if (this.pinned.has(id)) {
      this.pinned.delete(id);
    } else {
      this.pinned.add(id);
    }
    this.persistPinned();
  }

  isPinned(id: string): boolean {
    return this.pinned.has(id);
  }

  sortedConversations(list: ConversationWithPartner[]): ConversationWithPartner[] {
    return [...list].sort((a, b) => {
      const aPin = this.pinned.has(a.id) ? 1 : 0;
      const bPin = this.pinned.has(b.id) ? 1 : 0;
      if (aPin !== bPin) return bPin - aPin;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
  }

  /**
   * Agrupa las conversaciones en bloques temporales (Hoy / Ayer / Anterior).
   * Fijadas siempre arriba y en su propio bloque "Fijadas" si hay alguna.
   */
  conversationGroups(list: ConversationWithPartner[]): { key: string; label: string; items: ConversationWithPartner[] }[] {
    if (!list.length) return [];
    const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const today = startOf(new Date());
    const dayMs = 86_400_000;
    const locale = this.localeFor(this.i18n.language());
    const t = (key: string) => this.i18n.translate(key);
    const buckets = new Map<string, { key: string; label: string; items: ConversationWithPartner[] }>();
    const pinnedGroup = { key: 'pinned', label: t('Fijadas'), items: [] as ConversationWithPartner[] };
    const todayGroup = { key: 'today', label: t('Hoy'), items: [] as ConversationWithPartner[] };
    const yesterdayGroup = { key: 'yesterday', label: t('Ayer'), items: [] as ConversationWithPartner[] };
    const weekGroup = { key: 'week', label: t('Esta semana'), items: [] as ConversationWithPartner[] };
    const earlierGroup = { key: 'earlier', label: t('Anteriores'), items: [] as ConversationWithPartner[] };

    for (const conversation of list) {
      if (this.pinned.has(conversation.id)) {
        pinnedGroup.items.push(conversation);
        continue;
      }
      const days = Math.round((today - startOf(new Date(conversation.updatedAt || 0))) / dayMs);
      if (days <= 0) todayGroup.items.push(conversation);
      else if (days === 1) yesterdayGroup.items.push(conversation);
      else if (days < 7) weekGroup.items.push(conversation);
      else earlierGroup.items.push(conversation);
    }

    for (const bucket of [pinnedGroup, todayGroup, yesterdayGroup, weekGroup, earlierGroup]) {
      if (bucket.items.length) buckets.set(bucket.key, bucket);
    }
    return [...buckets.values()];
  }

  toggleMessageSearch(): void {
    this.messageSearchOpen = !this.messageSearchOpen;
    if (!this.messageSearchOpen) {
      this.messageQuery = '';
      this.searchCursor.set(-1);
    }
  }

  clearMessageSearch(): void {
    this.messageQuery = '';
    this.searchCursor.set(-1);
  }

  filteredGroups(groups: MessageGroup[]): MessageGroup[] {
    const query = this.messageQuery.trim().toLowerCase();
    if (!query) return groups;
    return groups
      .map((group) => ({
        ...group,
        messages: group.messages.filter((item) => item.message.text.toLowerCase().includes(query)),
      }))
      .filter((group) => group.messages.length > 0);
  }

  matchCount(groups: MessageGroup[]): number {
    const query = this.messageQuery.trim().toLowerCase();
    if (!query) return 0;
    return groups.reduce(
      (sum, group) =>
        sum + group.messages.filter((item) => item.message.text.toLowerCase().includes(query)).length,
      0,
    );
  }

  activityFor(uid: string, activities: Map<string, UserActivity> | null): UserActivity | null {
    if (!activities) return null;
    return activities.get(uid) ?? null;
  }

  activityLabel(entry: UserActivity | null): string {
    if (!entry) return '';
    const diff = Date.now() - entry.lastSeenAt;
    if (diff < 2 * 60 * 1000) return this.i18n.translate('En línea');
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return this.i18n.translate('Visto hace') + ` ${Math.max(1, minutes)} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return this.i18n.translate('Visto hace') + ` ${hours} h`;
    const days = Math.floor(hours / 24);
    return this.i18n.translate('Visto hace') + ` ${days} d`;
  }

  activityClass(entry: UserActivity | null): 'online' | 'seen' {
    if (entry && Date.now() - entry.lastSeenAt < 2 * 60 * 1000) return 'online';
    return 'seen';
  }

  /**
   * Inserta el emoji en la posición del cursor (no siempre al final del texto)
   * y devuelve el foco al campo de escritura.
   */
  insertEmoji(emoji: string): void {
    const textarea = this.composer?.nativeElement;
    if (!textarea) {
      this.message.set(`${this.message()}${emoji}`);
      return;
    }
    const current = textarea.value ?? this.message();
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? start;
    const next = `${current.slice(0, start)}${emoji}${current.slice(end)}`;
    textarea.value = next;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = start + emoji.length;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
      });
    } else {
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
      });
    }
  }

  async copyMessage(message: ChatMessage): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(message.text);
      this.copiedMessageId.set(message.id);
      if (this.copyMessageTimer) clearTimeout(this.copyMessageTimer);
      this.copyMessageTimer = setTimeout(() => this.copiedMessageId.set(''), 1600);
    } catch {
      this.notifications.warning(this.i18n.translate('No se pudo copiar.'));
    }
  }

  /**
   * Valida que una URL sea segura para renderizar como enlace.
   * Solo permite protocolos http:// o https://. Rechaza javascript:, data:,
   * vbscript:, file:, ftp: y cualquier otro esquema potencialmente peligroso.
   */
  private isSafeUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Escapa el mensaje y convierte las URLs en enlaces.
   *
   * El resaltado de la búsqueda se aplica únicamente sobre el texto plano:
   * antes se aplicaba sobre el HTML completo, lo que insertaba `<mark>` dentro
   * de las etiquetas `<a>` y rompía los enlaces. Además las URLs ya escapadas
   * se escapaban dos veces, dejando `&amp;amp;` en el `href`.
   */
  highlightedHtml(text: string): SafeHtml {
    const query = this.messageQuery.trim();
    const highlight = query ? new RegExp(this.escapeRegExp(query), 'gi') : null;
    const html = this.splitLinks(text)
      .map((segment) =>
        segment.kind === 'link'
          ? this.renderLink(segment.value)
          : this.highlightSegment(segment.value, highlight),
      )
      .join('');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  /** Divide el texto plano en fragmentos de enlace y de texto normal. */
  private splitLinks(text: string): Array<{ kind: 'text' | 'link'; value: string }> {
    const segments: Array<{ kind: 'text' | 'link'; value: string }> = [];
    // Solo http:// y https://; el resto de esquemas se mantiene como texto.
    const pattern = /\bhttps?:\/\/[^\s<>"']+/gi;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      const trailing = raw.match(/[.,;:!?)\]}]+$/)?.[0] ?? '';
      const url = trailing ? raw.slice(0, raw.length - trailing.length) : raw;
      if (!url) break;
      if (match.index > cursor) {
        segments.push({ kind: 'text', value: text.slice(cursor, match.index) });
      }
      segments.push({ kind: 'link', value: url });
      cursor = match.index + url.length;
      if (trailing) {
        segments.push({ kind: 'text', value: trailing });
        cursor += trailing.length;
      }
      pattern.lastIndex = cursor;
    }
    if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) });
    return segments;
  }

  private renderLink(url: string): string {
    if (!this.isSafeUrl(url)) return this.escapeHtml(url);
    const escaped = this.escapeHtml(url);
    return `<a href="${escaped}" target="_blank" rel="noopener noreferrer">${escaped}</a>`;
  }

  private highlightSegment(value: string, highlight: RegExp | null): string {
    if (!highlight) return this.escapeHtml(value);
    let result = '';
    let cursor = 0;
    highlight.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = highlight.exec(value)) !== null) {
      if (!match[0].length) {
        highlight.lastIndex += 1;
        continue;
      }
      result += this.escapeHtml(value.slice(cursor, match.index));
      result += `<mark>${this.escapeHtml(match[0])}</mark>`;
      cursor = match.index + match[0].length;
    }
    return result + this.escapeHtml(value.slice(cursor));
  }

  private escapeHtml(value: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return value.replace(/[&<>"']/g, (char) => map[char] ?? char);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * `ngModelChange` emite el valor del modelo (un `string`), no el evento DOM.
   * Leer `event.target` aquí lanzaba un `TypeError` y rompía el selector de fondo.
   */
  onConversationBackgroundChange(id: string): void {
    const next = this.normalizeBackgroundId(id);
    if (!this.chatId()) {
      this.setGlobalChatBackground(next);
      return;
    }
    this.chatBackgroundId = next;
    this.setConversationBackground(this.chatId(), next);
  }

  onGlobalBackgroundChange(id: string): void {
    this.setGlobalChatBackground(this.normalizeBackgroundId(id));
  }

  effectiveChatBackgroundId(chatId: string): string {
    const override = this.readStoredChatBackground(chatId);
    return override ?? this.globalChatBackgroundId;
  }

  /**
   * Identificador del fondo efectivo como `data-*` para que el CSS pueda
   * aplicar la paleta de burbujas acorde al lienzo (p. ej. oscuros),
   * independientemente del tema global claro/oscuro.
   */
  conversationDataBg(): string {
    return this.effectiveChatBackgroundId(this.chatId());
  }

  conversationBackground(chatId: string): string {
    const id = this.effectiveChatBackgroundId(chatId);
    const background = this.chatBackgrounds.find((item) => item.id === id);
    return background?.css ?? this.chatBackgrounds[0].css;
  }

  setConversationBackground(chatId: string, id: string): void {
    if (!chatId) return;
    this.backgroundOverrides.set(chatId, id);
    this.writeStoredValue(`${CHAT_BACKGROUND_PREFIX}${chatId}`, id);
  }

  setGlobalChatBackground(id: string): void {
    this.globalChatBackgroundId = id;
    this.writeStoredValue(CHAT_BACKGROUND_KEY, id);
    // Si la conversación abierta no tiene un fondo propio, sigue al global.
    if (this.chatId() && !this.readStoredChatBackground(this.chatId())) {
      this.chatBackgroundId = id;
    }
  }

  private readStoredChatBackground(chatId: string): string | null {
    if (!chatId) return null;
    const cached = this.backgroundOverrides.get(chatId);
    if (cached) return cached;
    const stored = this.readStoredValue(`${CHAT_BACKGROUND_PREFIX}${chatId}`);
    if (!stored) return null;
    this.backgroundOverrides.set(chatId, stored);
    return stored;
  }

  private loadGlobalChatBackground(): string {
    const stored = this.readStoredValue(CHAT_BACKGROUND_KEY);
    return stored && this.isKnownBackground(stored) ? stored : this.chatBackgrounds[0].id;
  }

  private isKnownBackground(id: string): boolean {
    return this.chatBackgrounds.some((background) => background.id === id);
  }

  private normalizeBackgroundId(id: string): string {
    return this.isKnownBackground(id) ? id : this.chatBackgrounds[0].id;
  }

  private readStoredValue(key: string): string | null {
    if (!this.storage) return null;
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeStoredValue(key: string, value: string): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(key, value);
    } catch {
      /* almacenamiento no disponible */
    }
  }

  private persistPinned(): void {
    this.writeStoredValue(CHAT_PINNED_KEY, JSON.stringify([...this.pinned]));
  }

  private loadPinned(): string[] {
    if (!this.storage) return [];
    try {
      const parsed = JSON.parse(this.storage.getItem(CHAT_PINNED_KEY) ?? '[]') as unknown;
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  /** Cierra el panel de ajustes al hacer clic fuera del contenido. */
  closeSettingsOnBackdrop(event: MouseEvent, dialog: HTMLDialogElement): void {
    if (event.target !== dialog) return;
    dialog.close();
  }

  /* ------------------------------------------------------------------
     Ajustes del chat
     ------------------------------------------------------------------ */

  private loadChatSettings(): ChatSettings {
    if (!this.storage) return { ...DEFAULT_CHAT_SETTINGS };
    try {
      const parsed = JSON.parse(this.storage.getItem(CHAT_SETTINGS_KEY) ?? '{}') as Partial<ChatSettings>;
      const fontScale = parsed.fontScale === 'sm' || parsed.fontScale === 'lg' ? parsed.fontScale : 'md';
      return {
        fontScale,
        showTimestamps: parsed.showTimestamps !== false,
        accent: typeof parsed.accent === 'string' && parsed.accent.startsWith('#')
          ? parsed.accent
          : DEFAULT_CHAT_SETTINGS.accent,
        muted: Array.isArray(parsed.muted)
          ? parsed.muted.filter((id): id is string => typeof id === 'string')
          : [],
      };
    } catch {
      return { ...DEFAULT_CHAT_SETTINGS };
    }
  }

  private persistChatSettings(): void {
    this.writeStoredValue(CHAT_SETTINGS_KEY, JSON.stringify({
      fontScale: this.chatFontScale(),
      showTimestamps: this.showTimestamps(),
      accent: this.chatAccent(),
      muted: this.mutedChats(),
    }));
  }

  setFontScale(scale: ChatFontScale): void {
    this.chatFontScale.set(scale);
    this.persistChatSettings();
  }

  toggleTimestamps(): void {
    this.showTimestamps.set(!this.showTimestamps());
    this.persistChatSettings();
  }

  setAccent(accent: string): void {
    this.chatAccent.set(accent);
    this.persistChatSettings();
  }

  /** Silencia (o reactiva) la conversación abierta. */
  toggleMute(chatId: string): void {
    if (!chatId) return;
    const muted = this.mutedChats();
    this.mutedChats.set(muted.includes(chatId) ? muted.filter((id) => id !== chatId) : [...muted, chatId]);
    this.persistChatSettings();
  }

  isMuted(chatId: string): boolean {
    return this.mutedChats().includes(chatId);
  }

  /** Descarga el historial de la conversación en texto plano. */
  exportConversation(): void {
    const messages = this.chatMessages();
    if (!messages.length) {
      this.notifications.info(
        this.i18n.translate('No hay mensajes que exportar todavía.'),
        this.i18n.translate('Exportar conversación'),
      );
      return;
    }
    const locale = this.localeFor(this.i18n.language());
    const lines = messages.map((message) => {
      const time = new Date(message.createdAt).toLocaleString(locale);
      return `[${time}] ${message.senderName}: ${message.text}`;
    });
    const header = [
      `CARXY · ${this.partnerId || 'conversación'}`,
      this.i18n.translate('Exportado el {date}.', { date: new Date().toLocaleString(locale) }),
      '',
    ];
    const blob = new Blob([header.join('\n'), lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `carxy-chat-${this.chatId() || 'conversacion'}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    this.notifications.success(
      this.i18n.translate('Conversación exportada.'),
      this.i18n.translate('Exportar conversación'),
    );
  }

  useFallbackAvatar(event: Event): void {
    const image = event.target;
    if (image instanceof HTMLImageElement) image.src = 'user-avatar.svg';
  }

  /** Abre el panel de ajustes del chat. */
  openSettings(): void {
    this.settingsDialog?.nativeElement.showModal();
  }

  private openRequestedConversation(): void {
    if (!this.currentUser || !this.partnerId.trim()) return;
    this.openConversation();
  }

  async send(): Promise<void> {
    if (this.sending()) return;
    const text = this.message().trim();
    const chatId = this.chatId();
    if (!chatId || !text) return;
    this.sending.set(true);
    try {
      // Se usa el usuario ya resuelto por `user$`: `firstValueFrom(user$)` podía
      // devolver `null` en la primera emisión y descartaba el mensaje en
      // silencio, dejando el texto en el compositor.
      const user = this.currentUser;
      if (!user) {
        this.error.set(this.i18n.translate('Tu sesión aún no está lista. Inténtalo de nuevo en un momento.'));
        this.notifications.warning(this.error());
        return;
      }
      await this.social.sendMessage(chatId, {
        text,
        senderId: user.uid,
        senderName: user.displayName || user.email || 'Usuario',
        senderPhotoURL: user.photoURL ?? null,
      });
      this.message.set('');
      this.error.set('');
      this.atBottom.set(true);
      this.markSeen(chatId);
      setTimeout(() => this.scrollToBottom());
    } catch (error) {
      this.error.set(this.i18n.firebaseError(error, 'No se pudo enviar el mensaje.'));
      this.notifications.error(this.error(), this.i18n.translate('No se pudo enviar el mensaje'));
    } finally {
      this.sending.set(false);
    }
  }

  /** Empieza la grabación o envía la nota ya grabada según el estado actual. */
  async toggleRecording(): Promise<void> {
    if (this.audioSending()) return;
    if (this.recording()) {
      this.stopRecordingAndSend();
      return;
    }
    await this.startRecording();
  }

  /** Descarta la grabación en curso sin enviarla. */
  cancelRecording(): void {
    this.teardownRecording(false);
  }

  isAudioMessage(message: ChatMessage): boolean {
    return message.kind === 'audio' && !!message.audioUrl;
  }

  /** Alterna reproducir/pausar una nota de voz. Solo un elemento <audio> a la vez. */
  toggleAudioNote(message: ChatMessage): void {
    if (!message.audioUrl || typeof Audio === 'undefined') return;
    if (this.audioNotePlayingId() === message.id) {
      this.audioElement?.pause();
      this.audioNotePlayingId.set(null);
      return;
    }
    this.stopAudioNote();
    const audio = new Audio(message.audioUrl);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      if (this.audioNotePlayingId() !== message.id) return;
      const meta = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (message.audioDuration ?? 0);
      this.audioNoteDuration.set(meta);
    };
    audio.ontimeupdate = () => {
      if (this.audioNotePlayingId() === message.id) this.audioNoteCurrent.set(audio.currentTime);
    };
    audio.onended = () => {
      if (this.audioNotePlayingId() === message.id) {
        this.audioNotePlayingId.set(null);
        this.audioNoteCurrent.set(0);
      }
    };
    audio.onerror = () => {
      this.notifications.warning(this.i18n.translate('No se pudo reproducir la nota de voz.'));
      this.audioNotePlayingId.set(null);
    };
    this.audioElement = audio;
    this.audioNotePlayingId.set(message.id);
    this.audioNoteCurrent.set(0);
    this.audioNoteDuration.set(message.audioDuration ?? 0);
    void audio.play().catch(() => {
      this.audioNotePlayingId.set(null);
      this.notifications.warning(this.i18n.translate('No se pudo reproducir la nota de voz.'));
    });
  }

  /** Busca un punto concreto dentro de la nota de voz desde la pista clicable. */
  seekAudioNote(event: MouseEvent, message: ChatMessage): void {
    const track = event.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    if (this.audioNotePlayingId() !== message.id) {
      this.toggleAudioNote(message);
    }
    const audio = this.audioElement;
    if (!audio) return;
    const duration = this.audioNoteDuration();
    if (duration > 0) {
      audio.currentTime = fraction * duration;
      this.audioNoteCurrent.set(audio.currentTime);
    }
  }

  /** Porcentaje de progreso de la nota actual (0 en las demás). */
  audioNotePercent(message: ChatMessage): number {
    if (this.audioNotePlayingId() !== message.id) return 0;
    const duration = this.audioNoteDuration();
    if (duration <= 0) return 0;
    return Math.min(100, Math.max(0, (this.audioNoteCurrent() / duration) * 100));
  }

  /** Etiqueta mm:ss / mm:ss cuando está sonando; total mm:ss en reposo. */
  audioNoteTimeLabel(message: ChatMessage): string {
    const total = this.audioNotePlayingId() === message.id
      ? this.audioNoteDuration()
      : (message.audioDuration ?? 0);
    if (this.audioNotePlayingId() === message.id) {
      return `${this.formatAudioTime(this.audioNoteCurrent())} / ${this.formatAudioTime(total)}`;
    }
    return this.formatAudioTime(total);
  }

  private formatAudioTime(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds || 0));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${minutes}:${rest.toString().padStart(2, '0')}`;
  }

  /** Detiene y libera el elemento de audio (al salir del chat o al destruir el componente). */
  stopAudioNote(): void {
    const audio = this.audioElement;
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio.ontimeupdate = null;
      audio.onloadedmetadata = null;
      audio.src = '';
      audio.load();
    }
    this.audioElement = undefined;
    this.audioNotePlayingId.set(null);
    this.audioNoteCurrent.set(0);
  }

  /** Temporizador mm:ss para la barra de grabación. */
  recordTimer(): string {
    const total = this.recordSeconds();
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private async startRecording(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.notifications.warning(this.i18n.translate('Este navegador no permite grabar audio.'));
      return;
    }
    if (!this.chatId()) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = this.pickAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.recordedChunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) this.recordedChunks.push(event.data);
      };
      recorder.start(250);
      this.mediaRecorder = recorder;
      this.recording.set(true);
      this.recordSeconds.set(0);
      this.recordStartedAt = Date.now();
      this.recordInterval = setInterval(() => {
        const elapsed = (Date.now() - this.recordStartedAt) / 1000;
        this.recordSeconds.set(Math.floor(elapsed));
        if (elapsed >= this.MAX_AUDIO_SECONDS) {
          this.stopRecordingAndSend();
        }
      }, 250);
    } catch (error) {
      console.warn('No se pudo acceder al micrófono.', error);
      this.notifications.warning(this.i18n.translate('No se pudo acceder al micrófono. Revisa los permisos del navegador.'));
    }
  }

  private pickAudioMimeType(): string | null {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    }
    return null;
  }

  private stopRecordingAndSend(): void {
    this.teardownRecording(true);
  }

  private teardownRecording(send: boolean): void {
    const recorder = this.mediaRecorder;
    if (this.recordInterval) {
      clearInterval(this.recordInterval);
      this.recordInterval = undefined;
    }
    this.mediaRecorder = null;
    this.recording.set(false);
    if (!recorder || recorder.state === 'inactive') {
      this.recordedChunks = [];
      this.recordSeconds.set(0);
      return;
    }
    recorder.onstop = () => {
      const type = recorder.mimeType || 'audio/webm';
      const blob = new Blob(this.recordedChunks, { type });
      const duration = Math.max(1, Math.round((Date.now() - this.recordStartedAt) / 1000));
      this.recordedChunks = [];
      this.recordSeconds.set(0);
      for (const track of recorder.stream.getTracks()) track.stop();
      if (send) {
        void this.sendAudioNote(blob, duration);
      }
    };
    recorder.stop();
  }

  private async sendAudioNote(blob: Blob, duration: number): Promise<void> {
    const chatId = this.chatId();
    const user = this.currentUser;
    if (!chatId || !user) return;
    this.audioSending.set(true);
    try {
      await this.social.sendAudioMessage(chatId, {
        blob,
        durationSeconds: duration,
        senderId: user.uid,
        senderName: user.displayName || user.email || 'Usuario',
        senderPhotoURL: user.photoURL ?? null,
      });
      this.atBottom.set(true);
      this.markSeen(chatId);
      setTimeout(() => this.scrollToBottom());
    } catch (error) {
      this.error.set(this.i18n.firebaseError(error, 'No se pudo enviar la nota de voz.'));
      this.notifications.error(this.error(), this.i18n.translate('No se pudo enviar la nota de voz'));
    } finally {
      this.audioSending.set(false);
    }
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    this.stopAudioNote();
    if (this.copyIdTimer) clearTimeout(this.copyIdTimer);
    if (this.copyMessageTimer) clearTimeout(this.copyMessageTimer);
    if (this.mediaRecorder) {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Ya estaba detenido.
      }
      this.mediaRecorder.stream?.getTracks().forEach((track) => track.stop());
      this.mediaRecorder = null;
    }
    if (this.recordInterval) clearInterval(this.recordInterval);
  }

  /**
   * Marca la conversación como vista. El valor en memoria se actualiza siempre
   * (para el indicador de no leídos) pero la escritura en `localStorage` se
   * limita a una vez cada {@link SEEN_THROTTLE_MS} porque este método se
   * invoca desde `ngAfterViewChecked`.
   */
  private markSeen(chatId: string): void {
    if (!chatId || !this.storage) return;
    const now = Date.now();
    const previous = this.seenChats()[chatId] ?? 0;
    if (now - previous < SEEN_THROTTLE_MS) return;
    this.seenChats.update((chats) => ({ ...chats, [chatId]: now }));
    this.writeStoredValue(CHAT_SEEN_KEY, JSON.stringify(this.seenChats()));
  }

  private loadSeenChats(): Record<string, number> {
    if (!this.storage) return {};
    try {
      return JSON.parse(this.storage.getItem(CHAT_SEEN_KEY) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  }

  private groupByDay(messages: ChatMessage[]): MessageGroup[] {
    const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
    const groups: MessageGroup[] = [];
    const byKey = new Map<string, MessageGroup>();
    let previousSender = '';

    for (const message of sorted) {
      const date = new Date(message.createdAt);
      const key = date.toDateString();
      let group = byKey.get(key);
      if (!group) {
        group = { key, label: this.dayLabel(date), messages: [] };
        byKey.set(key, group);
        groups.push(group);
        previousSender = '';
      }
      const firstOfRun = message.senderId !== previousSender;
      group.messages.push({ message, firstOfRun });
      previousSender = message.senderId;
    }

    return groups;
  }

  private dayLabel(date: Date): string {
    const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
    if (diffDays === 0) return this.i18n.translate('Hoy');
    if (diffDays === 1) return this.i18n.translate('Ayer');
    const locale = this.localeFor(this.i18n.language());
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: new Date().getFullYear() === date.getFullYear() ? undefined : 'numeric',
    }).format(date);
  }

  private localeFor(language: string): string {
    switch (language) {
      case 'es':
        return 'es-CO';
      case 'fr':
        return 'fr-FR';
      case 'pt':
        return 'pt-BR';
      default:
        return 'en-US';
    }
  }
}
