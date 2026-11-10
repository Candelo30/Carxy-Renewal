import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { ShellHeaderComponent } from '../../shared/components/shell-header/shell-header';
import { SiteFooterComponent } from '../../shared/components/site-footer/site-footer';
import { CollaborationService } from '../../core/services/collaboration';
import { I18nService } from '../../core/services/i18n';
import { AuthService } from '../../core/services/auth';

@Component({
  selector: 'app-projects-page',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe, TranslatePipe, ShellHeaderComponent, SiteFooterComponent],
  templateUrl: './projects-page.html',
  styleUrl: './projects-page.css',
})
export class ProjectsPage {
  readonly collaboration = inject(CollaborationService);
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);

  newProjectName = '';
  newProjectDescription = '';
  newProjectPublic = false;
  creating = false;

  readonly projects = this.collaboration.getProjects();

  async createProject(): Promise<void> {
    if (!this.newProjectName.trim()) return;
    this.creating = true;
    try {
      const id = await this.collaboration.createProject(
        this.newProjectName.trim(),
        this.newProjectDescription.trim(),
        this.newProjectPublic
      );
      this.newProjectName = '';
      this.newProjectDescription = '';
      this.newProjectPublic = false;
      void this.auth; // mantener referencia
      // Navegar al proyecto recién creado
      window.location.href = `/projects/${id}`;
    } catch (error) {
      alert(error instanceof Error ? error.message : 'No se pudo crear el proyecto.');
    } finally {
      this.creating = false;
    }
  }

  trackById = (_index: number, project: { id: string }) => project.id;
}
