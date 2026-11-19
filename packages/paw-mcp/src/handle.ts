/** Number of wishId characters in a handle. */
export const HANDLE_PREFIX_LENGTH = 8;

/** `<first 8 characters of wishId>:<curse id>`, for example `3f2a9c1e:curse-2`. */
export function toHandle(wishId: string, curseId: string): string {
  return `${wishId.slice(0, HANDLE_PREFIX_LENGTH)}:${curseId}`;
}

/** Split a handle at its last colon. Returns null when the text has no usable `prefix:id` shape. */
export function parseHandle(text: string): { prefix: string; curseId: string } | null {
  const at = text.lastIndexOf(':');
  if (at <= 0 || at === text.length - 1) return null;
  return { prefix: text.slice(0, at), curseId: text.slice(at + 1) };
}
