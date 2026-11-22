import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ErrorCode, McpError, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import { describeInputIssue } from './issue';
import { errorResult, type ToolResult } from './render';

/**
 * The MCP SDK echoes on its own: "Tool <name> not found" (the name is the caller's), zod text with
 * received values and caller keys in input and output validation, and JSON-RPC error answers whose
 * message is the message of the thrown error plus its `data`. This module is the one place that
 * closes all of it (paw-power Requirement 6.2). `createPawServer` calls `hardenServer` once.
 */

export const MSG_UNKNOWN_TOOL = 'Unknown tool.';
export const MSG_TOOL_FAILED = 'The Paw tool failed unexpectedly.';
export const MSG_INVALID_INPUT = 'Invalid input.';

/** The SDK writes every McpError message as "MCP error <code>: <text>". */
const MCP_PREFIX = /^MCP error -?\d+: /;
/** "Tool X not found" and "Tool X disabled". A name such as `constructor` is "disabled", not "not found". */
const UNKNOWN_TOOL = /^Tool [\s\S]* (?:not found|disabled)$/;
/** Our own input messages (see `describeInputIssue`) start like this. */
const INPUT_MESSAGE_PREFIX = 'Invalid input';
const MAX_INPUT_MESSAGE = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * What a tool error of the SDK may say. An unknown tool is one fixed sentence. An input problem
 * keeps its field message, but only the one that `hardenServer` built itself (an McpError whose text
 * starts with "Invalid input"). Anything else (output validation, a thrown value, the element cap,
 * the SDK's own zod text) is one fixed sentence.
 */
export function safeToolErrorText(message: string): string {
  const text = message.replace(MCP_PREFIX, '');
  if (UNKNOWN_TOOL.test(text)) return MSG_UNKNOWN_TOOL;
  if (MCP_PREFIX.test(message) && text.startsWith(INPUT_MESSAGE_PREFIX) && text.length <= MAX_INPUT_MESSAGE) {
    return text;
  }
  return MSG_TOOL_FAILED;
}

/** One fixed message per JSON-RPC code. */
const RPC_MESSAGES: ReadonlyMap<number, string> = new Map([
  [-32700, 'Parse error'],
  [-32600, 'Invalid request'],
  [-32601, 'Method not found'],
  [-32602, 'Invalid params'],
  [-32603, 'Internal error'],
]);

/** A JSON-RPC error answer with a fixed message for its code and no `data`. Other messages pass as they are. */
export function redactRpcError(message: JSONRPCMessage): JSONRPCMessage {
  if (!('error' in message) || !isRecord(message.error)) return message;
  const raw = (message.error as { code?: unknown }).code;
  const code = typeof raw === 'number' && Number.isSafeInteger(raw) ? raw : -32603;
  return { jsonrpc: '2.0', id: message.id, error: { code, message: RPC_MESSAGES.get(code) ?? 'Request failed' } };
}

type ToolLike = { inputSchema?: { safeParseAsync?: (value: unknown) => Promise<{ success: boolean; error?: { issues?: z.ZodIssue[] } }> } };

/** The first issue of the input of a tool, or undefined when the input is fine or cannot be checked. */
async function firstIssueOf(tool: ToolLike, args: unknown): Promise<z.ZodIssue | undefined> {
  const schema = tool.inputSchema;
  if (typeof schema?.safeParseAsync !== 'function') return undefined;
  const parsed = await schema.safeParseAsync(args ?? {});
  return parsed.success ? undefined : parsed.error?.issues?.[0];
}

/**
 * Close the SDK's echoes on one server.
 *
 * Both methods below are private in the SDK's types. `validateToolInput` is wrapped because the
 * SDK builds its input message from zod's text, which quotes received values and caller keys: when
 * it fails, the message is rebuilt from the first issue by `describeInputIssue`.
 * `createToolError` is the one function that every tool error passes through (unknown tool, input
 * and output validation, a throw), so overriding it is the one small place to make them all safe.
 * `connect` wraps `send` of the transport so that every JSON-RPC error answer has a fixed message
 * and no data, whatever the SDK put in it.
 */
export function hardenServer(server: McpServer): void {
  const internals = server as unknown as {
    createToolError(text: string): ToolResult;
    validateToolInput(tool: ToolLike, args: unknown, name: string): Promise<unknown>;
  };

  const validate = internals.validateToolInput.bind(server);
  internals.validateToolInput = async (tool, args, name) => {
    try {
      return await validate(tool, args, name);
    } catch {
      let text = MSG_INVALID_INPUT;
      try {
        const issue = await firstIssueOf(tool, args);
        if (issue) text = describeInputIssue(issue);
      } catch {
        // keep the fixed sentence
      }
      throw new McpError(ErrorCode.InvalidParams, text);
    }
  };

  internals.createToolError = (text) => errorResult(safeToolErrorText(text));

  const connect = server.connect.bind(server);
  server.connect = (transport: Transport) => {
    const send = transport.send.bind(transport);
    transport.send = (message, options) => send(redactRpcError(message), options);
    return connect(transport);
  };
}
