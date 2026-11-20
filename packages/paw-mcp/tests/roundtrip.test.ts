import type { Grant } from 'paw-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectPaw, sendJson, startStub, textOf, type Connected, type Stub } from './stub-api';
import { makeGrant } from './fixtures';

const WISH_ID = '3f2a9c1e-0000-4000-8000-000000000001';
const REQUIREMENT = 'Only the owner can delete a project.';

let stub: Stub;
let connected: Connected;
let verdictClosed = true;
const logged: [string, number | string, number][] = [];

function closeCurse(grant: Grant, curseId: string): Grant {
  return {
    ...grant,
    curses: grant.curses.map((c) => (c.id === curseId ? { ...c, status: 'closed' as const } : c)),
  };
}

beforeEach(async () => {
  logged.length = 0;
  verdictClosed = true;
  stub = await startStub((req, res) => {
    if (req.path === '/api/grant') {
      sendJson(res, 200, {
        wish: { id: 'w1', text: REQUIREMENT, createdAt: 1 },
        grant: makeGrant(WISH_ID, 4),
      });
    } else if (req.path === '/api/bind') {
      const body = req.body as { grant: Grant; curseId: string };
      const closed = verdictClosed;
      sendJson(res, 200, {
        grant: closed ? closeCurse(body.grant, body.curseId) : body.grant,
        verdict: {
          curseId: body.curseId,
          closed,
          reason: closed ? 'The clause names a successor.' : 'The clause still names no successor',
          judgedAt: 2,
          ...(closed ? { property: 'For every owner exit, some user may delete the project.' } : {}),
        },
      });
    } else {
      sendJson(res, 404, { message: 'nope' });
    }
  });
  connected = await connectPaw({
    mode: 'remote',
    baseUrl: stub.url,
    log: (tool, status, ms) => logged.push([tool, status, ms]),
  });
});

afterEach(async () => {
  await connected.close();
  await stub.close();
});

async function curse(): Promise<{ text: string; structured: Record<string, unknown> }> {
  const result = await connected.client.callTool({
    name: 'paw_curse',
    arguments: { requirement: `  ${REQUIREMENT}  `, context: ' A project tool. ' },
  });
  expect(result.isError).toBeFalsy();
  return { text: textOf(result), structured: result.structuredContent as Record<string, unknown> };
}

describe('paw_curse then paw_bind', () => {
  it('sends the wish and returns every curse with a handle', async () => {
    const { text, structured } = await curse();
    expect(stub.requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/grant',
      body: { wish: { text: REQUIREMENT, context: 'A project tool.' } },
    });
    expect(text.startsWith('The paw grants it. 4 loopholes:')).toBe(true);
    expect(text).toContain('[3f2a9c1e:curse-0] permissions: Story 0');
    expect(text).toContain('  Loophole: Loophole 3.');
    expect(text.split('\n').at(-1)).toBe(
      'Close one: paw_bind(curse="3f2a9c1e:curse-0", amendment="WHEN ... THE SYSTEM SHALL ...")',
    );
    expect(structured.wishId).toBe(WISH_ID);
    expect(structured.narration).toBe('Granted. Exactly.');
    const curses = structured.curses as { handle: string; id: string; status: string; type: string }[];
    expect(curses.map((c) => c.handle)).toEqual([0, 1, 2, 3].map((n) => `3f2a9c1e:curse-${n}`));
    expect(curses[0]).toMatchObject({ id: 'curse-0', type: 'permissions', status: 'open' });
  });

  it('omits an empty context from the request', async () => {
    await connected.client.callTool({ name: 'paw_curse', arguments: { requirement: 'R', context: '   ' } });
    expect(stub.requests[0]?.body).toEqual({ wish: { text: 'R' } });
  });

  it('sends only content-type and accept, no key, token or cookie', async () => {
    await curse();
    const h = stub.requests[0]!.headers;
    expect(h['content-type']).toBe('application/json');
    expect(h.accept).toBe('application/json');
    for (const name of ['authorization', 'cookie', 'x-api-key', 'proxy-authorization']) {
      expect(h[name]).toBeUndefined();
    }
  });

  it('bind closed: the stub sees the whole grant, the curseId and the clause', async () => {
    await curse();
    const result = await connected.client.callTool({
      name: 'paw_bind',
      arguments: { curse: '3f2a9c1e:curse-2', amendment: '  WHEN the owner leaves, THE SYSTEM SHALL name a successor.  ' },
    });
    expect(result.isError).toBeFalsy();
    const sent = stub.requests[1]!;
    expect(sent.path).toBe('/api/bind');
    expect(sent.body).toEqual({
      grant: makeGrant(WISH_ID, 4),
      curseId: 'curse-2',
      kind: 'ears-clause',
      clause: 'WHEN the owner leaves, THE SYSTEM SHALL name a successor.',
    });
    const text = textOf(result);
    expect(text.startsWith('CLOSED: The clause names a successor.')).toBe(true);
    expect(text).toContain('Property: For every owner exit, some user may delete the project.');
    expect(text).toContain('Still open: [3f2a9c1e:curse-0], [3f2a9c1e:curse-1], [3f2a9c1e:curse-3]');
    expect(result.structuredContent).toEqual({
      handle: '3f2a9c1e:curse-2',
      closed: true,
      reason: 'The clause names a successor.',
      property: 'For every owner exit, some user may delete the project.',
      openHandles: ['3f2a9c1e:curse-0', '3f2a9c1e:curse-1', '3f2a9c1e:curse-3'],
    });
  });

  it('bind accepts a handle copied with its brackets', async () => {
    await curse();
    const result = await connected.client.callTool({
      name: 'paw_bind',
      arguments: { curse: '[3f2a9c1e:curse-1]', amendment: 'WHEN the owner leaves, THE SYSTEM SHALL name a successor.' },
    });
    expect(result.isError).toBeFalsy();
    expect(stub.requests[1]!.body).toMatchObject({ curseId: 'curse-1' });
    expect(result.structuredContent).toMatchObject({ handle: '3f2a9c1e:curse-1', closed: true });
  });

  it('bind open is a normal result that says the loophole remains', async () => {
    await curse();
    verdictClosed = false;
    const result = await connected.client.callTool({
      name: 'paw_bind',
      arguments: { curse: 'curse-0', amendment: 'Make it better.', kind: 'rewrite' },
    });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text.startsWith('OPEN: The clause still names no successor.')).toBe(true);
    expect(text).toContain('The loophole remains.');
    expect(stub.requests[1]?.body).toMatchObject({ curseId: 'curse-0', kind: 'rewrite', clause: 'Make it better.' });
    expect(result.structuredContent).toMatchObject({ handle: '3f2a9c1e:curse-0', closed: false });
    expect((result.structuredContent as { property?: string }).property).toBeUndefined();
  });

  it('replaces the stored grant with the returned one', async () => {
    await curse();
    await connected.client.callTool({
      name: 'paw_bind',
      arguments: { curse: '3f2a9c1e:curse-1', amendment: 'First clause.' },
    });
    await connected.client.callTool({
      name: 'paw_bind',
      arguments: { curse: 'curse-3', amendment: 'Second clause.' },
    });
    const second = stub.requests[2]!.body as { grant: Grant };
    expect(second.grant.curses.map((c) => c.status)).toEqual(['open', 'closed', 'open', 'open']);
  });

  it('logs the tool, the status and the duration only', async () => {
    await curse();
    expect(logged).toHaveLength(1);
    const [tool, status, ms] = logged[0]!;
    expect([tool, status]).toEqual(['paw_curse', 200]);
    expect(typeof ms).toBe('number');
    expect(JSON.stringify(logged)).not.toContain('owner');
  });
});
