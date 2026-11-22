import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createApiClient } from './api-client';
import type { CallLogger } from './call-log';
import { createGrantMemory } from './grant-memory';
import { LOCAL_INSTRUCTIONS, REMOTE_INSTRUCTIONS } from './instructions';
import { errorResult, type ToolResult } from './render';
import { hardenServer } from './safe-sdk';
import * as bind from './tool-bind';
import * as checkCurses from './tool-check-curses';
import * as checkVerdict from './tool-check-verdict';
import * as curse from './tool-curse';
import * as rules from './tool-rules';
import { PAW_MCP_VERSION } from './version';

export interface PawServerOptions {
  mode: 'local' | 'remote';
  /** Required in remote mode. In local mode it is accepted and ignored. */
  baseUrl?: string;
  /** Used only by the remote tools. In local mode it is accepted and never called. */
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  log?: CallLogger;
  /** Remote mode only: `PAW_I_AM_18_OR_OLDER` was exactly `yes`. Local mode has no use for it. */
  adultConfirmed?: boolean;
  /** The clock for `judgedAt`. Default `Date.now`. */
  now?: () => number;
}

/** A tool handler never throws: any surprise becomes one plain sentence, and the error is not logged. */
async function safely(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch {
    return errorResult('The Paw tool failed unexpectedly.');
  }
}

/**
 * The MCP server named `paw`. Local mode registers exactly the three local tools and creates no API client
 * and no grant memory. Remote mode registers those and `paw_curse` and `paw_bind`, which call the Paw API.
 */
export function createPawServer(options: PawServerOptions): McpServer {
  const now = options.now ?? Date.now;
  const log: CallLogger = options.log ?? (() => undefined);
  const remote = options.mode === 'remote';
  if (remote && !options.baseUrl) throw new Error('Remote mode needs a baseUrl.');

  const server = new McpServer(
    { name: 'paw', version: PAW_MCP_VERSION },
    { instructions: remote ? REMOTE_INSTRUCTIONS : LOCAL_INSTRUCTIONS },
  );

  // The SDK's own echoes (tool name, zod text, JSON-RPC error messages) are closed in one place.
  hardenServer(server);

  /** Local handlers log `ok` or `invalid` and the duration, never content. */
  const local =
    <A>(tool: string, run: (args: A) => Promise<ToolResult>) =>
    (args: A): Promise<ToolResult> =>
      safely(async () => {
        const started = Date.now();
        let result: ToolResult;
        try {
          result = await run(args);
        } catch {
          log(tool, 'invalid', Date.now() - started);
          throw new Error('local tool failed');
        }
        log(tool, result.isError ? 'invalid' : 'ok', Date.now() - started);
        return result;
      });

  server.registerTool(
    'paw_rules',
    { description: rules.DESCRIPTION, inputSchema: rules.inputShape, outputSchema: rules.outputShape },
    local('paw_rules', (args) => rules.handleRules(args)),
  );
  server.registerTool(
    'paw_check_curses',
    { description: checkCurses.DESCRIPTION, inputSchema: checkCurses.inputShape, outputSchema: checkCurses.outputShape },
    local('paw_check_curses', (args) => checkCurses.handleCheckCurses(args)),
  );
  server.registerTool(
    'paw_check_verdict',
    {
      description: checkVerdict.DESCRIPTION,
      inputSchema: checkVerdict.inputShape,
      outputSchema: checkVerdict.outputShape,
    },
    local('paw_check_verdict', (args) => checkVerdict.handleCheckVerdict(now, args)),
  );

  if (remote) {
    const api = createApiClient({
      baseUrl: options.baseUrl as string,
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.adultConfirmed === true ? { adultConfirmed: true } : {}),
      log,
    });
    const deps = { api, memory: createGrantMemory() };
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
  }
  return server;
}
