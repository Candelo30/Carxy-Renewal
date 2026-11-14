import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { SocialService } from '../../core/services/social';
import { ChatPage } from './chat-page';

const CURRENT_USER = {
  uid: 'creator-1',
  displayName: 'Creador Uno',
  email: 'uno@example.test',
  photoURL: null,
  bio: '',
};

function createSocialStub(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    userActivity$: of([]),
    userActivityOf$: vi.fn(() => of(null)),
    userPresence$: vi.fn(() => of(null)),
    activityNotifications$: vi.fn(() => of([])),
    recentChats$: vi.fn(() => of([])),
    chatMessages$: vi.fn(() => of([])),
    profile$: vi.fn(() => of(null)),
    markActivityNotificationRead: vi.fn().mockResolvedValue(undefined),
    markMessageNotificationsRead: vi.fn().mockResolvedValue(undefined),
    markAllActivityNotificationsRead: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendImageMessage: vi.fn().mockResolvedValue(undefined),
    decryptMediaForChat: vi.fn().mockResolvedValue(null),
    ensureChatConversation: vi.fn().mockResolvedValue(undefined),
    ensureMyChatKeyPair: vi.fn().mockResolvedValue(true),
    writeChatState: vi.fn().mockResolvedValue(undefined),
    chatPeerState$: vi.fn(() => of(null)),
    ...overrides,
  };
}

async function setup(social: Record<string, unknown> = createSocialStub()): Promise<{
  fixture: ReturnType<typeof TestBed.createComponent<ChatPage>>;
  component: ChatPage;
}> {
  await TestBed.configureTestingModule({
    imports: [ChatPage],
    providers: [
      {
        provide: AuthService,
        useValue: { user$: of(CURRENT_USER), isConfigured: true },
      },
      { provide: SocialService, useValue: social },
      {
        provide: ActivatedRoute,
        useValue: { queryParamMap: of(new Map<string, string>()) },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ChatPage);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance };
}

describe('ChatPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('applies the conversation background when the select emits a plain value', async () => {
    const { component } = await setup();
    component.partnerId = 'creator-2';
    component.openConversation();

    // `ngModelChange` emite el valor (string), no el evento DOM.
    expect(() => component.onConversationBackgroundChange('aurora')).not.toThrow();

    expect(component.chatBackgroundId).toBe('aurora');
    expect(localStorage.getItem('carxy:chat:bg:creator-1__creator-2')).toBe('aurora');
    expect(component.conversationBackground('creator-1__creator-2')).toContain('#0d0a1a');
  });

  it('falls back to the default background for unknown ids', async () => {
    const { component } = await setup();
    component.onGlobalBackgroundChange('no-existe');
    expect(component.globalChatBackgroundId).toBe('default');
  });

  it('persists and restores the global background', async () => {
    localStorage.setItem('carxy:chat:bg', 'ocean');
    const { component } = await setup();
    expect(component.globalChatBackgroundId).toBe('ocean');

    component.onGlobalBackgroundChange('forest');
    expect(localStorage.getItem('carxy:chat:bg')).toBe('forest');
  });

  it('keeps the conversation background in sync with the global one when there is no override', async () => {
    const { component } = await setup();
    component.partnerId = 'creator-2';
    component.openConversation();

    component.onGlobalBackgroundChange('sunset');

    expect(component.chatBackgroundId).toBe('sunset');
  });

  it('does not escape URLs twice when rendering links', async () => {
    const { component } = await setup();
    const html = component.highlightedHtml('mira https://carxy.app/?a=1&b=2');

    expect(html.toString()).toContain('href="https://carxy.app/?a=1&amp;b=2"');
    expect(html.toString()).not.toContain('&amp;amp;');
  });

  it('never injects markup inside the generated anchor tag when searching', async () => {
    const { component } = await setup();
    component.messageQuery = 'carxy';
    const html = component.highlightedHtml('visita https://carxy.app ahora').toString();

    expect(html).toContain('<a href="https://carxy.app"');
    expect(html).not.toContain('<mark>carxy</mark>.app');
  });

  it('highlights matches in plain text', async () => {
    const { component } = await setup();
    component.messageQuery = 'hola';
    const html = component.highlightedHtml('holaqué tal').toString();

    expect(html).toContain('<mark>hola</mark>');
  });

  it('escapes html in the message body', async () => {
    const { component } = await setup();
    const html = component.highlightedHtml('<script>alert(1)</script>').toString();

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not send the same message twice while a send is in flight', async () => {
    let resolveSend: (() => void) | undefined;
    const sendMessage = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveSend = resolve; }),
    );
    const { component } = await setup(createSocialStub({ sendMessage }));

    component.partnerId = 'creator-2';
    component.openConversation();
    component.message.set('hola');

    const first = component.send();
    const second = component.send();
    // Deja que se resuelva la lectura del usuario actual.
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(component.sending()).toBe(true);

    resolveSend?.();
    await first;
    await second;

    expect(component.sending()).toBe(false);
    expect(component.message()).toBe('');
  });

  it('does not write the seen marker on every change detection cycle', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { fixture, component } = await setup();
    component.partnerId = 'creator-2';
    component.openConversation();
    setItem.mockClear();

    fixture.detectChanges();
    fixture.detectChanges();
    fixture.detectChanges();

    const seenWrites = setItem.mock.calls.filter(([key]) => key === 'carxy:chat:seen');
    expect(seenWrites.length).toBeLessThanOrEqual(1);
  });

  it('exposes the open conversation through signals so zoneless repaints it', async () => {
    const { component } = await setup();

    component.partnerId = 'creator-2';
    component.openConversation();

    // Con propiedades simples el render dependía del throttling de `markSeen`
    // o del AsyncPipe de `user$`, y el panel podía no dibujarse nunca.
    expect(component.chatId()).toBe('creator-1__creator-2');
    expect(component.messages()).toBeDefined();
    expect(component.partnerProfile()).toBeDefined();
  });

  it('clears the conversation state when it is deselected', async () => {
    const { component } = await setup();

    component.partnerId = 'creator-2';
    component.openConversation();
    component.deselectChat();

    expect(component.chatId()).toBe('');
    expect(component.messages()).toBeUndefined();
    expect(component.partnerProfile()).toBeUndefined();
  });

  it('shows the failure instead of silently emptying the message thread', async () => {
    const { fixture, component } = await setup(createSocialStub({
      chatMessages$: vi.fn(() => throwError(() => new Error('sin permisos'))),
    }));

    component.partnerId = 'creator-2';
    component.openConversation();
    fixture.detectChanges();

    expect(component.threadError()).toContain('sin permisos');
  });

  it('shows the failure instead of silently emptying the conversation list', async () => {
    const { fixture, component } = await setup(createSocialStub({
      recentChats$: vi.fn(() => throwError(() => new Error('lista rota'))),
    }));

    fixture.detectChanges();

    expect(component.listError()).toContain('lista rota');
  });

  it('sends the message with the already resolved user and their avatar', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const { component } = await setup(createSocialStub({ sendMessage }));

    component.partnerId = 'creator-2';
    component.openConversation();
    component.message.set('hola');
    await component.send();

    expect(sendMessage).toHaveBeenCalledWith('creator-1__creator-2', {
      text: 'hola',
      senderId: 'creator-1',
      senderName: 'Creador Uno',
      senderPhotoURL: null,
    });
  });

  it('detects a shared model link so it can be shown as a card', async () => {
    const { component } = await setup();

    expect(component.modelPostId({
      id: '1',
      text: 'mira https://carxy.app/Carxy-Renewal/feed?post=abc-123_def',
      senderId: 'creator-2',
      senderName: 'Creador Dos',
      createdAt: 1,
    })).toBe('abc-123_def');

    expect(component.modelPostId({
      id: '2',
      text: 'hola, ¿qué tal?',
      senderId: 'creator-2',
      senderName: 'Creador Dos',
      createdAt: 2,
    })).toBe('');
  });

  it('marks the messages that arrive while reading history as unread', async () => {
    const { component } = await setup();

    component.partnerId = 'creator-2';
    component.openConversation();

    const older = { id: 'a', text: 'viejo', senderId: 'creator-2', senderName: 'Creador Dos', createdAt: 1_000 };
    const fresh = { id: 'b', text: 'nuevo', senderId: 'creator-2', senderName: 'Creador Dos', createdAt: 5_000 };
    // El hilo llega con el historial y el usuario está al final: todo leído.
    component['syncReadState']([older] as never);
    expect(component.unreadCount()).toBe(0);

    // El usuario sube a leer historial: a partir de aquí lo que llega se
    // marca como nuevo en vez de hacer scroll.
    component.atBottom.set(false);
    component['syncReadState']([older, fresh] as never);

    expect(component.unreadCount()).toBe(1);
    expect(component.firstUnreadId()).toBe('b');
  });

  it('clears the unread marker when the user returns to the end of the thread', async () => {
    const { component } = await setup();

    component.partnerId = 'creator-2';
    component.openConversation();
    component['syncReadState']([
      { id: 'a', text: 'hola', senderId: 'creator-2', senderName: 'Creador Dos', createdAt: 5_000 },
    ] as never);
    component.atBottom.set(false);
    component['syncReadState']([
      { id: 'a', text: 'hola', senderId: 'creator-2', senderName: 'Creador Dos', createdAt: 5_000 },
      { id: 'b', text: 'otro', senderId: 'creator-2', senderName: 'Creador Dos', createdAt: 9_000 },
    ] as never);
    expect(component.unreadCount()).toBe(1);

    component.scrollToLatest();

    expect(component.atBottom()).toBe(true);
    expect(component.unreadCount()).toBe(0);
    expect(component.firstUnreadId()).toBe('');
  });

  it('shows the hour for conversations updated today and a label for older ones', async () => {
    const { component } = await setup();

    const now = Date.now();
    expect(component.conversationDateLabel(now)).toMatch(/\d{1,2}:\d{2}/);
    expect(component.conversationDateLabel(now - 86_400_000)).toBe('Ayer');
    expect(component.conversationDateLabel(now - 30 * 86_400_000)).not.toBe('');
  });
});
