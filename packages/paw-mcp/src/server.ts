import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createApiClient, type CallLogger } from './api-client';
import { createGrantMemory } from './grant-memory';
import { errorResult, type ToolResult } from './render';
import * as bind from './tool-bind';
import * as curse from './tool-curse';
import { PAW_MCP_VERSION } from './version';

export interface PawServerOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  log?: CallLogger;
}

/** A tool handler never throws: any surprise becomes one plain sentence, and the error is not logged. */
async function safely(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch {
    return errorResult('The Paw tool failed unexpectedly.');
  }
}

/** The MCP server named `paw`, with exactly two tools. Each server has its own grant memory. */
export function createPawServer(options: PawServerOptions): McpServer {
  const api = createApiClient(options);
  const deps = { api, memory: createGrantMemory() };
  const server = new McpServer({ name: 'paw', version: PAW_MCP_VERSION });

  server.registerTool(
    'paw_curse',
    { description: curse.DESCRIPTION, inputSchema: curse.inputShape, outputSchema: curse.outputShape },
    (args) => safely(() => curse.handleCurse(deps, args)),
  );
  server.registerTool(
    'paw_bind',
    { description: bind.DESCRIPTION, inputSchema: bind.inputShape, outputSchema: bind.outputShape },
    (args) => safely(() => bind.handleBind(deps, args)),
  );
  return server;
}
