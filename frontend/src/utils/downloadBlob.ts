/** Start a browser download from a Blob and keep its object URL alive long
 * enough for Chromium/WebKit to begin reading it. Revoking synchronously after
 * `click()` can leave a valid file stranded as `.crdownload`. */
export function downloadBlob(blob: Blob, filename: string, revokeDelayMs = 1000): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs);
}
