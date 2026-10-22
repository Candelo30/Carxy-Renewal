import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { LOCAL_KEYS } from '../config/app.constants';
import { Post3D } from '../models/social.models';
import { formatStorageError, SocialService } from './social';

describe('SocialService local mode', () => {
  let service: SocialService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(SocialService);
  });

  describe('formatStorageError', () => {
    it('guides the user to verify the bucket when Firebase reports it missing', () => {
      expect(formatStorageError({ code: 'storage/bucket-not-found' }))
        .toContain('nombre exacto');
    });

    it('distinguishes Storage rules denials from network/CORS symptoms', () => {
      expect(formatStorageError({ code: 'storage/unauthorized' }))
        .toContain('storage.rules');
      expect(formatStorageError({ code: 'storage/unknown' }))
        .toContain('revisa la respuesta HTTP');
    });
  });

  it('publishes comments and chat messages through live local streams', async () => {
    const author = {
      uid: 'creator-1',
      displayName: 'Creator',
      email: 'creator@example.test',
      photoURL: null,
      bio: '',
    };
    await service.addComment('post-1', 'Looks great', author);
    await service.sendMessage('creator-1__creator-2', {
      text: 'Hello',
      senderId: author.uid,
      senderName: author.displayName,
    });

    expect((await firstValueFrom(service.comments$('post-1')))[0].text).toBe('Looks great');
    expect((await firstValueFrom(service.chatMessages$('creator-1__creator-2')))[0].senderId).toBe('creator-1');
    const [recentChat] = await firstValueFrom(service.chatConversations$('creator-1'));
    expect(recentChat.id).toBe('creator-1__creator-2');
    expect(recentChat.lastMessage?.text).toBe('Hello');
  });

  it('supports following creators and read-state notifications in local mode', async () => {
    const follower = {
      uid: 'creator-2',
      displayName: 'Second Creator',
      email: '',
      photoURL: null,
      bio: '',
    };
    await service.followUser(follower, 'creator-1');
    await service.followUser(follower, 'creator-1');

    expect(await firstValueFrom(service.isFollowing$('creator-2', 'creator-1'))).toBe(true);
    expect(await firstValueFrom(service.followCounts$('creator-1'))).toEqual({ followers: 1, following: 0 });
    const [notification] = await firstValueFrom(service.activityNotifications$('creator-1'));
    expect(notification.actorId).toBe(follower.uid);
    expect(notification.kind).toBe('follow');
    expect(notification.read).toBe(false);

    await service.markActivityNotificationRead('creator-1', notification.id);
    expect((await firstValueFrom(service.activityNotifications$('creator-1')))[0].read).toBe(true);
    await service.unfollowUser('creator-2', 'creator-1');
    expect(await firstValueFrom(service.isFollowing$('creator-2', 'creator-1'))).toBe(false);
    await expect(service.followUser(follower, follower.uid)).rejects.toThrow('No puedes seguirte a ti mismo.');
  });

  it('keeps private creations out of public creator lists and supports local metric updates', async () => {
    TestBed.resetTestingModule();
    localStorage.clear();
    const author = {
      uid: 'creator-1',
      displayName: 'Creator',
      email: '',
      photoURL: null,
      bio: '',
    };
    const posts: Post3D[] = [
      {
        id: 'public-post',
        title: 'Public',
        description: '',
        modelUrl: '',
        thumbnailUrl: '',
        author,
        likes: 2,
        authorId: author.uid,
        likesCount: 2,
        createdAt: 1,
        isPrivate: false,
      },
      {
        id: 'private-post',
        title: 'Private',
        description: '',
        modelUrl: '',
        thumbnailUrl: '',
        author,
        likes: 1,
        authorId: author.uid,
        likesCount: 1,
        createdAt: 2,
        isPrivate: true,
      },
    ];
    localStorage.setItem(LOCAL_KEYS.posts, JSON.stringify(posts));
    TestBed.configureTestingModule({});
    service = TestBed.inject(SocialService);

    expect((await firstValueFrom(service.userPosts$(author.uid))).map((post) => post.id))
      .toEqual(['public-post']);
    expect((await firstValueFrom(service.userPosts$(author.uid, true))).map((post) => post.id))
      .toEqual(['public-post', 'private-post']);

    await service.updatePost(posts[1], {
      title: posts[1].title,
      description: posts[1].description,
      tags: [],
      isPrivate: false,
    });
    await service.incrementViews(posts[1]);
    await service.incrementRemixes(posts[1]);

    const updated = (await firstValueFrom(service.userPosts$(author.uid)))
      .find((post) => post.id === 'private-post');
    expect(updated?.isPrivate).toBe(false);
    expect(updated?.viewsCount).toBe(1);
    expect(updated?.remixCount).toBe(1);
  });
});
