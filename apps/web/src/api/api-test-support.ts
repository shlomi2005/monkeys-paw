// Test support for the API client tests: a recording fake `fetch`, response builders, fixtures and a
// per-endpoint call helper. App code must never import this file.

import type { BindingKind, Grant, SpecExport, Verdict, Wish } from 'paw-core';
import type { ApiClient } from './api-client';
import type { ApiResult } from './api-errors';

export const BASE_URL = 'https://api.example.test';

export type Endpoint = 'examples' | 'grant' | 'bind' | 'export';

export const ENDPOINTS: readonly Endpoint[] = ['examples', 'grant', 'bind', 'export'];

export const ENDPOINT_PATH: Record<Endpoint, string> = {
  examples: '/api/examples',
  grant: '/api/grant',
  bind: '/api/bind',
  export: '/api/export',
};

// ---------------------------------------------------------------------------
// Fake fetch
// ---------------------------------------------------------------------------

export interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

export type FetchHandler = (call: RecordedCall) => Promise<Response> | Response;

/** A fake `fetch` that records every call, then delegates to `handler`. */
export function recordingFetch(handler: FetchHandler): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call: RecordedCall = { url, init: init ?? {} };
    calls.push(call);
    return Promise.resolve(handler(call));
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/** Never answers. Rejects with an `AbortError` as soon as the request's signal aborts, like real `fetch`. */
export function hangUntilAborted(call: RecordedCall): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = call.init.signal;
    if (signal == null) return;
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

/**
 * A Response that reports `status` (any value from 100 to 599; the `Response` constructor only
 * accepts 200 to 599 and refuses bodies on some statuses) and serves `body` as text.
 */
export function makeResponse(status: number, body: string | null = null): Response {
  const response = new Response(body, {
    status: 200,
    headers: body === null ? undefined : { 'content-type': 'application/json' },
  });
  Object.defineProperty(response, 'status', { value: status });
  Object.defineProperty(response, 'ok', { value: status >= 200 && status <= 299 });
  return response;
}

export function jsonResponse(status: number, value: unknown): Response {
  return makeResponse(status, JSON.stringify(value));
}

/** A 200 response whose body stream fails while it is being read. */
export function brokenBodyResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new TypeError('body stream failed'));
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const SAMPLE_WISH_TEXT = 'Only the owner can delete a project';

export function sampleWish(text: string = SAMPLE_WISH_TEXT): Wish {
  return { id: 'wish-1', text, createdAt: 1_700_000_000_000 };
}

export function sampleGrant(): Grant {
  return {
    wishId: 'wish-1',
    narration: 'Granted. Exactly as written.',
    curses: [
      { id: 'c1', type: 'permissions', story: 'The owner quits. Nobody may delete it.', loophole: 'Only the owner.', status: 'open' },
      { id: 'c2', type: 'abuse', story: 'A hostile owner deletes everything.', loophole: 'delete a project', status: 'open' },
      { id: 'c3', type: 'data-loss', story: 'Deletion has no undo.', loophole: 'delete', status: 'open' },
    ],
  };
}

/** `grant` with the curse `curseId` set to `closed`. */
export function withCurseStatus(grant: Grant, curseId: string, status: 'open' | 'closed'): Grant {
  return { ...grant, curses: grant.curses.map((c) => (c.id === curseId ? { ...c, status } : c)) };
}

export function sampleVerdict(curseId: string, closed: boolean): Verdict {
  return { curseId, closed, reason: 'The clause names a successor.', judgedAt: 1_700_000_000_500 };
}

export function sampleSpecExport(): SpecExport {
  return {
    wishId: 'wish-1',
    requirementsMd: '# Requirements\n',
    propertiesMd: '# Properties\n',
    integrity: { score: 3, total: 3, closed: 3, open: 0 },
  };
}

export const BIND_CURSE_ID = 'c2';

/** A well-formed 200 body for `endpoint` that passes the paw-core schema and the bind consistency check. */
export function validBody(endpoint: Endpoint): unknown {
  switch (endpoint) {
    case 'examples':
      return [{ wish: sampleWish(), grant: sampleGrant() }];
    case 'grant':
      return { wish: sampleWish(), grant: sampleGrant() };
    case 'bind':
      return {
        grant: withCurseStatus(sampleGrant(), BIND_CURSE_ID, 'closed'),
        verdict: sampleVerdict(BIND_CURSE_ID, true),
      };
    case 'export':
      return sampleSpecExport();
  }
}

// ---------------------------------------------------------------------------
// One call per endpoint
// ---------------------------------------------------------------------------

export interface CallInput {
  readonly wishText?: string;
  readonly context?: string;
  readonly clause?: string;
  readonly kind?: BindingKind;
  readonly signal?: AbortSignal;
}

/** Calls the client function for `endpoint`. Bind targets `BIND_CURSE_ID` of `sampleGrant()`. */
export function callEndpoint(
  client: ApiClient,
  endpoint: Endpoint,
  input: CallInput = {},
): Promise<ApiResult<unknown>> {
  const text = input.wishText ?? SAMPLE_WISH_TEXT;
  switch (endpoint) {
    case 'examples':
      return client.getExamples(input.signal);
    case 'grant':
      return client.postGrant(
        input.context === undefined ? { text } : { text, context: input.context },
        input.signal,
      );
    case 'bind':
      return client.postBind(
        {
          grant: sampleGrant(),
          curseId: BIND_CURSE_ID,
          kind: input.kind ?? 'ears-clause',
          clause: input.clause ?? 'WHEN the owner leaves THE SYSTEM SHALL name a successor',
        },
        input.signal,
      );
    case 'export':
      return client.postExport({ wish: sampleWish(text), grant: sampleGrant() }, input.signal);
  }
}
