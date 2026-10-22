import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoadingSpinner } from './loading-spinner';

describe('LoadingSpinner', () => {
  let component: LoadingSpinner;
  let fixture: ComponentFixture<LoadingSpinner>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoadingSpinner],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadingSpinner);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('shows the supplied loading message accessibly', () => {
    fixture.componentRef.setInput('label', 'Cargando modelos…');
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Cargando modelos…');
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeTruthy();
  });

  it('supports a compact inline presentation', () => {
    fixture.componentRef.setInput('variant', 'inline');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.loading-inline')).toBeTruthy();
  });
});
