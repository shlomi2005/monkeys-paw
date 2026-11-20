import { afterEach, describe, expect, it } from 'vitest';
import { FLOW_INSTRUCTIONS, LOCAL_INSTRUCTIONS, REMOTE_INSTRUCTIONS } from '../src/instructions';
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
  description?: string;
  inputSchema: {
    required?: string[];
    properties: Record<
      string,
      {
        maxLength?: number;
        minLength?: number;
        enum?: string[];
        default?: unknown;
        description?: string;
        anyOf?: unknown[];
      }
    >;
  };
  outputSchema?: { properties: Record<string, unknown> };
}

const LOCAL_TOOLS = ['paw_check_curses', 'paw_check_verdict', 'paw_rules'];
const REMOTE_TOOLS = [...LOCAL_TOOLS, 'paw_bind', 'paw_curse'].sort();
const NAME_RULE = /^[a-zA-Z0-9_-]{1,64}$/;

async function listLocal(): Promise<ListedTool[]> {
  connected = await connectPaw({ mode: 'local' });
  return (await connected.client.listTools()).tools as unknown as ListedTool[];
}

async function listRemote(): Promise<ListedTool[]> {
  // The URL is never called: listing tools makes no request.
  connected = await connectPaw({ mode: 'remote', baseUrl: 'http://127.0.0.1:9' });
  return (await connected.client.listTools()).tools as unknown as ListedTool[];
}

describe('tool list by mode (Req 21)', () => {
  it('local: exactly paw_rules, paw_check_curses and paw_check_verdict, under the server name paw', async () => {
    const tools = await listLocal();
    expect(tools.map((t) => t.name).sort()).toEqual(LOCAL_TOOLS);
    expect(connected?.client.getServerVersion()?.name).toBe('paw');
  });

  it('local: paw_curse and paw_bind are not registered, so calling them fails', async () => {
    await listLocal();
    for (const name of ['paw_curse', 'paw_bind']) {
      const result = await connected!.client.callTool({ name, arguments: { requirement: 'R' } }).catch((e: unknown) => e);
      const failed = result instanceof Error || (result as { isError?: boolean }).isError === true;
      expect(failed).toBe(true);
    }
  });

  it('remote: the three local tools plus paw_curse and paw_bind', async () => {
    const tools = await listRemote();
    expect(tools.map((t) => t.name).sort()).toEqual(REMOTE_TOOLS);
  });

  it('every name matches the MCP name rule, with no dots, in both modes', async () => {
    for (const list of [listLocal, listRemote]) {
      const tools = await list();
      for (const tool of tools) expect(tool.name).toMatch(NAME_RULE);
      await connected?.close();
      connected = undefined;
    }
  });

  it('every tool has a description', async () => {
    for (const tool of await listRemote()) expect(tool.description?.length ?? 0).toBeGreaterThan(20);
  });
});

describe('instructions (Req 21.5)', () => {
  it('local initialize carries the local text', async () => {
    connected = await connectPaw({ mode: 'local' });
    const text = connected.client.getInstructions();
    expect(text).toBe(LOCAL_INSTRUCTIONS);
    for (const word of ['paw_rules', 'paw_check_curses', 'paw_check_verdict', 'once']) expect(text).toContain(word);
    expect(text).not.toContain('paw_curse');
    expect(text).not.toContain('paw_bind');
  });

  it('remote initialize carries the remote text: the shared flow, the three local tools, and the two remote tools', async () => {
    connected = await connectPaw({ mode: 'remote', baseUrl: 'http://127.0.0.1:9' });
    const text = connected.client.getInstructions();
    expect(text).toBe(REMOTE_INSTRUCTIONS);
    expect(text).toContain('paw_curse and paw_bind');
    expect(text).toContain('PAW_API_URL');
  });

  it('local text starts "Local mode.", remote text starts "Remote mode.", and both hold the shared flow', () => {
    expect(LOCAL_INSTRUCTIONS.startsWith('Local mode. ')).toBe(true);
    expect(REMOTE_INSTRUCTIONS.startsWith('Remote mode. ')).toBe(true);
    expect(LOCAL_INSTRUCTIONS).toContain(FLOW_INSTRUCTIONS);
    expect(REMOTE_INSTRUCTIONS).toContain(FLOW_INSTRUCTIONS);
    expect(LOCAL_INSTRUCTIONS).not.toContain('Remote mode');
    expect(REMOTE_INSTRUCTIONS).not.toContain('Local mode');
  });

  it('remote text limits "no model and no server" to the three local tools and names the API for the other two', () => {
    expect(REMOTE_INSTRUCTIONS).toContain('paw_rules, paw_check_curses and paw_check_verdict call no model and no server.');
    // The only "no server" claim in the remote text is the one that names the three local tools.
    expect(REMOTE_INSTRUCTIONS.match(/no server/g)).toHaveLength(1);
    expect(REMOTE_INSTRUCTIONS).not.toContain('These tools call no');
    expect(REMOTE_INSTRUCTIONS.endsWith('paw_curse and paw_bind call the Paw API at the origin in PAW_API_URL.')).toBe(true);
    expect(LOCAL_INSTRUCTIONS.endsWith('These tools call no model and no server.')).toBe(true);
  });

  it('remote mode without a baseUrl is refused at creation', async () => {
    await expect(connectPaw({ mode: 'remote' })).rejects.toThrow('baseUrl');
  });
});

describe('local tool schemas (D18)', () => {
  it('paw_rules: kind is required and limited to curse and bind', async () => {
    const tool = (await listLocal()).find((t) => t.name === 'paw_rules')!;
    expect(tool.inputSchema.required).toEqual(['kind']);
    expect([...(tool.inputSchema.properties.kind?.enum ?? [])].sort()).toEqual(['bind', 'curse']);
    expect(Object.keys(tool.outputSchema?.properties ?? {}).sort()).toEqual(['jsonSchema', 'kind', 'next', 'sections']);
  });

  it('paw_check_curses: requirement and curses required, limit 500, items named in the description', async () => {
    const tool = (await listLocal()).find((t) => t.name === 'paw_check_curses')!;
    expect([...(tool.inputSchema.required ?? [])].sort()).toEqual(['curses', 'requirement']);
    expect(tool.inputSchema.properties.requirement?.maxLength).toBe(500);
    const curses = tool.inputSchema.properties.curses!;
    expect(curses.anyOf).toBeDefined();
    expect(curses.description).toBe(
      '3 to 5 curses, each {type, story, loophole}, no ids; or a JSON string of that array. Get the rules from paw_rules first.',
    );
    expect(Object.keys(tool.outputSchema?.properties ?? {}).sort()).toEqual(['curses', 'warnings']);
  });

  it('paw_check_verdict: curse, amendment and verdict required, kind has a default, items named', async () => {
    const tool = (await listLocal()).find((t) => t.name === 'paw_check_verdict')!;
    expect([...(tool.inputSchema.required ?? [])].sort()).toEqual(['amendment', 'curse', 'verdict']);
    expect(tool.inputSchema.properties.amendment?.maxLength).toBe(500);
    expect(tool.inputSchema.properties.kind?.enum?.sort()).toEqual(['ears-clause', 'rewrite']);
    expect(tool.inputSchema.properties.kind?.default).toBe('ears-clause');
    expect(tool.inputSchema.properties.curse?.description).toContain('{type, story, loophole}');
    expect(tool.inputSchema.properties.verdict?.description).toContain('{closed, reason, property?}');
    expect(Object.keys(tool.outputSchema?.properties ?? {}).sort()).toEqual(['binding', 'verdict']);
  });
});

describe('remote tool schemas', () => {
  it('paw_curse: requirement required, limits 500 and 200', async () => {
    const tool = (await listRemote()).find((t) => t.name === 'paw_curse')!;
    expect(tool.inputSchema.required).toEqual(['requirement']);
    expect(tool.inputSchema.properties.requirement?.maxLength).toBe(500);
    expect(tool.inputSchema.properties.context?.maxLength).toBe(200);
    expect(Object.keys(tool.outputSchema?.properties ?? {}).sort()).toEqual(['curses', 'narration', 'wishId']);
  });

  it('paw_bind: curse and amendment required, kind optional with a default', async () => {
    const tool = (await listRemote()).find((t) => t.name === 'paw_bind')!;
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
    connected = await connectPaw({ mode: 'remote', baseUrl: stub.url });
    const result = await connected.client.callTool({
      name: 'paw_curse',
      arguments: { requirement: 'x'.repeat(501) },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('requirement must be at most 500 characters');
    expect(stub.requests).toHaveLength(0);
  });

  it('an unknown argument type is also an isError result', async () => {
    connected = await connectPaw({ mode: 'remote', baseUrl: 'http://127.0.0.1:9' });
    const result = await connected.client.callTool({ name: 'paw_bind', arguments: { curse: 5 } });
    expect(result.isError).toBe(true);
  });

  it('local tools: a bad argument is an isError result that names the field', async () => {
    connected = await connectPaw({ mode: 'local' });
    const rules = await connected.client.callTool({ name: 'paw_rules', arguments: { kind: 'wish' } });
    expect(rules.isError).toBe(true);
    expect(textOf(rules)).toContain('kind must be "curse" or "bind"');

    const long = await connected.client.callTool({
      name: 'paw_check_curses',
      arguments: { requirement: 'x'.repeat(501), curses: [] },
    });
    expect(long.isError).toBe(true);
    expect(textOf(long)).toContain('requirement must be at most 500 characters');

    const empty = await connected.client.callTool({ name: 'paw_check_curses', arguments: { requirement: '', curses: [] } });
    expect(empty.isError).toBe(true);
    expect(textOf(empty)).toContain('requirement must not be empty');

    const notArray = await connected.client.callTool({
      name: 'paw_check_curses',
      arguments: { requirement: 'R', curses: 5 },
    });
    expect(notArray.isError).toBe(true);
    expect(textOf(notArray)).toContain('curses must be an array, or a JSON string of an array');

    const longAmend = await connected.client.callTool({
      name: 'paw_check_verdict',
      arguments: { curse: {}, amendment: 'a'.repeat(501), verdict: {} },
    });
    expect(longAmend.isError).toBe(true);
    expect(textOf(longAmend)).toContain('amendment must be at most 500 characters');
  });
});
