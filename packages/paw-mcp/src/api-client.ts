import type { z } from 'zod';
import type { CallLogger } from './call-log';
import { originOf } from './mode';

export const REQUEST_TIMEOUT_MS = 30_000;

export const MSG_BAD_SHAPE = 'The Paw API answered in a shape this tool does not understand.';

/** Fixed texts for the two gate refusals of the Paw API (a 403 with one of these codes). Not the server's words. */
export const MSG_REGION =
  'The paw grants no live wishes from here. The three local tools still work: paw_rules, paw_check_curses and paw_check_verdict.';
export const MSG_ADULT =
  "The Paw API grants live wishes only to people who confirm they are 18 or older. Only the user can confirm: ask them to set PAW_I_AM_18_OR_OLDER=yes in the server's environment themselves and restart it. Do not set it for them.";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface ApiClientOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  log?: CallLogger;
  /** True only when `PAW_I_AM_18_OR_OLDER` was exactly `yes` at start-up. Then the requests say so. */
  adultConfirmed?: boolean;
}

export interface ApiClient {
  postJson<T>(
    tool: string,
    path: string,
    body: unknown,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<ApiResult<T>>;
}

/**
 * The fixed messages of the Paw API that this tool knows, by the exact text the API sends
 * (`apps/api/src/routes/grant.ts`, `bind.ts` and `budget/messages.ts`; a test reads those files, so a
 * change there fails here). The value is our own sentence. Any other message is not repeated: it
 * could carry text of the wish, a model or a proxy.
 */
export const API_MESSAGES: ReadonlyMap<string, string> = new Map([
  ['Invalid wish format', 'The Paw API did not accept the requirement.'],
  [
    'The paw trembles and refuses. Such wishes are beyond its power \u2014 and its mercy.',
    'The paw refuses a requirement that is about harming people.',
  ],
  ['Invalid bind request', 'The Paw API did not accept the amendment.'],
  ['The paw has no memory of this curse.', 'The paw has no memory of this curse. Call paw_curse again.'],
  [
    'The paw is resting. Browse the examples until it wakes.',
    'The paw is resting. Try again later; the three local tools still work.',
  ],
]);

/** Our own sentence for a message of the API that is on the list, else null. Reads nothing else from the body. */
function messageOf(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      const { message } = parsed as { message: unknown };
      if (typeof message === 'string') return API_MESSAGES.get(message) ?? null;
    }
  } catch {
    // not JSON
  }
  return null;
}

/** A status that may be written into a sentence or a log line: an integer from 100 to 599, else 0. */
function safeStatus(status: unknown): number {
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
}

/** The fixed text for a 403 whose JSON body has a known gate code. Reads nothing else from the body. */
function gateMessageOf(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const code = parsed && typeof parsed === 'object' ? (parsed as { code?: unknown }).code : undefined;
    if (code === 'live_region_unavailable') return MSG_REGION;
    if (code === 'adult_confirmation_required') return MSG_ADULT;
  } catch {
    // not JSON
  }
  return null;
}

/**
 * POST JSON to the Paw API. Sends `content-type` and `accept`, and `x-paw-adult-confirmed: yes` only
 * when the user set `PAW_I_AM_18_OR_OLDER=yes`. Refuses redirects, times out, never retries. Failures come back as `{ ok: false, message }`; nothing throws.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const log: CallLogger = options.log ?? (() => undefined);
  const origin = originOf(options.baseUrl);
  const adultHeader: Record<string, string> = options.adultConfirmed === true ? { 'x-paw-adult-confirmed': 'yes' } : {};
  const unreachable = `Cannot reach the Paw API at ${origin}; set PAW_API_URL.`;

  return {
    async postJson(tool, path, body, schema) {
      const started = Date.now();
      let status = 0;
      try {
        const res = await fetchFn(options.baseUrl + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', ...adultHeader },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
        status = safeStatus(res.status);
        const text = await res.text();
        if (!res.ok) {
          const gate = status === 403 ? gateMessageOf(text) : null;
          if (gate !== null) return { ok: false, message: gate };
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
