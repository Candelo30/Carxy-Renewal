import { TestBed } from '@angular/core/testing';
import { LocalStateService } from './local-state';

describe('LocalStateService', () => {
  let service: LocalStateService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(LocalStateService);
  });

  it('persists editor preferences and a serializable scene draft', () => {
    const preferences = service.loadPreferences();
    preferences.backgroundColor = '#102030';
    preferences.lightIntensity = 2.4;
    preferences.gizmoMode = 'rotate';
    service.savePreferences(preferences);
    service.saveDraft('{"scene":"demo"}');

    expect(service.loadPreferences()).toEqual(preferences);
    expect(service.loadDraft()).toBe('{"scene":"demo"}');
  });

  it('clears an existing draft', () => {
    service.saveDraft('{}');
    service.clearDraft();
    expect(service.loadDraft()).toBeNull();
  });
});
