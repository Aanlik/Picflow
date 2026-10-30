/** No existing session is normal for a first visit; all other failures remain errors. */
export async function readOptionalGallerySession<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'response' in error
        && (error.response as { status?: number } | undefined)?.status === 401) return null;
    throw error;
  }
}
