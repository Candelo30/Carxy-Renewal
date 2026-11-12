import { AsyncPipe, DatePipe } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
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
  private readonly seenChats: Record<string, number> = this.loadSeenChats();
  private currentUser: User | null = null;
  mobileMenuOpen = false;
  @ViewChild('messageList') private messageListContainer?: ElementRef<HTMLElement>;
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
  message = '';
  search = '';
  error = '';
  chatId = '';
  copiedId = '';
  messages$?: Observable<MessageGroup[]>;
  partnerProfile$?: Observable<User | null>;
  messageQuery = '';
  messageSearchOpen = false;
  copiedMessageId = '';
  readonly pinned = new Set<string>(this.loadPinned());
  private nearBottom = true;
  chatBackgroundId = 'default';
  globalChatBackgroundId = 'default';
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
      this.error = this.i18n.translate('Ingresa un UID válido de otro creador.');
      this.notifications.warning(this.error);
      return;
    }
    this.error = '';
    const nextChatId = [this.currentUser.uid, peer].sort().join('__');
    if (this.chatId === nextChatId) return;
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
      this.error = error instanceof Error ? error.message : this.i18n.translate('No se pudo abrir la conversación.');
      this.notifications.error(this.error);
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
    this.error = '';
    this.copiedId = '';
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
    return conversation.updatedAt > (this.seenChats[conversation.id] ?? 0);
  }

  async copyPartnerId(): Promise<void> {
    const target = this.partnerId.trim();
    if (!target || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(target);
      this.copiedId = 'copied';
      setTimeout(() => (this.copiedId = ''), 1800);
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

  insertEmoji(emoji: string): void {
    this.message = `${this.message}${emoji}`;
  }

  async copyMessage(message: ChatMessage): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(message.text);
      this.copiedMessageId = message.id;
      setTimeout(() => (this.copiedMessageId = ''), 1600);
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

  highlightedHtml(text: string): SafeHtml {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    let html = text.replace(/[&<>"']/g, (char) => map[char] ?? char);

    // Solo convertir a enlace URLs que empiecen estrictamente con http:// o https://.
    // Se valida cada URL con el constructor URL() para evitar esquemas peligrosos.
    html = html.replace(/\b(https?:\/\/[^\s<"']+)/gi, (match) => {
      if (!this.isSafeUrl(match)) {
        return match;
      }
      const escapedUrl = match.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      return `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a>`;
    });

    const query = this.messageQuery.trim();
    if (query) {
      const pattern = new RegExp(`(${this.escapeRegExp(query)})`, 'gi');
      html = html.replace(pattern, '<mark>$1</mark>');
    }

    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  effectiveChatBackgroundId(chatId: string): string {
    const override = this.storage ? this.readStoredChatBackground(chatId) : null;
    return override ?? this.globalChatBackgroundId;
  }

  conversationBackground(chatId: string): string {
    const id = this.effectiveChatBackgroundId(chatId);
    const background = this.chatBackgrounds.find((item) => item.id === id);
    return background?.css ?? this.chatBackgrounds[0].css;
  }

  setConversationBackground(chatId: string, id: string): void {
    if (this.storage) {
      try {
        this.storage.setItem(`carxy:chat:bg:${chatId}`, id);
      } catch {
        /* almacenamiento no disponible */
      }
    }
  }

  setGlobalChatBackground(id: string): void {
    this.globalChatBackgroundId = id;
    if (this.storage) {
      try {
        this.storage.setItem('carxy:chat:bg', id);
      } catch {
        /* almacenamiento no disponible */
      }
    }
  }

  private readStoredChatBackground(chatId: string): string | null {
    if (!this.storage) return null;
    try {
      return this.storage.getItem(`carxy:chat:bg:${chatId}`);
    } catch {
      return null;
    }
  }

  onConversationBackgroundChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const id = value || this.chatBackgrounds[0].id;
    if (this.chatId) {
      this.setConversationBackground(this.chatId, id);
    } else {
      this.setGlobalChatBackground(id);
    }
  }

  onGlobalBackgroundChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const id = value || this.chatBackgrounds[0].id;
    this.setGlobalChatBackground(id);
  }

  private persistPinned(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem('carxy:chat:pinned', JSON.stringify([...this.pinned]));
    } catch {
      /* almacenamiento lleno: ignorar */
    }
  }

  private loadPinned(): string[] {
    if (!this.storage) return [];
    try {
      const parsed = JSON.parse(this.storage.getItem('carxy:chat:pinned') ?? '[]') as unknown;
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
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    const text = this.message.trim();
    if (!user || !this.chatId || !text) return;
    try {
      await this.social.sendMessage(this.chatId, {
        text,
        senderId: user.uid,
        senderName: user.displayName || user.email || 'Usuario',
      });
      this.message = '';
      this.error = '';
      this.nearBottom = true;
      this.markSeen(this.chatId);
      setTimeout(() => this.scrollToBottom());
    } catch (error) {
      this.error = error instanceof Error ? error.message : this.i18n.translate('No se pudo enviar el mensaje.');
      this.notifications.error(this.error, this.i18n.translate('No se pudo enviar el mensaje'));
    }
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  private markSeen(chatId: string): void {
    if (!chatId || !this.storage) return;
    this.seenChats[chatId] = Date.now();
    try {
      this.storage.setItem('carxy:chat:seen', JSON.stringify(this.seenChats));
    } catch {
      /* almacenamiento lleno: ignorar */
    }
  }

  private loadSeenChats(): Record<string, number> {
    if (!this.storage) return {};
    try {
      return JSON.parse(this.storage.getItem('carxy:chat:seen') ?? '{}') as Record<string, number>;
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
