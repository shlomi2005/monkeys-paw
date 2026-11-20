import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUNDLE_OUT } from '../scripts/build-bundle.mjs';
import { LOCAL_INSTRUCTIONS, REMOTE_INSTRUCTIONS } from '../src/instructions';
import { PAW_MCP_VERSION } from '../src/version';
import { makeGrant } from './fixtures';
import { sendJson, startStub, type Stub } from './stub-http';

const REQUIREMENT = 'Only the zebra-keeper can feed the quokka at dawn.';
const WISH_ID = '3f2a9c1e-0000-4000-8000-000000000001';

let stub: Stub;
let child: ChildProcessWithoutNullStreams | undefined;

beforeEach(async () => {
  stub = await startStub((req, res) => {
    if (req.path === '/api/grant') {
      sendJson(res, 200, { wish: { id: 'w1', text: REQUIREMENT, createdAt: 1 }, grant: makeGrant(WISH_ID, 4) });
    } else {
      sendJson(res, 404, { message: 'nope' });
    }
  });
});

afterEach(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child!.once('exit', resolve));
    child.kill();
    await exited;
  }
  child = undefined;
  await stub.close();
});

function waitFor(predicate: () => boolean, what: string, ms = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > ms) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${what}`));
      }
    }, 20);
  });
}

interface Session {
  messages: Record<string, unknown>[];
  stderr: string;
  stdoutLines: string[];
}

/**
 * Spawn the committed bundle, run initialize, tools/list and one tools/call, and collect what it wrote.
 * `PAW_API_URL` is removed from the environment unless `apiUrl` is given.
 */
async function runBundle(apiUrl: string | undefined, call: { name: string; arguments: unknown }): Promise<Session> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PAW_API_URL;
  if (apiUrl !== undefined) env.PAW_API_URL = apiUrl;
  child = spawn('node', [BUNDLE_OUT], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
  child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));

  const lines = (): string[] => stdout.split('\n').filter((l) => l.length > 0);
  const send = (message: unknown): void => void child!.stdin.write(`${JSON.stringify(message)}\n`);

  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stdio-test', version: '0.0.0' } },
  });
  await waitFor(() => lines().length >= 1, 'initialize reply');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  await waitFor(() => lines().length >= 2, 'tools/list reply');
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: call });
  await waitFor(() => lines().length >= 3, `${call.name} reply`);
  // Let the per-call stderr line arrive before reading it.
  await waitFor(() => stderr.includes(`${call.name} `), 'the per-call log line');

  return { messages: lines().map((l) => JSON.parse(l) as Record<string, unknown>), stderr, stdoutLines: lines() };
}

function expectJsonRpcOnly(session: Session): void {
  for (const line of session.stdoutLines) expect(() => JSON.parse(line)).not.toThrow();
  for (const m of session.messages) expect(m.jsonrpc).toBe('2.0');
  expect(session.messages.map((m) => m.id)).toEqual([1, 2, 3]);
}

function toolNames(session: Session): string[] {
  return (session.messages[1]!.result as { tools: { name: string }[] }).tools.map((t) => t.name).sort();
}

describe('committed bundle over stdio', () => {
  it('local mode: no PAW_API_URL, three tools, local instructions, no network', async () => {
    const curses = [
      { type: 'permissions', story: 'The quokka goes hungry when the keeper quits.', loophole: 'Only the zebra-keeper can feed' },
      { type: 'time', story: 'Dawn comes at a different hour in each zone.', loophole: 'at dawn' },
      { type: 'abuse', story: 'A rival keeper claims the quokka.', loophole: 'zebra-keeper can feed the quokka' },
    ];
    const session = await runBundle(undefined, {
      name: 'paw_check_curses',
      arguments: { requirement: REQUIREMENT, curses },
    });
    expectJsonRpcOnly(session);

    const init = session.messages[0]!.result as { instructions?: string; serverInfo: { name: string; version: string } };
    expect(init.serverInfo).toEqual({ name: 'paw', version: PAW_MCP_VERSION });
    expect(init.instructions).toBe(LOCAL_INSTRUCTIONS);

    expect(toolNames(session)).toEqual(['paw_check_curses', 'paw_check_verdict', 'paw_rules']);

    const call = session.messages[2]!.result as {
      isError?: boolean;
      content: { text: string }[];
      structuredContent: { curses: { id: string }[] };
    };
    expect(call.isError).toBeFalsy();
    expect(call.content[0]!.text.startsWith('The curses pass. 3 loopholes:')).toBe(true);
    expect(call.structuredContent.curses.map((c) => c.id)).toEqual(['curse-0', 'curse-1', 'curse-2']);

    expect(session.stderr).toContain(`paw-mcp ${PAW_MCP_VERSION} mode=local`);
    expect(session.stderr).toMatch(/paw_check_curses ok \d+ms/);
    expect(session.stderr).not.toContain('ignored');
    expect(session.stderr).not.toContain(REQUIREMENT);
    expect(session.stderr).not.toContain('zebra');
    expect(session.stderr).not.toContain('quokka');
    expect(stub.requests).toHaveLength(0);
  });

  it('remote mode: PAW_API_URL set to the stub, five tools, paw_curse reaches the stub', async () => {
    const session = await runBundle(stub.url, {
      name: 'paw_curse',
      arguments: { requirement: REQUIREMENT, context: 'A zoo rota app.' },
    });
    expectJsonRpcOnly(session);

    const init = session.messages[0]!.result as { instructions?: string };
    expect(init.instructions).toBe(REMOTE_INSTRUCTIONS);

    expect(toolNames(session)).toEqual(['paw_bind', 'paw_check_curses', 'paw_check_verdict', 'paw_curse', 'paw_rules']);

    const call = session.messages[2]!.result as { isError?: boolean; content: { text: string }[] };
    expect(call.isError).toBeFalsy();
    expect(call.content[0]!.text).toContain('3f2a9c1e:curse-0');

    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]!.path).toBe('/api/grant');
    expect(session.stderr).toContain(`paw-mcp ${PAW_MCP_VERSION} mode=remote api=${stub.url}`);
    expect(session.stderr).toMatch(/paw_curse 200 \d+ms/);
    expect(session.stderr).not.toContain(REQUIREMENT);
    expect(session.stderr).not.toContain('zebra');
  });
});
