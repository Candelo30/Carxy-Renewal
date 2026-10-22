import { TestBed } from '@angular/core/testing';
import { FileHandler } from './file-handler';

describe('FileHandler', () => {
  let service: FileHandler;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FileHandler);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
