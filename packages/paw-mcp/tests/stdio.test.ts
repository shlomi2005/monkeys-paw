import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUNDLE_OUT } from '../scripts/build-bundle.mjs';
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

describe('committed bundle over stdio', () => {
  it('speaks JSON-RPC only on stdout and never logs the requirement', async () => {
    child = spawn('node', [BUNDLE_OUT], {
      env: { ...process.env, PAW_API_URL: stub.url },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'paw_curse', arguments: { requirement: REQUIREMENT, context: 'A zoo rota app.' } },
    });
    await waitFor(() => lines().length >= 3, 'paw_curse reply');

    const messages = lines().map((l) => JSON.parse(l) as Record<string, unknown>);
    for (const m of messages) expect(m.jsonrpc).toBe('2.0');
    expect(messages.map((m) => m.id)).toEqual([1, 2, 3]);

    const tools = (messages[1]!.result as { tools: { name: string }[] }).tools.map((t) => t.name).sort();
    expect(tools).toEqual(['paw_bind', 'paw_curse']);
    const call = messages[2]!.result as { isError?: boolean; content: { text: string }[] };
    expect(call.isError).toBeFalsy();
    expect(call.content[0]!.text).toContain('3f2a9c1e:curse-0');

    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]!.path).toBe('/api/grant');
    expect(stderr).toContain('paw-mcp');
    expect(stderr).not.toContain(REQUIREMENT);
    expect(stderr).not.toContain('zebra');
  });
});
