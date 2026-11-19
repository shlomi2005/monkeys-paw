// Response-side helpers for the API client: grant normalization, the bind consistency check
// and the examples types (design.md section 6). Schemas themselves come from paw-core.

import type { Grant, Verdict, Wish } from 'paw-core';

/** One cached example from `GET /api/examples`. */
export interface ExampleEntry {
  readonly wish: Wish;
  readonly grant: Grant;
}

export type ExamplesState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly entries: readonly ExampleEntry[] }
  | { readonly kind: 'unavailable' };

/**
 * A fresh grant: every curse `open`, no binding and no verdict. The server's example grants may
 * carry closed curses; a new round always starts with all of them open. Does not mutate `grant`.
 */
export function normalizeGrant(grant: Grant): Grant {
  return {
    ...grant,
    curses: grant.curses.map((curse) => ({
      id: curse.id,
      type: curse.type,
      story: curse.story,
      loophole: curse.loophole,
      status: 'open' as const,
    })),
  };
}

/**
 * True when a bind response agrees with the request: the verdict is for the requested curse, the
 * grant contains that curse, and the curse is `closed` exactly when the verdict is `closed`.
 */
export function isBindConsistent(
  curseId: string,
  response: { readonly grant: Grant; readonly verdict: Verdict },
): boolean {
  const { grant, verdict } = response;
  if (verdict.curseId !== curseId) return false;
  const curse = grant.curses.find((c) => c.id === curseId);
  if (curse === undefined) return false;
  return (curse.status === 'closed') === verdict.closed;
}
