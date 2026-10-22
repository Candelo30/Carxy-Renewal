import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelPreviewComponent } from './model-preview';

describe('ModelPreviewComponent', () => {
  let fixture: ComponentFixture<ModelPreviewComponent>;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a useful error instead of loading forever when Storage cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await TestBed.configureTestingModule({
      imports: [ModelPreviewComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ModelPreviewComponent);
    fixture.componentRef.setInput('modelUrl', 'https://storage.example/model.glb');
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Revisa CORS y los permisos de Firebase Storage.');
    });

    expect(fixture.nativeElement.textContent).not.toContain('Cargando modelo 3D');
  });
});
