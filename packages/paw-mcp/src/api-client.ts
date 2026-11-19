import type { z } from 'zod';
import { originOf } from './base-url';

export const REQUEST_TIMEOUT_MS = 30_000;

export const MSG_BAD_SHAPE = 'The Paw API answered in a shape this tool does not understand.';

/** Logs the tool name, the HTTP status (0 when none) and the duration. Nothing else can reach it. */
export type CallLogger = (tool: string, status: number, ms: number) => void;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface ApiClientOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  log?: CallLogger;
}

export interface ApiClient {
  postJson<T>(
    tool: string,
    path: string,
    body: unknown,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<ApiResult<T>>;
}

function messageOf(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      const { message } = parsed as { message: unknown };
      if (typeof message === 'string' && message.trim() !== '') return message;
    }
  } catch {
    // not JSON
  }
  return null;
}

/**
 * POST JSON to the Paw API. Sends only `content-type` and `accept`, refuses redirects,
 * times out, never retries. Failures come back as `{ ok: false, message }`; nothing throws.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const log: CallLogger = options.log ?? (() => undefined);
  const origin = originOf(options.baseUrl);
  const unreachable = `Cannot reach the Paw API at ${origin}; set PAW_API_URL.`;

  return {
    async postJson(tool, path, body, schema) {
      const started = Date.now();
      let status = 0;
      try {
        const res = await fetchFn(options.baseUrl + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
        status = res.status;
        const text = await res.text();
        if (!res.ok) {
          return { ok: false, message: messageOf(text) ?? `The Paw API answered HTTP ${status}.` };
        }
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          return { ok: false, message: MSG_BAD_SHAPE };
        }
        const parsed = schema.safeParse(json);
        return parsed.success ? { ok: true, data: parsed.data } : { ok: false, message: MSG_BAD_SHAPE };
      } catch {
        return { ok: false, message: unreachable };
      } finally {
        log(tool, status, Date.now() - started);
      }
    },
  };
}
