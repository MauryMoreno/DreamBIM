

export const SHORT_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const PLAY_MS = 200;

export const realTimer = { every: (ms: number, fn: () => void) => { const h = setInterval(fn, ms); return () => clearInterval(h); } };
