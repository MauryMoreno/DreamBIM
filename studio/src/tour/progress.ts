// What the tour remembers between sessions: whether it was offered and which chapters were finished.

export const TOUR_STORAGE_KEY = 'studio.tour';

export interface TourProgress {
  /** The first-run offer was already shown. */
  offered: boolean;
  /** Ids of the finished chapters. */
  done: string[];
}

/** Saved progress; missing, broken or unreachable storage counts as a fresh start. */
export function loadProgress(): TourProgress {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY) ?? 'null');
    if (!v || typeof v !== 'object') return { offered: false, done: [] };
    const { offered, done } = v as { offered?: unknown; done?: unknown };
    return { offered: offered === true, done: Array.isArray(done) ? done.filter((d): d is string => typeof d === 'string') : [] };
  } catch {
    return { offered: false, done: [] };
  }
}

function save(p: TourProgress): void {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* no storage: the tour is simply offered again next time */
  }
}

export function markOffered(): void {
  save({ ...loadProgress(), offered: true });
}

export function markDone(chapter: string): void {
  const p = loadProgress();
  if (!p.done.includes(chapter)) save({ ...p, done: [...p.done, chapter] });
}
