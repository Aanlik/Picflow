/**
 * A process-wide gate on concurrent authenticated image fetches (#1287).
 *
 * Gallery grids are NOT virtualized: a 546-photo event puts 546 `PhotoCard`s
 * in the DOM, each mounting its own `AuthenticatedImage` the moment its
 * IntersectionObserver fires. Scrolling through such a gallery therefore hands
 * the browser several hundred simultaneous `fetch` calls with nothing between
 * them and the connection pool.
 *
 * That is not a load the browser degrades gracefully under. The reported
 * symptom is a gallery that loads in bursts, then stops with tiles blank
 * indefinitely — no console error, no failed request, nothing in the backend
 * log, and no recovery from scrolling. A request that is queued forever is
 * *pending*, not failed, which is exactly why it leaves no trace.
 *
 * Bounding it here fixes the shape of the problem rather than one instance of
 * it: at most MAX_CONCURRENT requests are ever outstanding; queued work is
 * chosen by live priority and FIFO order within a tier. Every slot is released
 * in a `finally` so a rejection or abort cannot leak one. Six matches what
 * browsers allow per origin on HTTP/1.1 anyway, so healthy-connection
 * throughput stays bounded without flooding the browser.
 *
 * Deliberately module-level, not per-component: the point is a cap across the
 * whole page, which is the thing that was missing.
 */

const MAX_CONCURRENT = 6;

let active = 0;
// Three priority tiers, drained high-first. A strict single FIFO meant the
// image the user just clicked queued behind every thumbnail already enqueued.
// Viewport gating limits ordinary gallery work; this queue still protects
// the browser and lets visible tiles and explicit viewer requests lead.
type Priority = 'high' | 'prefetch' | 'normal';
type WaitingTask = { run: () => void; priority: () => Priority; order: number };
const waiting: WaitingTask[] = [];
let nextOrder = 0;
let pumpScheduled = false;

const priorityRank: Record<Priority, number> = { high: 2, prefetch: 1, normal: 0 };

/** Highest current tier first; FIFO within a tier. */
function nextWaiter() {
  let bestIndex = -1;
  let bestRank = -1;
  let bestOrder = Number.POSITIVE_INFINITY;
  waiting.forEach((task, index) => {
    const rank = priorityRank[task.priority()];
    if (rank > bestRank || (rank === bestRank && task.order < bestOrder)) {
      bestIndex = index;
      bestRank = rank;
      bestOrder = task.order;
    }
  });
  return bestIndex >= 0 ? waiting.splice(bestIndex, 1)[0] : undefined;
}

/** Hand the next waiter a slot, if anyone is queued and one is free. */
function pump() {
  while (active < MAX_CONCURRENT && waiting.length > 0) {
    const next = nextWaiter();
    if (!next) break;
    active += 1;
    next.run();
  }
}

/** Let all image effects from the current React commit join before choosing work. */
function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  queueMicrotask(() => {
    pumpScheduled = false;
    pump();
  });
}

/**
 * Run `task` once a slot is free. The slot is released when the returned
 * promise settles, whatever way it settles.
 *
 * Callers that no longer need their result should still let it run — the work
 * is already cheap, and an AbortController on the underlying fetch is the
 * right way to cancel, not dropping the slot on the floor.
 */
export interface ImageFetchOptions {
  /**
   * Three tiers, drained highest-first:
   *
   *   'high'     visible gallery tiles and the current lightbox slide
   *   'prefetch' near-viewport tiles and lightbox neighbours
   *   'normal'   other/background images
   *
   * The middle tier exists because the lightbox's effects enqueue in slide
   * order (previous, current, next). Sharing one tier with its neighbours
   * meant the PREVIOUS slide could take the first freed slot while the image
   * the user is actually looking at stayed queued behind it.
   *
   * Only tiles currently in view are high; nearby tiles remain prefetch work.
   */
  priority?: Priority | (() => Priority);
}

export function withImageFetchSlot<T>(
  task: () => Promise<T>,
  { priority = 'normal' }: ImageFetchOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      // Promise.resolve().then(task) rather than task() directly: a task that
      // throws SYNCHRONOUSLY would otherwise never reach the `.finally`, and
      // `active` would stay incremented. Repeat that and the pool is
      // permanently exhausted — the precise failure this queue exists to
      // prevent, reintroduced by its own release path.
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    };

    const getPriority = typeof priority === 'function' ? priority : () => priority;
    waiting.push({ run, priority: getPriority, order: nextOrder++ });
    schedulePump();
  });
}

/** Test-only visibility into the gate. */
export function __imageFetchQueueState() {
  return {
    active,
    queued: waiting.length,
    queuedHigh: waiting.filter((task) => task.priority() === 'high').length,
    queuedPrefetch: waiting.filter((task) => task.priority() === 'prefetch').length,
    max: MAX_CONCURRENT,
  };
}
