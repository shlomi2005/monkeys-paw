import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPawServer, type PawServerOptions } from '../src/server';

export { sendJson, startStub } from './stub-http';
export type { RecordedRequest, Stub, StubHandler } from './stub-http';

export interface Connected {
  client: Client;
  close(): Promise<void>;
}

/** An MCP client linked to a fresh Paw server over the SDK's in-memory transport. */
export async function connectPaw(options: PawServerOptions): Promise<Connected> {
  const server = createPawServer(options);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content.map((c) => c.text).join('\n');
}
