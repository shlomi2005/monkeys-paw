import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportSpec } from 'paw-core';
import { createApp } from '../src/app';
import { FakeMeteredModel } from '../src/budget/fake-metered';
import { checkBudget } from '../src/budget/middleware';
import { createGlobalState } from '../src/budget/state';
import { isHarmfulWish } from '../src/guardrail';
import { READY_ROUNDS } from '../../web/src/state/ready-rounds';

const CAP = 196608;
const FIXTURE = fileURLToPath(new URL('./fixtures/examples-cache.json', import.meta.url));
const BUDGET = { perIpLimit: 10, windowMs: 60_000, dailyBudgetCents: 500 };
const GATE = { tier: 'free' as const, countryHeader: 'x-test-country' };
const GH = { 'x-test-country': 'US', 'x-paw-adult-confirmed': 'yes', 'content-type': 'application/json' };
const TOO_LARGE = { message: 'The request is too large.' };

afterEach(() => vi.restoreAllMocks());

const verdictModel = () =>
  new FakeMeteredModel({
    answer: async () => ({ curseId: 'c', closed: true, reason: 'Airtight.', judgedAt: 1 }),
  });

function mk(model: FakeMeteredModel = verdictModel(), budget = BUDGET) {
  return createApp({ model, budget, corsOrigin: 'https://paw.example', examplesCachePath: FIXTURE, gate: GATE });
}

/** A request whose body is pulled one chunk at a time; `pulled()` says how many bytes the server took. */
function streamed(path: string, headers: Record<string, string>, first = '') {
  let sent = 0;
  let pulledBytes = 0;
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>(
    {
      pull(ctrl) {
        if (sent >= 2_000_000) return ctrl.close();
        const chunk = sent === 0 && first ? enc.encode(first) : new Uint8Array(65536).fill(97);
        sent += chunk.byteLength;
        pulledBytes += chunk.byteLength;
        ctrl.enqueue(chunk);
      },
    },
    { highWaterMark: 0 },
  );
  const req = new Request(`http://paw.test${path}`, {
    method: 'POST',
    body,
    headers,
    duplex: 'half',
  } as RequestInit);
  return { req, pulled: () => pulledBytes };
}

const padded = (n: number) => {
  const head = '{"pad":"';
  const tail = '"}';
  return head + 'a'.repeat(n - head.length - tail.length) + tail;
};

const ROUTES = ['/api/grant', '/api/bind', '/api/export'];

describe('body cap (Req 15)', () => {
  for (const path of ROUTES) {
    for (const declared of [undefined, '10', '99999999']) {
      it(`${path}: streamed body over the cap, content-length ${declared ?? 'absent'}, is 413`, async () => {
        const app = mk();
        const headers: Record<string, string> = { ...GH, origin: 'https://paw.example' };
        if (declared) headers['content-length'] = declared;
        const { req, pulled } = streamed(path, headers);
        const res = await app.fetch(req);
        expect(res.status).toBe(413);
        expect(await res.json()).toEqual(TOO_LARGE);
        expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
        expect(pulled()).toBeLessThanOrEqual(CAP + 2 * 65536);
        expect(pulled()).toBeLessThan(1_000_000);
      });
    }
    it(`${path}: a small body with a huge declared length is 413`, async () => {
      const res = await mk().request(path, {
        method: 'POST',
        headers: { ...GH, 'content-length': '5000000' },
        body: '{}',
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual(TOO_LARGE);
    });
    it(`${path}: exactly ${CAP} bytes is read, one more is 413`, async () => {
      const app = mk();
      const ok = await app.request(path, { method: 'POST', headers: GH, body: padded(CAP) });
      expect(ok.status).toBe(400);
      const over = await app.request(path, { method: 'POST', headers: GH, body: padded(CAP + 1) });
      expect(over.status).toBe(413);
    });
  }

  it('a canary in an oversized body reaches no log line, and no error is logged', async () => {
    const lines: string[] = [];
    const grab = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
    const spies = (['log', 'error', 'warn', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(grab));
    const { req } = streamed('/api/export', GH, '{"canary":"CANARY-9f3a","pad":"');
    const res = await mk().fetch(req);
    expect(res.status).toBe(413);
    expect(lines.some((l) => l.includes('CANARY-9f3a'))).toBe(false);
    expect(spies[1]).not.toHaveBeenCalled();
  });

  it('every POST route answers 413 to an oversized body', async () => {
    const app = mk();
    const paths = [...new Set(app.routes.filter((r) => r.method === 'POST').map((r) => r.path))];
    expect(paths.length).toBeGreaterThanOrEqual(3);
    for (const path of paths) {
      const { req } = streamed(path, GH);
      expect((await app.fetch(req)).status, path).toBe(413);
    }
  });
});

function listen(app: Hono) {
  return new Promise<{ server: ReturnType<typeof serve>; port: number }>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) =>
      resolve({ server, port: info.port }),
    );
  });
}

function raw(port: number, head: string, parts: Buffer[], abort = false) {
  return new Promise<string>((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    let acc = '';
    const done = () => {
      sock.destroy();
      resolve(acc);
    };
    sock.on('data', (d) => {
      acc += d.toString('latin1');
      if (acc.includes('\r\n\r\n') && acc.includes('}')) done();
    });
    sock.on('error', () => {});
    sock.on('close', done);
    sock.write(head);
    for (const p of parts) sock.write(p);
    if (abort) setTimeout(done, 20);
  });
}

describe('real HTTP (Req 15)', () => {
  it('refuses chunked and declared oversize uploads, survives aborted ones', async () => {
    const { server, port } = await listen(mk());
    try {
      const chunk = Buffer.alloc(65536, 97);
      const hex = (n: number) => `${n.toString(16)}\r\n`;
      const chunked = await raw(
        port,
        'POST /api/export HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n',
        Array.from({ length: 6 }, () => Buffer.concat([Buffer.from(hex(65536)), chunk, Buffer.from('\r\n')])),
      );
      expect(chunked).toContain(' 413 ');
      const declared = await raw(
        port,
        'POST /api/export HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 500000\r\n\r\n',
        [],
      );
      expect(declared).toContain(' 413 ');
      for (let i = 0; i < 10; i++) {
        await raw(
          port,
          'POST /api/export HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 150000\r\n\r\n',
          [chunk],
          true,
        );
      }
      expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    } finally {
      (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      server.close();
    }
  });
});

const S = (n: number) => '\u0001'.repeat(n);
const BIG = 1.7976931348623157e308;
const TYPES = ['permissions', 'time', 'money', 'scale', 'abuse'] as const;

function fullGrant() {
  const base = structuredClone(READY_ROUNDS[0].grant) as any;
  const curses = TYPES.map((type, i) => {
    const id = String(i) + S(99);
    return {
      id,
      type,
      story: S(360),
      loophole: S(1000),
      status: 'closed',
      binding: { curseId: id, kind: 'ears-clause', clause: S(1000), proposedAt: BIG },
      verdict: { curseId: id, closed: true, reason: S(1000), judgedAt: BIG, property: S(1000) },
    };
  });
  return { ...base, wishId: 'w' + S(99), narration: S(260), userStory: S(1000), wishCriterion: S(1000), curses };
}
const fullWish = () => ({ ...structuredClone(READY_ROUNDS[0].wish), id: 'w' + S(99), text: S(500), context: S(200), createdAt: BIG });
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

describe('the largest legitimate request fits (Req 15)', () => {
  it('export', async () => {
    const body = { wish: fullWish(), grant: fullGrant() };
    expect(bytes(body)).toBeLessThanOrEqual(CAP);
    expect(bytes(body)).toBeGreaterThan(150000);
    const res = await mk().request('/api/export', { method: 'POST', headers: GH, body: JSON.stringify(body) });
    expect(res.status).toBe(200);
  });
  it('bind', async () => {
    const grant = fullGrant();
    const body = { grant, curseId: grant.curses[0].id, kind: 'ears-clause', clause: S(1000) };
    expect(bytes(body)).toBeLessThanOrEqual(CAP);
    expect(bytes(body)).toBeGreaterThan(150000);
    const res = await mk().request('/api/bind', { method: 'POST', headers: GH, body: JSON.stringify(body) });
    expect(res.status).toBe(200);
  });
});

type Mutation = [string, (b: any) => void];
const GRANT_MUTATIONS: Mutation[] = [
  ['grant.wishId', (b) => (b.grant.wishId = 'a'.repeat(101))],
  ['grant.narration', (b) => (b.grant.narration = 'a'.repeat(261))],
  ['grant.userStory', (b) => (b.grant.userStory = 'a'.repeat(1001))],
  ['grant.wishCriterion', (b) => (b.grant.wishCriterion = 'a'.repeat(1001))],
  ['curse.id', (b) => (b.grant.curses[0].id = 'a'.repeat(101))],
  ['curse.story', (b) => (b.grant.curses[0].story = 'a'.repeat(361))],
  ['curse.loophole', (b) => (b.grant.curses[0].loophole = 'a'.repeat(1001))],
  ['binding.curseId', (b) => (b.grant.curses[0].binding.curseId = 'a'.repeat(101))],
  ['binding.clause', (b) => (b.grant.curses[0].binding.clause = 'a'.repeat(1001))],
  ['verdict.curseId', (b) => (b.grant.curses[0].verdict.curseId = 'a'.repeat(101))],
  ['verdict.reason', (b) => (b.grant.curses[0].verdict.reason = 'a'.repeat(1001))],
  ['verdict.property', (b) => (b.grant.curses[0].verdict.property = 'a'.repeat(1001))],
  ['6 curses', (b) => (b.grant.curses = Array.from({ length: 6 }, () => b.grant.curses[0]))],
  ['40000 curses', (b) => (b.grant.curses = Array.from({ length: 40000 }, () => ({})))],
];
const WISH_MUTATIONS: Mutation[] = [
  ['wish.id', (b) => (b.wish.id = 'a'.repeat(101))],
  ['wish.text', (b) => (b.wish.text = 'a'.repeat(501))],
  ['wish.context', (b) => (b.wish.context = 'a'.repeat(201))],
];

describe('field caps (Req 15)', () => {
  const exportBody = () => ({ wish: structuredClone(READY_ROUNDS[0].wish), grant: structuredClone(READY_ROUNDS[0].grant) });
  it('the unmutated export body is 200', async () => {
    const res = await mk().request('/api/export', { method: 'POST', headers: GH, body: JSON.stringify(exportBody()) });
    expect(res.status).toBe(200);
  });
  for (const [name, mutate] of [...WISH_MUTATIONS, ...GRANT_MUTATIONS]) {
    it(`export: ${name} over its cap is 400`, async () => {
      const b = exportBody();
      mutate(b);
      const res = await mk().request('/api/export', { method: 'POST', headers: GH, body: JSON.stringify(b) });
      expect(res.status).toBe(400);
    });
  }
  for (const [name, mutate] of GRANT_MUTATIONS) {
    it(`bind: ${name} over its cap is 400 and calls no model`, async () => {
      const model = verdictModel();
      const b: any = { ...exportBody(), kind: 'ears-clause', clause: 'WHEN a THE SYSTEM SHALL b.' };
      b.curseId = b.grant.curses[0].id;
      mutate(b);
      const res = await mk(model).request('/api/bind', { method: 'POST', headers: GH, body: JSON.stringify(b) });
      expect(res.status).toBe(400);
      expect(model.calls).toBe(0);
    });
  }
});

describe('what the server serves can be sent back (Req 15)', () => {
  const exp = (app: Hono, wish: unknown, grant: unknown) =>
    app.request('/api/export', { method: 'POST', headers: GH, body: JSON.stringify({ wish, grant }) });

  it('every ready round exports, as it is and with the curses open', async () => {
    const app = mk();
    for (const r of READY_ROUNDS) {
      expect((await exp(app, r.wish, r.grant)).status).toBe(200);
      const open = structuredClone(r.grant) as any;
      for (const c of open.curses) {
        delete c.binding;
        delete c.verdict;
        c.status = 'open';
      }
      expect((await exp(app, r.wish, open)).status).toBe(200);
    }
  });

  it('the examples fixture exports', async () => {
    const app = mk();
    for (const e of JSON.parse(readFileSync(FIXTURE, 'utf-8'))) expect((await exp(app, e.wish, e.grant)).status).toBe(200);
  });

  it('a long loophole, userStory, wishCriterion and an emoji at the cut still export and bind', async () => {
    const answer = async (prompt: string) => {
      if (prompt.includes('Task: GRANT_WISH')) {
        const loophole = 'x'.repeat(999) + '😀'.repeat(5);
        return {
          narration: 'Your wish is granted, exactly as stated.',
          userStory: 'U'.repeat(3000),
          wishCriterion: 'W'.repeat(3000),
          curses: ['permissions', 'time', 'scale'].map((type) => ({ id: 'x', type, story: 'Bad.', loophole })),
        };
      }
      if (prompt.includes('Task: JUDGE_BATCH_QUALITY')) {
        return [0, 1, 2].map((i) => ({ curseId: `curse-${i}`, specific: true, reason: 'Specific.' }));
      }
      return { curseId: 'c', closed: true, reason: 'Airtight.', judgedAt: 1 };
    };
    const app = mk(new FakeMeteredModel({ answer }));
    const g = await app.request('/api/grant', { method: 'POST', headers: GH, body: JSON.stringify({ wish: { text: 'Only the owner can delete a project' } }) });
    expect(g.status).toBe(200);
    const { wish, grant } = (await g.json()) as any;
    for (const c of grant.curses) expect(c.loophole.length).toBeLessThanOrEqual(1000);
    expect((grant.userStory ?? '').length).toBeLessThanOrEqual(1000);
    expect((await exp(app, wish, grant)).status).toBe(200);
    const bind = { grant, curseId: grant.curses[0].id, kind: 'ears-clause', clause: 'WHEN a THE SYSTEM SHALL b.' };
    expect((await app.request('/api/bind', { method: 'POST', headers: GH, body: JSON.stringify(bind) })).status).toBe(200);
  });
});

describe('only POST counts, after the gate (Req 15)', () => {
  const IP = '203.0.113.9';
  const wish = JSON.stringify({ wish: { text: 'Only the owner can delete a project' } });
  const grantModel = () =>
    new FakeMeteredModel({
      answer: async (prompt) => {
        if (prompt.includes('Task: GRANT_WISH')) {
          return {
            narration: 'Granted.',
            curses: ['permissions', 'time', 'scale'].map((type) => ({ id: 'x', type, story: 'Bad.', loophole: '"owner"' })),
          };
        }
        return [0, 1, 2].map((i) => ({ curseId: `curse-${i}`, specific: true, reason: 'Specific.' }));
      },
    });
  const setKeys = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => c[0]);

  it('GET, HEAD, PUT, PATCH and DELETE are never 503 and make no entry; then two POSTs pass and the third is refused', async () => {
    for (const available of [true, false]) {
      const model = available ? grantModel() : new FakeMeteredModel({ available: false });
      const app = mk(model, { ...BUDGET, perIpLimit: 2 });
      const spy = vi.spyOn(Map.prototype, 'set');
      try {
        for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']) {
          for (const path of ['/api/grant', '/api/bind']) {
            for (let i = 0; i < 3; i++) {
              const res = await app.request(path, { method, headers: { ...GH, 'x-forwarded-for': IP } });
              expect(res.status, `${method} ${path}`).not.toBe(503);
            }
          }
        }
        expect(setKeys(spy)).not.toContain(IP);
      } finally {
        spy.mockRestore();
      }
      if (!available) continue;
      const post = () => app.request('/api/grant', { method: 'POST', headers: { ...GH, 'x-forwarded-for': IP }, body: wish });
      expect((await post()).status).toBe(200);
      expect((await post()).status).toBe(200);
      expect((await post()).status).toBe(503);
    }
  });

  it('a POST the gate refuses makes no entry', async () => {
    const app = mk(grantModel(), { ...BUDGET, perIpLimit: 2 });
    const spy = vi.spyOn(Map.prototype, 'set');
    try {
      const res = await app.request('/api/grant', { method: 'POST', headers: { 'x-forwarded-for': IP }, body: wish });
      expect(res.status).toBe(403);
      expect(setKeys(spy)).not.toContain(IP);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the IP map is pruned (Req 15)', () => {
  const cfg = { perIpLimit: 10, windowMs: 60_000, dailyBudgetCents: 500 };
  function small() {
    const state = createGlobalState(0);
    let now = 0;
    const app = new Hono();
    app.post('/x', checkBudget(state, cfg, () => now, 1), (c) => c.json({}));
    const hit = (key: string) => app.request('/x', { method: 'POST', headers: { 'x-forwarded-for': key } });
    return { state, hit, at: (t: number) => void (now = t) };
  }
  it('1000 IPs, a window later, one more leaves one entry', async () => {
    const { state, hit, at } = small();
    for (let i = 0; i < 1000; i++) await hit(`10.0.${i >> 8}.${i & 255}`);
    expect(state.ipStates.size).toBe(1000);
    at(60_000);
    await hit('10.9.9.9');
    expect(state.ipStates.size).toBe(1);
  });
  it('keeps the young', async () => {
    const { state, hit, at } = small();
    await hit('a');
    await hit('b');
    at(40_000);
    await hit('c');
    at(70_000);
    await hit('d');
    expect([...state.ipStates.keys()]).toEqual(['c', 'd']);
  });
  it('stores a 5000-character forwarded key as 64', async () => {
    const { state, hit } = small();
    await hit('k'.repeat(5000));
    expect([...state.ipStates.keys()].map((k) => k.length)).toEqual([64]);
  });
});

describe('linear trims (Req 15)', () => {
  it('exportSpec on a wish of 80000 dots', () => {
    const { wish, grant: ready } = READY_ROUNDS[0];
    const { wishCriterion: _skipped, ...grant } = ready;
    const t = performance.now();
    exportSpec({ ...wish, text: '.'.repeat(80000) + 'a' }, grant);
    expect(performance.now() - t).toBeLessThan(500);
  });
  it('isHarmfulWish on a run of apostrophes', () => {
    const t = performance.now();
    isHarmfulWish('a' + "'".repeat(80000) + "b'");
    expect(performance.now() - t).toBeLessThan(500);
  });
});
