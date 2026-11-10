export const APP_ROUTES = {
  editor: '/editor',
  feed: '/feed',
  login: '/login',
  register: '/register',
  profile: (uid: string) => `/profile/${encodeURIComponent(uid)}`,
  chat: '/chat',
  admin: '/admin',
  myModels: '/my-models',
  favorites: '/favorites',
  help: '/help',
  about: '/about',
  gettingStarted: '/getting-started',
  communityHelp: '/community-help',
  contact: '/contact',
} as const;

export const SOCIAL_COLLECTIONS = {
  users: 'users',
  privateUsers: 'userPrivate',
  posts: 'posts',
  chats: 'chats',
  reports: 'reports',
  follows: 'follows',
  feedback: 'feedback',
  communityQuestions: 'communityQuestions',
  projects: 'projects',
  projectMembers: 'projectMembers',
  projectInvitations: 'projectInvitations',
  projectActivity: 'projectActivity',
} as const;

export const SOCIAL_STORAGE_PATHS = {
  model: (uid: string, postId: string) => `models/${uid}/${postId}.glb`,
  thumbnail: (uid: string, postId: string) => `thumbnails/${uid}/${postId}.png`,
} as const;

export const LOCAL_KEYS = {
  user: 'forma-local-user',
  accounts: 'forma-local-accounts',
  posts: 'forma-social-posts',
  comments: 'forma-social-comments',
  chats: 'forma-social-chat',
  follows: 'forma-social-follows',
  likes: 'forma-social-likes',
  reports: 'forma-social-reports',
  feedback: 'forma-social-feedback',
  communityQuestions: 'forma-social-community-questions',
  communityAnswers: 'forma-social-community-answers',
  activityNotifications: 'forma-social-activity-notifications',
  modelDatabase: 'forma-social-models',
  preferences: 'forma-3d-preferences',
  draft: 'forma-3d-draft',
  onboarding: 'forma-3d-onboarding',
  guideProgress: 'forma-3d-guide-progress',
} as const;
