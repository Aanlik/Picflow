import { batchThumbnailUrl } from './galleryThumbnailBatch.ts';

/** Fetch an authenticated gallery rendition without forwarding gallery credentials to object storage. */
export async function fetchGalleryImage(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const requestUrl = new URL(url, typeof window === 'undefined' ? 'http://localhost' : window.location.href);
  const options: RequestInit = {
    credentials: 'include',
    headers: Object.keys(headers).length ? headers : undefined,
    signal,
  };
  const batched = batchThumbnailUrl(requestUrl, headers, fetcher, signal);
  if (batched) {
    const cloudUrl = await batched;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (cloudUrl !== undefined) {
      if (cloudUrl) {
        try {
          const cloudResponse = await fetcher(cloudUrl, { credentials: 'omit', signal });
          if (cloudResponse.ok) return cloudResponse;
        } catch (error) { if (signal.aborted) throw error; }
      }
      requestUrl.searchParams.set('cloud_source', 'nas');
      return fetcher(requestUrl.toString(), options);
    }
  }
  requestUrl.searchParams.set('cloud_transport', 'json');
  const response = await fetcher(requestUrl.toString(), options);
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return response;

  try {
    const data = await response.json() as { cloudUrl?: string };
    if (data.cloudUrl) {
      const cloudResponse = await fetcher(data.cloudUrl, { credentials: 'omit', signal });
      if (cloudResponse.ok) return cloudResponse;
    }
  } catch (error) {
    if (signal.aborted) throw error;
  }
  requestUrl.searchParams.delete('cloud_transport');
  requestUrl.searchParams.set('cloud_source', 'nas');
  return fetcher(requestUrl.toString(), options);
}
