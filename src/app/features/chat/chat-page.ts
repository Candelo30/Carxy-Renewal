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
  firstValueFrom,
  map,
  of,
  switchMap,
  take,
} from 'rxjs';
import { ChatConversation, ChatMessage, User, UserActivity } from '../../core/models/social.models';
import { AuthService } from '../../core/services/auth';
import { SocialService } from '../../core/services/social';
import { NotificationService } from '../../core/services/notifications';
import { I18nService } from '../../core/services/i18n';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

/** Claves de preferencias del chat guardadas en `localStorage`. */
const CHAT_BACKGROUND_KEY = 'carxy:chat:bg';
const CHAT_BACKGROUND_PREFIX = 'carxy:chat:bg:';
const CHAT_PINNED_KEY = 'carxy:chat:pinned';
const CHAT_SEEN_KEY = 'carxy:chat:seen';
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
  private readonly social = inject(SocialService);
  private readonly notifications = inject(NotificationService);
  private readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  readonly activities$ = this.social.userActivity$;
  readonly emojis = ['😀', '😂', '😉', '😍', '🤝', '👍', '🙏', '🔥', '🎉', '❤️', '😢', '😎', '💡', '✅'];
  private readonly subscription = new Subscription();
  private readonly storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null;
  private readonly seenChats = signal<Record<string, number>>(this.loadSeenChats());
  private currentUser: User | null = null;
  mobileMenuOpen = false;
  @ViewChild('messageList') private messageListContainer?: ElementRef<HTMLElement>;
  @ViewChild('composer') private composer?: ElementRef<HTMLTextAreaElement>;
  readonly conversations$ = this.user$.pipe(
    switchMap((user) =>
      user
        ? this.social
            .chatConversations$(user.uid)
            .pipe(
              catchError(() => of([])),
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
  search = '';
  chatId = '';
  messages$?: Observable<MessageGroup[]>;
  partnerProfile$?: Observable<User | null>;
  messageQuery = '';
  messageSearchOpen = false;
  readonly pinned = new Set<string>(this.loadPinned());
  private nearBottom = true;
  /** Evita envíos duplicados por doble clic o Enter repetido. */
  readonly sending = signal(false);
  readonly chatBackgrounds: { id: string; label: string; css: string }[] = [
    {
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
    const nextChatId = [this.currentUser.uid, peer].sort().join('__');
    if (this.chatId === nextChatId) {
      // Misma conversación: no se recrea el stream, pero se refresca el estado visual.
      this.chatBackgroundId = this.effectiveChatBackgroundId(this.chatId);
      return;
    }
    this.chatId = nextChatId;
    this.chatBackgroundId = this.effectiveChatBackgroundId(this.chatId);
    this.messages$ = this.social.chatMessages$(this.chatId).pipe(
      catchError(() => of([])),
      map((messages) => this.groupByDay(messages)),
    );
    this.partnerProfile$ = this.social.profile$(peer).pipe(
      catchError(() => of(null)),
    );
    this.nearBottom = true;
    this.markSeen(this.chatId);
    void this.social.ensureChatConversation(this.chatId).catch((error: unknown) => {
      this.error.set(error instanceof Error ? error.message : this.i18n.translate('No se pudo abrir la conversación.'));
      this.notifications.error(this.error());
    });
  }

  ngAfterViewChecked(): void {
    if (this.nearBottom) this.scrollToBottom();
    if (this.chatId) this.markSeen(this.chatId);
  }

  onMessageListScroll(): void {
    const element = this.messageListContainer?.nativeElement;
    if (!element) return;
    this.nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
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
    this.chatId = '';
    this.partnerId = '';
    this.chatBackgroundId = this.effectiveChatBackgroundId('');
    this.messages$ = undefined;
    this.partnerProfile$ = undefined;
    this.error.set('');
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
    return conversation.updatedAt > (this.seenChats()[conversation.id] ?? 0);
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

  toggleMessageSearch(): void {
    this.messageSearchOpen = !this.messageSearchOpen;
    if (!this.messageSearchOpen) this.messageQuery = '';
  }

  clearMessageSearch(): void {
    this.messageQuery = '';
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

  activityFor(uid: string, activities: UserActivity[] | null): UserActivity | null {
    if (!activities) return null;
    return activities.find((entry) => entry.uid === uid) ?? null;
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
    if (!this.chatId) {
      this.setGlobalChatBackground(next);
      return;
    }
    this.chatBackgroundId = next;
    this.setConversationBackground(this.chatId, next);
  }

  onGlobalBackgroundChange(id: string): void {
    this.setGlobalChatBackground(this.normalizeBackgroundId(id));
  }

  effectiveChatBackgroundId(chatId: string): string {
    const override = this.readStoredChatBackground(chatId);
    return override ?? this.globalChatBackgroundId;
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
    if (this.chatId && !this.readStoredChatBackground(this.chatId)) {
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

  useFallbackAvatar(event: Event): void {
    const image = event.target;
    if (image instanceof HTMLImageElement) image.src = 'user-avatar.svg';
  }

  private openRequestedConversation(): void {
    if (!this.currentUser || !this.partnerId.trim()) return;
    this.openConversation();
  }

  async send(): Promise<void> {
    if (this.sending()) return;
    const text = this.message().trim();
    if (!this.chatId || !text) return;
    this.sending.set(true);
    try {
      const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
      if (!user) return;
      await this.social.sendMessage(this.chatId, {
        text,
        senderId: user.uid,
        senderName: user.displayName || user.email || 'Usuario',
      });
      this.message.set('');
      this.error.set('');
      this.nearBottom = true;
      this.markSeen(this.chatId);
      setTimeout(() => this.scrollToBottom());
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : this.i18n.translate('No se pudo enviar el mensaje.'));
      this.notifications.error(this.error(), this.i18n.translate('No se pudo enviar el mensaje'));
    } finally {
      this.sending.set(false);
    }
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    if (this.copyIdTimer) clearTimeout(this.copyIdTimer);
    if (this.copyMessageTimer) clearTimeout(this.copyMessageTimer);
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
