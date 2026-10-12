import { describe, expect, it } from 'vitest';
import { downloadResolutionLabel } from '../downloadResolutionLabel';

describe('downloadResolutionLabel', () => {
  it('localizes built-in labels and preserves custom labels', () => {
    expect(downloadResolutionLabel('Large', (key) => key)).toBe('settings.downloads.size.large');
    expect(downloadResolutionLabel('客户定制', (key) => key)).toBe('客户定制');
  });
});
