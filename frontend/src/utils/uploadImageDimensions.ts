const MIN_UPLOAD_IMAGE_DIMENSION = 10;

/** Return false only when the browser decoded a supported image below the
 * server's minimum dimension. Decode failures are left to server validation. */
export async function meetsMinimumUploadImageDimensions(
  file: File,
  minimum = MIN_UPLOAD_IMAGE_DIMENSION,
): Promise<boolean> {
  if (!file.type.startsWith('image/')) return true;
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      return bitmap.width >= minimum && bitmap.height >= minimum;
    } catch {
      return true;
    } finally {
      bitmap?.close();
    }
  }

  if (typeof Image === 'undefined' || typeof URL?.createObjectURL !== 'function') return true;
  const url = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = reject;
      image.src = url;
    });
    return dimensions.width >= minimum && dimensions.height >= minimum;
  } catch {
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}
