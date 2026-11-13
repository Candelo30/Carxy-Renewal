import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
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
    activityNotifications$: vi.fn(() => of([])),
    recentChats$: vi.fn(() => of([])),
    chatMessages$: vi.fn(() => of([])),
    profile$: vi.fn(() => of(null)),
    markActivityNotificationRead: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ensureChatConversation: vi.fn().mockResolvedValue(undefined),
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
});
