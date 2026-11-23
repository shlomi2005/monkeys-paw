import type { EdgeRequest } from './types';

/** The one header that carries the country to the gate on the edge. */
export const EDGE_COUNTRY_HEADER = 'x-paw-country';

const ADULT_HEADER = 'x-paw-adult-confirmed';
const COUNTRY_CODE = /^[A-Z]{2}$/;
const NOT_A_COUNTRY = new Set(['XX', 'T1']);

/**
 * The request the object gets. Pure. Every `x-paw-*` header except the visitor's own adult
 * statement is deleted, the forwarding headers are replaced by Cloudflare's address, and the
 * country comes from `request.cf` only (never when `CF-Worker` says another Worker called).
 */
export function rewriteRequest(request: EdgeRequest): Request {
  const headers = new Headers(request.headers);

  for (const name of [...headers.keys()]) {
    if (name.startsWith('x-paw-') && name !== ADULT_HEADER) headers.delete(name);
  }
  headers.delete('x-forwarded-for');
  headers.delete('x-real-ip');
  headers.delete('forwarded');

  const address = request.headers.get('cf-connecting-ip');
  if (address !== null) headers.set('x-forwarded-for', address);

  const country = request.cf?.country;
  if (
    typeof country === 'string' &&
    COUNTRY_CODE.test(country) &&
    !NOT_A_COUNTRY.has(country) &&
    !request.headers.has('cf-worker')
  ) {
    headers.set(EDGE_COUNTRY_HEADER, country);
  }

  return new Request(request, { headers });
}
