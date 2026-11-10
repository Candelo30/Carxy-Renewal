import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { catchError, of } from 'rxjs';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';
import { CollaborationService } from '../../core/services/collaboration';
import { I18nService } from '../../core/services/i18n';
import { AuthService } from '../../core/services/auth';
import { NotificationService } from '../../core/services/notifications';
import type { Project, ProjectInvitation } from '../../core/models/social.models';

type ProjectFilter = 'all' | 'owned' | 'shared' | 'public' | 'private';
type ProjectSort = 'updated' | 'name' | 'created';

@Component({
  selector: 'app-projects-page',
  standalone: true,
  imports: [FormsModule, DatePipe, TranslatePipe, ShellHeaderComponent, SiteFooterComponent],
  templateUrl: './projects-page.html',
  styleUrl: './projects-page.css',
})
export class ProjectsPage {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly collaboration = inject(CollaborationService);
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);

  newProjectName = '';
  newProjectDescription = '';
  newProjectPublic = false;
  creating = false;
  createError = '';

  searchQuery = '';
  filter: ProjectFilter = 'all';
  sort: ProjectSort = 'updated';

  readonly projectsLoading = signal(true);
  readonly projectsError = signal('');
  readonly busyInvitationId = signal<string | null>(null);
  readonly busyProjectId = signal<string | null>(null);
  readonly currentUid = signal<string | null>(null);
  readonly projects = signal<Project[]>([]);
  readonly invitations = signal<ProjectInvitation[]>([]);

  readonly filteredProjects = computed(() => {
    const uid = this.currentUid();
    const query = this.searchQuery.trim().toLowerCase();
    let list = [...this.projects()];

    if (query) {
      list = list.filter((project) => {
        const haystack = `${project.name ?? ''} ${project.description ?? ''}`.toLowerCase();
        return haystack.includes(query);
      });
    }

    switch (this.filter) {
      case 'owned':
        list = list.filter((project) => project.ownerId === uid);
        break;
      case 'shared':
        list = list.filter((project) => project.ownerId !== uid);
        break;
      case 'public':
        list = list.filter((project) => project.isPublic);
        break;
      case 'private':
        list = list.filter((project) => !project.isPublic);
        break;
    }

    list.sort((a, b) => {
      if (this.sort === 'name') return (a.name || '').localeCompare(b.name || '');
      if (this.sort === 'created') return (b.createdAt || 0) - (a.createdAt || 0);
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    return list;
  });

  readonly ownedCount = computed(() => this.projects().filter((p) => p.ownerId === this.currentUid()).length);
  readonly sharedCount = computed(() => this.projects().filter((p) => p.ownerId !== this.currentUid()).length);

  constructor() {
    this.auth.user$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((user) => {
      this.currentUid.set(user?.uid ?? null);
    });

    this.collaboration.getAccessibleProjects().pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError((error: unknown) => {
        this.projectsLoading.set(false);
        const message = error instanceof Error ? error.message : this.i18n.translate('No se pudieron cargar los proyectos.');
        this.projectsError.set(message);
        return of([] as Project[]);
      })
    ).subscribe((projects) => {
      this.projects.set(projects ?? []);
      this.projectsLoading.set(false);
      this.projectsError.set('');
    });

    this.collaboration.getMyInvitations().pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError(() => of([] as ProjectInvitation[]))
    ).subscribe((invitations) => this.invitations.set(invitations ?? []));
  }

  setSearch(value: string): void {
    this.searchQuery = value;
  }

  setFilter(value: ProjectFilter): void {
    this.filter = value;
  }

  setSort(value: ProjectSort): void {
    this.sort = value;
  }

  clearFilters(): void {
    this.searchQuery = '';
    this.filter = 'all';
    this.sort = 'updated';
  }

  async createProject(): Promise<void> {
    const name = this.newProjectName.trim();
    if (!name) {
      this.createError = this.i18n.translate('projects.nameRequired');
      return;
    }
    this.creating = true;
    this.createError = '';
    try {
      const id = await this.collaboration.createProject(
        name,
        this.newProjectDescription.trim(),
        this.newProjectPublic
      );
      this.notifications.success(
        this.i18n.translate('projects.createdSuccess'),
        this.i18n.translate('projects.createdTitle')
      );
      this.newProjectName = '';
      this.newProjectDescription = '';
      this.newProjectPublic = false;
      void this.router.navigate(['/projects', id]);
    } catch (error) {
      const message = error instanceof Error ? error.message : this.i18n.translate('No se pudo crear el proyecto.');
      this.createError = message;
      this.notifications.error(message, this.i18n.translate('projects.createErrorTitle'));
    } finally {
      this.creating = false;
    }
  }

  async acceptInvitation(invitation: ProjectInvitation): Promise<void> {
    this.busyInvitationId.set(invitation.id);
    try {
      await this.collaboration.acceptInvitation(invitation.id);
      this.notifications.success(this.i18n.translate('projects.invitationAccepted'));
      void this.router.navigate(['/projects', invitation.projectId]);
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo aceptar la invitación.')
      );
    } finally {
      this.busyInvitationId.set(null);
    }
  }

  async rejectInvitation(invitation: ProjectInvitation): Promise<void> {
    this.busyInvitationId.set(invitation.id);
    try {
      await this.collaboration.rejectInvitation(invitation.id);
      this.notifications.info(this.i18n.translate('projects.invitationRejected'));
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo rechazar la invitación.')
      );
    } finally {
      this.busyInvitationId.set(null);
    }
  }

  async deleteProject(project: Project, event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isOwner(project)) return;
    if (!confirm(this.i18n.translate('projects.confirmDeleteProject'))) return;
    this.busyProjectId.set(project.id);
    try {
      await this.collaboration.deleteProject(project.id);
      this.notifications.success(this.i18n.translate('projects.deletedSuccess'));
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar el proyecto.')
      );
    } finally {
      this.busyProjectId.set(null);
    }
  }

  openInEditor(projectId: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    void this.router.navigate(['/editor'], { queryParams: { project: projectId } });
  }

  openProject(projectId: string): void {
    void this.router.navigate(['/projects', projectId]);
  }

  isOwner(project: Project): boolean {
    return !!this.currentUid() && project.ownerId === this.currentUid();
  }

  trackById = (_index: number, project: { id: string }) => project.id;
}
