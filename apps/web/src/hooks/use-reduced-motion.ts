import { useSyncExternalStore } from 'react';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function mediaList(): MediaQueryList | null {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    return window.matchMedia(REDUCED_MOTION_QUERY) ?? null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  const list = mediaList();
  if (!list) return () => {};
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }
  // Older Safari only has the deprecated pair.
  list.addListener?.(onChange);
  return () => list.removeListener?.(onChange);
}

const getSnapshot = (): boolean => mediaList()?.matches ?? false;

/** The preference right now, read once. A missing or throwing `matchMedia` means false. */
export function prefersReducedMotion(): boolean {
  return getSnapshot();
}
const getServerSnapshot = (): boolean => false;

/** True while the user asks for reduced motion. Updates when the preference changes. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
