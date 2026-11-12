import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AsyncPipe, DatePipe, DOCUMENT } from '@angular/common';
import { combineLatest, tap } from 'rxjs';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';
import { CollaborationService, hasPermission, type ProjectPermission } from '../../core/services/collaboration';
import { I18nService } from '../../core/services/i18n';
import { AuthService } from '../../core/services/auth';
import { NotificationService } from '../../core/services/notifications';
import { absoluteAppUrl, shareOrCopy } from '../../core/utils/share';
import type { ProjectShareLink, ProjectShareLinkRole } from '../../core/models/social.models';

@Component({
  selector: 'app-project-detail-page',
  standalone: true,
  imports: [RouterLink, FormsModule, AsyncPipe, DatePipe, TranslatePipe, ShellHeaderComponent, SiteFooterComponent],
  templateUrl: './project-detail-page.html',
  styleUrl: './project-detail-page.css',
})
export class ProjectDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly collaboration = inject(CollaborationService);
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly document = inject(DOCUMENT);

  projectId = '';
  projectName = '';
  projectLoaded = false;
  project$ = this.collaboration.getProject('');
  members = this.collaboration.getMembers('');
  invitations = this.collaboration.getMyInvitations();
  activity = this.collaboration.getProjectActivity('');
  shareLinks = this.collaboration.getShareLinks('');

  newInviteEmail = '';
  newInviteRole: 'owner' | 'editor' | 'viewer' = 'editor';
  inviting = false;

  canWrite = false;
  isOwner = false;

  newShareRole: ProjectShareLinkRole = 'viewer';
  creatingShareLink = false;
  busyShareLinkId: string | null = null;

  /** UID del usuario actual (para permitir auto-eliminación de membresía). */
  get currentUid(): string | null {
    return this.auth.currentUser?.uid ?? null;
  }

  useFallbackAvatar(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (image) image.src = 'user-avatar.svg';
  }

  editing = false;
  saving = false;
  editName = '';
  editDescription = '';
  editPublic = false;

  readonly projectPermission = { read: 'read', write: 'write', owner: 'owner' };

  ngOnInit(): void {
    this.projectId = this.route.snapshot.paramMap.get('id') ?? '';
    this.project$ = this.collaboration.getProject(this.projectId).pipe(
      tap((p) => {
        this.projectLoaded = true;
        this.projectName = p?.name ?? '';
      })
    );
    this.members = this.collaboration.getMembers(this.projectId);
    this.invitations = this.collaboration.getMyInvitations();
    this.activity = this.collaboration.getProjectActivity(this.projectId);
    this.shareLinks = this.collaboration.getShareLinks(this.projectId);

    combineLatest([this.auth.user$, this.members])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([user, members]) => {
        const currentUid = user?.uid ?? this.auth.currentUser?.uid ?? null;
        const member = currentUid ? members.find((m) => m.userId === currentUid) : undefined;
        this.isOwner = member?.role === 'owner';
        this.canWrite = hasPermission(member?.role ?? 'viewer', 'write');
      });
  }

  async inviteMember(): Promise<void> {
    const email = this.newInviteEmail.trim();
    if (!email) return;
    this.inviting = true;
    try {
      const result = await this.collaboration.inviteMember(this.projectId, email, this.newInviteRole);
      this.newInviteEmail = '';
      if (result.emailSent) {
        this.notifications.success(this.i18n.translate('projects.inviteSent'));
      } else {
        this.notifications.warning(this.i18n.translate('Invitación creada, pero el correo no se pudo enviar. El invitado la verá en /projects.'));
      }
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo enviar la invitación.')
      );
    } finally {
      this.inviting = false;
    }
  }

  async acceptInvitation(invitationId: string): Promise<void> {
    try {
      await this.collaboration.acceptInvitation(invitationId);
      this.notifications.success(this.i18n.translate('projects.invitationAccepted'));
      void this.router.navigate(['/projects', this.projectId]);
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo aceptar la invitación.')
      );
    }
  }

  async rejectInvitation(invitationId: string): Promise<void> {
    try {
      await this.collaboration.rejectInvitation(invitationId);
      this.notifications.info(this.i18n.translate('projects.invitationRejected'));
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo rechazar la invitación.')
      );
    }
  }

  async changeRole(memberId: string, role: string): Promise<void> {
    try {
      await this.collaboration.updateMemberRole(this.projectId, memberId, role as 'owner' | 'editor' | 'viewer');
      this.notifications.success(this.i18n.translate('projects.roleUpdated'));
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo cambiar el rol.')
      );
    }
  }

  async removeMember(memberId: string): Promise<void> {
    if (!confirm(this.i18n.translate('projects.confirmRemoveMember'))) return;
    try {
      await this.collaboration.removeMember(this.projectId, memberId);
      this.notifications.success(this.i18n.translate('projects.memberRemoved'));
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar el miembro.')
      );
    }
  }

  async deleteProject(): Promise<void> {
    if (!confirm(this.i18n.translate('projects.confirmDeleteProject'))) return;
    try {
      await this.collaboration.deleteProject(this.projectId);
      this.notifications.success(this.i18n.translate('projects.deletedSuccess'));
      void this.router.navigate(['/projects']);
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar el proyecto.')
      );
    }
  }

  openEditor(): void {
    void this.router.navigate(['/editor'], { queryParams: { project: this.projectId } });
  }

  async shareProject(): Promise<void> {
    const url = absoluteAppUrl(`projects/${encodeURIComponent(this.projectId)}`, this.document.baseURI);
    try {
      await shareOrCopy(
        url,
        this.projectName || this.i18n.translate('projects.shareTitle'),
        this.i18n.translate('projects.shareHint'),
      );
      this.notifications.success(
        this.i18n.translate('projects.shareCopied'),
        this.i18n.translate('projects.shareTitle')
      );
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('projects.shareError')
      );
    }
  }

  shareLinkUrl(link: ProjectShareLink): string {
    return absoluteAppUrl(
      `editor?project=${encodeURIComponent(this.projectId)}&share=${encodeURIComponent(link.id)}`,
      this.document.baseURI,
    );
  }

  shareLinkRoleLabel(link: ProjectShareLink): string {
    return link.role === 'editor' ? this.i18n.translate('projects.roleEditor') : this.i18n.translate('projects.roleViewer');
  }

  async createShareLink(): Promise<void> {
    if (!this.isOwner) return;
    this.creatingShareLink = true;
    try {
      await this.collaboration.createShareLink(this.projectId, this.newShareRole);
      this.notifications.success(this.i18n.translate('Enlace de acceso creado.'));
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo crear el enlace.'));
    } finally {
      this.creatingShareLink = false;
    }
  }

  async copyShareLink(link: ProjectShareLink): Promise<void> {
    try {
      await shareOrCopy(this.shareLinkUrl(link), this.projectName || this.i18n.translate('projects.shareTitle'));
      this.notifications.success(this.i18n.translate('projects.shareCopied'));
    } catch {
      this.notifications.error(this.i18n.translate('projects.shareError'));
    }
  }

  async toggleShareLink(link: ProjectShareLink): Promise<void> {
    this.busyShareLinkId = link.id;
    try {
      await this.collaboration.updateShareLink(link.id, { enabled: !link.enabled });
      this.notifications.success(link.enabled ? this.i18n.translate('Enlace desactivado.') : this.i18n.translate('Enlace activado.'));
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el enlace.'));
    } finally {
      this.busyShareLinkId = null;
    }
  }

  async changeShareLinkRole(link: ProjectShareLink, role: string): Promise<void> {
    if (role !== 'editor' && role !== 'viewer') return;
    this.busyShareLinkId = link.id;
    try {
      await this.collaboration.updateShareLink(link.id, { role: role as ProjectShareLinkRole });
      this.notifications.success(this.i18n.translate('Permisos del enlace actualizados.'));
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo actualizar el enlace.'));
    } finally {
      this.busyShareLinkId = null;
    }
  }

  async deleteShareLink(link: ProjectShareLink): Promise<void> {
    if (!confirm(this.i18n.translate('¿Eliminar este enlace de acceso?'))) return;
    this.busyShareLinkId = link.id;
    try {
      await this.collaboration.deleteShareLink(link.id);
      this.notifications.success(this.i18n.translate('Enlace eliminado.'));
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : this.i18n.translate('No se pudo eliminar el enlace.'));
    } finally {
      this.busyShareLinkId = null;
    }
  }

  startEdit(project: { name: string; description: string; isPublic: boolean }): void {
    if (!this.isOwner) return;
    this.editName = project.name || '';
    this.editDescription = project.description || '';
    this.editPublic = !!project.isPublic;
    this.editing = true;
  }

  cancelEdit(): void {
    this.editing = false;
  }

  async saveEdit(): Promise<void> {
    const name = this.editName.trim();
    if (!name) {
      this.notifications.warning(this.i18n.translate('projects.nameRequired'));
      return;
    }
    this.saving = true;
    try {
      await this.collaboration.updateProject(this.projectId, {
        name,
        description: this.editDescription.trim(),
        isPublic: this.editPublic,
      });
      this.projectName = name;
      this.editing = false;
      this.notifications.success(this.i18n.translate('projects.updatedSuccess'));
    } catch (error) {
      this.notifications.error(
        error instanceof Error ? error.message : this.i18n.translate('projects.updateError')
      );
    } finally {
      this.saving = false;
    }
  }

  hasPermission(permission: ProjectPermission): boolean {
    return hasPermission(this.isOwner ? 'owner' : (this.canWrite ? 'editor' : 'viewer'), permission);
  }
}
