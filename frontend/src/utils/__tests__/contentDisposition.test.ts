import { describe, expect, it } from 'vitest';
import { parseContentDispositionFilename } from '../contentDisposition';

describe('parseContentDispositionFilename', () => {
  it('decodes a Chinese archive name from the RFC 5987 filename parameter', () => {
    expect(parseContentDispositionFilename(
      `attachment; filename="Picflow.zip"; filename*=UTF-8''%E6%9E%97%E5%85%88%E7%94%9F%E9%A1%B9%E7%9B%AE.zip`,
    )).toBe('林先生项目.zip');
  });

  it('falls back safely when the RFC 5987 value is malformed', () => {
    expect(parseContentDispositionFilename('attachment; filename="archive.zip"; filename*=UTF-8\'\'%ZZ'))
      .toBe('archive.zip');
  });
});
