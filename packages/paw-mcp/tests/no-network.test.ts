// Req 20.3: local mode makes zero network calls, and the three local tools make none in remote mode either.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectPaw, textOf, type Connected } from './stub-api';

const CURSES = [
  { type: 'permissions', story: 'The owner quits. Nobody may delete the project, ever.', loophole: 'Only the owner can delete' },
  { type: 'time', story: 'The owner is away until spring.', loophole: 'the owner can delete' },
  { type: 'abuse', story: 'A hostile owner deletes every project.', loophole: 'owner can delete a project' },
];
const CLAUSE = 'WHEN the owner has left, THE SYSTEM SHALL let any member delete the project.';
const PROPERTY = 'For any project whose owner has left, at least one member can still delete it.';

const calls: string[] = [];
const failingFetch = ((input: unknown) => {
  calls.push(String(input));
  throw new Error('fetch must not be called by a local tool');
}) as unknown as typeof fetch;

const realFetch = globalThis.fetch;
let connected: Connected | undefined;

beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = failingFetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await connected?.close();
  connected = undefined;
});

/** Every local tool, with valid and with invalid input. */
const LOCAL_CALLS: [string, Record<string, unknown>, boolean][] = [
  ['paw_rules', { kind: 'curse' }, false],
  ['paw_rules', { kind: 'bind' }, false],
  ['paw_rules', { kind: 'nope' }, true],
  ['paw_rules', {}, true],
  ['paw_check_curses', { requirement: 'Only the owner can delete a project.', curses: CURSES }, false],
  ['paw_check_curses', { requirement: 'Only the owner can delete a project.', curses: JSON.stringify(CURSES) }, false],
  ['paw_check_curses', { requirement: 'Only the owner can delete a project.', curses: CURSES.slice(0, 1) }, true],
  ['paw_check_curses', { requirement: '', curses: CURSES }, true],
  ['paw_check_curses', { requirement: 'R', curses: 'not json' }, true],
  [
    'paw_check_verdict',
    { curse: CURSES[0], amendment: CLAUSE, verdict: { closed: true, reason: 'Fine.', property: PROPERTY } },
    false,
  ],
  ['paw_check_verdict', { curse: CURSES[0], amendment: CLAUSE, verdict: { closed: false, reason: 'No.' } }, false],
  ['paw_check_verdict', { curse: CURSES[0], amendment: 'not ears', verdict: { closed: false, reason: 'No.' } }, true],
  ['paw_check_verdict', { curse: 'x', amendment: CLAUSE, verdict: 'y' }, true],
  ['paw_check_verdict', { curse: {}, amendment: 'a'.repeat(501), verdict: {} }, true],
];

describe.each([
  ['local mode', () => connectPaw({ mode: 'local', fetchFn: failingFetch })],
  ['remote mode', () => connectPaw({ mode: 'remote', baseUrl: 'http://127.0.0.1:9', fetchFn: failingFetch })],
] as const)('the local tools call no fetch, in %s', (_name, connect) => {
  it('every local tool, valid and invalid input, never reaches fetch', async () => {
    connected = await connect();
    for (const [name, args, shouldFail] of LOCAL_CALLS) {
      const result = await connected.client.callTool({ name, arguments: args });
      expect(Boolean(result.isError), `${name} ${JSON.stringify(args).slice(0, 60)}: ${textOf(result).slice(0, 80)}`).toBe(
        shouldFail,
      );
    }
    expect(calls).toEqual([]);
  });
});

describe('local mode', () => {
  it('has no remote tool to call, and the failing fetch is still never reached', async () => {
    connected = await connectPaw({ mode: 'local', baseUrl: 'http://127.0.0.1:9', fetchFn: failingFetch });
    for (const name of ['paw_curse', 'paw_bind']) {
      const result = await connected.client.callTool({ name, arguments: { requirement: 'R', curse: 'curse-0', amendment: 'A' } }).catch((e: unknown) => e);
      expect(result instanceof Error || (result as { isError?: boolean }).isError === true).toBe(true);
    }
    expect(calls).toEqual([]);
  });
});
