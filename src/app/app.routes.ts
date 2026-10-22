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
  { path: '**', redirectTo: 'editor' },
];
