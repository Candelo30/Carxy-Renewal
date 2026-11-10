import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';
import { CollaborationService, hasPermission, type ProjectPermission } from '../../core/services/collaboration';
import { I18nService } from '../../core/services/i18n';
import { AuthService } from '../../core/services/auth';
import { firstValueFrom, map, take } from 'rxjs';

@Component({
  selector: 'app-project-detail-page',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe, TranslatePipe, ShellHeaderComponent, SiteFooterComponent],
  templateUrl: './project-detail-page.html',
  styleUrl: './project-detail-page.css',
})
export class ProjectDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly collaboration = inject(CollaborationService);
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);

  projectId = '';
  projectName = '';
  project$ = this.collaboration.getProject('');
  members = this.collaboration.getMembers('');
  invitations = this.collaboration.getMyInvitations();

  newInviteEmail = '';
  newInviteRole: 'owner' | 'editor' | 'viewer' = 'editor';
  inviting = false;

  canWrite = false;
  isOwner = false;

  readonly projectPermission = { read: 'read', write: 'write', owner: 'owner' };

  ngOnInit(): void {
    this.projectId = this.route.snapshot.paramMap.get('id') ?? '';
    this.project$ = this.collaboration.getProject(this.projectId);
    this.project$.pipe(take(1)).subscribe((p) => {
      this.projectName = p?.name ?? '';
    });
    this.members = this.collaboration.getMembers(this.projectId);
    this.invitations = this.collaboration.getMyInvitations();

    this.collaboration
      .getMembers(this.projectId)
      .pipe(
        take(1),
        map((members) => {
          const currentUid = this.auth.currentUser?.uid;
          const member = members.find((m) => m.userId === currentUid);
          this.isOwner = member?.role === 'owner';
          this.canWrite = hasPermission(member?.role ?? 'viewer', 'write');
          return member;
        })
      )
      .subscribe();
  }

  async inviteMember(): Promise<void> {
    if (!this.newInviteEmail.trim()) return;
    this.inviting = true;
    try {
      await this.collaboration.inviteMember(this.projectId, this.newInviteEmail, this.newInviteRole);
      this.newInviteEmail = '';
    } catch (error) {
      alert(error instanceof Error ? error.message : 'No se pudo enviar la invitación.');
    } finally {
      this.inviting = false;
    }
  }

  async acceptInvitation(invitationId: string): Promise<void> {
    try {
      await this.collaboration.acceptInvitation(invitationId);
      void this.router.navigate(['/projects', this.projectId]);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'No se pudo aceptar la invitación.');
    }
  }

  async rejectInvitation(invitationId: string): Promise<void> {
    try {
      await this.collaboration.rejectInvitation(invitationId);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'No se pudo rechazar la invitación.');
    }
  }

  async changeRole(memberId: string, role: string): Promise<void> {
    try {
      await this.collaboration.updateMemberRole(this.projectId, memberId, role as 'owner' | 'editor' | 'viewer');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'No se pudo cambiar el rol.');
    }
  }

  async removeMember(memberId: string): Promise<void> {
    if (!confirm(this.i18n.translate('projects.confirmRemoveMember'))) return;
    try {
      await this.collaboration.removeMember(this.projectId, memberId);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'No se pudo eliminar el miembro.');
    }
  }

  async deleteProject(): Promise<void> {
    if (!confirm(this.i18n.translate('projects.confirmDeleteProject'))) return;
    try {
      await this.collaboration.deleteProject(this.projectId);
      void this.router.navigate(['/projects']);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'No se pudo eliminar el proyecto.');
    }
  }

  openEditor(): void {
    void this.router.navigate(['/editor'], { queryParams: { project: this.projectId } });
  }

  hasPermission(permission: ProjectPermission): boolean {
    return hasPermission(this.isOwner ? 'owner' : (this.canWrite ? 'editor' : 'viewer'), permission);
  }
}
