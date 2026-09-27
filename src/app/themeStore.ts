/**
 * Light (default) or dark theme. The choice is an interface preference, saved with the configuration store in
 * IndexedDB, the only browser storage the tool uses (CLAUDE.md, restriction 4). Any IndexedDB failure keeps the default.
 */
import { STORE_CONFIG, openDatabase, requestToPromise, transactionDone } from './db';

export type Theme = 'light' | 'dark';

const KEY = 'uiTheme';

export async function loadTheme(): Promise<Theme> {
  try {
    const db = await openDatabase();
    const stored = await requestToPromise(db.transaction(STORE_CONFIG, 'readonly').objectStore(STORE_CONFIG).get(KEY));
    db.close();
    return stored === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export async function saveTheme(theme: Theme): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    tx.objectStore(STORE_CONFIG).put(theme, KEY);
    await transactionDone(tx);
    db.close();
  } catch {
    // The theme still applies to this session.
  }
}

/** Applies the theme to the page; with View Transitions (Chrome/Edge) the new theme is revealed from `origin`. */
export function applyTheme(theme: Theme, update: () => void, origin?: { x: number; y: number }): void {
  const root = document.documentElement;
  const commit = () => {
    root.dataset.theme = theme;
    update();
  };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!origin || reduced || typeof doc.startViewTransition !== 'function') {
    commit();
    return;
  }
  const radius = Math.hypot(Math.max(origin.x, window.innerWidth - origin.x), Math.max(origin.y, window.innerHeight - origin.y));
  root.style.setProperty('--vt-x', `${origin.x}px`);
  root.style.setProperty('--vt-y', `${origin.y}px`);
  root.style.setProperty('--vt-r', `${radius}px`);
  doc.startViewTransition(commit);
}
