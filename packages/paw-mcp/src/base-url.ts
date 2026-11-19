/** Reserved name that never resolves. Stands in until the API is deployed. */
export const PLACEHOLDER_API_URL = 'https://paw-api.invalid';

/**
 * Turn the raw `PAW_API_URL` value into a base URL without trailing slashes.
 * Anything unusable (unset, blank, unexpanded `${...}`, not http(s), credentials in the URL)
 * falls back to the placeholder.
 */
export function resolveBaseUrl(raw: string | undefined): string {
  if (raw === undefined) return PLACEHOLDER_API_URL;
  const text = raw.trim();
  if (text === '' || text.includes('${')) return PLACEHOLDER_API_URL;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return PLACEHOLDER_API_URL;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return PLACEHOLDER_API_URL;
  if (url.username !== '' || url.password !== '') return PLACEHOLDER_API_URL;
  return text.replace(/\/+$/, '');
}

/** Scheme, host and port only: no path, no credentials. */
export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return PLACEHOLDER_API_URL;
  }
}
