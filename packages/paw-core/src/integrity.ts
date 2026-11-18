// computeIntegrity: count open/closed curses and compute the Wish Integrity score.
// Score is 0–5: Math.floor(closed/total * 5) when total > 0, else 5.

import type { Grant, IntegrityResult } from './types';

/**
 * Compute the Wish Integrity score for a grant: a 0–5 integer where 5 means
 * all curses are closed and 0 means none are.
 */
export function computeIntegrity(grant: Grant): IntegrityResult {
  const total = grant.curses.length;
  const closed = grant.curses.filter((c) => c.status === 'closed').length;
  const open = total - closed;

  // Req 5.2: when total > 0, compute Math.floor(closed/total * 5)
  // Req 5.3: when total === 0, return 5 (nothing to bind)
  const score = total === 0 ? 5 : Math.floor((closed / total) * 5);

  return { score, total, closed, open };
}
