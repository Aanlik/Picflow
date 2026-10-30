import type { DownloadQueueItem } from "../../utils/downloadQueue";
import type {
  DownloadRepository,
  DownloadTask,
  DownloadTransport,
} from "./types";
import { BLOCK_SIZE } from "./types";
export type DownloadSnapshot = {
  tasks: DownloadTask[];
  progress: Record<string, number>;
  open: boolean;
  requestSequence?: number;
  readyToSave?: string[];
};
function id() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
function code(error: unknown): string {
  const e = error as {
    message?: string;
    name?: string;
    response?: { status?: number; data?: { code?: string } };
  };
  if (e.response?.data?.code === "CLOUD_DOWNLOAD_NOT_READY")
    return "CLOUD_DOWNLOAD_NOT_READY";
  if (e.response?.data?.code === "DOWNLOAD_TOO_LARGE") return "DOWNLOAD_TOO_LARGE";
  if (e.message === "DIRECT_CLOUD_DOWNLOAD_FAILED") return "DIRECT_CLOUD_DOWNLOAD_FAILED";
  if (e.response?.data?.code === "INVALID_RESOLUTION") return "INVALID_RESOLUTION";
  if (e.response?.data?.code === "DOWNLOAD_IDENTITY_CHANGED")
    return "IDENTITY_CHANGED";
  if (e.response?.status === 409 || e.message === "DOWNLOAD_VERSION_CHANGED")
    return "DOWNLOAD_VERSION_CHANGED";
  if ([401, 403, 404, 410].includes(e.response?.status || 0))
    return "DOWNLOAD_ACCESS_CHANGED";
  if (e.message?.startsWith("LOCAL_STORAGE_")) return e.message;
  if (e.name === "TransactionInactiveError" || e.name === "InvalidStateError")
    return "LOCAL_STORAGE_TRANSACTION_INACTIVE";
  if (e.name === "AbortError") return "LOCAL_STORAGE_TRANSACTION_ABORTED";
  if (e.name === "SecurityError" || e.name === "NotAllowedError")
    return "LOCAL_STORAGE_BLOCKED";
  if (e.name === "QuotaExceededError") return "LOCAL_STORAGE_QUOTA_EXCEEDED";
  if (e.name === "UnknownError") return "LOCAL_STORAGE_UNKNOWN_ERROR";
  if (e.message === "LOCAL_STORAGE_UNAVAILABLE")
    return "LOCAL_STORAGE_UNAVAILABLE";
  return e.message === "IDENTITY_CHANGED"
    ? "IDENTITY_CHANGED"
    : e.message === "LOCAL_BLOCKS_MISSING"
      ? "LOCAL_BLOCKS_MISSING"
      : e.message === "DOWNLOAD_LEASE_LOST"
        ? "DOWNLOAD_LEASE_LOST"
        : "DOWNLOAD_NETWORK_ERROR";
}
function storageDiagnostic(error: unknown): string | undefined {
  const value = (error as { storageDiagnostic?: unknown } | null)?.storageDiagnostic;
  return typeof value === "string" ? value : undefined;
}
function transient(error: unknown): boolean {
  const e = error as {
    response?: { status?: number };
    message?: string;
    name?: string;
  };
  if (
    e.name === "AbortError" ||
    e.message === "DOWNLOAD_VERSION_CHANGED" ||
    e.message === "IDENTITY_CHANGED"
  )
    return false;
  const status = e.response?.status;
  return !status || status === 408 || status === 429 || status >= 500;
}
export class DownloadEngine {
  private value: DownloadSnapshot = { tasks: [], progress: {}, open: false };
  private listeners = new Set<() => void>();
  private controllers = new Map<string, AbortController>();
  private owner = id();
  private cancelled = new Set<string>();
  private activeScope?: { slug: string; identity: string };
  private pendingScopes = 0;
  private repo: DownloadRepository;
  private transport: DownloadTransport;
  private deviceId: string;
  private delay: (ms: number, signal: AbortSignal) => Promise<void>;
  constructor(
    repo: DownloadRepository,
    transport: DownloadTransport,
    deviceId: string,
    delay = (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, ms);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
  ) {
    this.repo = repo;
    this.transport = transport;
    this.deviceId = deviceId;
    this.delay = delay;
  }

  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  };
  snapshot = () => this.value;
  private emit(update: Partial<DownloadSnapshot> = {}) {
    this.value = { ...this.value, ...update };
    this.listeners.forEach((callback) => callback());
  }
  private update(task: DownloadTask) {
    if (
      this.activeScope &&
      (task.slug !== this.activeScope.slug ||
        task.identity !== this.activeScope.identity)
    )
      return;
    this.emit({
      tasks: [task, ...this.value.tasks.filter((t) => t.id !== task.id)],
    });
  }
  open = () => this.emit({ open: true });
  close = () => this.emit({ open: false });
  isActive(slug: string) {
    return this.pendingScopes > 0 && this.activeScope?.slug === slug;
  }
  async activate(slug: string, identity: string) {
    this.pendingScopes++;
    const same =
      this.activeScope?.slug === slug && this.activeScope.identity === identity;
    if (!same) {
      for (const controller of this.controllers.values()) controller.abort();
      this.activeScope = { slug, identity };
      this.emit({ tasks: [], progress: {}, readyToSave: [] });
    }
    try {
      const all = await this.repo.list();
      if (
        this.activeScope?.slug !== slug ||
        this.activeScope.identity !== identity
      )
        return;
      const tasks = all
        .filter((t) => t.slug === slug && t.identity === identity)
        .map((t) => ({
          ...t,
          state:
            (!t.leaseUntil || t.leaseUntil < Date.now()) &&
            ["receiving", "retrying", "queued"].includes(t.state)
              ? ("paused" as const)
              : t.state,
        }));
      // Hydration must not erase a task queued while IndexedDB was opening.
      const live = this.value.tasks.filter(
        (task) => task.slug === slug && task.identity === identity,
      );
      this.emit({
        tasks: [
          ...live,
          ...tasks.filter(
            (task) => !live.some((current) => current.id === task.id),
          ),
        ],
      });
      void this.flush();
    } catch {
      /* Adding a task reports storage failure with an explicit ordinary-download option. */
    }
  }
  deactivate() {
    this.pendingScopes = Math.max(0, this.pendingScopes - 1);
    if (this.pendingScopes === 0) {
      for (const task of this.value.tasks) this.pause(task.id);
    }
  }
  runningHere(id: string) {
    return this.controllers.has(id);
  }
  async refreshLocal() {
    const scope = this.activeScope;
    if (!scope) return;
    const rows = await this.repo.list().catch(() => []);
    if (this.activeScope !== scope) return;
    const updated = new Map(this.value.tasks.map((task) => [task.id, task]));
    for (const task of rows) {
      if (
        task.slug !== scope.slug ||
        task.identity !== scope.identity ||
        this.controllers.has(task.id)
      )
        continue;
      if (updated.get(task.id)?.state === "queued" && task.state === "queued")
        continue;
      const expired = !task.leaseUntil || task.leaseUntil < Date.now();
      updated.set(task.id, {
        ...task,
        state:
          expired && ["queued", "receiving", "retrying"].includes(task.state)
            ? "paused"
            : task.state,
      });
    }
    this.emit({ tasks: [...updated.values()] });
  }
  async enqueue(
    items: DownloadQueueItem[],
    identity: string,
    guestId?: number,
  ) {
    this.emit({ open: true, requestSequence: (this.value.requestSequence || 0) + 1 });
    for (const item of items) {
      if (
        this.value.tasks.some(
          (t) =>
            t.slug === item.slug &&
            t.identity === identity &&
            t.photoId === item.photoId &&
            t.resolution === item.resolution &&
            !["cancelled", "failed", "handed_off", "version_changed"].includes(
              t.state,
            ),
        )
      )
        continue;
      const now = new Date().toISOString();
      const task: DownloadTask = {
        id: id(),
        slug: item.slug,
        photoId: item.photoId,
        filename: item.filename || `photo-${item.photoId}`,
        resolution: item.resolution,
        identity,
        guestId,
        deviceId: this.deviceId,
        total: 0,
        received: 0,
        contentType: "application/octet-stream",
        state: "queued",
        createdAt: now,
        updatedAt: now,
      };
      this.update(task);
      try {
        await this.repo.put(task);
      } catch (error) {
        task.state = "failed";
        task.error = code(error);
        task.storageDiagnostic = storageDiagnostic(error) || (
          task.error.startsWith("LOCAL_STORAGE_")
            ? `enqueue.task.persist · ${(error as { name?: string }).name || "Error"}`
            : undefined
        );
        this.update({ ...task });
      }
    }
    this.pump();
  }
  private pump() {
    if (this.controllers.size >= 2) return;
    for (const task of this.value.tasks.slice().reverse()) {
      if (this.controllers.size >= 2) break;
      if (
        task.state === "queued" &&
        !this.controllers.has(task.id) &&
        this.transport.isCurrent(task)
      )
        void this.run(task);
    }
  }
  private async persist(task: DownloadTask) {
    task.updatedAt = new Date().toISOString();
    await this.repo.release(task, this.owner);
    delete task.leaseOwner;
    delete task.leaseUntil;
    this.update({ ...task });
  }
  private async sync(task: DownloadTask) {
    if (!task.remoteId) return;
    if (task.historyPending && ["receiving", "retrying"].includes(task.state))
      return;
    try {
      await this.transport.sync(task);
      task.historyPending = false;
    } catch {
      task.historyPending = true;
    }
  }
  private async run(task: DownloadTask) {
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    let claimed = false;
    let storageOperation = "run.claim";
    const heartbeat = setInterval(() => {
      if (claimed)
        void this.repo
          .renew(task.id, this.owner)
          .then((ok) => {
            if (!ok) controller.abort();
          })
          .catch(() => controller.abort());
    }, 20000);
    try {
      storageOperation = "run.claim";
      claimed = await this.repo.claim(task.id, this.owner);
      if (!claimed) {
        task.state = "paused";
        task.error = "DOWNLOAD_LEASE_LOST";
        this.update({ ...task });
        return;
      }
      storageOperation = "run.load_task";
      const saved = (await this.repo.list()).find(
        (item) => item.id === task.id,
      );
      if (saved) Object.assign(task, saved);
      if (["cancelled", "handed_off"].includes(task.state)) return;
      task.state = "receiving";
      task.error = undefined;
      task.storageDiagnostic = undefined;
      this.update({ ...task });
      const meta = task.etag
        ? await this.transport.metadata(task, controller.signal)
        : await this.transport.initialize(task, controller.signal);
      if (controller.signal.aborted)
        throw new DOMException("Aborted", "AbortError");
      if (task.etag && (meta.etag !== task.etag || meta.size !== task.total))
        throw new Error("DOWNLOAD_VERSION_CHANGED");
      if (!meta.etag || !Number.isSafeInteger(meta.size) || meta.size < 0)
        throw new Error("DOWNLOAD_VERSION_CHANGED");
      task.etag = meta.etag;
      task.total = meta.size;
      task.filename = meta.filename;
      task.contentType = meta.content_type;
      task.remoteId = meta.id || task.remoteId;
      // Metadata is durable before the first block; a reload reuses this attempt.
      storageOperation = "run.append.metadata";
      await this.repo.append(task, task.received, new Blob([]), this.owner);
      while (task.received < task.total) {
        if (controller.signal.aborted)
          throw new DOMException("Aborted", "AbortError");
        if (!this.transport.isCurrent(task))
          throw new Error("IDENTITY_CHANGED");
        const start = task.received,
          end = Math.min(start + BLOCK_SIZE, task.total) - 1;
        let block: Blob | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            block = await this.transport.chunk(
              task,
              start,
              end,
              controller.signal,
              (bytes) =>
                this.emit({
                  progress: { ...this.value.progress, [task.id]: bytes },
                }),
            );
            break;
          } catch (error) {
            if (controller.signal.aborted || !transient(error) || attempt === 2)
              throw error;
            task.state = "retrying";
            this.update({ ...task });
            const retryAfter = Number(
              (error as { response?: { headers?: Record<string, string> } })
                ?.response?.headers?.["retry-after"],
            );
            await this.delay(
              Math.max(
                1000 * 2 ** attempt,
                Number.isFinite(retryAfter)
                  ? Math.min(retryAfter * 1000, 60000)
                  : 0,
              ),
              controller.signal,
            );
            task.state = "receiving";
            this.update({ ...task });
          }
        }
        if (!block || block.size !== end - start + 1)
          throw new Error("DOWNLOAD_VERSION_CHANGED");
        if (controller.signal.aborted)
          throw new DOMException("Aborted", "AbortError");
        if (!this.transport.isCurrent(task))
          throw new Error("IDENTITY_CHANGED");
        const next = {
          ...task,
          received: end + 1,
          updatedAt: new Date().toISOString(),
        };
        storageOperation = "run.append.chunk";
        await this.repo.append(next, start, block, this.owner);
        Object.assign(task, next);
        this.emit({ progress: { ...this.value.progress, [task.id]: 0 } });
        this.update({ ...task });
        await this.sync(task);
      }
      task.state = "received";
      await this.sync(task);
    } catch (error) {
      if (controller.signal.aborted) {
        task.state = this.cancelled.has(task.id) ? "cancelled" : "paused";
        task.error = undefined;
      } else {
        task.error = code(error);
        const detail = storageDiagnostic(error);
        task.storageDiagnostic = detail
          ? `${storageOperation} → ${detail}`
          : task.error.startsWith("LOCAL_STORAGE_")
            ? `${storageOperation} · ${(error as { name?: string }).name || "Error"}`
            : undefined;
        task.state =
          task.error === "DOWNLOAD_VERSION_CHANGED"
            ? "version_changed"
            : "failed";
      }
      await this.sync(task);
    } finally {
      clearInterval(heartbeat);
      if (claimed) await this.persist(task).catch(() => {});
      this.controllers.delete(task.id);
      this.cancelled.delete(task.id);
      if (task.state === "cancelled") {
        task.cacheCleared = true;
        await this.repo.clearBlocks(task.id).catch(() => {});
        await this.repo.put(task).catch(() => {});
        this.update({ ...task });
      }
      this.emit({
        progress: { ...this.value.progress, [task.id]: 0 },
        ...(task.state === "received" && claimed ? {
          readyToSave: [...new Set([...(this.value.readyToSave || []), task.id])],
        } : {}),
      });
      this.pump();
    }
  }
  pause(id: string) {
    const task = this.value.tasks.find((t) => t.id === id);
    if (!task || !["queued", "receiving", "retrying"].includes(task.state))
      return;
    task.state = "paused";
    this.controllers.get(id)?.abort();
    this.update({ ...task });
    if (!this.controllers.has(id)) void this.repo.put(task).catch(() => {});
  }
  async resume(id: string) {
    const task = this.value.tasks.find((t) => t.id === id);
    if (!task || this.controllers.has(id) || !this.transport.isCurrent(task))
      return;
    task.state = "queued";
    task.error = undefined;
    task.storageDiagnostic = undefined;
    this.update({ ...task });
    this.pump();
  }
  async cancel(id: string) {
    const task = this.value.tasks.find((t) => t.id === id);
    if (!task) return;
    this.cancelled.add(id);
    task.state = "cancelled";
    this.controllers.get(id)?.abort();
    this.update({ ...task });
    if (!this.controllers.has(id)) {
      await this.sync(task);
      task.cacheCleared = true;
      await this.repo.clearBlocks(id);
      await this.repo.put(task);
      this.update({ ...task });
    }
  }
  async file(id: string) {
    const task = this.value.tasks.find((t) => t.id === id);
    if (
      !task ||
      !this.transport.isCurrent(task) ||
      !["received", "handed_off"].includes(task.state)
    )
      throw new Error("DOWNLOAD_ACCESS_CHANGED");
    await this.transport
      .metadata(task, new AbortController().signal)
      .then((meta) => {
        if (meta.etag !== task.etag)
          throw new Error("DOWNLOAD_VERSION_CHANGED");
      });
    const blob = await this.repo.blob(task);
    if (!this.transport.isCurrent(task)) throw new Error("IDENTITY_CHANGED");
    return { task, blob };
  }
  async saveError(id: string, error: unknown) {
    const task = this.value.tasks.find((item) => item.id === id);
    if (!task) return;
    task.error = code(error);
    task.storageDiagnostic = storageDiagnostic(error);
    if (task.state !== "handed_off") {
      task.state =
        task.error === "DOWNLOAD_VERSION_CHANGED"
          ? "version_changed"
          : "failed";
      await this.sync(task);
    }
    await this.repo.put(task).catch(() => {});
    this.update({ ...task });
  }
  async handedOff(id: string) {
    const task = this.value.tasks.find((t) => t.id === id);
    if (!task) return;
    task.state = "handed_off";
    await this.sync(task);
    await this.repo.put(task);
    this.update({ ...task });
  }
  async restart(id: string) {
    const task = this.value.tasks.find((t) => t.id === id);
    if (!task || !this.transport.isCurrent(task)) return;
    await this.discard(id);
    task.archived = true;
    await this.repo.put(task);
    this.update({ ...task });
    await this.enqueue(
      [
        {
          slug: task.slug,
          photoId: task.photoId,
          filename: task.filename,
          resolution: task.resolution,
        },
      ],
      task.identity,
      task.guestId,
    );
  }
  async discard(id: string) {
    if (this.controllers.has(id)) return;
    const task = this.value.tasks.find((item) => item.id === id);
    if (!task) return;
    await this.repo.clearBlocks(id);
    task.cacheCleared = true;
    await this.repo.put(task);
    this.update({ ...task });
  }
  async flush() {
    for (const task of this.value.tasks) {
      if (
        task.historyPending &&
        !this.controllers.has(task.id) &&
        this.transport.isCurrent(task)
      ) {
        await this.sync(task);
        if (
          this.controllers.has(task.id) ||
          this.value.tasks.find((item) => item.id === task.id) !== task
        )
          continue;
        await this.repo.put(task).catch(() => {});
        this.update({ ...task });
      }
    }
  }
}
