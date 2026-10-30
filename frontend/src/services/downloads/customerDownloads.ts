import { DownloadEngine } from "./downloadEngine";
import { IndexedDownloadRepository } from "./downloadRepository";
import { downloadTransport, identityFor } from "./downloadTransport";
import { getGuestIdentity } from "../../utils/guestIdentityStorage";
import type { DownloadQueueItem } from "../../utils/downloadQueue";
function deviceId() {
  const fresh = () =>
    `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    let value = localStorage.getItem("picflow-download-device");
    if (!value) {
      value = fresh();
      localStorage.setItem("picflow-download-device", value);
    }
    return value;
  } catch {
    return fresh();
  }
}
export const customerDownloads = new DownloadEngine(
  new IndexedDownloadRepository(),
  downloadTransport,
  deviceId(),
);
export function queueCustomerDownloads(items: DownloadQueueItem[]) {
  if (!items.length) return Promise.resolve();
  const guest = getGuestIdentity(items[0].slug);
  return customerDownloads.enqueue(
    items,
    identityFor(items[0].slug),
    guest?.id,
  );
}
export { identityFor };
