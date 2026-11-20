import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { canCall } from 'paw-core';
import type { BudgetConfig, BudgetState } from 'paw-core';
import { checkBudget, clientKeyOf } from './middleware';
import { createGlobalState } from './state';

describe('Budget middleware (paw-core integration)', () => {
  const config: BudgetConfig = {
    perIpLimit: 3,
    windowMs: 1000, // 1 second for testing
    dailyBudgetCents: 500,
  };

  it('returns false when per-IP limit exceeded (Req 7.1, Task 10)', () => {
    const now = Date.now();
    const state: BudgetState = {
      ipCalls: 3,
      windowStart: now,
      spentCents: 100,
      dayStart: now,
    };

    // Already at limit (3 calls in current window)
    expect(canCall(state, config, now)).toBe(false);
  });

  it('returns false when daily budget exhausted (Req 7.6, Task 11)', () => {
    const now = Date.now();
    const state: BudgetState = {
      ipCalls: 1,
      windowStart: now,
      spentCents: 500, // At daily limit
      dayStart: now,
    };

    expect(canCall(state, config, now)).toBe(false);
  });

  it('resets per-IP counter after window elapses (Req 7.5, Task 12)', () => {
    const now = Date.now();
    const windowStart = now - 2000; // 2 seconds ago (past 1-second window)

    const state: BudgetState = {
      ipCalls: 3,
      windowStart,
      spentCents: 100,
      dayStart: now,
    };

    // Window has elapsed, counter should reset, so call is allowed
    expect(canCall(state, config, now)).toBe(true);
  });
});

describe('per-IP key from TRUSTED_PROXY_HOPS (task 111, Req 7.4)', () => {
  const PER_IP_LIMIT = 3;
  const config: BudgetConfig = {
    perIpLimit: PER_IP_LIMIT,
    windowMs: 60_000,
    dailyBudgetCents: 1_000_000,
  };

  /** A tiny app behind the real admission middleware; `request` sends one request. */
  function setup(hops?: number) {
    const app = new Hono();
    const state = createGlobalState(1_000_000);
    app.use('*', checkBudget(state, config, () => 1_000_000, hops));
    app.get('/', (c) => c.text('ok'));
    const request = async (forwardedFor: string | undefined, socket = '10.0.0.1') => {
      const headers: Record<string, string> = {};
      if (forwardedFor !== undefined) headers['x-forwarded-for'] = forwardedFor;
      const res = await app.request('http://localhost/', { headers }, {
        incoming: { socket: { remoteAddress: socket } },
      });
      return res.status;
    };
    return { request, state };
  }

  /** Statuses of `count` requests, each with the header that `header(i)` makes. */
  async function burst(
    request: (header: string | undefined, socket?: string) => Promise<number>,
    count: number,
    header: (i: number) => string | undefined,
    socket?: string,
  ) {
    const statuses: number[] = [];
    for (let i = 0; i < count; i++) statuses.push(await request(header(i), socket));
    return statuses;
  }

  const allowed = Array.from({ length: PER_IP_LIMIT }, () => 200);

  it('hops 1: a client that fakes a new leftmost entry on every request is still limited', async () => {
    const { request } = setup(1);
    const statuses = await burst(request, PER_IP_LIMIT + 3, (i) => `fake-${Math.random()}-${i}, 203.0.113.7`);
    expect(statuses).toEqual([...allowed, 503, 503, 503]);
  });

  it('hops 1 is the default', async () => {
    const { request } = setup();
    const statuses = await burst(request, PER_IP_LIMIT + 1, (i) => `fake-${i}, 203.0.113.7`);
    expect(statuses).toEqual([...allowed, 503]);
  });

  it('hops 1: different real addresses have separate limits', async () => {
    const { request } = setup(1);
    await burst(request, PER_IP_LIMIT, () => 'x, 203.0.113.7');
    expect(await request('x, 203.0.113.7')).toBe(503);
    expect(await request('x, 203.0.113.8')).toBe(200);
  });

  it('hops 0 ignores the header and uses the socket address', async () => {
    const { request } = setup(0);
    // A new header every time does not help: the socket is the same.
    const statuses = await burst(request, PER_IP_LIMIT + 1, (i) => `198.51.100.${i}, 203.0.113.${i}`);
    expect(statuses).toEqual([...allowed, 503]);
    // Another socket is another client, whatever the header says.
    expect(await request('203.0.113.0', '10.0.0.2')).toBe(200);
  });

  it('hops 2 takes the second entry from the right', async () => {
    const { request } = setup(2);
    // The leftmost entry is faked; the entry the outer proxy saw is second from the right.
    const statuses = await burst(request, PER_IP_LIMIT + 1, (i) => `fake-${i}, 203.0.113.7, 10.9.9.9`);
    expect(statuses).toEqual([...allowed, 503]);
    // The same second entry from the right is the same client, even with another rightmost entry.
    expect(await request('other, 203.0.113.7, 10.8.8.8')).toBe(503);
    // A different second entry from the right is a different client.
    expect(await request('fake, 203.0.113.99, 10.9.9.9')).toBe(200);
  });

  it('no header uses the socket address', async () => {
    const { request } = setup(1);
    expect(await burst(request, PER_IP_LIMIT + 1, () => undefined)).toEqual([...allowed, 503]);
    expect(await request(undefined, '10.0.0.2')).toBe(200);
  });

  it('a header with fewer entries than hops uses the socket address', async () => {
    const { request } = setup(2);
    // One entry, two hops: the header cannot be vouched for, so it never picks the key.
    const statuses = await burst(request, PER_IP_LIMIT + 1, (i) => `fake-${i}`);
    expect(statuses).toEqual([...allowed, 503]);
  });

  it('blank entries are ignored', async () => {
    const { request } = setup(1);
    const statuses = await burst(request, PER_IP_LIMIT + 1, (i) => `fake-${i}, 203.0.113.7, , `);
    expect(statuses).toEqual([...allowed, 503]);
  });

  it('an invalid hops value means 1', async () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { request } = setup(bad);
      const statuses = await burst(request, PER_IP_LIMIT + 1, (i) => `fake-${i}, 203.0.113.7`);
      expect(statuses, String(bad)).toEqual([...allowed, 503]);
    }
  });

  describe('clientKeyOf', () => {
    it.each([
      ['a, b, c', 1, 'c'],
      ['a, b, c', 2, 'b'],
      ['a, b, c', 3, 'a'],
      ['a, b, c', 4, 'SOCKET'],
      ['a, b, c', 0, 'SOCKET'],
      [undefined, 1, 'SOCKET'],
      ['', 1, 'SOCKET'],
      [' , ,', 1, 'SOCKET'],
      ['a,, b ,', 1, 'b'],
      ['a,, b ,', 2, 'a'],
    ] as const)('%j with hops %d is %s', (header, hops, expected) => {
      expect(clientKeyOf(header, 'SOCKET', hops)).toBe(expected);
    });

    it('without a socket address the key is unknown-ip', () => {
      expect(clientKeyOf(undefined, undefined, 1)).toBe('unknown-ip');
    });
  });
});
