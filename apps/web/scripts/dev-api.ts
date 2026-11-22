// Dev only. Forwards /api/ from the Vite dev server to the local API, and can tell the API which country the
// developer is in, so the live-wish gate can be tried from a browser. It is absent from build, preview and tests.
//
// The header is removed and set in `bypass`, which runs before http-proxy copies the request's headers. `proxyReq`
// would not do: http-proxy does not emit it for a request with an `Expect` header, so a forged header would pass.
import type { Plugin, ProxyOptions } from 'vite';

export const DEV_COUNTRY_HEADER = 'x-paw-dev-country';
const TARGET = 'http://127.0.0.1:8787';

export function devCountryBypass(country: string | undefined): NonNullable<ProxyOptions['bypass']> {
  return (req) => {
    delete req.headers[DEV_COUNTRY_HEADER];
    const origin = req.headers.origin;
    if (country !== undefined && /^[A-Z]{2}$/.test(country) && (origin === undefined || origin === `http://${req.headers.host}`)) {
      req.headers[DEV_COUNTRY_HEADER] = country;
    }
    return undefined;
  };
}

export function devApi(env: NodeJS.ProcessEnv = process.env): Plugin {
  return {
    name: 'paw-dev-api',
    apply: (_config, e) => e.command === 'serve' && !e.isPreview && e.mode !== 'test',
    config: () => ({
      server: { proxy: { '^/api/': { target: TARGET, bypass: devCountryBypass(env.PAW_DEV_COUNTRY) } } },
    }),
  };
}
