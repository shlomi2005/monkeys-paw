// Local mode creates no API client and no grant memory (Req 4.5, 5.6, 20.1). Remote mode creates both.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const created = { client: 0, memory: 0 };

vi.mock('../src/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/api-client')>();
  return {
    ...original,
    createApiClient: (...args: Parameters<typeof original.createApiClient>) => {
      created.client += 1;
      return original.createApiClient(...args);
    },
  };
});

vi.mock('../src/grant-memory', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/grant-memory')>();
  return {
    ...original,
    createGrantMemory: (...args: Parameters<typeof original.createGrantMemory>) => {
      created.memory += 1;
      return original.createGrantMemory(...args);
    },
  };
});

const { connectPaw, textOf } = await import('./stub-api');
type Connected = Awaited<ReturnType<typeof connectPaw>>;

let connected: Connected | undefined;

beforeEach(() => {
  created.client = 0;
  created.memory = 0;
});

afterEach(async () => {
  await connected?.close();
  connected = undefined;
});

describe('what each mode creates', () => {
  it('local: no API client, no grant memory', async () => {
    connected = await connectPaw({ mode: 'local', baseUrl: 'http://127.0.0.1:9' });
    await connected.client.callTool({ name: 'paw_rules', arguments: { kind: 'curse' } });
    expect(created).toEqual({ client: 0, memory: 0 });
  });

  it('remote: one API client and one grant memory', async () => {
    connected = await connectPaw({ mode: 'remote', baseUrl: 'http://127.0.0.1:9' });
    expect(created).toEqual({ client: 1, memory: 1 });
  });
});

describe('local call logging (D24)', () => {
  it('logs the tool, ok or invalid, and the duration, and nothing else', async () => {
    const logged: unknown[][] = [];
    connected = await connectPaw({ mode: 'local', log: (...args) => logged.push(args) });
    const secret = 'zebra-keeper';
    await connected.client.callTool({ name: 'paw_rules', arguments: { kind: 'curse' } });
    const bad = await connected.client.callTool({
      name: 'paw_check_curses',
      arguments: { requirement: secret, curses: [] },
    });
    expect(textOf(bad)).toContain('3 to 5');
    await connected.client.callTool({ name: 'paw_check_verdict', arguments: { curse: {}, amendment: 'X', verdict: secret } });
    expect(logged.map(([tool, outcome]) => [tool, outcome])).toEqual([
      ['paw_rules', 'ok'],
      ['paw_check_curses', 'invalid'],
      ['paw_check_verdict', 'invalid'],
    ]);
    for (const entry of logged) {
      expect(entry).toHaveLength(3);
      expect(typeof entry[2]).toBe('number');
    }
    expect(JSON.stringify(logged)).not.toContain(secret);
  });

  it('a call the SDK rejects before the handler runs is not logged', async () => {
    const logged: unknown[][] = [];
    connected = await connectPaw({ mode: 'local', log: (...args) => logged.push(args) });
    await connected.client.callTool({ name: 'paw_rules', arguments: { kind: 'wish' } });
    expect(logged).toEqual([]);
  });

  it('a failing logger turns into one plain sentence and the server keeps working', async () => {
    let first = true;
    connected = await connectPaw({
      mode: 'local',
      log: () => {
        if (first) {
          first = false;
          throw new Error('secret detail');
        }
      },
    });
    const a = await connected.client.callTool({ name: 'paw_rules', arguments: { kind: 'curse' } });
    expect(a.isError).toBe(true);
    expect(textOf(a)).toBe('The Paw tool failed unexpectedly.');
    const b = await connected.client.callTool({ name: 'paw_rules', arguments: { kind: 'curse' } });
    expect(b.isError).toBeFalsy();
  });
});
