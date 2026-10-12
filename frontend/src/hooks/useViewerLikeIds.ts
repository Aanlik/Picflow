import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

type LikeStatePhoto = { id: number; is_liked?: boolean };

/**
 * Keep optimistic like state aligned with the viewer-specific `is_liked`
 * values returned by the server. A new gallery identity can change those
 * values without remounting the layout, so mount-only seeding leaks one
 * customer's state into another customer's cards.
 */
export function useViewerLikeIds(
  photos: readonly LikeStatePhoto[],
): [Set<number>, Dispatch<SetStateAction<Set<number>>>] {
  const signature = JSON.stringify(photos.map(({ id, is_liked }) => [id, Boolean(is_liked)]));
  const [likedIds, setLikedIds] = useState<Set<number>>(() =>
    new Set(photos.filter((photo) => photo.is_liked).map((photo) => photo.id)));
  const previousSignature = useRef(signature);

  useEffect(() => {
    if (previousSignature.current === signature) return;
    previousSignature.current = signature;
    const serverState = JSON.parse(signature) as Array<[number, boolean]>;
    setLikedIds(new Set(serverState.filter(([, liked]) => liked).map(([id]) => id)));
  }, [signature]);

  return [likedIds, setLikedIds];
}
