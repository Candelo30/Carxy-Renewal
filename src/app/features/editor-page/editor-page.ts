import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, Subscription, take } from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { ModelEditor } from '../model-editor/model-editor';
import { ModelViewer } from '../model-viewer/model-viewer';
import { TopToolbar } from '../top-toolbar/top-toolbar';
import { PublishModalComponent } from '../publish-modal/publish-modal';

@Component({
  selector: 'app-editor-page',
  standalone: true,
  imports: [ModelEditor, ModelViewer, TopToolbar, PublishModalComponent],
  templateUrl: './editor-page.html',
  styleUrl: './editor-page.css',
})
export class EditorPage implements OnInit, OnDestroy {
  language: 'es' | 'en' = 'es';
  presentationMode = false;
  publishModalOpen = false;
  modelEditorOpen = true;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly subscription = new Subscription();

  ngOnInit(): void {
    this.subscription.add(this.route.queryParamMap.subscribe((params) => {
      if (params.get('publish') === '1') this.publishModalOpen = true;
    }));
  }

  async onPublishClick(): Promise<void> {
    const user = await firstValueFrom(this.auth.user$.pipe(take(1)));
    if (user) {
      this.publishModalOpen = true;
      return;
    }
    await this.router.navigate(['/login'], { queryParams: { returnUrl: '/editor?publish=1' } });
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
