/** The idle-callback pair of `window`. Absent in Safari, where the timeout fallback is used. */
export interface IdleHost {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/** Fallback delay when `requestIdleCallback` does not exist. */
export const IDLE_FALLBACK_MS = 200;
/** Upper bound on the wait for an idle period, so a busy page cannot delay the paw for long. */
export const IDLE_TIMEOUT_MS = 1000;

/**
 * Runs `callback` once after first paint: in the next idle period, or after 200 ms where `requestIdleCallback` is
 * missing. Returns a cancel function that is safe to call at any time.
 */
export function whenIdle(
  callback: () => void,
  host: IdleHost | undefined = typeof window === 'undefined' ? undefined : (window as IdleHost),
): () => void {
  if (host !== undefined && typeof host.requestIdleCallback === 'function') {
    const handle = host.requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
    return () => host.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(callback, IDLE_FALLBACK_MS);
  return () => clearTimeout(timer);
}
