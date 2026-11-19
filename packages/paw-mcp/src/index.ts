import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { originOf, resolveBaseUrl } from './base-url';
import { createPawServer } from './server';
import { PAW_MCP_VERSION } from './version';

// stdout carries JSON-RPC only. Every log line goes to stderr.
const baseUrl = resolveBaseUrl(process.env.PAW_API_URL);
process.stderr.write(`paw-mcp ${PAW_MCP_VERSION} api=${originOf(baseUrl)}\n`);

const server = createPawServer({
  baseUrl,
  log: (tool, status, ms) => process.stderr.write(`${tool} ${status} ${ms}ms\n`),
});

server.connect(new StdioServerTransport()).catch(() => {
  process.stderr.write('paw-mcp failed to start\n');
  process.exit(1);
});
