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
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  Observable,
  Subscription,
  combineLatest,
  firstValueFrom,
  map,
  of,
  switchMap,
  take,
} from 'rxjs';
import { ChatConversation, ChatMessage, User } from '../../core/models/social.models';
import { AuthService } from '../../core/services/auth';
import { SocialService } from '../../core/services/social';
import { NotificationService } from '../../core/services/notifications';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { AccountMenuComponent } from '../../shared/components/account-menu/account-menu';
import { ActivityNotificationsComponent } from '../../shared/components/activity-notifications/activity-notifications';

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [
    AccountMenuComponent,
    ActivityNotificationsComponent,
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
  private readonly route = inject(ActivatedRoute);
  private readonly subscription = new Subscription();
  private currentUser: User | null = null;
  @ViewChild('messageList') private messageListContainer!: ElementRef;
  readonly conversations$ = this.user$.pipe(
    switchMap((user) =>
      user
        ? this.social
            .chatConversations$(user.uid)
            .pipe(
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
  error = '';
  chatId = '';
  messages$?: Observable<ChatMessage[]>;

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

  openConversation(): void {
    const peer = this.partnerId.trim();
    if (!this.currentUser || !peer || peer === this.currentUser.uid || /[/.#$/\[\]]/.test(peer)) {
      this.error = 'Ingresa un UID válido de otro creador.';
      this.notifications.warning(this.error);
      return;
    }
    this.error = '';
    const nextChatId = [this.currentUser.uid, peer].sort().join('__');
    if (this.chatId === nextChatId) return;
    this.chatId = nextChatId;
    this.messages$ = this.social.chatMessages$(this.chatId);
    void this.social.ensureChatConversation(this.chatId).catch((error: unknown) => {
      this.error = error instanceof Error ? error.message : 'No se pudo abrir la conversación.';
      this.notifications.error(this.error);
    });
  }

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  scrollToBottom(): void {
    try {
      this.messageListContainer.nativeElement.scrollTop =
        this.messageListContainer.nativeElement.scrollHeight;
    } catch (err) {}
  }

  deselectChat(): void {
    this.chatId = '';
    this.partnerId = '';
    this.messages$ = undefined;
    this.error = '';
  }

  peerId(conversation: ChatConversation, uid: string): string {
    return conversation.participantIds.find((participantId) => participantId !== uid) ?? '';
  }

  selectConversation(conversation: ChatConversation, uid: string): void {
    this.partnerId = this.peerId(conversation, uid);
    this.openConversation();
  }

  useFallbackAvatar(event: Event): void {
    const image = event.target;
    if (image instanceof HTMLImageElement) image.src = '/user-avatar.svg';
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
        senderName: user.displayName,
      });
      this.message = '';
      this.error = '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'No se pudo enviar el mensaje.';
      this.notifications.error(this.error, 'No se pudo enviar el mensaje');
    }
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
