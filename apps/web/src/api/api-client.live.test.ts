// getLive, the 18+ header and the 403 mapping (paw-web Req 13.1, 13.4, 13.5, design section 6).

import { describe, expect, it } from 'vitest';
import { createApiClient } from './api-client';
import {
  BASE_URL,
  BIND_CURSE_ID,
  hangUntilAborted,
  jsonResponse,
  recordingFetch,
  sampleGrant,
  sampleWish,
  validBody,
} from './api-test-support';
import type { FetchHandler } from './api-test-support';
import {
  ADULT_REQUIRED_MESSAGE,
  OUTSIDE_REFUSAL_MESSAGE,
  SERVER_STUMBLE_MESSAGE,
} from './api-messages';

function setup(handler: FetchHandler, live = 5_000) {
  const { fetchImpl, calls } = recordingFetch(handler);
  return { client: createApiClient({ baseUrl: BASE_URL, fetchImpl, timeouts: { live } }), calls };
}

const bindRequest = { grant: sampleGrant(), curseId: BIND_CURSE_ID, kind: 'ears-clause' as const, clause: 'WHEN x THE SYSTEM SHALL y' };
const headersOf = (init: RequestInit): Record<string, string> => (init.headers ?? {}) as Record<string, string>;

describe('getLive', () => {
  it('GETs /api/live and returns the strict { live } body', async () => {
    const { client, calls } = setup(() => jsonResponse(200, { live: false }));
    expect(await client.getLive()).toEqual({ ok: true, value: { live: false } });
    expect(calls[0]?.url).toBe(`${BASE_URL}/api/live`);
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(headersOf(calls[0]?.init ?? {})['X-Paw-Adult-Confirmed']).toBeUndefined();
  });

  it.each([{ live: 'yes' }, { live: true, extra: 1 }, {}, [], 'true', null])('rejects the body %j', async (body) => {
    const { client } = setup(() => jsonResponse(200, body));
    const result = await client.getLive();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid-response');
  });

  it('is a failure on a 500, and a timeout after 5 s by default', async () => {
    const failed = await setup(() => jsonResponse(500, {})).client.getLive();
    expect(failed.ok).toBe(false);
    const slow = await setup(hangUntilAborted, 5).client.getLive();
    expect(slow.ok).toBe(false);
    if (!slow.ok) expect(slow.error.kind).toBe('timeout');
  });
});

describe('the adult header', () => {
  it('is sent on a live grant and bind only when adult is true, as a header and never in the body', async () => {
    const { client, calls } = setup((call) =>
      jsonResponse(200, call.url.endsWith('/api/grant') ? validBody('grant') : validBody('bind')),
    );
    await client.postGrant({ text: 'a wish' }, undefined, true);
    await client.postBind(bindRequest, undefined, true);
    for (const call of calls) {
      expect(headersOf(call.init)['X-Paw-Adult-Confirmed']).toBe('yes');
      expect(String(call.init.body)).not.toMatch(/adult|confirmed|yes/i);
    }
  });

  it.each([undefined, false])('is absent when adult is %s', async (adult) => {
    const { client, calls } = setup((call) =>
      jsonResponse(200, call.url.endsWith('/api/grant') ? validBody('grant') : validBody('bind')),
    );
    await client.postGrant({ text: 'a wish' }, undefined, adult);
    await client.postBind(bindRequest, undefined, adult);
    for (const call of calls) expect(Object.keys(headersOf(call.init))).toEqual(['Content-Type']);
  });

  it('is never sent on examples, live or export', async () => {
    const { client, calls } = setup((call) => {
      if (call.url.endsWith('/api/export')) return jsonResponse(200, validBody('export'));
      if (call.url.endsWith('/api/live')) return jsonResponse(200, { live: true });
      return jsonResponse(200, validBody('examples'));
    });
    await client.getExamples();
    await client.getLive();
    await client.postExport({ wish: sampleWish(), grant: sampleGrant() });
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(headersOf(call.init)['X-Paw-Adult-Confirmed']).toBeUndefined();
  });
});

describe('403 on grant and bind', () => {
  const run = (endpoint: 'grant' | 'bind', body: unknown) => {
    const { client } = setup(() => jsonResponse(403, body));
    return endpoint === 'grant' ? client.postGrant({ text: 'a wish' }) : client.postBind(bindRequest);
  };

  it.each(['grant', 'bind'] as const)('maps live_region_unavailable on %s to outside, with the server line', async (endpoint) => {
    const result = await run(endpoint, { code: 'live_region_unavailable', message: 'Not from here.' });
    expect(result).toEqual({ ok: false, error: { kind: 'outside', status: 403, message: 'Not from here.' } });
  });

  it.each(['grant', 'bind'] as const)('uses its own line for outside when the server sent none (%s)', async (endpoint) => {
    const result = await run(endpoint, { code: 'live_region_unavailable' });
    expect(result).toEqual({ ok: false, error: { kind: 'outside', status: 403, message: OUTSIDE_REFUSAL_MESSAGE } });
  });

  it.each(['grant', 'bind'] as const)('maps adult_confirmation_required on %s to adult, with the page line', async (endpoint) => {
    const result = await run(endpoint, { code: 'adult_confirmation_required', message: 'Server words.' });
    expect(result).toEqual({ ok: false, error: { kind: 'adult', status: 403, message: ADULT_REQUIRED_MESSAGE } });
  });

  it.each([{ code: 'something_else' }, { message: 'Forbidden' }, 'nope', null, { code: 5 }])(
    'any other 403 (%j) is the stumble line',
    async (body) => {
      for (const endpoint of ['grant', 'bind'] as const) {
        const result = await run(endpoint, body);
        expect(result).toEqual({ ok: false, error: { kind: 'server', status: 403, message: SERVER_STUMBLE_MESSAGE } });
      }
    },
  );

  it('does not map a 403 on export by its code', async () => {
    const { client } = setup(() => jsonResponse(403, { code: 'live_region_unavailable' }));
    const result = await client.postExport({ wish: sampleWish(), grant: sampleGrant() });
    expect(result).toEqual({ ok: false, error: { kind: 'server', status: 403, message: SERVER_STUMBLE_MESSAGE } });
  });
});
