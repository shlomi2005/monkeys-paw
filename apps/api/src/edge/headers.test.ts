import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { EDGE_COUNTRY_HEADER, rewriteRequest } from './headers';
import type { EdgeRequest } from './types';

const URL_ = 'https://paw.example/api/grant?x=1';

function makeRequest(
  pairs: Array<[string, string]>,
  cf: unknown | 'absent' = 'absent',
  init: { method?: string; body?: string } = {},
): EdgeRequest {
  const headers = new Headers();
  for (const [name, value] of pairs) headers.append(name, value);
  const request = new Request(URL_, { method: init.method ?? 'GET', headers, body: init.body });
  if (cf !== 'absent') Object.defineProperty(request, 'cf', { value: cf });
  return request as EdgeRequest;
}

const countryOf = (cf: unknown): string | undefined =>
  cf === 'absent' ? undefined : countryOfObject(cf);
function countryOfObject(cf: unknown): string | undefined {
  const value = (cf as { country?: unknown } | null | undefined)?.country;
  return typeof value === 'string' ? value : undefined;
}

/** The expected rule of Requirement 2.3 to 2.5, written out again. */
const trusted = (country: string | undefined, hasWorkerHeader: boolean): boolean =>
  country !== undefined && /^[A-Z]{2}$/.test(country) && country !== 'XX' && country !== 'T1' && !hasWorkerHeader;

const FIXED_NAMES = [
  'x-paw-country',
  'X-Paw-Country',
  'x-paw-dev-country',
  'x-paw-adult-confirmed',
  'X-PAW-ADULT-CONFIRMED',
  'cf-ipcountry',
  'cf-connecting-ip',
  'CF-Worker',
  'true-client-ip',
  'x-real-ip',
  'forwarded',
  'x-forwarded-for',
  'accept',
];

const nameArb = fc.oneof(
  fc.constantFrom(...FIXED_NAMES),
  fc
    .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), { minLength: 1, maxLength: 8 })
    .map((tail) => `x-paw-${tail}`),
);
const valueArb = fc.stringOf(fc.constantFrom(...'abcXYZ019.:,; -_'.split('')), { maxLength: 24 });
const pairsArb = fc.array(fc.tuple(nameArb, valueArb), { maxLength: 14 });

const countryArb = fc.oneof(
  fc.constantFrom('US', 'IL', 'DE', 'XX', 'T1', 'us', 'USA', 'U', '', '12', 'U1', ' US'),
  fc.string({ maxLength: 4 }),
  fc.stringOf(fc.constantFrom(...'ABCXYZT01'.split('')), { maxLength: 3 }),
);
const cfArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant('absent'),
  fc.constant(undefined),
  fc.constant(null),
  fc.constant('US'),
  fc.constant({}),
  countryArb.map((country) => ({ country })),
  fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant(['US'])).map((country) => ({ country })),
);

describe('rewriteRequest properties', () => {
  it('property 1: the forwarded country is cf.country iff it is two uppercase letters, not XX or T1, with no CF-Worker', () => {
    fc.assert(
      fc.property(pairsArb, cfArb, (pairs, cf) => {
        const request = makeRequest(pairs, cf);
        const forwarded = rewriteRequest(request);
        const country = countryOf(cf);
        const expected = trusted(country, request.headers.has('cf-worker'));
        expect(forwarded.headers.get(EDGE_COUNTRY_HEADER)).toBe(expected ? country : null);
      }),
      { numRuns: 300 },
    );
  });

  it('property 2: no x-paw-* survives except the adult header and the one country the Worker set', () => {
    fc.assert(
      fc.property(pairsArb, cfArb, (pairs, cf) => {
        const request = makeRequest(pairs, cf);
        const forwarded = rewriteRequest(request);
        const names = [...forwarded.headers.keys()].filter((name) => name.startsWith('x-paw-'));
        for (const name of names) expect(['x-paw-adult-confirmed', 'x-paw-country']).toContain(name);
        expect(forwarded.headers.get('x-paw-adult-confirmed')).toBe(request.headers.get('x-paw-adult-confirmed'));
        // A forged country is never what comes out, unless Cloudflare's own value is the same.
        const country = countryOf(cf);
        if (!trusted(country, request.headers.has('cf-worker'))) {
          expect(forwarded.headers.has('x-paw-country')).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('property 3: x-forwarded-for is CF-Connecting-IP or absent; x-real-ip and forwarded are gone', () => {
    fc.assert(
      fc.property(pairsArb, cfArb, (pairs, cf) => {
        const request = makeRequest(pairs, cf);
        const forwarded = rewriteRequest(request);
        expect(forwarded.headers.get('x-forwarded-for')).toBe(request.headers.get('cf-connecting-ip'));
        expect(forwarded.headers.has('x-real-ip')).toBe(false);
        expect(forwarded.headers.has('forwarded')).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

describe('rewriteRequest cases', () => {
  const country = (cf: unknown, pairs: Array<[string, string]> = []) =>
    rewriteRequest(makeRequest(pairs, cf)).headers.get(EDGE_COUNTRY_HEADER);

  it('sets the country from cf', () => {
    expect(country({ country: 'US' })).toBe('US');
    expect(country({ country: 'IL' }, [['x-paw-country', 'US']])).toBe('IL');
  });

  it('gives no country with CF-Worker, even for US', () => {
    expect(country({ country: 'US' }, [['CF-Worker', 'attacker.example']])).toBeNull();
    expect(country({ country: 'US' }, [['cf-worker', '']])).toBeNull();
  });

  it('gives no country for XX, T1, lower case, three letters, a number or no cf', () => {
    expect(country({ country: 'XX' })).toBeNull();
    expect(country({ country: 'T1' })).toBeNull();
    expect(country({ country: 'us' })).toBeNull();
    expect(country({ country: 'USA' })).toBeNull();
    expect(country({ country: 12 })).toBeNull();
    expect(country({ country: 'U1' })).toBeNull();
    expect(country('absent')).toBeNull();
    expect(country(undefined)).toBeNull();
    expect(country({})).toBeNull();
  });

  it('ignores forged country headers of every kind', () => {
    const forged: Array<[string, string]> = [
      ['x-paw-country', 'US'],
      ['x-paw-dev-country', 'US'],
      ['cf-ipcountry', 'US'],
      ['true-client-ip', '203.0.113.9'],
    ];
    expect(country({ country: 'DE' }, forged)).toBe('DE');
    const out = rewriteRequest(makeRequest(forged, { country: 'DE' }));
    expect(out.headers.get(EDGE_COUNTRY_HEADER)).toBe('DE');
    expect(out.headers.has('x-paw-dev-country')).toBe(false);
    const bare = rewriteRequest(makeRequest(forged));
    expect(bare.headers.has(EDGE_COUNTRY_HEADER)).toBe(false);
    expect(bare.headers.has('x-paw-dev-country')).toBe(false);
  });

  it('keeps the adult header unchanged', () => {
    const out = rewriteRequest(makeRequest([['X-Paw-Adult-Confirmed', 'yes']], { country: 'IL' }));
    expect(out.headers.get('x-paw-adult-confirmed')).toBe('yes');
  });

  it('replaces a forged x-forwarded-for by CF-Connecting-IP, or drops it', () => {
    const withIp = rewriteRequest(
      makeRequest(
        [
          ['x-forwarded-for', '1.1.1.1, 2.2.2.2'],
          ['x-real-ip', '3.3.3.3'],
          ['forwarded', 'for=4.4.4.4'],
          ['cf-connecting-ip', '198.51.100.7'],
        ],
        { country: 'IL' },
      ),
    );
    expect(withIp.headers.get('x-forwarded-for')).toBe('198.51.100.7');
    expect(withIp.headers.has('x-real-ip')).toBe(false);
    expect(withIp.headers.has('forwarded')).toBe(false);
    const without = rewriteRequest(makeRequest([['x-forwarded-for', '1.1.1.1']], { country: 'IL' }));
    expect(without.headers.has('x-forwarded-for')).toBe(false);
  });

  it('keeps method, URL and body', async () => {
    const out = rewriteRequest(makeRequest([['content-type', 'application/json']], { country: 'IL' }, { method: 'POST', body: '{"a":1}' }));
    expect(out.method).toBe('POST');
    expect(out.url).toBe(URL_);
    expect(await out.text()).toBe('{"a":1}');
    expect(out.headers.get('content-type')).toBe('application/json');
  });
});
