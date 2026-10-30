import {
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  X,
  Pause,
  Play,
  RotateCw,
  History,
  AlertCircle,
  Check,
} from "lucide-react";
import {
  DOWNLOAD_QUEUE_EVENT,
  type DownloadQueueItem,
} from "../../utils/downloadQueue";
import {
  customerDownloads,
  identityFor,
  queueCustomerDownloads,
} from "../../services/downloads/customerDownloads";
import { galleryService } from "../../services/gallery.service";
import { getDownloadErrorCode } from "../../services/downloads/cloudDownloadFallback";
import { api } from "../../config/api";
import {
  getGuestIdentity,
  getGuestToken,
  GUEST_IDENTITY_CLEARED_EVENT,
} from "../../utils/guestIdentityStorage";
import type { DownloadTask } from "../../services/downloads/types";
import { toast } from "react-toastify";
import { useLocalizedDate } from "../../hooks/useLocalizedDate";
import { useGuestIdentityOptional } from "../../contexts/GuestIdentityContext";

interface HistoryItem {
  etag?: string;
  updated_at?: string;
  id: string;
  photo_id: number | null;
  device_id: string;
  filename: string;
  resolution: string | null;
  total_bytes: number;
  received_bytes: number;
  state: string;
  created_at: string;
}
function version(etag?: string) {
  return (
    etag
      ?.replace(/^"sha256-/, "")
      .replace(/"$/, "")
      .slice(0, 10) || "—"
  );
}
function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const unit = value >= 1024 ** 2 ? "MB" : "KB";
  return `${(value / (unit === "MB" ? 1024 ** 2 : 1024)).toFixed(1)} ${unit}`;
}

/** All gallery layouts mount this same manager; no native-download history is read. */
export function DownloadQueue({ slug: providedSlug }: { slug?: string }) {
  const { t } = useTranslation();
  const guestContext = useGuestIdentityOptional();
  const { formatDateTime } = useLocalizedDate();
  const [slug, setSlug] = useState(providedSlug || "");
  const [identity, setIdentity] = useState(() =>
    providedSlug ? identityFor(providedSlug) : "anonymous",
  );
  const snapshot = useSyncExternalStore(
    customerDownloads.subscribe,
    customerDownloads.snapshot,
    customerDownloads.snapshot,
  );
  const [tab, setTab] = useState<"active" | "history">("active");
  useEffect(() => {
    if (snapshot.requestSequence) setTab("active");
  }, [snapshot.requestSequence]);
  const autoAttempted = useRef(new Set<string>());
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPages, setHistoryPages] = useState(1);
  const historyPageRef = useRef(1);
  historyPageRef.current = historyPage;
  const [historyError, setHistoryError] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const currentScope = useRef({ slug, identity });
  currentScope.current = { slug, identity };
  const local = useMemo(() => snapshot.tasks.filter(
    (task) => task.slug === slug && task.identity === identity,
  ), [snapshot.tasks, slug, identity]);
  const active = local.filter(
    (task) =>
      !task.archived && !["handed_off", "cancelled"].includes(task.state),
  );
  const receiving = active.filter((task) =>
    ["queued", "receiving", "retrying"].includes(task.state),
  ).length;

  useEffect(() => {
    if (providedSlug) setSlug(providedSlug);
  }, [providedSlug]);
  useEffect(() => {
    if (!slug) return;
    const changed = () => setIdentity(identityFor(slug));
    changed();
    window.addEventListener("storage", changed);
    window.addEventListener(GUEST_IDENTITY_CLEARED_EVENT, changed);
    // Registration is a context update; the short poll also covers same-tab role switching.
    const timer = window.setInterval(changed, 2000);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener(GUEST_IDENTITY_CLEARED_EVENT, changed);
      window.clearInterval(timer);
    };
  }, [slug]);
  useEffect(() => {
    if (!slug) return;
    setHistory([]);
    setHistoryPage(1);
    void customerDownloads.activate(slug, identity);
    return () => customerDownloads.deactivate();
  }, [slug, identity]);
  useEffect(() => {
    const receive = async (event: Event) => {
      const items = (event as CustomEvent<DownloadQueueItem[]>).detail;
      if (!items?.length) return;
      setTab("active");
      if (!slug) setSlug(items[0].slug);
      await queueCustomerDownloads(items);
    };
    window.addEventListener(DOWNLOAD_QUEUE_EVENT, receive);
    return () => window.removeEventListener(DOWNLOAD_QUEUE_EVENT, receive);
  }, [slug]);

  const refresh = useCallback(
    async (page = 1) => {
      if (!slug || identity === "anonymous" || identityFor(slug) !== identity)
        return;
      const guest = getGuestIdentity(slug);
      if (!guest) return;
      const scope = { slug, identity };
      try {
        const response = await api.get(`/gallery/${slug}/download-history`, {
          params: { page },
          headers: {
            "X-Download-Guest": String(guest.id),
            "x-guest-token": getGuestToken(slug) || "",
          },
        });
        if (
          currentScope.current.slug !== scope.slug ||
          currentScope.current.identity !== scope.identity
        )
          return;
        setHistory((previous) =>
          page === 1
            ? response.data.items
            : [
                ...previous,
                ...response.data.items.filter(
                  (item: HistoryItem) =>
                    !previous.some((old) => old.id === item.id),
                ),
              ],
        );
        setHistoryPage(page);
        setHistoryPages(response.data.pages);
        setHistoryError(false);
        void customerDownloads.flush();
      } catch {
        if (
          currentScope.current.slug === scope.slug &&
          currentScope.current.identity === scope.identity
        )
          setHistoryError(true);
      }
    },
    [slug, identity],
  );
  useEffect(() => {
    if (!snapshot.open) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (historyPageRef.current === 1) void refresh();
      void customerDownloads.refreshLocal();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [snapshot.open, refresh]);
  useEffect(() => {
    if (!snapshot.open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        customerDownloads.close();
      }
    };
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("keydown", escape, true);
      previous?.focus();
    };
  }, [snapshot.open]);

  const safe = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch {
      toast.error(t("downloadManager.actionFailed"));
    }
  };
  const save = useCallback(async (task: DownloadTask, automatic = false) => {
    setSaving(task.id);
    let prepared = false;
    try {
      const file = await customerDownloads.file(task.id);
      prepared = true;
      if (
        await galleryService.saveDownloadedBlob(file.blob, file.task.filename, { automatic })
      ) {
        await customerDownloads.handedOff(task.id);
        if (automatic) toast.info(t("downloadManager.autoSaved", { filename: file.task.filename }));
      }
    } catch (error) {
      if (!automatic || !prepared) await customerDownloads.saveError(task.id, error);
      const message = (error as Error)?.message;
      toast.error(
        t(
          message === "LOCAL_BLOCKS_MISSING"
            ? "downloadManager.cacheMissing"
            : message === "DOWNLOAD_VERSION_CHANGED"
              ? "downloadManager.versionChanged"
              : automatic && prepared
                ? "downloadManager.autoSaveFailed"
                : "downloadManager.saveFailed",
        ),
      );
    } finally {
      setSaving(null);
    }
  }, [t]);
  // Auto-save only tasks actively queued/continued in this mounted client.
  // Received history hydrated on reload must not download itself again.
  useEffect(() => {
    // An explicit continue after a failed validation is a new save attempt.
    for (const task of local) {
      if (["queued", "receiving", "retrying"].includes(task.state) && customerDownloads.runningHere(task.id))
        autoAttempted.current.delete(task.id);
    }
    if (saving) return;
    const ready = local.find(task => task.state === "received" &&
      snapshot.readyToSave?.includes(task.id) && !autoAttempted.current.has(task.id) &&
      !customerDownloads.runningHere(task.id));
    if (!ready) return;
    autoAttempted.current.add(ready.id);
    toast.info(t("downloadManager.ready", { filename: ready.filename }));
    void save(ready, true);
  }, [local, snapshot.readyToSave, slug, identity, saving, save, t]);

  const normal = async (task: DownloadTask) => {
    setSaving(task.id);
    try {
      const handedOff = await galleryService.savePhotoToDeviceDirect(
        task.slug,
        task.photoId,
        task.filename,
        task.resolution,
      );
      if (handedOff) toast.info(t("downloadManager.ordinaryNotice"));
    } catch (error) {
      const code = await getDownloadErrorCode(error) || (error as Error)?.message;
      const status = (error as { response?: { status?: number } })?.response?.status;
      const translatedCodes = [
        "CLOUD_DOWNLOAD_NOT_READY",
        "DIRECT_CLOUD_DOWNLOAD_FAILED",
        "DOWNLOAD_VERSION_CHANGED",
        "DOWNLOAD_TOO_LARGE",
        "INVALID_RESOLUTION",
      ];
      const message = code && translatedCodes.includes(code)
        ? t(`downloadManager.errors.${code}`)
        : [401, 403, 404, 410].includes(status || 0)
          ? t("downloadManager.errors.DOWNLOAD_ACCESS_CHANGED")
          : t("downloadManager.saveFailed");
      toast.error(message);
    } finally {
      setSaving(null);
    }
  };
  const newFromHistory = async (item: HistoryItem) => {
    if (!item.photo_id) return;
    const response = await api.get(`/gallery/${slug}/photos`, { params: { limit: 1 } });
    if (currentScope.current.slug !== slug || currentScope.current.identity !== identity || identityFor(slug) !== identity) return;
    const policy = response.data.event?.download_resolution;
    const allowed = policy?.picker_enabled && policy.choices?.some((choice: { id: string }) => choice.id === item.resolution);
    const resolution = allowed ? item.resolution || undefined : undefined;
    if (item.resolution && policy && item.resolution !== policy.standard && !allowed)
      toast.info(t("downloadManager.currentSize"));
    await queueCustomerDownloads([
      {
        slug,
        photoId: item.photo_id,
        filename: item.filename,
        resolution,
      },
    ]);
    setTab("active");
  };
  if (!slug) return null;
  return (
    <>
      <div className="mt-4 flex justify-end sm:contents">
        <button
          type="button"
          onClick={() => customerDownloads.open()}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-3 text-sm font-semibold text-neutral-900 shadow-lg hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white sm:fixed sm:bottom-6 sm:right-4 sm:z-[11000] sm:mt-0"
          aria-label={t("downloadManager.title")}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {t("downloadManager.title")}
          {receiving > 0 && (
            <span className="gallery-numeric rounded-full bg-emerald-700 px-2 py-0.5 text-xs text-white">
              {receiving}
            </span>
          )}
        </button>
      </div>
      {snapshot.open && (
        <div
          className="fixed inset-0 z-[12000] flex justify-end bg-black/50"
          onClick={() => customerDownloads.close()}
        >
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-download-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const buttons = Array.from(
                panel.current?.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), [tabindex="0"]',
                ) || [],
              );
              const target = event.shiftKey
                ? buttons[buttons.length - 1]
                : buttons[0];
              if (
                (event.shiftKey && document.activeElement === buttons[0]) ||
                (!event.shiftKey &&
                  document.activeElement === buttons[buttons.length - 1])
              ) {
                event.preventDefault();
                target?.focus();
              }
            }}
            className="flex h-full w-full flex-col bg-white text-neutral-900 shadow-2xl dark:bg-neutral-950 dark:text-neutral-100 sm:max-w-lg"
          >
            <header className="border-b border-neutral-200 p-5 dark:border-neutral-800">
              <div className="flex items-center justify-between gap-4">
                <h2
                  id="customer-download-title"
                  className="flex items-center gap-2 text-xl font-semibold"
                >
                  <Download className="h-5 w-5" />
                  {t("downloadManager.title")}
                </h2>
                <button
                  type="button"
                  className="rounded-full p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  onClick={() => customerDownloads.close()}
                  aria-label={t("common.close")}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                {t("downloadManager.explanation")}
              </p>
              <p className="mt-2 text-xs leading-5 text-neutral-500">
                {t(
                  identity === "anonymous"
                    ? "downloadManager.anonymous"
                    : "downloadManager.identityHistory",
                  { name: getGuestIdentity(slug)?.name || "" },
                )}
              </p>
              {identity === "anonymous" &&
                guestContext?.identityMode === "guest" && (
                  <button
                    type="button"
                    className="mt-2 min-h-9 text-sm font-medium text-emerald-700 underline"
                    onClick={() => {
                      customerDownloads.close();
                      guestContext.openPrompt();
                    }}
                  >
                    {t("downloadManager.chooseIdentity")}
                  </button>
                )}
              <div
                className="mt-4 flex gap-2"
                role="tablist"
                aria-label={t("downloadManager.title")}
              >
                {(["active", "history"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    onClick={() => {
                      setTab(value);
                      if (value === "history") void refresh();
                    }}
                    className={`min-h-10 rounded-lg px-4 text-sm font-medium ${tab === value ? "bg-emerald-700 text-white" : "bg-neutral-100 dark:bg-neutral-800"}`}
                  >
                    {value === "history" && (
                      <History className="mr-1 inline h-4 w-4" />
                    )}
                    {t(`downloadManager.${value}`)}
                    {value === "active" && active.length > 0
                      ? ` (${active.length})`
                      : ""}
                  </button>
                ))}
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-5" role="tabpanel">
              {tab === "active" && (
                <>
                  {!active.length && (
                    <p className="py-12 text-center text-sm text-neutral-500">
                      {t("downloadManager.empty")}
                    </p>
                  )}
                  <ul className="space-y-4">
                    {active.map((task) => {
                      const elsewhere =
                        !customerDownloads.runningHere(task.id) &&
                        !!task.leaseOwner &&
                        Number(task.leaseUntil) > Date.now();
                      const received = Math.min(
                        task.total,
                        task.received + (snapshot.progress[task.id] || 0),
                      );
                      const percent = task.total
                        ? Math.floor((received / task.total) * 100)
                        : 0;
                      return (
                        <li
                          key={task.id}
                          className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="min-w-0 break-all text-sm font-semibold">
                              {task.filename}
                            </p>
                            <span className="shrink-0 text-xs text-neutral-500">
                              {t(`downloadManager.states.${task.state}`)}
                            </span>
                          </div>
                          <p className="gallery-numeric mt-1 text-xs text-neutral-500">
                            {t("downloadManager.version")} ·{" "}
                            {version(task.etag)}
                          </p>
                          <div
                            role="progressbar"
                            aria-label={task.filename}
                            aria-valuenow={task.total ? percent : undefined}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
                          >
                            <div
                              className="h-full rounded-full bg-emerald-600 transition-[width]"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <p className="gallery-numeric mt-2 text-xs text-neutral-500">
                            {task.total
                              ? `${bytes(received)} / ${bytes(task.total)} · ${percent}%`
                              : t("downloadManager.preparing")}
                          </p>
                          {task.error && (
                            <p
                              role="status"
                              className="mt-3 flex gap-1.5 text-xs leading-5 text-amber-700 dark:text-amber-400"
                            >
                              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              {t(`downloadManager.errors.${task.error}`)}
                            </p>
                          )}
                          {task.storageDiagnostic && (
                            <p className="mt-1 text-xs text-neutral-500">
                              {t("downloadManager.storageDiagnostic")}: {task.storageDiagnostic}
                            </p>
                          )}
                          {elsewhere && (
                            <p className="mt-2 text-xs text-neutral-500">
                              {t("downloadManager.otherWindow")}
                            </p>
                          )}
                          {task.historyPending && (
                            <p className="mt-2 text-xs text-amber-700">
                              {t("downloadManager.historyPending")}
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {!elsewhere &&
                              ["receiving", "retrying", "queued"].includes(
                                task.state,
                              ) && (
                                <Action
                                  onClick={() =>
                                    customerDownloads.pause(task.id)
                                  }
                                >
                                  <Pause className="h-3.5 w-3.5" />
                                  {t("downloadManager.pause")}
                                </Action>
                              )}
                            {!elsewhere &&
                              ["paused", "failed"].includes(task.state) &&
                              !task.error?.startsWith("LOCAL_STORAGE_") &&
                              task.error !== "LOCAL_BLOCKS_MISSING" && (
                                <Action
                                  onClick={() =>
                                    void safe(() =>
                                      customerDownloads.resume(task.id),
                                    )
                                  }
                                >
                                  <Play className="h-3.5 w-3.5" />
                                  {t("downloadManager.resume")}
                                </Action>
                              )}
                            {task.state === "received" && (
                              <Action
                                primary
                                disabled={saving === task.id}
                                onClick={() => void save(task)}
                              >
                                <Download className="h-3.5 w-3.5" />
                                {t(
                                  saving === task.id
                                    ? "downloadManager.saving"
                                    : "downloadManager.save",
                                )}
                              </Action>
                            )}
                            {!elsewhere &&
                              ["failed", "version_changed"].includes(
                                task.state,
                              ) && (
                                <Action
                                  onClick={() =>
                                    void safe(() =>
                                      customerDownloads.restart(task.id),
                                    )
                                  }
                                >
                                  <RotateCw className="h-3.5 w-3.5" />
                                  {t("downloadManager.restart")}
                                </Action>
                              )}
                            {task.state === "failed" && (
                              <Action
                                disabled={saving === task.id}
                                onClick={() => void normal(task)}
                              >
                                {t("downloadManager.ordinary")}
                              </Action>
                            )}
                            {!elsewhere && (
                              <Action
                                onClick={() =>
                                  void safe(() =>
                                    customerDownloads.cancel(task.id),
                                  )
                                }
                              >
                                {t("downloadManager.cancel")}
                              </Action>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {tab === "history" && (
                <>
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-xs text-neutral-500">
                      {t("downloadManager.historyHint")}
                    </p>
                    <Action onClick={() => void refresh()}>
                      <RotateCw className="h-3.5 w-3.5" />
                      {t("downloadManager.refresh")}
                    </Action>
                  </div>
                  {historyError && (
                    <p role="alert" className="mb-4 text-sm text-amber-700">
                      {t("downloadManager.historyFailed")}
                    </p>
                  )}
                  {identity === "anonymous" && (
                    <p className="mb-4 text-sm text-neutral-500">
                      {t("downloadManager.anonymous")}
                    </p>
                  )}
                  <ul className="space-y-3">
                    {local
                      .filter(
                        (task) =>
                          task.archived ||
                          ["handed_off", "cancelled"].includes(task.state),
                      )
                      .map((task) => (
                        <li
                          key={task.id}
                          className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
                        >
                          <p className="break-all text-sm font-semibold">
                            {task.filename}
                          </p>
                          <p className="gallery-numeric mt-1 text-xs text-neutral-500">
                            {t("downloadManager.version")} ·{" "}
                            {version(task.etag)}
                          </p>
                          {task.cacheCleared && (
                            <p className="mt-1 text-xs text-neutral-500">
                              {t("downloadManager.cacheCleared")}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-neutral-500">
                            <Check className="mr-1 inline h-3.5 w-3.5" />
                            {t(`downloadManager.states.${task.state}`)} ·{" "}
                            {t("downloadManager.thisDevice")}
                          </p>
                          <div className="mt-3 flex gap-2">
                            {task.state === "handed_off" &&
                              !task.cacheCleared && (
                                <Action
                                  disabled={saving === task.id}
                                  onClick={() => void save(task)}
                                >
                                  {t("downloadManager.saveAgain")}
                                </Action>
                              )}
                            {task.state !== "cancelled" && (
                              <Action
                                onClick={() =>
                                  void safe(() =>
                                    customerDownloads.restart(task.id),
                                  )
                                }
                              >
                                {t("downloadManager.restart")}
                              </Action>
                            )}
                            {!task.cacheCleared && (
                              <Action
                                onClick={() =>
                                  void safe(() =>
                                    customerDownloads.discard(task.id),
                                  )
                                }
                              >
                                {t("downloadManager.clearLocal")}
                              </Action>
                            )}
                          </div>
                        </li>
                      ))}
                  </ul>
                  <ul className="mt-3 space-y-3">
                    {history
                      .filter(
                        (item) =>
                          !local.some((task) => task.remoteId === item.id),
                      )
                      .map((item) => (
                        <li
                          key={item.id}
                          className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
                        >
                          <p className="break-all text-sm font-semibold">
                            {item.filename}
                          </p>
                          <p className="gallery-numeric mt-1 text-xs text-neutral-500">
                            {t("downloadManager.version")} ·{" "}
                            {version(item.etag)}
                          </p>
                          <p className="gallery-numeric mt-2 text-xs text-neutral-500">
                            {t(`downloadManager.states.${item.state}`)} ·{" "}
                            {bytes(item.received_bytes)} /{" "}
                            {bytes(item.total_bytes)}
                          </p>
                          <p className="mt-1 text-xs text-neutral-500">
                            {formatDateTime(item.created_at)}
                          </p>
                          <p className="mt-2 text-xs text-neutral-500">
                            {t("downloadManager.otherAttempt")}
                          </p>
                          {item.photo_id && (
                            <div className="mt-3">
                              <Action
                                onClick={() =>
                                  void safe(() => newFromHistory(item))
                                }
                              >
                                {t("downloadManager.downloadHere")}
                              </Action>
                            </div>
                          )}
                        </li>
                      ))}
                  </ul>
                  {!history.length &&
                    !local.some(
                      (task) =>
                        task.archived ||
                        ["handed_off", "cancelled"].includes(task.state),
                    ) && (
                      <p className="py-12 text-center text-sm text-neutral-500">
                        {t("downloadManager.noHistory")}
                      </p>
                    )}
                  {historyPage < historyPages && (
                    <div className="mt-4">
                      <Action
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          void refresh(historyPage + 1).finally(() =>
                            setBusy(false),
                          );
                        }}
                      >
                        {t("downloadManager.moreHistory")}
                      </Action>
                    </div>
                  )}
                </>
              )}
            </div>
            <footer className="border-t border-neutral-200 px-5 py-3 text-xs leading-5 text-neutral-500 dark:border-neutral-800">
              {t("downloadManager.footer")}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
function Action({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${primary ? "bg-emerald-700 text-white hover:bg-emerald-800" : "border border-neutral-200 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
    >
      {children}
    </button>
  );
}
