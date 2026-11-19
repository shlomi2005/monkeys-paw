export type GlbChoice = 'web' | 'mobile';

/** Minimal shape of `window.matchMedia`, so tests and non-browser callers can inject a fake. */
export type MatchMediaFn = (query: string) => { readonly matches: boolean };

export const MOBILE_QUERY = '(max-width: 768px)';

/**
 * Picks the GLB once. Viewports of 768 px or less get the mobile file. A missing or throwing `matchMedia`
 * falls back to mobile, the smaller download.
 */
export function chooseGlb(matchMedia: MatchMediaFn | undefined | null): GlbChoice {
  if (typeof matchMedia !== 'function') return 'mobile';
  try {
    return matchMedia(MOBILE_QUERY).matches ? 'mobile' : 'web';
  } catch {
    return 'mobile';
  }
}

/** URL of the chosen GLB. `baseUrl` is Vite's `import.meta.env.BASE_URL` and ends with a slash. */
export function glbUrl(choice: GlbChoice, baseUrl: string): string {
  return `${baseUrl}paw/paw-${choice}.glb`;
}
