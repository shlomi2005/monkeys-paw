// API client (design.md section 6). The client never throws: every outcome is an `ApiResult`.
// Responses are untrusted (iron-rules section 6): they are validated with the paw-core schemas.

import { z } from 'zod';
import {
  BindResponseSchema,
  ExamplesResponseSchema,
  GrantResponseSchema,
  SpecExportSchema,
} from 'paw-core';
import type { BindingKind, Grant, SpecExport, Verdict, Wish } from 'paw-core';
import type { ApiError, ApiResult } from './api-errors';
import {
  ABORTED_MESSAGE,
  ADULT_REQUIRED_MESSAGE,
  CLAUSE_UNREADABLE_MESSAGE,
  CURSE_FORGOTTEN_MESSAGE,
  GRANT_UNREADABLE_MESSAGE,
  INVALID_RESPONSE_MESSAGE,
  NETWORK_MESSAGE,
  OUTSIDE_REFUSAL_MESSAGE,
  RESTING_MESSAGE,
  SERVER_STUMBLE_MESSAGE,
  TIMEOUT_MESSAGE,
  serverMessageOf,
} from './api-messages';
import { isBindConsistent, normalizeGrant } from './api-schemas';
import type { ExampleEntry } from './api-schemas';

/** Per-call timeouts in milliseconds. Defaults (task 16): grant 60 s, bind 60 s, export 15 s, examples 10 s. */
export interface ApiTimeouts {
  readonly examples: number;
  readonly live: number;
  readonly grant: number;
  readonly bind: number;
  readonly export: number;
}

export interface ApiClientOptions {
  /** Prefix for the fixed paths (`/api/examples`, `/api/live`, `/api/grant`, `/api/bind`, `/api/export`). */
  readonly baseUrl: string;
  /** Defaults to the global `fetch`. Tests inject a fake. */
  readonly fetchImpl?: typeof fetch;
  readonly timeouts?: Partial<ApiTimeouts>;
}

export interface GrantRequest {
  readonly text: string;
  readonly context?: string;
}

export interface BindRequest {
  readonly grant: Grant;
  readonly curseId: string;
  readonly kind: BindingKind;
  readonly clause: string;
}

export interface ExportRequest {
  readonly wish: Wish;
  readonly grant: Grant;
}

export interface ApiClient {
  getExamples(signal?: AbortSignal): Promise<ApiResult<ExampleEntry[]>>;
  /** `GET /api/live`: does the server grant live wishes here (paw-web Req 13.1)? 5 s timeout. */
  getLive(signal?: AbortSignal): Promise<ApiResult<{ live: boolean }>>;
  /** `adult` is the real state of the 18+ checkbox. The header `X-Paw-Adult-Confirmed: yes` is sent only when it is true. */
  postGrant(wish: GrantRequest, signal?: AbortSignal, adult?: boolean): Promise<ApiResult<{ wish: Wish; grant: Grant }>>;
  postBind(req: BindRequest, signal?: AbortSignal, adult?: boolean): Promise<ApiResult<{ grant: Grant; verdict: Verdict }>>;
  postExport(req: ExportRequest, signal?: AbortSignal): Promise<ApiResult<SpecExport>>;
}

type Endpoint = 'examples' | 'live' | 'grant' | 'bind' | 'export';

/** Fixed paths. No query string and no fragment, ever (Req 11.6). */
const PATHS: Readonly<Record<Endpoint, string>> = {
  examples: '/api/examples',
  live: '/api/live',
  grant: '/api/grant',
  bind: '/api/bind',
  export: '/api/export',
};

export const DEFAULT_TIMEOUTS: ApiTimeouts = {
  examples: 10_000,
  live: 5_000,
  grant: 60_000,
  bind: 60_000,
  export: 15_000,
};

/** What one network exchange produced, before any interpretation. */
interface Exchange {
  readonly status: number;
  /** The body as text. `undefined` when an error response's body could not be read. */
  readonly text: string | undefined;
}

type Outcome = { readonly kind: 'exchange'; readonly exchange: Exchange } | { readonly kind: 'abort' };

const fail = (
  kind: ApiError['kind'],
  message: string,
  status?: number,
): { ok: false; error: ApiError } => ({
  ok: false,
  error: status === undefined ? { kind, message } : { kind, status, message },
});

/** The whole body of `GET /api/live`, and nothing else. */
const LiveResponseSchema = z.object({ live: z.boolean() }).strict();

/** The `code` of an error body, when the body is JSON with a string `code`. */
function codeOf(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  try {
    const body: unknown = JSON.parse(text);
    const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

function messageOfBody(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  try {
    return serverMessageOf(JSON.parse(text));
  } catch {
    return undefined;
  }
}

const isSuccessStatus = (status: number): boolean => status >= 200 && status <= 299;

/** Maps a non-2xx response to an in-character error (design.md section 6, status table). */
function failureForStatus(endpoint: Endpoint, status: number, text: string | undefined): { ok: false; error: ApiError } {
  if (status === 400 && endpoint === 'grant') {
    return fail('bad-request', messageOfBody(text) ?? GRANT_UNREADABLE_MESSAGE, status);
  }
  if (status === 403 && (endpoint === 'grant' || endpoint === 'bind')) {
    // The `code` decides. Any other 403 falls through to the stumble line.
    const code = codeOf(text);
    if (code === 'live_region_unavailable') return fail('outside', messageOfBody(text) ?? OUTSIDE_REFUSAL_MESSAGE, status);
    if (code === 'adult_confirmation_required') return fail('adult', ADULT_REQUIRED_MESSAGE, status);
  }
  if (status === 400 && (endpoint === 'bind' || endpoint === 'export')) {
    return fail('bad-request', CLAUSE_UNREADABLE_MESSAGE, status);
  }
  if (status === 404 && endpoint === 'bind') {
    return fail('not-found', CURSE_FORGOTTEN_MESSAGE, status);
  }
  if ((status === 429 || status === 503) && endpoint !== 'export') {
    return fail('resting', RESTING_MESSAGE, status);
  }
  return fail('server', SERVER_STUMBLE_MESSAGE, status);
}

/** Validates a 2xx body. Returns `undefined` when it is not JSON or fails the schema. */
function parseSuccess(endpoint: Endpoint, text: string, bindCurseId: string | undefined): { value: unknown } | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  switch (endpoint) {
    case 'examples': {
      const parsed = ExamplesResponseSchema.safeParse(json);
      return parsed.success ? { value: parsed.data } : undefined;
    }
    case 'live': {
      const parsed = LiveResponseSchema.safeParse(json);
      return parsed.success ? { value: parsed.data } : undefined;
    }
    case 'grant': {
      const parsed = GrantResponseSchema.safeParse(json);
      return parsed.success ? { value: { wish: parsed.data.wish, grant: normalizeGrant(parsed.data.grant) } } : undefined;
    }
    case 'bind': {
      const parsed = BindResponseSchema.safeParse(json);
      if (!parsed.success || bindCurseId === undefined) return undefined;
      return isBindConsistent(bindCurseId, parsed.data) ? { value: parsed.data } : undefined;
    }
    case 'export': {
      const parsed = SpecExportSchema.safeParse(json);
      return parsed.success ? { value: parsed.data } : undefined;
    }
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { fetchImpl = globalThis.fetch } = options;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const timeouts: ApiTimeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };

  async function call<T>(
    endpoint: Endpoint,
    body: unknown,
    callerSignal: AbortSignal | undefined,
    bindCurseId?: string,
    adult = false,
  ): Promise<ApiResult<T>> {
    const callerAborted = (): boolean => callerSignal?.aborted === true;
    if (callerAborted()) return fail('aborted', ABORTED_MESSAGE);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeouts[endpoint]);
    const onCallerAbort = (): void => controller.abort();
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    const aborted = new Promise<Outcome>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve({ kind: 'abort' }), { once: true });
    });

    // Every request: no cookies, no cache, no referrer. Data travels only in the JSON body.
    const init: RequestInit = {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined
        ? {}
        : {
            headers: {
              'Content-Type': 'application/json',
              // Only a live grant or bind with the tick sends it, as a header and never in the body (Req 13.4).
              ...(adult ? { 'X-Paw-Adult-Confirmed': 'yes' } : {}),
            },
            body: JSON.stringify(body),
          }),
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    };

    const exchange = async (): Promise<Outcome> => {
      const response = await fetchImpl(`${baseUrl}${PATHS[endpoint]}`, init);
      const status = response.status;
      if (isSuccessStatus(status)) return { kind: 'exchange', exchange: { status, text: await response.text() } };
      // The status decides an error; a body that cannot be read only costs the server's message.
      let text: string | undefined;
      try {
        text = await response.text();
      } catch {
        text = undefined;
      }
      return { kind: 'exchange', exchange: { status, text } };
    };

    try {
      const outcome = await Promise.race([exchange(), aborted]);
      if (outcome.kind === 'abort') {
        return callerAborted() || !timedOut
          ? fail('aborted', ABORTED_MESSAGE)
          : fail('timeout', TIMEOUT_MESSAGE);
      }
      const { status, text } = outcome.exchange;
      if (!isSuccessStatus(status)) return failureForStatus(endpoint, status, text);
      const parsed = text === undefined ? undefined : parseSuccess(endpoint, text, bindCurseId);
      return parsed === undefined
        ? fail('invalid-response', INVALID_RESPONSE_MESSAGE)
        : { ok: true, value: parsed.value as T };
    } catch {
      // fetch rejected or threw, or the body stream broke.
      if (callerAborted()) return fail('aborted', ABORTED_MESSAGE);
      if (timedOut) return fail('timeout', TIMEOUT_MESSAGE);
      return fail('network', NETWORK_MESSAGE);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }

  return {
    getExamples: (signal) => call<ExampleEntry[]>('examples', undefined, signal),
    getLive: (signal) => call<{ live: boolean }>('live', undefined, signal),
    postGrant: (wish, signal, adult) =>
      call<{ wish: Wish; grant: Grant }>(
        'grant',
        { wish: wish.context === undefined ? { text: wish.text } : { text: wish.text, context: wish.context } },
        signal,
        undefined,
        adult === true,
      ),
    postBind: (req, signal, adult) =>
      call<{ grant: Grant; verdict: Verdict }>(
        'bind',
        { grant: req.grant, curseId: req.curseId, kind: req.kind, clause: req.clause },
        signal,
        req.curseId,
        adult === true,
      ),
    postExport: (req, signal) => call<SpecExport>('export', { wish: req.wish, grant: req.grant }, signal),
  };
}

/**
 * The client the app uses. The base URL is read from `VITE_API_BASE_URL` (name only, no value is
 * committed). When it is unset the paths are same-origin.
 */
export function defaultApiClient(): ApiClient {
  const raw: unknown = import.meta.env.VITE_API_BASE_URL;
  return createApiClient({ baseUrl: typeof raw === 'string' ? raw : '' });
}
