import type { MatchMediaFn } from './glb-choice';

export const REDUCED_DATA_QUERY = '(prefers-reduced-data: reduce)';

/** The slice of `navigator` this check reads. `navigator.connection` exists in Chromium only. */
export interface ConnectionHost {
  readonly connection?: { readonly saveData?: unknown } | null;
}

function defaultNavigator(): ConnectionHost | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as ConnectionHost);
}

function defaultMatchMedia(): MatchMediaFn | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  // Called through `window`: a detached `matchMedia` throws "Illegal invocation".
  return (query) => window.matchMedia(query);
}

/**
 * True when the visitor asked for less data: `navigator.connection.saveData === true` or the
 * `prefers-reduced-data: reduce` media query matches. The paw then stays a poster and the 3D chunk and the GLB are
 * never requested. Never throws: anything missing or broken counts as "no preference".
 */
export function prefersReducedData(
  nav: ConnectionHost | undefined | null = defaultNavigator(),
  matchMedia: MatchMediaFn | undefined | null = defaultMatchMedia(),
): boolean {
  try {
    if (nav?.connection?.saveData === true) return true;
  } catch {
    // A throwing getter is the same as a missing one.
  }
  try {
    if (typeof matchMedia === 'function' && matchMedia(REDUCED_DATA_QUERY).matches === true) return true;
  } catch {
    // A throwing matchMedia is the same as a missing one.
  }
  return false;
}
