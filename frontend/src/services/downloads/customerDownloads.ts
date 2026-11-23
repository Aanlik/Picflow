import { DownloadEngine } from "./downloadEngine";
import { IndexedDownloadRepository } from "./downloadRepository";
import { downloadTransport, identityFor } from "./downloadTransport";
import { getGuestIdentity } from "../../utils/guestIdentityStorage";
import { safeGetItem, safeSetItem } from "../../utils/safeStorage";
import type { DownloadQueueItem } from "../../utils/downloadQueue";
function deviceId() {
  let value = safeGetItem('local', 'picflow-download-device');
  if (!value) {
    value = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    safeSetItem('local', 'picflow-download-device', value);
  }
  return value;
}
export const customerDownloads = new DownloadEngine(
  new IndexedDownloadRepository(),
  downloadTransport,
  deviceId(),
);
export function queueCustomerDownloads(items: DownloadQueueItem[]) {
  if (!items.length) return Promise.resolve();
  const identity = identityFor(items[0].slug);
  const guest = identity.startsWith('delivery:') ? null : getGuestIdentity(items[0].slug);
  return customerDownloads.enqueue(
    items,
    identity,
    guest?.id,
  );
}
export { identityFor };
