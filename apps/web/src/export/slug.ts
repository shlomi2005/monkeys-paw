// File-name helpers (design.md section 6). Pure string functions, no DOM.

const SLUG_MAX_LENGTH = 32;
const SAFE_ID_MAX_LENGTH = 64;
const FALLBACK = 'wish';

/**
 * Returns text matching `[a-z0-9-]{1,32}`, falling back to `wish`. Accents are folded to their
 * base letter, every other run of characters becomes one dash, and the ends are trimmed of dashes.
 */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? FALLBACK : slug;
}

/**
 * Strips everything outside `[A-Za-z0-9-]` so a server id is safe inside a file name, keeps at most
 * 64 characters, and returns `wish` when nothing survives. The result always matches
 * `[A-Za-z0-9-]{1,64}`.
 */
export function safeId(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9-]/g, '').slice(0, SAFE_ID_MAX_LENGTH);
  return safe === '' ? FALLBACK : safe;
}
