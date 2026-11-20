import { afterEach, describe, expect, it } from 'vitest';
import { makeGrant } from './fixtures';
import { connectPaw, sendJson, startStub, textOf, type Connected, type Stub } from './stub-api';

const WISH_ID = '3f2a9c1e-0000-4000-8000-000000000001';

let stub: Stub | undefined;
let connected: Connected | undefined;

afterEach(async () => {
  await connected?.close();
  await stub?.close();
  stub = undefined;
  connected = undefined;
});

async function callCurse(
  handler: Parameters<typeof startStub>[0],
  extra: { timeoutMs?: number } = {},
): Promise<{ text: string; isError: boolean | undefined }> {
  stub = await startStub(handler);
  connected = await connectPaw({ mode: 'remote', baseUrl: stub.url, ...extra });
  const result = await connected.client.callTool({ name: 'paw_curse', arguments: { requirement: 'A secret requirement.' } });
  return { text: textOf(result), isError: result.isError as boolean | undefined };
}

describe('API failures are tool results', () => {
  it('400: returns the API message unchanged', async () => {
    const r = await callCurse((_q, res) => sendJson(res, 400, { message: 'Wish text cannot be empty' }));
    expect(r).toEqual({ text: 'Wish text cannot be empty', isError: true });
  });

  it('503: keeps "The paw is resting"', async () => {
    const r = await callCurse((_q, res) => sendJson(res, 503, { message: 'The paw is resting. Try the examples.' }));
    expect(r.isError).toBe(true);
    expect(r.text).toBe('The paw is resting. Try the examples.');
  });

  it('500 with a JSON message', async () => {
    const r = await callCurse((_q, res) => sendJson(res, 500, { message: 'The paw slipped.' }));
    expect(r).toEqual({ text: 'The paw slipped.', isError: true });
  });

  it('non-JSON error body', async () => {
    const r = await callCurse((_q, res) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Bad Gateway');
    });
    expect(r).toEqual({ text: 'The Paw API answered HTTP 502.', isError: true });
  });

  it('JSON error body without a message', async () => {
    const r = await callCurse((_q, res) => sendJson(res, 500, { error: 'boom' }));
    expect(r.text).toBe('The Paw API answered HTTP 500.');
  });

  it('unreachable host', async () => {
    const closed = await startStub(() => undefined);
    const url = closed.url;
    await closed.close();
    connected = await connectPaw({ mode: 'remote', baseUrl: url });
    const result = await connected.client.callTool({ name: 'paw_curse', arguments: { requirement: 'R' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`Cannot reach the Paw API at ${url}; set PAW_API_URL.`);
  });

  it('the unreachable-host message hides any path', async () => {
    const closed = await startStub(() => undefined);
    const url = closed.url;
    await closed.close();
    connected = await connectPaw({ mode: 'remote', baseUrl: `${url}/deep/path` });
    const result = await connected.client.callTool({ name: 'paw_curse', arguments: { requirement: 'R' } });
    expect(textOf(result)).toBe(`Cannot reach the Paw API at ${url}; set PAW_API_URL.`);
  });

  it('timeout (injected, short)', async () => {
    const r = await callCurse(() => undefined, { timeoutMs: 100 });
    expect(r.isError).toBe(true);
    expect(r.text).toBe(`Cannot reach the Paw API at ${stub!.url}; set PAW_API_URL.`);
  });

  it('redirects are refused', async () => {
    const r = await callCurse((_q, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' });
      res.end();
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Cannot reach the Paw API');
    expect(stub!.requests).toHaveLength(1);
  });

  it.each([
    ['not JSON', () => 'not json at all'],
    ['wrong shape', () => JSON.stringify({ grant: { wishId: 'x' } })],
  ])('2xx answer that is %s', async (_name, body) => {
    const r = await callCurse((_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body());
    });
    expect(r).toEqual({
      text: 'The Paw API answered in a shape this tool does not understand.',
      isError: true,
    });
  });

  it('a bind answer with a bad shape is rejected too', async () => {
    stub = await startStub((req, res) =>
      req.path === '/api/grant'
        ? sendJson(res, 200, { wish: { id: 'w', text: 't', createdAt: 1 }, grant: makeGrant(WISH_ID) })
        : sendJson(res, 200, { verdict: 'closed' }),
    );
    connected = await connectPaw({ mode: 'remote', baseUrl: stub.url });
    await connected.client.callTool({ name: 'paw_curse', arguments: { requirement: 'R' } });
    const result = await connected.client.callTool({
      name: 'paw_bind',
      arguments: { curse: '3f2a9c1e:curse-0', amendment: 'A.' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('The Paw API answered in a shape this tool does not understand.');
  });

  it('an unexpected failure becomes one sentence and the server keeps working', async () => {
    stub = await startStub((_q, res) => sendJson(res, 400, { message: 'x' }));
    let calls = 0;
    connected = await connectPaw({
      mode: 'remote',
      baseUrl: stub.url,
      log: () => {
        if (calls++ === 0) throw new Error('secret detail');
      },
    });
    const first = await connected.client.callTool({ name: 'paw_curse', arguments: { requirement: 'R' } });
    expect(first.isError).toBe(true);
    expect(textOf(first)).toBe('The Paw tool failed unexpectedly.');
    const second = await connected.client.callTool({ name: 'paw_curse', arguments: { requirement: 'R' } });
    expect(textOf(second)).toBe('x');
  });
});

describe('paw_bind with an unknown curse', () => {
  it.each(['curse-0', '3f2a9c1e:curse-0'])('%s with an empty memory: error, no API call', async (curse) => {
    stub = await startStub((_q, res) => sendJson(res, 200, {}));
    connected = await connectPaw({ mode: 'remote', baseUrl: stub.url });
    const result = await connected.client.callTool({ name: 'paw_bind', arguments: { curse, amendment: 'A.' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      `Unknown curse "${curse}". Call paw_curse first; handles last only while this server runs.`,
    );
    expect(stub.requests).toHaveLength(0);
  });

  it('a handle of another grant is unknown and cuts a long id to 60 characters', async () => {
    stub = await startStub((req, res) =>
      sendJson(res, 200, { wish: { id: 'w', text: 't', createdAt: 1 }, grant: makeGrant(WISH_ID) }),
    );
    connected = await connectPaw({ mode: 'remote', baseUrl: stub.url });
    await connected.client.callTool({ name: 'paw_curse', arguments: { requirement: 'R' } });
    const long = 'z'.repeat(90);
    const result = await connected.client.callTool({ name: 'paw_bind', arguments: { curse: long, amendment: 'A.' } });
    expect(textOf(result)).toContain(`"${'z'.repeat(60)}".`);
    expect(stub.requests).toHaveLength(1);
  });
});

describe('input limits: error names the field and the limit, no API call', () => {
  const cases: [string, string, Record<string, unknown>, string][] = [
    ['paw_curse', 'requirement of 501 characters', { requirement: 'x'.repeat(501) }, 'requirement must be at most 500 characters'],
    ['paw_curse', 'empty requirement', { requirement: '' }, 'requirement must not be empty'],
    ['paw_curse', 'blank requirement', { requirement: '   ' }, 'requirement must not be empty'],
    ['paw_curse', 'context of 201 characters', { requirement: 'R', context: 'c'.repeat(201) }, 'context must be at most 200 characters'],
    ['paw_bind', 'curse of 101 characters', { curse: 'c'.repeat(101), amendment: 'A' }, 'curse must be at most 100 characters'],
    ['paw_bind', 'empty curse', { curse: '', amendment: 'A' }, 'curse must not be empty'],
    ['paw_bind', 'amendment of 501 characters', { curse: 'curse-0', amendment: 'a'.repeat(501) }, 'amendment must be at most 500 characters'],
    ['paw_bind', 'empty amendment', { curse: 'curse-0', amendment: '' }, 'amendment must not be empty'],
  ];
  it.each(cases)('%s: %s', async (name, _label, args, expected) => {
    stub = await startStub((_q, res) => sendJson(res, 200, {}));
    connected = await connectPaw({ mode: 'remote', baseUrl: stub.url });
    const result = await connected.client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(expected);
    expect(stub.requests).toHaveLength(0);
  });

  it('accepts exactly 500 and 200 characters', async () => {
    const r = await callCurse((_q, res) => sendJson(res, 400, { message: 'reached the API' }));
    expect(r.text).toBe('reached the API');
    const result = await connected!.client.callTool({
      name: 'paw_curse',
      arguments: { requirement: 'x'.repeat(500), context: 'c'.repeat(200) },
    });
    expect(textOf(result)).toBe('reached the API');
  });
});
