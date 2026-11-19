import { afterEach, describe, expect, it } from 'vitest';
import { PLACEHOLDER_API_URL } from '../src/base-url';
import { connectPaw, startStub, textOf, type Connected, type Stub } from './stub-api';

let connected: Connected | undefined;
let stub: Stub | undefined;

afterEach(async () => {
  await connected?.close();
  await stub?.close();
  connected = undefined;
  stub = undefined;
});

interface ListedTool {
  name: string;
  inputSchema: {
    required?: string[];
    properties: Record<string, { maxLength?: number; minLength?: number; enum?: string[]; default?: unknown }>;
  };
  outputSchema?: { properties: Record<string, unknown> };
}

async function listTools(): Promise<ListedTool[]> {
  connected = await connectPaw({ baseUrl: PLACEHOLDER_API_URL });
  return (await connected.client.listTools()).tools as unknown as ListedTool[];
}

describe('tool list', () => {
  it('registers exactly paw_curse and paw_bind under the server name paw', async () => {
    const tools = await listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['paw_bind', 'paw_curse']);
    expect(connected?.client.getServerVersion()?.name).toBe('paw');
  });

  it('paw_curse: requirement required, limits 500 and 200', async () => {
    const tool = (await listTools()).find((t) => t.name === 'paw_curse')!;
    expect(tool.inputSchema.required).toEqual(['requirement']);
    expect(tool.inputSchema.properties.requirement?.maxLength).toBe(500);
    expect(tool.inputSchema.properties.context?.maxLength).toBe(200);
    expect(Object.keys(tool.outputSchema?.properties ?? {}).sort()).toEqual(['curses', 'narration', 'wishId']);
  });

  it('paw_bind: curse and amendment required, kind optional with a default', async () => {
    const tool = (await listTools()).find((t) => t.name === 'paw_bind')!;
    expect([...(tool.inputSchema.required ?? [])].sort()).toEqual(['amendment', 'curse']);
    expect(tool.inputSchema.properties.curse?.maxLength).toBe(100);
    expect(tool.inputSchema.properties.amendment?.maxLength).toBe(500);
    expect(tool.inputSchema.properties.kind?.enum?.sort()).toEqual(['ears-clause', 'rewrite']);
    expect(tool.inputSchema.properties.kind?.default).toBe('ears-clause');
    expect(Object.keys(tool.outputSchema?.properties ?? {}).sort()).toEqual([
      'closed',
      'handle',
      'openHandles',
      'property',
      'reason',
    ]);
  });
});

describe('input validation (D8)', () => {
  it('the SDK reports an input-schema failure as an isError result, not a protocol error', async () => {
    stub = await startStub((_req, res) => res.end('{}'));
    connected = await connectPaw({ baseUrl: stub.url });
    const result = await connected.client.callTool({
      name: 'paw_curse',
      arguments: { requirement: 'x'.repeat(501) },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('requirement must be at most 500 characters');
    expect(stub.requests).toHaveLength(0);
  });

  it('an unknown argument type is also an isError result', async () => {
    connected = await connectPaw({ baseUrl: PLACEHOLDER_API_URL });
    const result = await connected.client.callTool({ name: 'paw_bind', arguments: { curse: 5 } });
    expect(result.isError).toBe(true);
  });
});
