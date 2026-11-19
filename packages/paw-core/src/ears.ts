// isEarsCriterion: does a model-written acceptance criterion read as EARS?
// It must start with an EARS keyword (WHEN, IF, WHILE, WHERE or THE SYSTEM SHALL)
// and contain SHALL. Used by grantWish (to keep or drop `wishCriterion`) and by exportSpec.

const EARS_START = /^(WHEN|IF|WHILE|WHERE|THE SYSTEM SHALL)\b/;
const HAS_SHALL = /\bSHALL\b/;

export function isEarsCriterion(text: string): boolean {
  const trimmed = text.trim();
  return EARS_START.test(trimmed) && HAS_SHALL.test(trimmed);
}
