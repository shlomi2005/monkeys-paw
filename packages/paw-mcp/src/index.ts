import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { adultConfirmedOf, ignoredLine, resolveMode, startupLine } from './mode';
import { createPawServer } from './server';
import { PAW_MCP_VERSION } from './version';

// stdout carries JSON-RPC only. Every log line goes to stderr, and none of them holds content or the
// value of PAW_API_URL or PAW_I_AM_18_OR_OLDER. Both variables are read once, here.
const { mode, ignored } = resolveMode(process.env.PAW_API_URL);
process.stderr.write(`${startupLine(PAW_MCP_VERSION, mode)}\n`);
if (ignored) process.stderr.write(`${ignoredLine(PAW_MCP_VERSION)}\n`);

const log = (tool: string, outcome: number | 'ok' | 'invalid', ms: number): void => {
  process.stderr.write(`${tool} ${outcome} ${ms}ms\n`);
};

// Only the remote client gets the age confirmation, and only the exact value `yes` counts. In local mode
// the variable is not read at all.
const server = createPawServer(
  mode.kind === 'remote'
    ? { mode: 'remote', baseUrl: mode.baseUrl, adultConfirmed: adultConfirmedOf(process.env.PAW_I_AM_18_OR_OLDER), log }
    : { mode: 'local', log },
);

server.connect(new StdioServerTransport()).catch(() => {
  process.stderr.write('paw-mcp failed to start\n');
  process.exit(1);
});
