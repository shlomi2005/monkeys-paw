// isEarsCriterion: does a model-written acceptance criterion read as EARS?
// It must start with an EARS keyword (WHEN, IF, WHILE, WHERE or THE SYSTEM SHALL)
// and contain SHALL. Used by grantWish (to keep or drop `wishCriterion`) and by exportSpec.

const EARS_START = /^(WHEN|IF|WHILE|WHERE|THE SYSTEM SHALL)\b/;
const HAS_SHALL = /\bSHALL\b/;

/**
 * The EARS clause format in one line, for agents that write a clause by hand
 * (`paw_rules` bind, `paw_check_verdict` errors). It names every keyword that
 * `isEarsCriterion` accepts as a start, and the SHALL it needs. Keep the two in step:
 * `tests/ears-format.test.ts` fails if they drift.
 */
export const EARS_CLAUSE_FORMAT =
  'An EARS clause must start with WHEN, IF, WHILE, WHERE or THE SYSTEM SHALL and contain SHALL.';

export function isEarsCriterion(text: string): boolean {
  const trimmed = text.trim();
  return EARS_START.test(trimmed) && HAS_SHALL.test(trimmed);
}
