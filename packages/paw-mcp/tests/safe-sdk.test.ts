import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  MSG_INVALID_INPUT,
  MSG_TOOL_FAILED,
  MSG_UNKNOWN_TOOL,
  hardenServer,
  redactRpcError,
  safeToolErrorText,
} from '../src/safe-sdk';

const CANARY = 'qxzvkwjhgmnpltrsqxzvkwjh';

describe('safeToolErrorText', () => {
  it.each([
    [`MCP error -32602: Tool ${CANARY} not found`],
    ['MCP error -32602: Tool constructor disabled'],
    ['Tool __proto__ disabled'],
    [`MCP error -32602: Tool ${CANARY}\nnot found tool not found`],
  ])('%j is an unknown tool', (message) => {
    expect(safeToolErrorText(message)).toBe(MSG_UNKNOWN_TOOL);
  });

  it('keeps an input message that hardenServer built, and nothing that merely looks like one', () => {
    const built = 'MCP error -32602: Invalid input: kind must be "ears-clause" or "rewrite".';
    expect(safeToolErrorText(built)).toBe('Invalid input: kind must be "ears-clause" or "rewrite".');
    expect(safeToolErrorText(`Invalid input: ${CANARY}`)).toBe(MSG_TOOL_FAILED);
    expect(safeToolErrorText(`MCP error -32602: Invalid input: ${'x'.repeat(400)}`)).toBe(MSG_TOOL_FAILED);
  });

  it.each([
    [`MCP error -32602: Input validation error: Invalid arguments for tool paw_bind: received '${CANARY}' at kind`],
    [`MCP error -32602: Output validation error: Invalid structured content for tool paw_bind: ${CANARY}`],
    [CANARY],
    [''],
  ])('%j is one fixed sentence', (message) => {
    expect(safeToolErrorText(message)).toBe(MSG_TOOL_FAILED);
  });
});

describe('redactRpcError', () => {
  it('gives every error answer the fixed message of its code and no data', () => {
    const redacted = redactRpcError({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32602, message: `Invalid request: ${CANARY}`, data: { received: CANARY } },
    });
    expect(redacted).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32602, message: 'Invalid params' } });
    const odd = redactRpcError({ jsonrpc: '2.0', id: 8, error: { code: 12345, message: CANARY } });
    expect(odd).toEqual({ jsonrpc: '2.0', id: 8, error: { code: 12345, message: 'Request failed' } });
  });

  it('leaves results and notifications alone', () => {
    const result = { jsonrpc: '2.0' as const, id: 1, result: { text: CANARY } };
    expect(redactRpcError(result)).toBe(result);
  });
});

describe('hardenServer on a server of its own', () => {
  let client: Client | undefined;
  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  async function connect(register: (server: McpServer) => void): Promise<Client> {
    const server = new McpServer({ name: 'probe', version: '0.0.0' });
    register(server);
    hardenServer(server);
    const [a, b] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }

  const textOf = (result: unknown): string =>
    (result as { content: { text: string }[] }).content.map((part) => part.text).join('\n');

  it('createToolError is the one place: a throw, a bad output, an unknown tool and a bad input are all fixed', async () => {
    const c = await connect((server) => {
      server.registerTool('throws', { inputSchema: {} }, async () => {
        throw new Error(CANARY);
      });
      server.registerTool(
        'bad_output',
        { inputSchema: {}, outputSchema: { n: z.number() } },
        async () => ({ content: [{ type: 'text' as const, text: 'x' }], structuredContent: { n: CANARY } }),
      );
      server.registerTool(
        'typed',
        { inputSchema: { kind: z.enum(['a', 'b']), requirement: z.string().max(5) } },
        async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      );
    });

    const thrown = await c.callTool({ name: 'throws', arguments: {} });
    expect(thrown.isError).toBe(true);
    expect(textOf(thrown)).toBe(MSG_TOOL_FAILED);

    const output = await c.callTool({ name: 'bad_output', arguments: {} });
    expect(textOf(output)).toBe(MSG_TOOL_FAILED);

    for (const name of [CANARY, 'constructor', '__proto__', 'toString']) {
      const unknown = await c.callTool({ name, arguments: { [CANARY]: CANARY } });
      expect(unknown.isError, name).toBe(true);
      expect(textOf(unknown), name).toBe(MSG_UNKNOWN_TOOL);
    }

    const badEnum = await c.callTool({ name: 'typed', arguments: { kind: CANARY, requirement: 'x' } });
    expect(textOf(badEnum)).toBe('Invalid input: kind must be one of: a, b.');
    const badKind = await c.callTool({ name: 'typed', arguments: { kind: 'a', requirement: CANARY } });
    expect(textOf(badKind)).toBe('Invalid input: requirement must be at most 5 characters.');
    const missing = await c.callTool({ name: 'typed', arguments: {} });
    expect(textOf(missing)).toMatch(/^Invalid input: kind is required\.$/);
    const unkeyed = await c.callTool({ name: 'typed', arguments: { kind: 'a', requirement: 'x', [CANARY]: 1 } });
    expect(unkeyed.isError).toBeUndefined();
  });

  it('a path part that is not a field of ours is written as "field"', async () => {
    const c = await connect((server) => {
      server.registerTool(
        'nested',
        { inputSchema: { curses: z.record(z.number()) } },
        async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      );
    });
    const result = await c.callTool({ name: 'nested', arguments: { curses: { [CANARY]: 'not a number' } } });
    expect(textOf(result)).not.toContain(CANARY);
    expect(textOf(result)).toMatch(/^Invalid input: curses\.field must be a number\.$/);
    expect(MSG_INVALID_INPUT).toBe('Invalid input.');
  });
});
