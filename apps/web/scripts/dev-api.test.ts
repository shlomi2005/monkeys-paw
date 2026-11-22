import fc from 'fast-check';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import { DEV_COUNTRY_HEADER, devCountryBypass } from './dev-api';

const CONFIG_FILE = fileURLToPath(new URL('../vite.config.ts', import.meta.url));

type Headers = Record<string, string | string[] | undefined>;
function run(country: string | undefined, headers: Headers): Headers {
  const req = { headers: { host: 'localhost:5173', ...headers } };
  const result = (devCountryBypass(country) as unknown as (r: unknown) => unknown)(req);
  expect(result).toBeUndefined();
  return req.headers;
}

describe('devCountryBypass', () => {
  it.each([undefined, '', 'us', 'USA', ' US', 'US,GB', 'U1'])('removes the caller header for country %j', (c) => {
    expect(DEV_COUNTRY_HEADER in run(c, { [DEV_COUNTRY_HEADER]: 'FR' })).toBe(false);
  });

  it.each(['http://evil.example', 'null', 'http://localhost:3000'])('removes it for origin %s even with US', (origin) => {
    expect(DEV_COUNTRY_HEADER in run('US', { origin, [DEV_COUNTRY_HEADER]: 'FR' })).toBe(false);
  });

  it('sets it with no Origin, the same origin, and an Expect header', () => {
    expect(run('US', { [DEV_COUNTRY_HEADER]: 'FR' })[DEV_COUNTRY_HEADER]).toBe('US');
    expect(run('US', { origin: 'http://localhost:5173' })[DEV_COUNTRY_HEADER]).toBe('US');
    expect(run('US', { expect: '100-continue', [DEV_COUNTRY_HEADER]: 'FR' })[DEV_COUNTRY_HEADER]).toBe('US');
  });

  it('property: the outgoing value is the configured country or absent, never the caller\'s', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: undefined }), fc.string(), fc.option(fc.string(), { nil: undefined }), (country, caller, origin) => {
        const out = run(country, { [DEV_COUNTRY_HEADER]: caller, ...(origin === undefined ? {} : { origin }) })[DEV_COUNTRY_HEADER];
        expect(out === undefined || out === country).toBe(true);
      }),
    );
  });
});

describe('plugin wiring', () => {
  const load = (command: 'serve' | 'build', mode: string, isPreview = false) =>
    resolveConfig({ configFile: CONFIG_FILE, logLevel: 'silent' }, command, mode, mode === 'production' ? 'production' : 'development', isPreview);

  it('proxies ^/api/ on serve in development', async () => {
    const cfg = await load('serve', 'development');
    const proxy = cfg.server.proxy ?? {};
    expect(Object.keys(proxy)).toEqual(['^/api/']);
    const re = new RegExp(Object.keys(proxy)[0]);
    expect(re.test('/api/live')).toBe(true);
    expect(re.test('/src/api/api-client.ts')).toBe(false);
    expect(re.test('/apiary')).toBe(false);
  });

  it.each([
    ['build', 'production', false],
    ['serve', 'development', true],
    ['serve', 'test', false],
  ] as const)('has no proxy for %s, mode %s, preview %s', async (command, mode, isPreview) => {
    const cfg = await load(command, mode, isPreview);
    expect(Object.keys(cfg.server.proxy ?? {})).toEqual([]);
    expect(Object.keys(cfg.preview.proxy ?? {})).toEqual([]);
  });
});
