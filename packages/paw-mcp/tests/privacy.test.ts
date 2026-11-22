import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { inspect } from 'node:util';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { BUNDLE_OUT } from '../scripts/build-bundle.mjs';
import { createPawServer } from '../src/server';
import { makeGrant } from './fixtures';
import { connectPaw, type Connected } from './stub-api';
import { sendJson, startStub, type Stub } from './stub-http';

/**
 * Privacy (paw-power Requirement 6.2): no text that came from a caller, a model or an upstream may
 * reach stdout, stderr, a log call or an error answer (an `isError` result or a JSON-RPC error).
 *
 * Each case carries a random canary: 24 to 32 random letters with no vowels and no hex letters,
 * an uppercase variant and 15 digits. A canary "appears" when any 7-character window of it appears,
 * whatever the case. Only fake, ASCII text. On a failure nothing that was captured is printed.
 */

const WINDOW = 7;
const WISH_ID = '3f2a9c1e-0000-4000-8000-000000000001';

interface Canary {
  lower: string;
  upper: string;
  digits: string;
}

const LETTERS = 'ghjklmnpqrstvwxz'.split('');
const canaryArb: fc.Arbitrary<Canary> = fc
  .record({
    lower: fc.array(fc.constantFrom(...LETTERS), { minLength: 24, maxLength: 32 }).map((a) => a.join('')),
    digits: fc
      .tuple(fc.integer({ min: 1, max: 9 }), fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 14, maxLength: 14 }))
      .map(([first, rest]) => `${first}${rest.join('')}`),
  })
  .map(({ lower, digits }) => ({ lower, upper: lower.toUpperCase(), digits }));

function leaks(text: string, canary: Canary): boolean {
  const haystack = text.toLowerCase();
  for (const full of [canary.lower, canary.upper, canary.digits]) {
    const needle = full.toLowerCase();
    for (let i = 0; i + WINDOW <= needle.length; i++) {
      if (haystack.includes(needle.slice(i, i + WINDOW))) return true;
    }
  }
  return false;
}

/** Console and the two streams, formatted with util.inspect and showHidden. Restored in `finally`. */
async function capturing<T>(fn: (seen: string[]) => Promise<T>): Promise<T> {
  const seen: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const originals = methods.map((method) => console[method]);
  const out = process.stdout.write;
  const err = process.stderr.write;
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      seen.push(args.map((arg) => inspect(arg, { showHidden: true, depth: 8 })).join(' '));
    };
  }
  const grab = (chunk: unknown): boolean => {
    seen.push(typeof chunk === 'string' ? chunk : inspect(chunk));
    return true;
  };
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  try {
    return await fn(seen);
  } finally {
    methods.forEach((method, i) => {
      console[method] = originals[i] as never;
    });
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function items(c: Canary, type: (i: number) => unknown, text: (i: number) => unknown) {
  return [0, 1, 2].map((i) => ({ type: type(i), story: text(i), loophole: text(i), [c.lower]: c.upper }));
}

/** A value for a field: right and wrong types, short and long, as a JSON string or not. */
function valueOf(c: Canary, which: number): unknown {
  const types = ['permissions', 'time', 'money'];
  const values: unknown[] = [
    c.lower,
    c.upper,
    `${c.lower}${'a'.repeat(600)}`,
    Number(c.digits),
    null,
    true,
    [c.lower],
    { [c.lower]: c.upper },
    JSON.stringify(items(c, () => c.lower, () => c.lower)),
    JSON.stringify({ type: c.lower, story: c.lower, loophole: c.lower }),
    `${c.lower}{`,
    undefined,
    '',
    `   ${c.lower}`,
    [],
    { type: 'permissions', story: c.lower, loophole: c.lower },
    items(c, () => c.lower, () => c.lower),
    items(c, (i) => types[i], () => c.lower),
    items(c, () => 'time', () => c.lower),
    items(c, (i) => types[i], () => `${c.lower}${'b'.repeat(1200)}`),
    { closed: true, reason: c.lower, property: c.lower },
    { closed: c.lower, reason: 5, [c.upper]: c.lower },
    { id: c.lower, type: 'permissions', story: 's', loophole: 'l', status: c.lower },
    { id: '', type: c.upper, story: c.lower, loophole: null },
    'ears-clause',
    'rewrite',
  ];
  return values[which % values.length];
}

const FIELDS: Record<string, string[]> = {
  paw_rules: ['kind'],
  paw_check_curses: ['requirement', 'curses'],
  paw_check_verdict: ['curse', 'amendment', 'kind', 'verdict'],
  paw_curse: ['requirement', 'context'],
  paw_bind: ['curse', 'amendment', 'kind'],
};

const argsCaseArb = fc.record({
  canary: canaryArb,
  tool: fc.constantFrom(...Object.keys(FIELDS)),
  picks: fc.array(fc.nat(60), { minLength: 4, maxLength: 4 }),
  extraKey: fc.boolean(),
});

function argsOf(s: { canary: Canary; tool: string; picks: number[]; extraKey: boolean }): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  FIELDS[s.tool].forEach((field, i) => {
    const value = valueOf(s.canary, s.picks[i]);
    if (value !== undefined) args[field] = value;
  });
  if (s.extraKey) args[s.canary.lower] = { [s.canary.upper]: s.canary.lower };
  return args;
}

// ---------------------------------------------------------------------------
// What the upstream does
// ---------------------------------------------------------------------------

const UPSTREAM = [
  'json-message',
  'text-body',
  'throw-error',
  'throw-forged',
  'throw-string',
  'weird-status',
  'ok-wrong-shape',
  'gate-code',
] as const;
const STATUSES = [400, 403, 404, 429, 500, 502, 503];

interface Scenario {
  kind: (typeof UPSTREAM)[number] | 'grant-ok';
  status: number;
  canary: Canary;
}

function upstreamFetch(current: { value: Scenario }): typeof fetch {
  return (async () => {
    const { kind, status, canary: c } = current.value;
    switch (kind) {
      case 'grant-ok':
        return new Response(
          JSON.stringify({ wish: { id: 'w1', text: 'R', createdAt: 1 }, grant: makeGrant(WISH_ID, 4) }),
          { status: 200 },
        );
      case 'json-message':
        return new Response(JSON.stringify({ message: c.lower, code: c.upper, error: c.lower }), {
          status,
          statusText: c.lower,
        });
      case 'text-body':
        return new Response(c.lower, { status, statusText: c.upper });
      case 'throw-error':
        throw new Error(c.lower);
      case 'throw-forged': {
        const err = new Error(c.lower);
        err.name = c.upper;
        throw err;
      }
      case 'throw-string':
        throw c.lower;
      case 'weird-status':
        return { ok: false, status: c.lower, text: async () => c.lower } as unknown as Response;
      case 'ok-wrong-shape':
        return new Response(JSON.stringify({ wish: c.lower, grant: { wishId: c.lower, [c.upper]: c.lower } }), {
          status: 200,
        });
      case 'gate-code':
        return new Response(JSON.stringify({ code: c.lower, message: c.lower }), { status: 403 });
    }
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

let connected: Connected | undefined;
let stub: Stub | undefined;
let child: ChildProcessWithoutNullStreams | undefined;

afterEach(async () => {
  await connected?.close();
  connected = undefined;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child!.once('exit', resolve));
    child.kill();
    await exited;
  }
  child = undefined;
  await stub?.close();
  stub = undefined;
});

/** The text of an error answer, whichever way the client got it. */
async function errorTextOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    const result = (await run()) as { isError?: boolean; content?: { text?: string }[] };
    if (!result.isError) return undefined;
    return (result.content ?? []).map((part) => part.text ?? '').join('\n');
  } catch (err) {
    const e = err as { message?: unknown; data?: unknown };
    return `${String(e.message)}\n${JSON.stringify(e.data ?? null)}`;
  }
}

describe('privacy: tool arguments, tool names and upstream answers', () => {
  it('the capture itself sees a console line and a stream write', async () => {
    await capturing(async (seen) => {
      console.log('one');
      process.stderr.write('two');
      expect(seen.length).toBe(2);
    });
  });

  it('every argument of all five tools, right and wrong, short and long', async () => {
    await capturing(async (seen) => {
      const logged: string[] = [];
      const current = { value: { kind: 'grant-ok', status: 200, canary: { lower: '', upper: '', digits: '' } } as Scenario };
      connected = await connectPaw({
        mode: 'remote',
        baseUrl: 'http://127.0.0.1:9',
        fetchFn: upstreamFetch(current),
        log: (...args) => void logged.push(inspect(args)),
      });
      const { client } = connected;
      await fc.assert(
        fc.asyncProperty(argsCaseArb, async (s) => {
          const from = seen.length;
          const before = logged.length;
          const text = await errorTextOf(() => client.callTool({ name: s.tool, arguments: argsOf(s) }));
          if (text !== undefined) expect(leaks(text, s.canary), 'a canary window reached an error answer').toBe(false);
          expect(leaks(logged.slice(before).join('\n'), s.canary), 'a canary window reached the log').toBe(false);
          expect(leaks(seen.slice(from).join('\n'), s.canary), 'a canary window reached a stream').toBe(false);
        }),
        { numRuns: 300 },
      );
      expect(logged.length).toBeGreaterThan(0);
    });
  }, 60_000);

  it('the canary as a tool name, and the names of the prototype', async () => {
    await capturing(async (seen) => {
      connected = await connectPaw({ mode: 'remote', baseUrl: 'http://127.0.0.1:9' });
      const { client } = connected;
      await fc.assert(
        fc.asyncProperty(canaryArb, fc.nat(6), async (c, which) => {
          const names = [c.lower, c.upper, `paw_${c.lower}`, 'constructor', '__proto__', `${c.lower} not found`, `paw_bind${c.lower}`];
          const from = seen.length;
          const text = await errorTextOf(() => client.callTool({ name: names[which], arguments: { [c.lower]: c.upper } }));
          expect(text, 'an unknown tool is an error answer').toBeDefined();
          expect(leaks(text ?? '', c), 'a canary window reached an error answer').toBe(false);
          expect(leaks(seen.slice(from).join('\n'), c), 'a canary window reached a stream').toBe(false);
        }),
        { numRuns: 80 },
      );
    });
  });

  it('the canary as an upstream message, body, code, status text, status and thrown fetch error', async () => {
    await capturing(async (seen) => {
      const logged: string[] = [];
      const current = { value: { kind: 'grant-ok', status: 200, canary: { lower: '', upper: '', digits: '' } } as Scenario };
      connected = await connectPaw({
        mode: 'remote',
        baseUrl: 'http://127.0.0.1:9',
        fetchFn: upstreamFetch(current),
        log: (...args) => void logged.push(inspect(args)),
      });
      const { client } = connected;
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            canary: canaryArb,
            kind: fc.constantFrom(...UPSTREAM),
            status: fc.constantFrom(...STATUSES),
            tool: fc.constantFrom('paw_curse', 'paw_bind'),
          }),
          async ({ canary, kind, status, tool }) => {
            const from = seen.length;
            const before = logged.length;
            let args: Record<string, unknown> = { requirement: 'R' };
            if (tool === 'paw_bind') {
              current.value = { kind: 'grant-ok', status: 200, canary };
              await client.callTool({ name: 'paw_curse', arguments: { requirement: 'R' } });
              args = { curse: 'curse-0', amendment: 'A.', kind: 'rewrite' };
            }
            current.value = { kind, status, canary };
            const text = await errorTextOf(() => client.callTool({ name: tool, arguments: args }));
            expect(text, 'an upstream failure is an error answer').toBeDefined();
            expect(leaks(text ?? '', canary), 'a canary window reached an error answer').toBe(false);
            expect(leaks(logged.slice(before).join('\n'), canary), 'a canary window reached the log').toBe(false);
            expect(leaks(seen.slice(from).join('\n'), canary), 'a canary window reached a stream').toBe(false);
          },
        ),
        { numRuns: 120 },
      );
    });
  }, 60_000);
});

describe('privacy: raw JSON-RPC', () => {
  it('error answers to bad params, bad methods and a bad initialize have a fixed message and no data', async () => {
    await capturing(async (seen) => {
      const server = createPawServer({ mode: 'local' });
      const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
      const received: Record<string, unknown>[] = [];
      let nextId = 1000;
      clientSide.onmessage = (message) => void received.push(message as unknown as Record<string, unknown>);
      await server.connect(serverSide);
      await clientSide.start();
      try {
        await fc.assert(
          fc.asyncProperty(canaryArb, fc.nat(7), async (c, which) => {
            const id = nextId++;
            const requests: Array<{ method: string; params?: unknown }> = [
              {
                method: 'initialize',
                params: {
                  protocolVersion: '2025-06-18',
                  capabilities: {},
                  clientInfo: { name: 'x', version: '1', icons: [{ src: 'https://example.invalid/i.png', theme: c.lower }] },
                },
              },
              { method: 'initialize', params: { protocolVersion: c.lower, capabilities: c.upper, clientInfo: c.lower } },
              { method: 'tools/call', params: { name: Number(c.digits), arguments: c.lower } },
              { method: 'tools/call', params: { name: c.lower, arguments: { [c.lower]: c.upper } } },
              { method: 'tools/call', params: { name: 'paw_rules', arguments: { kind: c.lower }, _meta: { progressToken: { a: c.lower } } } },
              { method: c.lower, params: { [c.upper]: c.lower } },
              { method: 'tools/list', params: { cursor: Number(c.digits) } },
              { method: 'tools/call', params: c.lower },
            ];
            const from = seen.length;
            await clientSide.send({ jsonrpc: '2.0', id, ...requests[which] } as never);
            // A request whose envelope is not JSON-RPC (a bad _meta, params that are not an object) is not answered at all.
            const unanswered = which === 4 || which === 7;
            for (let i = 0; i < (unanswered ? 10 : 200) && !received.some((m) => m.id === id); i++) {
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
            const answer = received.find((m) => m.id === id);
            if (unanswered) expect(answer, 'no answer for a request that is not JSON-RPC').toBeUndefined();
            else expect(answer, 'the server answered').toBeDefined();
            const error = (answer as { error?: { message?: unknown; data?: unknown } } | undefined)?.error;
            if (error) {
              expect(error.data).toBeUndefined();
              expect(leaks(JSON.stringify(error), c), 'a canary window reached a JSON-RPC error').toBe(false);
            } else {
              const result = (answer as { result?: { isError?: boolean } } | undefined)?.result;
              if (result?.isError) expect(leaks(JSON.stringify(result), c), 'a canary window reached an error result').toBe(false);
            }
            expect(leaks(seen.slice(from).join('\n'), c), 'a canary window reached a stream').toBe(false);
          }),
          { numRuns: 120 },
        );
      } finally {
        await clientSide.close();
        await server.close();
      }
    });
  }, 60_000);
});

describe('privacy: the spawned bundle', () => {
  interface Session {
    stderr: string;
    stdoutLines: string[];
  }

  /** Spawn the committed bundle, write the lines, wait for the answers to the requests with an id, then stop it. */
  async function runBundle(apiUrl: string | undefined, lines: string[], answers: number): Promise<Session> {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.PAW_API_URL;
    delete env.PAW_I_AM_18_OR_OLDER;
    if (apiUrl !== undefined) env.PAW_API_URL = apiUrl;
    child = spawn('node', [BUNDLE_OUT], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    for (const line of lines) child.stdin.write(`${line}\n`);
    const started = Date.now();
    const count = () => stdout.split('\n').filter((l) => l.trim() !== '').length;
    while (count() < answers && Date.now() - started < 10_000) await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setTimeout(resolve, 200)); // anything late would show up now
    const exited = new Promise((resolve) => child!.once('exit', resolve));
    child.kill();
    await exited;
    return { stderr, stdoutLines: stdout.split('\n').filter((l) => l.trim() !== '') };
  }

  function expectClean(session: Session, c: Canary): void {
    expect(leaks(session.stderr, c), 'a canary window reached stderr').toBe(false);
    for (const line of session.stdoutLines) {
      let message: { error?: unknown; result?: { isError?: boolean } } | undefined;
      try {
        message = JSON.parse(line);
      } catch {
        message = undefined;
      }
      // A line that is not JSON-RPC at all, a JSON-RPC error and an isError result are all error answers.
      if (message === undefined || message.error !== undefined || message.result?.isError) {
        expect(leaks(line, c), 'a canary window reached an error answer on stdout').toBe(false);
      }
    }
  }

  function linesFor(c: Canary): string[] {
    const rpc = (id: number, method: string, params: unknown) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return [
      rpc(7, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'x', version: '1', icons: [{ src: 'https://example.invalid/i.png', theme: c.lower }] },
      }),
      rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      rpc(2, 'tools/call', { name: 'paw_curse', arguments: { requirement: c.lower, context: c.upper } }),
      rpc(3, 'tools/call', { name: c.lower, arguments: { [c.lower]: c.upper } }),
      rpc(4, 'tools/call', { name: 'paw_bind', arguments: { curse: c.lower, amendment: c.upper, kind: c.lower } }),
      rpc(5, 'tools/call', { name: 'paw_check_verdict', arguments: { curse: c.lower, amendment: c.upper, kind: c.lower, verdict: c.lower } }),
      rpc(6, 'tools/call', { name: 5, arguments: c.lower }),
      `${c.lower}{`,
      `{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"${c.lower}`,
      JSON.stringify({ a: c.lower, [c.upper]: c.digits }),
      JSON.stringify([c.lower]),
    ];
  }

  it.each([['local'], ['remote']])('%s mode: valid and malformed stdin lines', async (mode) => {
    const [c] = fc.sample(canaryArb, 1);
    stub = await startStub((_req, res) => sendJson(res, 400, { message: c.lower, code: c.upper }));
    const session = await runBundle(mode === 'remote' ? stub.url : undefined, linesFor(c), 7);
    expect(session.stdoutLines.length, 'the bundle answered').toBeGreaterThan(0);
    expect(session.stderr.length, 'the bundle wrote its start-up line').toBeGreaterThan(0);
    expectClean(session, c);
  }, 30_000);
});
