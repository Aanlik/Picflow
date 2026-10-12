import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useViewerLikeIds } from '../useViewerLikeIds';

describe('useViewerLikeIds', () => {
  it('uses server likes for the current gallery identity after an identity switch', () => {
    const { result, rerender } = renderHook(
      ({ photos }) => useViewerLikeIds(photos),
      { initialProps: { photos: [{ id: 1, is_liked: true }, { id: 2, is_liked: false }] } },
    );

    expect(result.current[0]).toEqual(new Set([1]));

    rerender({ photos: [{ id: 1, is_liked: false }, { id: 2, is_liked: true }] });
    expect(result.current[0]).toEqual(new Set([2]));
  });

  it('does not overwrite an optimistic toggle when unrelated photo data changes', () => {
    const { result, rerender } = renderHook(
      ({ photos }) => useViewerLikeIds(photos),
      { initialProps: { photos: [{ id: 1, is_liked: false, filename: 'proof.jpg' }] } },
    );

    act(() => result.current[1](new Set([1])));
    rerender({ photos: [{ id: 1, is_liked: false, filename: 'renamed-proof.jpg' }] });
    expect(result.current[0]).toEqual(new Set([1]));
  });
});
