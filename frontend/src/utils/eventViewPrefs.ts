export type EventViewMode = 'cards' | 'list';

const VIEW_KEY = 'picpeak.adminEvents.view';
const ALLOWED_VIEWS: readonly EventViewMode[] = ['cards', 'list'];

export function getEventViewMode(): EventViewMode {
  if (typeof window === 'undefined') return 'cards';

  try {
    const storage = window.localStorage;
    if (!storage) return 'cards';
    const stored = storage.getItem(VIEW_KEY);
    return stored && (ALLOWED_VIEWS as readonly string[]).includes(stored)
      ? stored as EventViewMode
      : 'cards';
  } catch {
    return 'cards';
  }
}

export function setEventViewMode(mode: EventViewMode): void {
  if (typeof window === 'undefined') return;
  if (!(ALLOWED_VIEWS as readonly string[]).includes(mode)) return;

  try {
    const storage = window.localStorage;
    if (!storage) return;
    storage.setItem(VIEW_KEY, mode);
  } catch {
    // The view remains usable for this session if browser storage is unavailable.
  }
}
