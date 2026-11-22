import { useCallback, useSyncExternalStore } from 'react';

/** A phone: under 768 px. The desktop layout starts at `(min-width: 768px)`, so the two never overlap. */
export const PHONE_QUERY = '(max-width: 767.98px)';

function mediaList(query: string): MediaQueryList | null {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    return window.matchMedia(query) ?? null;
  } catch {
    return null;
  }
}

const getServerSnapshot = (): boolean => false;

/** True while `query` matches. A missing or throwing `matchMedia` means false, which is desktop for `PHONE_QUERY`. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      const list = mediaList(query);
      if (!list) return () => {};
      if (typeof list.addEventListener === 'function') {
        list.addEventListener('change', onChange);
        return () => list.removeEventListener('change', onChange);
      }
      // Older Safari only has the deprecated pair.
      list.addListener?.(onChange);
      return () => list.removeListener?.(onChange);
    },
    [query],
  );
  const getSnapshot = useCallback((): boolean => mediaList(query)?.matches === true, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
