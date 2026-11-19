/** Longest text shown on an example card, ellipsis included (Req 3.5: about 50 characters). */
export const SNIPPET_MAX_LENGTH = 50;

/**
 * Collapses whitespace and cuts `text` to `max` characters, ending in an ellipsis when it was cut.
 * Counts code points, so an emoji is never split in half.
 */
export function snippet(text: string, max: number = SNIPPET_MAX_LENGTH): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const points = Array.from(clean);
  if (points.length <= max) return clean;
  return `${points.slice(0, max - 1).join('').trimEnd()}…`;
}
