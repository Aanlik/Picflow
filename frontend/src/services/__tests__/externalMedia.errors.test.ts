import { describe, expect, it } from 'vitest';
import { externalMediaErrorKey } from '../externalMedia.service';

describe('external media folder errors', () => {
  it('distinguishes NAS permission and mount errors', () => {
    expect(externalMediaErrorKey({ response: { status: 403, data: { code: 'EXTERNAL_FOLDER_PERMISSION_DENIED' } } }))
      .toBe('readPermissionDenied');
    expect(externalMediaErrorKey({ response: { status: 404, data: { code: 'EXTERNAL_FOLDER_NOT_FOUND' } } }))
      .toBe('folderUnavailable');
  });

  it('uses the general read message for unexpected errors', () => {
    expect(externalMediaErrorKey(new Error('offline'))).toBe('readError');
    expect(externalMediaErrorKey({ response: { status: 403, data: { error: 'Forbidden' } } })).toBe('readError');
  });
});
