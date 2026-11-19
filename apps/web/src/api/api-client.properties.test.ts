// P18, API client safety (design.md "Correctness Properties"). Written before the client (task 15).
//
// For any status 100-599 and any body, a rejecting or throwing fetch, a timeout and a caller abort:
// the client never throws; it returns `ok` only for a body that passes the paw-core schema; every
// other outcome is an ApiError whose message is a string of at most 200 characters; every request
// uses `credentials: 'omit'`; and the wish, context and clause travel only in the JSON body.

import * as fc from 'fast-check';
import {
  BindResponseSchema,
  ExamplesResponseSchema,
  GrantResponseSchema,
  SpecExportSchema,
} from 'paw-core';
import { describe, expect, it } from 'vitest';
import { numRuns } from '../state/arbitraries';
import { createApiClient } from './api-client';
import * as messages from './api-messages';
import { isBindConsistent, normalizeGrant } from './api-schemas';
import {
  BASE_URL,
  BIND_CURSE_ID,
  ENDPOINTS,
  ENDPOINT_PATH,
  brokenBodyResponse,
  callEndpoint,
  hangUntilAborted,
  makeResponse,
  recordingFetch,
  sampleGrant,
  sampleVerdict,
  validBody,
  withCurseStatus,
} from './api-test-support';
import type { CallInput, Endpoint, FetchHandler, RecordedCall } from './api-test-support';

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

const ERROR_KINDS = [
  'bad-request',
  'not-found',
  'resting',
  'server',
  'network',
  'timeout',
  'invalid-response',
  'aborted',
];

/** The value the client must return for `text`, or `undefined` when the response must be an error. */
function expectedValue(endpoint: Endpoint, status: number, text: string): { value: unknown } | undefined {
  if (status < 200 || status > 299) return undefined;
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
    case 'grant': {
      const parsed = GrantResponseSchema.safeParse(json);
      return parsed.success
        ? { value: { wish: parsed.data.wish, grant: normalizeGrant(parsed.data.grant) } }
        : undefined;
    }
    case 'bind': {
      const parsed = BindResponseSchema.safeParse(json);
      return parsed.success && isBindConsistent(BIND_CURSE_ID, parsed.data)
        ? { value: parsed.data }
        : undefined;
    }
    case 'export': {
      const parsed = SpecExportSchema.safeParse(json);
      return parsed.success ? { value: parsed.data } : undefined;
    }
  }
}

/** Lines the client may show: its own, or the server's own `message` when it is safe to render. */
function allowedMessages(bodyText: string): Set<string> {
  const allowed = new Set<string>();
  for (const value of Object.values(messages)) {
    if (typeof value === 'string') allowed.add(value);
  }
  try {
    const own = messages.serverMessageOf(JSON.parse(bodyText));
    if (own !== undefined) allowed.add(own);
  } catch {
    // not JSON: only the client's own lines are allowed
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const arbEndpoint: fc.Arbitrary<Endpoint> = fc.constantFrom(...ENDPOINTS);

/** Wish text, context and clause all start with a marker that cannot occur in a fixed URL. */
const arbInput: fc.Arbitrary<Required<Pick<CallInput, 'wishText' | 'context' | 'clause'>>> = fc.record({
  wishText: fc.fullUnicodeString({ maxLength: 40 }).map((s) => `ZQX${s}`),
  context: fc.fullUnicodeString({ maxLength: 40 }).map((s) => `CTXQ${s}`),
  clause: fc.fullUnicodeString({ maxLength: 40 }).map((s) => `CLSQ${s}`),
});

const BROKEN_TEXTS = ['', '{', '[', '{"message":', 'undefined', '<html><body>Bad gateway</body></html>', 'null', '"text"'];

/** Request bodies for `endpoint`: valid, mutated, inconsistent, arbitrary JSON, error bodies and garbage. */
function arbBodyText(endpoint: Endpoint): fc.Arbitrary<string | null> {
  const valid = validBody(endpoint);
  const mutated = fc
    .record({ key: fc.nat({ max: 3 }), replacement: fc.jsonValue() })
    .map(({ key, replacement }) => {
      const mutate = (record: Record<string, unknown>): Record<string, unknown> => {
        const keys = Object.keys(record);
        const target = keys[key % keys.length] as string;
        return { ...record, [target]: replacement };
      };
      return Array.isArray(valid)
        ? [mutate(valid[0] as Record<string, unknown>)]
        : mutate(valid as Record<string, unknown>);
    })
    .map((v) => JSON.stringify(v));

  // A bind response whose verdict and curse disagree, or that names another curse.
  const inconsistentBind = fc
    .constantFrom(
      { grant: sampleGrant(), verdict: sampleVerdict(BIND_CURSE_ID, true) },
      { grant: withCurseStatus(sampleGrant(), BIND_CURSE_ID, 'closed'), verdict: sampleVerdict(BIND_CURSE_ID, false) },
      { grant: withCurseStatus(sampleGrant(), 'c1', 'closed'), verdict: sampleVerdict('c1', true) },
      { grant: sampleGrant(), verdict: sampleVerdict('zz', false) },
    )
    .map((v) => JSON.stringify(v));

  const errorBody = fc
    .record({ message: fc.oneof(fc.string({ maxLength: 400 }), fc.integer(), fc.constant(null)) })
    .map((v) => JSON.stringify(v));

  return fc.oneof(
    { arbitrary: fc.constant(JSON.stringify(valid)), weight: 4 },
    { arbitrary: mutated, weight: 3 },
    { arbitrary: endpoint === 'bind' ? inconsistentBind : mutated, weight: 2 },
    { arbitrary: fc.jsonValue().map((v) => JSON.stringify(v)), weight: 2 },
    { arbitrary: errorBody, weight: 2 },
    { arbitrary: fc.constantFrom(...BROKEN_TEXTS), weight: 2 },
    { arbitrary: fc.string({ maxLength: 60 }), weight: 1 },
    { arbitrary: fc.constant(null), weight: 1 },
  );
}

const arbThrown: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(new TypeError('Failed to fetch')),
  fc.string({ maxLength: 500 }).map((m) => new Error(m)),
  fc.constant(new Error('<script>alert(1)</script>'.repeat(40))),
  fc.string(),
  fc.integer(),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant({ message: 'x'.repeat(1000) }),
);

type Scenario =
  | { kind: 'response'; status: number; bodyText: string | null }
  | { kind: 'reject'; error: unknown }
  | { kind: 'throw-sync'; error: unknown }
  | { kind: 'broken-body' }
  | { kind: 'timeout' }
  | { kind: 'abort-before' }
  | { kind: 'abort-during' };

function arbScenario(endpoint: Endpoint): fc.Arbitrary<Scenario> {
  return fc.oneof(
    {
      arbitrary: fc.record({
        kind: fc.constant('response' as const),
        status: fc.oneof(fc.integer({ min: 100, max: 599 }), fc.constantFrom(200, 400, 404, 429, 500, 503)),
        bodyText: arbBodyText(endpoint),
      }),
      weight: 10,
    },
    // Well-formed answers at 200, so the property also proves that valid bodies are accepted.
    {
      arbitrary: fc.constant<Scenario>({ kind: 'response', status: 200, bodyText: JSON.stringify(validBody(endpoint)) }),
      weight: 2,
    },
    { arbitrary: fc.record({ kind: fc.constant('reject' as const), error: arbThrown }), weight: 2 },
    { arbitrary: fc.record({ kind: fc.constant('throw-sync' as const), error: arbThrown }), weight: 1 },
    { arbitrary: fc.constant<Scenario>({ kind: 'broken-body' }), weight: 1 },
    { arbitrary: fc.constant<Scenario>({ kind: 'timeout' }), weight: 1 },
    { arbitrary: fc.constant<Scenario>({ kind: 'abort-before' }), weight: 1 },
    { arbitrary: fc.constant<Scenario>({ kind: 'abort-during' }), weight: 1 },
  );
}

// ---------------------------------------------------------------------------
// Request rules
// ---------------------------------------------------------------------------

function assertRequestRules(
  endpoint: Endpoint,
  call: RecordedCall,
  input: Required<Pick<CallInput, 'wishText' | 'context' | 'clause'>>,
): void {
  const { url, init } = call;
  expect(init.credentials).toBe('omit');
  expect(url).toBe(`${BASE_URL}${ENDPOINT_PATH[endpoint]}`);
  expect(url).not.toContain('?');
  expect(url).not.toContain('#');
  for (const secret of [input.wishText, input.context, input.clause, 'ZQX', 'CTXQ', 'CLSQ']) {
    expect(url).not.toContain(secret);
    expect(url).not.toContain(encodeURIComponent(secret));
  }

  if (endpoint === 'examples') {
    expect([undefined, 'GET']).toContain(init.method);
    expect(init.body ?? undefined).toBeUndefined();
    return;
  }

  // POST: the content type is the only custom header, and the data is in the JSON body.
  expect(init.method).toBe('POST');
  expect(new Headers(init.headers).get('content-type')).toMatch(/^application\/json/);
  expect(typeof init.body).toBe('string');
  const body = JSON.parse(init.body as string) as Record<string, unknown>;
  switch (endpoint) {
    case 'grant':
      expect(body).toMatchObject({ wish: { text: input.wishText, context: input.context } });
      break;
    case 'bind':
      expect(body).toMatchObject({ curseId: BIND_CURSE_ID, clause: input.clause });
      break;
    case 'export':
      expect(body).toMatchObject({ wish: { text: input.wishText } });
      break;
  }
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe('P18: API client safety', () => {
  it('never throws, accepts only schema-valid bodies, and keeps every request private', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbEndpoint.chain((endpoint) => fc.tuple(fc.constant(endpoint), arbScenario(endpoint), arbInput)),
        async ([endpoint, scenario, input]) => {
          const controller = new AbortController();
          let handler: FetchHandler;
          let signal: AbortSignal | undefined;
          let timeouts: { examples: number; grant: number; bind: number; export: number } | undefined;
          let bodyText = '';

          switch (scenario.kind) {
            case 'response':
              bodyText = scenario.bodyText ?? '';
              handler = () => makeResponse(scenario.status, scenario.bodyText);
              break;
            case 'reject':
              handler = () => Promise.reject(scenario.error);
              break;
            case 'throw-sync':
              handler = () => {
                throw scenario.error;
              };
              break;
            case 'broken-body':
              handler = () => brokenBodyResponse();
              break;
            case 'timeout':
              timeouts = { examples: 1, grant: 1, bind: 1, export: 1 };
              handler = hangUntilAborted;
              break;
            case 'abort-before':
              signal = controller.signal;
              controller.abort();
              handler = hangUntilAborted;
              break;
            case 'abort-during':
              signal = controller.signal;
              handler = (call) => {
                setTimeout(() => controller.abort(), 0);
                return hangUntilAborted(call);
              };
              break;
          }

          const { fetchImpl, calls } = recordingFetch(handler);
          const client = createApiClient({
            baseUrl: BASE_URL,
            fetchImpl,
            ...(timeouts === undefined ? {} : { timeouts }),
          });

          // Never throws: an exception here fails the property.
          const result = await callEndpoint(client, endpoint, { ...input, signal });

          // Requests: private, one at most (the client does not retry).
          expect(calls.length).toBeLessThanOrEqual(1);
          for (const call of calls) assertRequestRules(endpoint, call, input);

          if (result.ok) {
            expect(scenario.kind).toBe('response');
            const expected = scenario.kind === 'response' ? expectedValue(endpoint, scenario.status, bodyText) : undefined;
            expect(expected).toBeDefined();
            expect(result.value).toEqual(expected?.value);
            return;
          }

          // Every failure is an ApiError with a short, safe, in-character message.
          const { error } = result;
          expect(ERROR_KINDS).toContain(error.kind);
          expect(typeof error.message).toBe('string');
          expect(error.message.length).toBeGreaterThan(0);
          expect(error.message.length).toBeLessThanOrEqual(200);
          expect(allowedMessages(bodyText).has(error.message)).toBe(true);
          if (error.status !== undefined) expect(Number.isInteger(error.status)).toBe(true);

          switch (scenario.kind) {
            case 'response':
              // A body that passes the schema at 2xx must be accepted.
              expect(expectedValue(endpoint, scenario.status, bodyText)).toBeUndefined();
              break;
            case 'reject':
            case 'throw-sync':
              expect(error.kind).toBe('network');
              break;
            case 'timeout':
              expect(error.kind).toBe('timeout');
              break;
            case 'abort-before':
            case 'abort-during':
              expect(error.kind).toBe('aborted');
              break;
            case 'broken-body':
              break;
          }
        },
      ),
      { numRuns: numRuns() },
    );
  });
});
