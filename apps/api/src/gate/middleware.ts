import type { MiddlewareHandler } from 'hono';
import type { GateConfig } from './config';
import { FREE_ALLOWED, PAID_ALLOWED } from './regions';

/** The routes that can call the model. The gate runs on exactly these (all POST). */
export const LIVE_ROUTES: readonly string[] = ['/api/grant', '/api/bind'];

/** Same list under the name the tests use. */
export const MODEL_ROUTES = LIVE_ROUTES;

export const ADULT_HEADER = 'x-paw-adult-confirmed';

export type GateCode = 'live_region_unavailable' | 'adult_confirmation_required';

export const GATE_MESSAGES: Readonly<Record<GateCode, string>> = {
  live_region_unavailable:
    'The paw grants no live wishes where you stand. The examples need no permission.',
  adult_confirmation_required:
    'The paw grants live wishes only to those who confirm they are 18 or older.',
};

/** An HTTP token (RFC 9110). `Headers.get` throws on anything else, so check before calling it. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;

/**
 * True only when the header named by `config.countryHeader` holds exactly one uppercase two-letter
 * code that is on the allow-list of the tier. Reads no other header, never throws, and the value
 * is used for this decision only.
 */
export function countryAllowed(headers: Headers, config: GateConfig): boolean {
  const name = config.countryHeader;
  if (typeof name !== 'string' || !HEADER_NAME.test(name)) return false;
  const value = headers.get(name);
  if (value === null || !COUNTRY_CODE.test(value)) return false;
  return (config.tier === 'paid' ? PAID_ALLOWED : FREE_ALLOWED).has(value);
}

export function adultConfirmed(headers: Headers): boolean {
  return headers.get(ADULT_HEADER) === 'yes';
}

/** The country is checked first, then the confirmation. `null` means the request may go on. */
export function gateDecision(headers: Headers, config: GateConfig): GateCode | null {
  if (!countryAllowed(headers, config)) return 'live_region_unavailable';
  if (!adultConfirmed(headers)) return 'adult_confirmation_required';
  return null;
}

/**
 * The live-call gate. It reads headers only, never the body, and refuses with 403 before the mode
 * check, the per-IP count, any reservation and any model call. The country is not logged or echoed.
 * (paw-api Requirement 14.1, 14.5-14.7)
 */
export function createGate(config: GateConfig): MiddlewareHandler {
  return async (c, next) => {
    const code = gateDecision(c.req.raw.headers, config);
    if (code === null) return next();
    return c.json({ code, message: GATE_MESSAGES[code] }, 403, { 'cache-control': 'no-store' });
  };
}
