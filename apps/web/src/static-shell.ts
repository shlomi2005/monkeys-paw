// The static shell in index.html paints the parchment and the poster before JS runs (design section 8, FCP).
// React removes it after its first commit. The shell is position: fixed, so removing it moves nothing.

export const STATIC_SHELL_ID = 'static-shell';

/** Removes the static shell if it is still in the document. Safe to call twice and outside a browser. */
export function removeStaticShell(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  doc?.getElementById(STATIC_SHELL_ID)?.remove();
}
