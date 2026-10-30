interface DownloadResponseError {
  response?: {
    status?: number;
    data?: unknown;
  };
}

export interface ManagedDownloadMetadata {
  filename?: string;
  size: number;
  etag: string;
  download_url?: string;
}

export async function getDownloadErrorCode(error: unknown): Promise<string | undefined> {
  const data = (error as DownloadResponseError | undefined)?.response?.data;
  if (data && typeof data === "object" && "code" in data) {
    const code = (data as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }

  let body: string | undefined;
  if (typeof data === "string") body = data;
  else if (typeof Blob !== "undefined" && data instanceof Blob) body = await data.text();
  if (!body) return undefined;

  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    return typeof parsed.code === "string" ? parsed.code : undefined;
  } catch {
    return undefined;
  }
}

async function readMetadata(
  requestMetadata: () => Promise<ManagedDownloadMetadata>,
): Promise<ManagedDownloadMetadata> {
  try {
    return await requestMetadata();
  } catch (error) {
    const code = await getDownloadErrorCode(error);
    if (code) throw new Error(code, { cause: error });
    throw error;
  }
}

function validateMetadata(metadata: ManagedDownloadMetadata): void {
  if (
    !metadata.download_url ||
    !metadata.etag ||
    !Number.isSafeInteger(metadata.size) ||
    metadata.size < 0
  ) {
    throw new Error("CLOUD_DOWNLOAD_NOT_READY");
  }
}

export async function fetchCloudFallbackBlob(
  originalError: unknown,
  requestMetadata: () => Promise<ManagedDownloadMetadata>,
  fetcher: typeof fetch = fetch,
): Promise<{ blob: Blob; serverFilename?: string }> {
  const responseError = (originalError as DownloadResponseError | undefined)?.response;
  if (responseError?.status !== 409 || await getDownloadErrorCode(originalError) !== "CLOUD_DOWNLOAD_QUEUE_REQUIRED") {
    throw originalError;
  }

  let metadata = await readMetadata(requestMetadata);
  validateMetadata(metadata);

  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      // Signed URLs are bearer capabilities; never send gallery credentials to object storage.
      response = await fetcher(metadata.download_url!, { credentials: "omit" });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      throw new Error("DIRECT_CLOUD_DOWNLOAD_FAILED", { cause: error });
    }

    if (response.status === 401 || response.status === 403) {
      if (attempt === 1) throw new Error("DIRECT_CLOUD_DOWNLOAD_FAILED");
      const refreshed = await readMetadata(requestMetadata);
      validateMetadata(refreshed);
      if (refreshed.etag !== metadata.etag || refreshed.size !== metadata.size)
        throw new Error("DOWNLOAD_VERSION_CHANGED");
      metadata = refreshed;
      continue;
    }
    if (response.status !== 200)
      throw new Error(response.status === 416 ? "DOWNLOAD_VERSION_CHANGED" : "DIRECT_CLOUD_DOWNLOAD_FAILED");

    const blob = await response.blob();
    if (blob.size !== metadata.size || response.headers.get("ETag") !== metadata.etag)
      throw new Error("DOWNLOAD_VERSION_CHANGED");
    return { blob, serverFilename: metadata.filename };
  }

  throw new Error("DIRECT_CLOUD_DOWNLOAD_FAILED");
}

export async function fetchPhotoBlobWithCloudFallback(
  fetchDirect: () => Promise<{ blob: Blob; serverFilename?: string | null }>,
  requestMetadata: () => Promise<ManagedDownloadMetadata>,
  fetcher: typeof fetch = fetch,
): Promise<{ blob: Blob; serverFilename?: string | null }> {
  try {
    return await fetchDirect();
  } catch (error) {
    return fetchCloudFallbackBlob(error, requestMetadata, fetcher);
  }
}
