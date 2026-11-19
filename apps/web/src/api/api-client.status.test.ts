// Example tests for the status mapping table and the request rules (design.md section 6).
// Written before the client (task 15).

import { describe, expect, it } from 'vitest';
import { createApiClient } from './api-client';
import type { ApiClient } from './api-client';
import {
  BASE_URL,
  BIND_CURSE_ID,
  ENDPOINTS,
  ENDPOINT_PATH,
  callEndpoint,
  hangUntilAborted,
  jsonResponse,
  makeResponse,
  recordingFetch,
  sampleGrant,
  sampleSpecExport,
  sampleVerdict,
  sampleWish,
  validBody,
  withCurseStatus,
} from './api-test-support';
import type { Endpoint, FetchHandler } from './api-test-support';

function clientFor(handler: FetchHandler, timeouts?: Partial<Record<Endpoint, number>>): ApiClient {
  const { fetchImpl } = recordingFetch(handler);
  return createApiClient({ baseUrl: BASE_URL, fetchImpl, ...(timeouts === undefined ? {} : { timeouts }) });
}

async function failureOf(endpoint: Endpoint, handler: FetchHandler) {
  const result = await callEndpoint(clientFor(handler), endpoint);
  if (result.ok) throw new Error(`expected an error for ${endpoint}`);
  return result.error;
}

describe('400', () => {
  it('on grant, uses the server message when it is a short string', async () => {
    const error = await failureOf('grant', () => jsonResponse(400, { message: 'The paw trembles and refuses.' }));
    expect(error).toEqual({ kind: 'bad-request', status: 400, message: 'The paw trembles and refuses.' });
  });

  it('on grant, uses its own line when the server sent no message', async () => {
    for (const response of [
      () => jsonResponse(400, {}),
      () => makeResponse(400, ''),
      () => makeResponse(400, '<html>Bad request</html>'),
      () => jsonResponse(400, { message: 'x'.repeat(201) }),
      () => jsonResponse(400, { message: 42 }),
    ]) {
      const error = await failureOf('grant', response);
      expect(error).toEqual({
        kind: 'bad-request',
        status: 400,
        message: 'The Paw cannot read that wish. Try fewer words.',
      });
    }
  });

  it('on grant, accepts a server message of exactly 200 characters', async () => {
    const message = 'y'.repeat(200);
    const error = await failureOf('grant', () => jsonResponse(400, { message }));
    expect(error.message).toBe(message);
  });

  it('on bind, says the Judge cannot read the clause, whatever the server says', async () => {
    for (const response of [() => jsonResponse(400, { message: 'Invalid bind request' }), () => makeResponse(400, '')]) {
      const error = await failureOf('bind', response);
      expect(error).toEqual({ kind: 'bad-request', status: 400, message: 'The Judge cannot read that clause.' });
    }
  });

  it('on export, says the Judge cannot read the clause', async () => {
    const error = await failureOf('export', () => jsonResponse(400, { message: 'Invalid export request' }));
    expect(error).toEqual({ kind: 'bad-request', status: 400, message: 'The Judge cannot read that clause.' });
  });
});

describe('404', () => {
  it('on bind, says the paw has no memory of the curse', async () => {
    const error = await failureOf('bind', () => jsonResponse(404, { message: 'Curse not found' }));
    expect(error).toEqual({ kind: 'not-found', status: 404, message: 'The paw has no memory of this curse.' });
  });
});

describe('429 and 503', () => {
  for (const endpoint of ['grant', 'bind'] as const) {
    for (const status of [429, 503]) {
      it(`on ${endpoint} (${status}) mean the paw is resting`, async () => {
        const error = await failureOf(endpoint, () => jsonResponse(status, { message: 'Budget used up' }));
        expect(error).toEqual({
          kind: 'resting',
          status,
          message: 'The paw is resting. Browse the examples until it wakes.',
        });
      });
    }
  }

  it('on getExamples (503) is resting', async () => {
    const error = await failureOf('examples', () => jsonResponse(503, { message: 'Examples unavailable' }));
    expect(error.kind).toBe('resting');
    expect(error.status).toBe(503);
  });
});

describe('other 5xx', () => {
  for (const endpoint of ENDPOINTS) {
    it(`on ${endpoint} (500) is server`, async () => {
      const error = await failureOf(endpoint, () => jsonResponse(500, { message: 'Internal detail' }));
      expect(error).toEqual({ kind: 'server', status: 500, message: 'The paw stumbles. Try again in a moment.' });
    });
  }

  it('covers 502 and 504 the same way', async () => {
    for (const status of [502, 504]) {
      const error = await failureOf('grant', () => makeResponse(status, '<html>gateway</html>'));
      expect(error.kind).toBe('server');
      expect(error.message).toBe('The paw stumbles. Try again in a moment.');
    }
  });
});

describe('transport failures', () => {
  for (const endpoint of ENDPOINTS) {
    it(`a rejected fetch on ${endpoint} is network`, async () => {
      const error = await failureOf(endpoint, () => Promise.reject(new TypeError('Failed to fetch')));
      expect(error).toEqual({ kind: 'network', message: 'The line to the paw is cut.' });
    });

    it(`an exceeded timeout on ${endpoint} is timeout`, async () => {
      const client = clientFor(hangUntilAborted, { examples: 5, grant: 5, bind: 5, export: 5 });
      const result = await callEndpoint(client, endpoint);
      expect(result).toEqual({ ok: false, error: { kind: 'timeout', message: 'The paw is slow to wake.' } });
    });

    it(`a caller abort on ${endpoint} is aborted`, async () => {
      const controller = new AbortController();
      const client = clientFor((call) => {
        setTimeout(() => controller.abort(), 0);
        return hangUntilAborted(call);
      });
      const result = await callEndpoint(client, endpoint, { signal: controller.signal });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('aborted');
        expect(typeof result.error.message).toBe('string');
      }
    });
  }

  it('a signal that is already aborted gives aborted, not timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await callEndpoint(clientFor(hangUntilAborted), 'grant', { signal: controller.signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('aborted');
  });
});

describe('bad shape', () => {
  it('a 200 with invalid JSON is invalid-response', async () => {
    for (const endpoint of ENDPOINTS) {
      const error = await failureOf(endpoint, () => makeResponse(200, '{"wish":'));
      expect(error).toEqual({ kind: 'invalid-response', message: 'The paw mumbles nonsense. Try again.' });
    }
  });

  it('a 200 with the wrong shape is invalid-response', async () => {
    for (const endpoint of ENDPOINTS) {
      const error = await failureOf(endpoint, () => jsonResponse(200, { unexpected: true }));
      expect(error.kind).toBe('invalid-response');
      expect(error.message).toBe('The paw mumbles nonsense. Try again.');
    }
  });

  it('never shows the raw body', async () => {
    const error = await failureOf('grant', () => makeResponse(200, '<script>alert("raw")</script>'));
    expect(error.message).not.toContain('script');
  });

  it('a bind response for another curse is invalid-response', async () => {
    const body = { grant: withCurseStatus(sampleGrant(), 'c1', 'closed'), verdict: sampleVerdict('c1', true) };
    const error = await failureOf('bind', () => jsonResponse(200, body));
    expect(error.kind).toBe('invalid-response');
  });

  it('a bind response whose curse status disagrees with the verdict is invalid-response', async () => {
    const closedVerdictOpenCurse = { grant: sampleGrant(), verdict: sampleVerdict(BIND_CURSE_ID, true) };
    const openVerdictClosedCurse = {
      grant: withCurseStatus(sampleGrant(), BIND_CURSE_ID, 'closed'),
      verdict: sampleVerdict(BIND_CURSE_ID, false),
    };
    for (const body of [closedVerdictOpenCurse, openVerdictClosedCurse]) {
      const error = await failureOf('bind', () => jsonResponse(200, body));
      expect(error.kind).toBe('invalid-response');
    }
  });

  it('a bind response without the requested curse is invalid-response', async () => {
    const grant = { ...sampleGrant(), curses: sampleGrant().curses.filter((c) => c.id !== BIND_CURSE_ID) };
    const error = await failureOf('bind', () => jsonResponse(200, { grant, verdict: sampleVerdict(BIND_CURSE_ID, false) }));
    expect(error.kind).toBe('invalid-response');
  });
});

describe('success', () => {
  it('getExamples returns the entries', async () => {
    const result = await callEndpoint(clientFor(() => jsonResponse(200, validBody('examples'))), 'examples');
    expect(result).toEqual({ ok: true, value: validBody('examples') });
  });

  it('postGrant returns the wish and a normalized grant', async () => {
    const closed = withCurseStatus(sampleGrant(), 'c1', 'closed');
    const body = {
      wish: sampleWish(),
      grant: {
        ...closed,
        curses: closed.curses.map((c) =>
          c.id === 'c1' ? { ...c, binding: { curseId: 'c1', kind: 'rewrite', clause: 'x', proposedAt: 1 }, verdict: sampleVerdict('c1', true) } : c,
        ),
      },
    };
    const result = await callEndpoint(clientFor(() => jsonResponse(200, body)), 'grant');
    expect(result).toEqual({ ok: true, value: { wish: sampleWish(), grant: sampleGrant() } });
  });

  it('postBind keeps the closed curse of a consistent response', async () => {
    const result = await callEndpoint(clientFor(() => jsonResponse(200, validBody('bind'))), 'bind');
    expect(result).toEqual({ ok: true, value: validBody('bind') });
  });

  it('postExport returns the spec export', async () => {
    const result = await callEndpoint(clientFor(() => jsonResponse(200, sampleSpecExport())), 'export');
    expect(result).toEqual({ ok: true, value: sampleSpecExport() });
  });
});

describe('request rules', () => {
  for (const endpoint of ENDPOINTS) {
    it(`${endpoint}: fixed URL, no credentials, no referrer, no cache`, async () => {
      const { fetchImpl, calls } = recordingFetch(() => jsonResponse(200, validBody(endpoint)));
      await callEndpoint(createApiClient({ baseUrl: BASE_URL, fetchImpl }), endpoint, {
        wishText: 'Secret wish text',
        context: 'a clinic app',
      });
      expect(calls).toHaveLength(1);
      const call = calls[0];
      expect(call?.url).toBe(`${BASE_URL}${ENDPOINT_PATH[endpoint]}`);
      expect(call?.init).toMatchObject({
        credentials: 'omit',
        mode: 'cors',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      expect(call?.url).not.toMatch(/[?#]/);
      expect(call?.url).not.toContain('Secret');
    });
  }

  it('POST sends the wish and context as JSON in the body only', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(200, validBody('grant')));
    await callEndpoint(createApiClient({ baseUrl: BASE_URL, fetchImpl }), 'grant', {
      wishText: 'Secret wish text',
      context: 'a clinic app',
    });
    const init = calls[0]?.init;
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ wish: { text: 'Secret wish text', context: 'a clinic app' } });
  });

  it('GET sends no body', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(200, validBody('examples')));
    await callEndpoint(createApiClient({ baseUrl: BASE_URL, fetchImpl }), 'examples');
    expect(calls[0]?.init.body ?? undefined).toBeUndefined();
  });

  it('makes one request per call, with no retry', async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse(500, { message: 'x' }));
    await callEndpoint(createApiClient({ baseUrl: BASE_URL, fetchImpl }), 'grant');
    expect(calls).toHaveLength(1);
  });
});
