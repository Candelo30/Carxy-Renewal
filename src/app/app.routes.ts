import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';
import { moderatorGuard } from './core/guards/moderator.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'editor' },
  {
    path: 'editor',
    loadComponent: () => import('./features/editor-page/editor-page').then((module) => module.EditorPage),
  },
  {
    path: 'feed',
    loadComponent: () => import('./features/feed/feed-page').then((module) => module.FeedPage),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/auth-page').then((module) => module.AuthPage),
    data: { mode: 'login' },
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/auth-page').then((module) => module.AuthPage),
    data: { mode: 'register' },
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./features/auth/auth-page').then((module) => module.AuthPage),
    data: { mode: 'reset' },
  },
  {
    path: 'profile/:uid',
    loadComponent: () => import('./features/profile/profile-page').then((module) => module.ProfilePage),
  },
  {
    path: 'chat',
    canActivate: [authGuard],
    loadComponent: () => import('./features/chat/chat-page').then((module) => module.ChatPage),
  },
  {
    path: 'my-models',
    canActivate: [authGuard],
    loadComponent: () => import('./features/my-models/my-models').then((module) => module.MyModelsComponent),
  },
  {
    path: 'favorites',
    canActivate: [authGuard],
    loadComponent: () => import('./features/favorites/favorites-page').then((module) => module.FavoritesPage),
  },
  { path: 'dashboard', pathMatch: 'full', redirectTo: 'my-models' },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./features/admin/admin-dashboard').then((module) => module.AdminDashboardComponent),
  },
  {
    path: 'moderation',
    canActivate: [moderatorGuard],
    loadComponent: () => import('./features/admin/admin-dashboard').then((module) => module.AdminDashboardComponent),
    data: { moderationOnly: true },
  },
  {
    path: 'help',
    loadComponent: () => import('./features/help/help-page').then((module) => module.HelpPage),
  },
  {
    path: 'getting-started',
    loadComponent: () => import('./features/getting-started/getting-started-page').then((module) => module.GettingStartedPage),
  },
  {
    path: 'about',
    loadComponent: () => import('./features/about/about-page').then((module) => module.AboutPage),
  },
  {
    path: 'community-help',
    loadComponent: () =>
      import('./features/community-help/community-help-page').then((module) => module.CommunityHelpPage),
  },
  {
    path: 'contact',
    loadComponent: () => import('./features/contact/contact-page').then((module) => module.ContactPage),
  },
  { path: 'ayuda', pathMatch: 'full', redirectTo: 'help' },
  { path: 'guia', pathMatch: 'full', redirectTo: 'getting-started' },
  { path: 'nosotros', pathMatch: 'full', redirectTo: 'about' },
  { path: 'ayuda-comunitaria', pathMatch: 'full', redirectTo: 'community-help' },
  { path: 'contacto', pathMatch: 'full', redirectTo: 'contact' },
  { path: '**', redirectTo: 'editor' },
];
