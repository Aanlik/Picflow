/** Customer session controls must never be rendered in an admin preview. */
export function shouldShowGalleryLogoutControl(
  requiresPassword: boolean,
  isClient: boolean,
  adminPreview: boolean,
): boolean {
  return !adminPreview && (requiresPassword || isClient);
}
