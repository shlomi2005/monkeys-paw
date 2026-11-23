// paw-power Requirement 26 and D25: the age confirmation in remote mode. A fake `fetch`, no network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_MESSAGES, MSG_ADULT, MSG_REGION } from '../src/api-client';
import type { CallLogger } from '../src/call-log';
import { adultConfirmedOf } from '../src/mode';
import { PAW_MCP_VERSION } from '../src/version';
import { makeGrant } from './fixtures';

const RESTING = 'The paw is resting. Browse the examples until it wakes.';
const MSG_RESTING = API_MESSAGES.get(RESTING) as string;
import { connectPaw, textOf, type Connected } from './stub-api';

const WISH_ID = '3f2a9c1e-0000-4000-8000-000000000001';
const HEADER = 'x-paw-adult-confirmed';
const CLAUSE = 'WHEN the owner leaves, THE SYSTEM SHALL name a successor.';

interface Seen {
  path: string;
  headers: Record<string, string>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fetch that records each call and answers by path. */
function fakeFetch(answer: (path: string) => Response) {
  const seen: Seen[] = [];
  const fn = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const path = new URL(String(input)).pathname;
    seen.push({ path, headers: { ...(init?.headers ?? {}) } });
    return answer(path);
  }) as unknown as typeof fetch;
  return { fn, seen };
}

const grantOk = () => json(200, { wish: { id: 'w1', text: 'R', createdAt: 1 }, grant: makeGrant(WISH_ID, 4) });

let connected: Connected | undefined;
afterEach(async () => {
  await connected?.close();
  connected = undefined;
  vi.restoreAllMocks();
});

async function connect(fn: typeof fetch, adultConfirmed?: boolean, log?: CallLogger) {
  connected = await connectPaw({
    mode: 'remote',
    baseUrl: 'http://paw.test',
    fetchFn: fn,
    ...(adultConfirmed === undefined ? {} : { adultConfirmed }),
    ...(log ? { log } : {}),
  });
  return connected.client;
}

const curse = (client: Connected['client']) =>
  client.callTool({ name: 'paw_curse', arguments: { requirement: 'Only the owner can delete a project.' } });
const bind = (client: Connected['client']) =>
  client.callTool({ name: 'paw_bind', arguments: { curse: '3f2a9c1e:curse-2', amendment: CLAUSE } });

describe('adultConfirmedOf: only the exact value yes counts', () => {
  it.each([
    ['unset', undefined],
    ['Yes', 'Yes'],
    ['YES', 'YES'],
    [' yes', ' yes'],
    ['yes ', 'yes '],
    ['true', 'true'],
    ['1', '1'],
    ['empty', ''],
  ])('%s is not a confirmation', (_name, raw) => {
    expect(adultConfirmedOf(raw)).toBe(false);
  });

  it('yes is', () => {
    expect(adultConfirmedOf('yes')).toBe(true);
  });
});

describe('the header on paw_curse and paw_bind', () => {
  it('is sent on both tools when confirmed, with the two usual headers', async () => {
    const { fn, seen } = fakeFetch((path) => (path === '/api/grant' ? grantOk() : json(500, { message: 'stop' })));
    const client = await connect(fn, true);
    await curse(client);
    await bind(client);
    expect(seen.map((s) => s.path)).toEqual(['/api/grant', '/api/bind']);
    for (const s of seen) {
      expect(s.headers[HEADER]).toBe('yes');
      expect(s.headers['content-type']).toBe('application/json');
      expect(s.headers.accept).toBe('application/json');
      expect(Object.keys(s.headers).sort()).toEqual(['accept', 'content-type', 'user-agent', HEADER]);
    }
  });

  it('sends user-agent paw-mcp/<version> exactly once on grant and on bind', async () => {
    const { fn, seen } = fakeFetch((path) => (path === '/api/grant' ? grantOk() : json(500, { message: 'stop' })));
    const client = await connect(fn);
    await curse(client);
    await bind(client);
    expect(seen.map((s) => s.path)).toEqual(['/api/grant', '/api/bind']);
    for (const s of seen) {
      const names = Object.keys(s.headers).filter((k) => k.toLowerCase() === 'user-agent');
      expect(names).toEqual(['user-agent']);
      expect(s.headers['user-agent']).toBe(`paw-mcp/${PAW_MCP_VERSION}`);
    }
  });

  it.each([['not set', undefined], ['false', false]])('is absent when the confirmation is %s', async (_name, value) => {
    const { fn, seen } = fakeFetch((path) => (path === '/api/grant' ? grantOk() : json(500, { message: 'stop' })));
    const client = await connect(fn, value);
    await curse(client);
    await bind(client);
    expect(seen).toHaveLength(2);
    for (const s of seen) expect(Object.keys(s.headers).sort()).toEqual(['accept', 'content-type', 'user-agent']);
  });
});

describe('local mode', () => {
  it('with the confirmation set still has three tools and makes no network call', async () => {
    const { fn, seen } = fakeFetch(() => json(500, { message: 'must not be called' }));
    const real = globalThis.fetch;
    const globalFetch = vi.fn(() => {
      throw new Error('no network in local mode');
    });
    globalThis.fetch = globalFetch as unknown as typeof fetch;
    try {
      connected = await connectPaw({ mode: 'local', fetchFn: fn, adultConfirmed: true });
      const tools = (await connected.client.listTools()).tools.map((t) => t.name).sort();
      expect(tools).toEqual(['paw_check_curses', 'paw_check_verdict', 'paw_rules']);
      const rules = await connected.client.callTool({ name: 'paw_rules', arguments: { kind: 'curse' } });
      expect(rules.isError).toBeFalsy();
    } finally {
      globalThis.fetch = real;
    }
    expect(seen).toHaveLength(0);
    expect(globalFetch).not.toHaveBeenCalled();
  });
});

describe('403 with a gate code', () => {
  const SERVER_WORDS = 'Words of the server that the tool must not repeat.';

  it.each([
    ['live_region_unavailable', MSG_REGION],
    ['adult_confirmation_required', MSG_ADULT],
  ])('%s gives the fixed text on paw_curse', async (code, text) => {
    const { fn } = fakeFetch(() => json(403, { code, message: SERVER_WORDS }));
    const result = await curse(await connect(fn, false));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(text);
  });

  it.each([
    ['live_region_unavailable', MSG_REGION],
    ['adult_confirmation_required', MSG_ADULT],
  ])('%s gives the fixed text on paw_bind', async (code, text) => {
    const { fn } = fakeFetch((path) => (path === '/api/grant' ? grantOk() : json(403, { code, message: SERVER_WORDS })));
    const client = await connect(fn, true);
    await curse(client);
    const result = await bind(client);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(text);
  });

  it('a known code gives the fixed text even when the body has no message', async () => {
    const { fn } = fakeFetch(() => json(403, { code: 'live_region_unavailable' }));
    const result = await curse(await connect(fn, true));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(MSG_REGION);
  });

  it('the fixed texts say what the user must do, and that the agent must not', () => {
    expect(MSG_REGION).toBe(
      'The paw grants no live wishes from here. The three local tools still work: paw_rules, paw_check_curses and paw_check_verdict.',
    );
    expect(MSG_ADULT).toContain('Only the user can confirm');
    expect(MSG_ADULT).toContain('PAW_I_AM_18_OR_OLDER=yes');
    expect(MSG_ADULT).toContain('Do not set it for them.');
  });

  it('any other 403, and a known code on another status, follows the usual rules', async () => {
    const cases: [number, unknown, string][] = [
      [403, { message: 'Forbidden by the host.' }, 'The Paw API answered HTTP 403.'],
      [403, { code: 'something_else', message: 'Some other refusal.' }, 'The Paw API answered HTTP 403.'],
      [403, 'plain text', 'The Paw API answered HTTP 403.'],
      [400, { code: 'adult_confirmation_required', message: 'Wish text cannot be empty' }, 'The Paw API answered HTTP 400.'],
      [503, { code: 'live_region_unavailable', message: RESTING }, MSG_RESTING],
    ];
    for (const [status, body, expected] of cases) {
      const { fn } = fakeFetch(() => json(status, body));
      const result = await curse(await connect(fn, true));
      expect(result.isError, `${status} ${JSON.stringify(body)}`).toBe(true);
      expect(textOf(result)).toBe(expected);
      await connected?.close();
      connected = undefined;
    }
  });
});

describe('what is never logged', () => {
  it('neither the value of the variable nor the response body reaches the logger or the console', async () => {
    const SECRET_BODY = 'Secret words of the response body.';
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const logged: [string, number | string, number][] = [];
    const log: CallLogger = (tool, outcome, ms) => void logged.push([tool, outcome, ms]);

    for (const code of ['live_region_unavailable', 'adult_confirmation_required']) {
      const { fn } = fakeFetch(() => json(403, { code, message: SECRET_BODY }));
      await curse(await connect(fn, true, log));
      await connected?.close();
      connected = undefined;
    }

    const everything = JSON.stringify([logged, spies.flatMap((s) => s.mock.calls)]);
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.every((entry) => entry[0] === 'paw_curse' && entry[1] === 403)).toBe(true);
    expect(everything).not.toContain(SECRET_BODY);
    expect(everything).not.toContain('yes');
    expect(everything).not.toContain('PAW_I_AM_18_OR_OLDER');
  });
});
