import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../../core/services/auth';
import { NotificationService } from '../../../core/services/notifications';
import { SocialService } from '../../../core/services/social';
import { ActivityNotification } from '../../../core/models/social.models';
import { ActivityNotificationsComponent } from './activity-notifications';

const ITEMS: ActivityNotification[] = [
  {
    id: 'n-1',
    recipientId: 'creator-1',
    actorId: 'creator-2',
    actorName: 'Creador Dos',
    actorPhotoURL: null,
    kind: 'like',
    targetId: 'post-1',
    createdAt: Date.now(),
    read: false,
  },
  {
    id: 'n-2',
    recipientId: 'creator-1',
    actorId: 'creator-3',
    actorName: 'Creador Tres',
    actorPhotoURL: null,
    kind: 'follow',
    createdAt: Date.now(),
    read: true,
  },
];

describe('ActivityNotificationsComponent', () => {
  async function setup(): Promise<{
    fixture: ReturnType<typeof TestBed.createComponent<ActivityNotificationsComponent>>;
    component: ActivityNotificationsComponent;
    markRead: ReturnType<typeof vi.fn>;
  }> {
    const markRead = vi.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [ActivityNotificationsComponent],
      providers: [
        {
          provide: AuthService,
          useValue: { user$: of({ uid: 'creator-1' }) },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: new Map<string, string>() } },
        },
        {
          provide: Router,
          useValue: { createUrlTree: () => '', serializeUrl: () => '' },
        },
        {
          provide: SocialService,
          useValue: {
            activityNotifications$: vi.fn(() => of(ITEMS)),
            markAllActivityNotificationsRead: markRead,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ActivityNotificationsComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, markRead };
  }

  it('counts only unread notifications', async () => {
    const { component } = await setup();
    expect(component.unreadCount(ITEMS)).toBe(1);
  });

  it('marks every unread notification as read and reports the amount', async () => {
    const { component, markRead } = await setup();
    const notifications = TestBed.inject(NotificationService);
    const success = vi.spyOn(notifications, 'success');

    await component.markAllRead(ITEMS, 'creator-1');

    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith('creator-1', ['n-1']);
    expect(success).toHaveBeenCalledWith(
      expect.stringContaining('1'),
      expect.any(String),
    );
  });

  it('does not claim that notifications were updated when there was nothing pending', async () => {
    const { component } = await setup();
    const notifications = TestBed.inject(NotificationService);
    const success = vi.spyOn(notifications, 'success');
    const info = vi.spyOn(notifications, 'info');

    await component.markAllRead([ITEMS[1]], 'creator-1');

    expect(success).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });

  it('closes the panel when clicking outside of it', async () => {
    const { fixture, component } = await setup();
    component.open.set(true);
    fixture.detectChanges();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(component.open()).toBe(false);
  });

  it('keeps the panel open when clicking inside of it', async () => {
    const { fixture, component } = await setup();
    const spy = vi.spyOn(component, 'onDocumentClick');
    component.open.set(true);
    console.log('OPEN BEFORE>>>', component.open);
    fixture.detectChanges();
    console.log('OPEN AFTER CD>>>', component.open, 'spy calls:', spy.mock.calls.length);
    await fixture.whenStable();
    fixture.detectChanges();
    console.log('HTML>>>', fixture.nativeElement.innerHTML);

    const header = fixture.nativeElement.querySelector('.activity-popover header') as HTMLElement;
    expect(header).toBeTruthy();
    header.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(component.open()).toBe(true);
  });
});
