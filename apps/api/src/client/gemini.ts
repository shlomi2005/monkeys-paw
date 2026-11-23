import type { ModelClient } from 'paw-core';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * `gemini-3.5-flash` is a retired name; its endpoint routes to `gemini-3.6-flash`.
 * Source: https://ai.google.dev/gemini-api/docs/deprecations (checked 2026-11-20).
 */
export const DEFAULT_MODEL = 'gemini-3.6-flash';

/** `gemini-3.1-flash-lite` shuts down on 2027-05-07. It stays as the last fallback until then. */
export const DEFAULT_FALLBACKS = 'gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite';

/** The default chain, primary first, as it is when no model variable is set. */
export const DEFAULT_MODEL_CHAIN: readonly string[] = [DEFAULT_MODEL, ...DEFAULT_FALLBACKS.split(',')];
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The hard cap on thinking tokens plus response tokens of one attempt, the same
 * for every task. When it is hit the candidate ends with `finishReason: "MAX_TOKENS"`
 * and the tokens are still billed.
 *
 * Sized from the largest real answer, a grant with 5 curses (GrantSchema allows 3 to 5):
 * - narration 260 chars; userStory and wishCriterion about 40 words (280 chars) each: 820
 * - 5 curses x (story 360 + loophole ~300 + type 13): 3365
 * - JSON keys, quotes and brackets (4 top keys, 3 keys per curse): ~360
 * That is about 4545 chars, which is 1515 tokens at 3 chars per token. Thinking at
 * level `low` counts toward the same cap, and 4096 - 1515 leaves about 2500 tokens
 * for it. Do not go above 8192 without a stated reason: the cap is also the
 * per-attempt price ceiling that the budget guard reserves.
 */
export const MAX_OUTPUT_TOKENS = 4096;

/**
 * HTTP statuses that mean "this model is unavailable right now": try the next one.
 * A 429 is also a quota attempt (the free quota is spent, Requirement 13.1). Whether the
 * chain goes on after it depends on the quota's scope: a quota shared by all models
 * (`quotaScopeOf` is `shared`) stops the chain, a per-model quota tries the next model.
 * Any other status that carries `error.status` `RESOURCE_EXHAUSTED` is a quota attempt too.
 */
const NEXT_MODEL_STATUSES = new Set([503, 429, 404]);

/**
 * HTTP statuses Google does not bill when the answer reports no token usage. Source: Google's
 * billing FAQ, https://ai.google.dev/gemini-api/docs/billing (read 2026-11-22): a 400 or 500
 * is not charged for tokens, but it still counts against the quota.
 */
const UNBILLED_STATUSES = new Set([400, 500]);

/** The most of an error body that is read. The rest is dropped unread. */
export const MAX_ERROR_BODY_BYTES = 64 * 1024;

/**
 * Thrown when the chain ended without a success and at least one attempt was a quota
 * attempt: the free quota is spent. The message is fixed. It holds no body and no key.
 */
export class QuotaExhaustedError extends Error {
  constructor() {
    super('The free quota of the model is spent');
    this.name = 'QuotaExhaustedError';
  }
}

/**
 * Thrown when Google refuses the server's location (HTTP 400, `error.message` says "user location is
 * not supported"). The message is fixed. It holds no body and no key.
 */
export class LocationRefusedError extends Error {
  constructor() {
    super("The model refused the server's location");
    this.name = 'LocationRefusedError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether the quota behind a 429 / `RESOURCE_EXHAUSTED` answer belongs to the whole project.
 * `shared` only when the `QuotaFailure` entries of `error.details[]` hold at least one
 * violation and every violation has a `quotaId` with `PerProject` and without `PerModel`,
 * and a `quotaDimensions` object without a `model` key. Every other case, including a body
 * that is missing or unparsable, is `per-model`: the next model has its own free quota.
 * `body` is the parsed JSON (a string is parsed here); nothing of it is kept or logged.
 */
export function quotaScopeOf(body: unknown): 'shared' | 'per-model' {
  let parsed = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return 'per-model';
    }
  }
  const details = isRecord(parsed) && isRecord(parsed.error) ? parsed.error.details : undefined;
  if (!Array.isArray(details)) return 'per-model';

  const violations: unknown[] = [];
  for (const detail of details) {
    if (!isRecord(detail)) continue;
    const type = detail['@type'];
    if (typeof type !== 'string' || !type.endsWith('google.rpc.QuotaFailure')) continue;
    if (Array.isArray(detail.violations)) violations.push(...detail.violations);
  }
  if (violations.length === 0) return 'per-model';

  const everyPerProject = violations.every((violation) => {
    if (!isRecord(violation)) return false;
    const { quotaId, quotaDimensions } = violation;
    return (
      typeof quotaId === 'string' &&
      quotaId.includes('PerProject') &&
      !quotaId.includes('PerModel') &&
      isRecord(quotaDimensions) &&
      !('model' in quotaDimensions)
    );
  });
  return everyPerProject ? 'shared' : 'per-model';
}

/** Whether a parsed error body's `error.message` says the location is not supported (any case). */
function isLocationRefusal(body: unknown): boolean {
  if (!isRecord(body) || !isRecord(body.error)) return false;
  const message = body.error.message;
  return typeof message === 'string' && message.toLowerCase().includes('user location is not supported');
}

/** Whether a parsed error body says `error.status === "RESOURCE_EXHAUSTED"`. */
function isResourceExhausted(body: unknown): boolean {
  return isRecord(body) && isRecord(body.error) && body.error.status === 'RESOURCE_EXHAUSTED';
}

/**
 * Reads at most `MAX_ERROR_BODY_BYTES` of an error body and parses it as JSON. Stops when
 * the attempt's signal aborts (timeout) and cancels the rest. Returns `undefined` when the
 * body is missing, cut, unreadable or not JSON. The text is never kept or logged.
 */
async function readErrorBody(response: Response, signal: AbortSignal): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = response.body?.getReader();
  } catch {
    return undefined; // a response that cannot be read: its error is not ours to keep
  }
  if (!reader) return undefined;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) return undefined;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
    if (signal.aborted) return undefined;
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes.subarray(0, MAX_ERROR_BODY_BYTES)));
  } catch {
    return undefined;
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
  }
}

/** The longest wait a hint may name: one day. */
const MAX_RETRY_HINT_SECONDS = 86400;

/** A hint counts only as a whole number of seconds from 1 to 86400. */
function validHint(seconds: number): number | undefined {
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= MAX_RETRY_HINT_SECONDS
    ? seconds
    : undefined;
}

/**
 * The wait Google hints at in a non-200 answer, in whole seconds, or `undefined` (Requirement 19.4).
 * Two sources: the `retryDelay` of the first `error.details[]` entry whose `@type` ends with
 * `google.rpc.RetryInfo` (a string like "37s" or "0.5s", rounded up), and, on a 429 or 503, a
 * `Retry-After` header of digits only. Each counts only from 1 to 86400; the smaller one wins.
 * Only that number leaves this function: nothing of the body or the header is kept or logged.
 */
function retryHintOf(errorBody: unknown, response: Response, status: number): number | undefined {
  const hints: number[] = [];

  if (isRecord(errorBody) && isRecord(errorBody.error) && Array.isArray(errorBody.error.details)) {
    const info = errorBody.error.details.find(
      (detail: unknown) =>
        isRecord(detail) &&
        typeof detail['@type'] === 'string' &&
        detail['@type'].endsWith('google.rpc.RetryInfo'),
    );
    const delay = isRecord(info) ? info.retryDelay : undefined;
    if (typeof delay === 'string' && /^\d+(\.\d+)?s$/.test(delay)) {
      const hint = validHint(Math.ceil(Number(delay.slice(0, -1))));
      if (hint !== undefined) hints.push(hint);
    }
  }

  if (status === 429 || status === 503) {
    let header: string | null = null;
    try {
      header = response.headers.get('retry-after');
    } catch {
      header = null; // a response without readable headers gives no hint
    }
    if (header !== null && /^\d+$/.test(header)) {
      const hint = validHint(Number(header));
      if (hint !== undefined) hints.push(hint);
    }
  }

  return hints.length === 0 ? undefined : Math.min(...hints);
}

/** What one attempt could cost at most: the request as planned, before any call is made. */
export interface AttemptPlan {
  model: string;
  /** `ceil((prompt.length + JSON.stringify(responseSchema).length) / 3)` */
  inputTokens: number;
  maxOutputTokens: number;
}

/** What one HTTP attempt turned out to be. Reported once per attempt, whatever happened. */
export interface AttemptReport extends AttemptPlan {
  /** The model that answered, as the response names it. */
  modelVersion?: string;
  /** Present only when the response carried `usageMetadata` with a valid `promptTokenCount`. */
  usage?: { promptTokens: number; outputTokens: number };
  /** The attempt was a quota answer (429, or `RESOURCE_EXHAUSTED`). Google does not bill it: 0 cents. */
  quota?: true;
  /** HTTP 400 or 500 with no usageMetadata, not cut off by the timeout: Google does not charge it. 0 cents. */
  unbilled?: true;
  /** On a non-200 answer: the wait Google hinted at, whole seconds from 1 to 86400 (Requirement 19.4). */
  retryAfterSeconds?: number;
}

/** One metadata line per HTTP attempt. Numbers and enums only; never the prompt, the response text or the key. */
export interface ModelCallLogEntry {
  event: 'model_call';
  model: string;
  /** HTTP status (an integer from 100 to 599), or 0 when no response arrived (timeout, network failure). */
  status: number;
  ms: number;
  ok: boolean;
  promptTokens?: number;
  outputTokens?: number;
  /** One of `FINISH_REASONS`, or `OTHER`. Never the upstream text. */
  finishReason?: string;
}

export interface GeminiClientOptions {
  /** Defaults to process.env.GEMINI_API_KEY. A blank key means unavailable. */
  apiKey?: string;
  /** Primary model first, then fallbacks. Defaults to GEMINI_MODEL + GEMINI_MODEL_FALLBACKS. */
  models?: string[];
  /** Defaults to GEMINI_TIMEOUT_MS, then 30000. */
  timeoutMs?: number;
  /** Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Defaults to one JSON line on stdout. */
  log?: (entry: ModelCallLogEntry) => void;
}

function defaultLog(entry: ModelCallLogEntry): void {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function modelsFromEnv(): string[] {
  const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const fallbacks = process.env.GEMINI_MODEL_FALLBACKS || DEFAULT_FALLBACKS;
  return [primary, ...fallbacks.split(',')];
}

/** `GEMINI_TIMEOUT_MS` as text: a finite number above 0, else 30000. Pure. */
export function parseTimeoutMs(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function timeoutFromEnv(): number {
  return parseTimeoutMs(process.env.GEMINI_TIMEOUT_MS);
}

/** The first candidate of the response envelope, if any. */
function firstCandidate(envelope: unknown): Record<string, unknown> | undefined {
  const candidates = (envelope as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(candidates)) return undefined;
  const first: unknown = candidates[0];
  return first !== null && typeof first === 'object' ? (first as Record<string, unknown>) : undefined;
}

/** The text parts of the first candidate, joined. Empty when blocked or empty. */
function candidateText(envelope: unknown): string {
  const parts = (firstCandidate(envelope)?.content as { parts?: unknown } | undefined)?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (part && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
    .join('');
}

/** The finish reasons of Gemini's `FinishReason` enum. A value outside the list is logged as `OTHER`. */
export const FINISH_REASONS: ReadonlySet<string> = new Set([
  'FINISH_REASON_UNSPECIFIED',
  'STOP',
  'MAX_TOKENS',
  'SAFETY',
  'RECITATION',
  'LANGUAGE',
  'OTHER',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'MALFORMED_FUNCTION_CALL',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_OTHER',
  'NO_IMAGE',
  'UNEXPECTED_TOOL_CALL',
  'TOO_MANY_TOOL_CALLS',
  'MISSING_THOUGHT_SIGNATURE',
  'MALFORMED_RESPONSE',
]);

/**
 * The finish reason of the first candidate: a string from `FINISH_REASONS`, `OTHER` for any other
 * string, `undefined` when there is none. Upstream text never reaches the caller.
 */
function finishReasonOf(envelope: unknown): string | undefined {
  const reason = firstCandidate(envelope)?.finishReason;
  if (typeof reason !== 'string') return undefined;
  return FINISH_REASONS.has(reason) ? reason : 'OTHER';
}

/** A token count that may be logged: a safe integer from 0 to 1,000,000. Anything else is omitted. */
function loggableCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
    ? value
    : undefined;
}

/** A status that may be logged and reported: an integer from 100 to 599, else 0. */
function loggableStatus(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : 0;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Token usage of a response. Thoughts are billed at the output rate. */
function usageOf(envelope: unknown): AttemptReport['usage'] {
  const meta = (envelope as { usageMetadata?: unknown } | null)?.usageMetadata;
  if (meta === null || typeof meta !== 'object') return undefined;
  const { promptTokenCount, candidatesTokenCount, thoughtsTokenCount } = meta as Record<string, unknown>;
  if (
    typeof promptTokenCount !== 'number' ||
    !Number.isFinite(promptTokenCount) ||
    promptTokenCount < 0
  ) {
    return undefined;
  }
  return {
    promptTokens: promptTokenCount,
    outputTokens: count(candidatesTokenCount) + count(thoughtsTokenCount),
  };
}

function modelVersionOf(envelope: unknown): string | undefined {
  const value = (envelope as { modelVersion?: unknown } | null)?.modelVersion;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Task 95: Gemini resilience. Default model `gemini-3.6-flash`; on 503/429/404
 * try the next model in GEMINI_MODEL_FALLBACKS before paw-core's retry/fallback.
 * Task 99: Remove gemini-2.5-flash from defaults, treat 404 like 503/429
 *
 * Talks to the REST API with plain `fetch`. The key travels only in the
 * `x-goog-api-key` header. Without a key the constructor still succeeds, the
 * client reports `available === false`, and `generate` rejects before any
 * request is made (Req 6.2: examples-only mode).
 *
 * Free tier (Requirement 13): a 429, or any non-200 answer whose error body says
 * `RESOURCE_EXHAUSTED`, is a quota attempt. The body of every non-200 answer is read
 * (at most 64 KB, under the attempt's timeout) only to decide that, whether a 400 or 500 is
 * billed, and its token counts, then dropped. A quota
 * shared by all models stops the chain; a per-model quota tries the next model. When the
 * chain ends without a success and any attempt was a quota attempt, the call throws
 * `QuotaExhaustedError`.
 *
 * Besides `generate`, it meters itself for the budget guard: `plan` says what
 * the attempts could cost at most, `generateMetered` reports what each HTTP
 * attempt really used.
 */
export class GeminiModelClient implements ModelClient {
  /** True only when a non-blank API key is configured. */
  readonly available: boolean;

  private readonly apiKey: string;
  private readonly models: string[];
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly log: (entry: ModelCallLogEntry) => void;

  constructor(options: GeminiClientOptions = {}) {
    this.apiKey = (options.apiKey ?? process.env.GEMINI_API_KEY ?? '').trim();
    this.available = this.apiKey !== '';

    // Primary model first, then fallbacks, trimmed and deduplicated
    const names = (options.models ?? modelsFromEnv()).map((name) => name.trim()).filter(Boolean);
    this.models = Array.from(new Set(names));

    this.timeoutMs = options.timeoutMs ?? timeoutFromEnv();
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.log = options.log ?? defaultLog;
  }

  /** Same as `generateMetered`, without anyone listening to the attempts. */
  async generate(prompt: string): Promise<unknown> {
    return this.generateMetered(prompt, () => {});
  }

  /**
   * One entry per model of the chain, in order. Pure: no I/O, no key needed.
   * The input estimate is `ceil((prompt + responseSchema characters) / 3)`.
   */
  plan(prompt: string): AttemptPlan[] {
    const inputTokens = this.inputTokensOf(prompt, this.schemaFor(prompt));
    return this.models.map((model) => ({ model, inputTokens, maxOutputTokens: MAX_OUTPUT_TOKENS }));
  }

  /**
   * Call Gemini with structured JSON output mode.
   * Tries each model in sequence on 503/429/404 and on a per-model quota answer; throws on
   * other errors. A shared quota answer stops the chain.
   * paw-core retries once then falls back.
   * Error messages carry only the model name and the HTTP status.
   *
   * `onAttempt` is called exactly once per HTTP attempt, whatever happened
   * (success, timeout, network error, any status, unreadable body, MAX_TOKENS,
   * bad JSON), before the next attempt starts and before the promise settles.
   */
  async generateMetered(
    prompt: string,
    onAttempt: (report: AttemptReport) => void,
  ): Promise<unknown> {
    if (!this.available) {
      throw new Error('Model client has no API key');
    }

    const responseSchema = this.schemaFor(prompt);
    const inputTokens = this.inputTokensOf(prompt, responseSchema);

    let lastError: Error = new Error('No Gemini model is configured');
    let sawQuota = false;

    for (const modelName of this.models) {
      const outcome = await this.callModel(modelName, prompt, responseSchema, inputTokens, onAttempt);
      if (outcome.kind === 'ok') {
        return outcome.value;
      }
      lastError = outcome.error;
      if (outcome.quota) sawQuota = true;
      if (outcome.stop) break;
    }

    // The chain ended without a success: all models tried, or a shared quota stopped it.
    if (sawQuota) throw new QuotaExhaustedError();
    throw lastError;
  }

  /** Characters of one request as the input estimate counts them: the prompt plus its response schema. */
  requestChars(prompt: string): number {
    return this.requestCharsOf(prompt, this.schemaFor(prompt));
  }

  private requestCharsOf(prompt: string, responseSchema: unknown): number {
    const schemaLength = responseSchema ? JSON.stringify(responseSchema).length : 0;
    return prompt.length + schemaLength;
  }

  private inputTokensOf(prompt: string, responseSchema: unknown): number {
    return Math.ceil(this.requestCharsOf(prompt, responseSchema) / 3);
  }

  /**
   * Task 101: Use hand-written Gemini structured output schemas.
   * The prompt determines which schema to use based on the "Task:" prefix.
   */
  private schemaFor(prompt: string): unknown {
    if (prompt.includes('Task: GRANT_WISH')) return this.grantWishSchema();
    if (prompt.includes('Task: JUDGE_VERDICT')) return this.verdictSchema();
    if (prompt.includes('Task: JUDGE_QUALITY')) return this.qualityGateSchema();
    if (prompt.includes('Task: JUDGE_BATCH_QUALITY')) return this.batchQualityGateSchema();
    if (prompt.includes('Task: REPLACE_CURSE')) return this.replaceCurseSchema();
    return undefined;
  }

  private async callModel(
    modelName: string,
    prompt: string,
    responseSchema: unknown,
    inputTokens: number,
    onAttempt: (report: AttemptReport) => void,
  ): Promise<
    { kind: 'ok'; value: unknown } | { kind: 'next'; error: Error; quota: boolean; stop: boolean }
  > {
    const generationConfig: Record<string, unknown> = {
      responseMimeType: 'application/json',
      // `low` is supported by every model in the chain. Thinking tokens count toward maxOutputTokens.
      thinkingConfig: { thinkingLevel: 'low' },
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    };

    if (responseSchema) {
      generationConfig.responseSchema = responseSchema;
    }

    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig,
    });

    const url = `${API_BASE}/${encodeURIComponent(modelName)}:generateContent`;
    const abortController = new AbortController();
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, this.timeoutMs);

    const startedAt = Date.now();
    let status = 0;
    let ok = false;
    let finishReason: string | undefined;
    const report: AttemptReport = { model: modelName, inputTokens, maxOutputTokens: MAX_OUTPUT_TOKENS };

    try {
      let text: string;
      try {
        const response = await this.fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
          body,
          signal: abortController.signal,
        });
        status = loggableStatus(response.status);

        if (status !== 200) {
          // Read (capped, under this attempt's signal), reduced to a verdict, dropped.
          const errorBody = await readErrorBody(response, abortController.signal);
          const error = new Error(`Model call failed (${modelName}: HTTP ${status})`);
          const hint = retryHintOf(errorBody, response, status); // a number only; nothing else is kept
          if (hint !== undefined) report.retryAfterSeconds = hint;
          const quota = status === 429 || isResourceExhausted(errorBody);
          if (quota) {
            report.quota = true;
            return { kind: 'next', error, quota: true, stop: quotaScopeOf(errorBody) === 'shared' };
          }
          if (UNBILLED_STATUSES.has(status) && !abortController.signal.aborted) {
            if (isRecord(errorBody) && errorBody.usageMetadata != null) {
              // usage reported: charged by it; unreadable usage keeps the ceiling
              const usage = usageOf(errorBody);
              if (usage) {
                report.usage = usage;
                const version = modelVersionOf(errorBody); // only to price that usage; never logged
                if (version) report.modelVersion = version;
              }
            } else {
              report.unbilled = true;
            }
          }
          // A location refusal stops the chain: every model would be refused from here.
          if (status === 400 && isLocationRefusal(errorBody)) {
            throw new LocationRefusedError();
          }
          if (NEXT_MODEL_STATUSES.has(status)) {
            return { kind: 'next', error, quota: false, stop: false };
          }
          throw error;
        }

        text = await response.text();
      } catch (err) {
        if (timedOut) {
          throw new Error('Model call timed out');
        }
        if (status !== 0 && status !== 200) {
          throw err; // our own "HTTP <status>" error from above
        }
        // Network failure or unreadable body; keep the cause out of the message.
        throw new Error(`Model call failed (${modelName}: no response)`);
      }

      let envelope: unknown;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw new Error(`Model call failed (${modelName}: unreadable response)`);
      }

      // The tokens are billed whatever the text turns out to be.
      const usage = usageOf(envelope);
      if (usage) report.usage = usage;
      const modelVersion = modelVersionOf(envelope);
      if (modelVersion) report.modelVersion = modelVersion;
      finishReason = finishReasonOf(envelope);

      // Cut off by maxOutputTokens: a failed attempt, charged by its usage. The next model
      // would be cut off too, so it does not move on; paw-core retries once, then falls back.
      if (finishReason === 'MAX_TOKENS') {
        throw new Error(`Model call failed (${modelName}: output cut off)`);
      }

      const modelText = candidateText(envelope);
      if (modelText.trim() === '') {
        throw new Error(`Model call failed (${modelName}: no text returned)`);
      }

      let value: unknown;
      try {
        // Return parsed JSON for paw-core to validate
        value = JSON.parse(modelText);
      } catch {
        throw new Error(`Model call failed (${modelName}: response is not JSON)`);
      }

      ok = true;
      return { kind: 'ok', value };
    } finally {
      clearTimeout(timeoutHandle);
      const entry: ModelCallLogEntry = {
        event: 'model_call',
        model: modelName,
        status,
        ms: Date.now() - startedAt,
        ok,
      };
      // The charge uses report.usage as it is. The log carries a count only when it is a small integer.
      const promptTokens = loggableCount(report.usage?.promptTokens);
      const outputTokens = loggableCount(report.usage?.outputTokens);
      if (promptTokens !== undefined) entry.promptTokens = promptTokens;
      if (outputTokens !== undefined) entry.outputTokens = outputTokens;
      if (finishReason) entry.finishReason = finishReason;
      this.log(entry);
      onAttempt(report);
    }
  }

  /**
   * Task 101: Grant output schema for buildPawPrompt + buildGeniePrompt.
   * Model-facing shape: {narration, userStory, wishCriterion, curses[{type, story, loophole}]}; the system assigns ids.
   */
  private grantWishSchema(): any {
    return {
      type: 'object',
      properties: {
        narration: { type: 'string' },
        userStory: { type: 'string' },
        wishCriterion: { type: 'string' },
        curses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: [
                  'permissions',
                  'time',
                  'money',
                  'scale',
                  'abuse',
                  'privacy',
                  'accessibility',
                  'data-loss',
                  'concurrency',
                  'edge-input',
                ],
              },
              story: { type: 'string' },
              loophole: { type: 'string' },
            },
            required: ['type', 'story', 'loophole'],
          },
        },
      },
      required: ['narration', 'userStory', 'wishCriterion', 'curses'],
    };
  }

  /**
   * Task 101: Verdict schema for buildJudgePrompt (verdict mode).
   * Model-facing shape: {closed, reason, property}; the system adds curseId and judgedAt.
   */
  private verdictSchema(): any {
    return {
      type: 'object',
      properties: {
        closed: { type: 'boolean' },
        reason: { type: 'string' },
        property: { type: 'string' },
      },
      required: ['closed', 'reason', 'property'],
    };
  }

  /**
   * Task 101: Quality gate schema for buildJudgePrompt (quality mode).
   * Matches QualityGateSchema: {specific, reason}
   */
  private qualityGateSchema(): any {
    return {
      type: 'object',
      properties: {
        specific: { type: 'boolean' },
        reason: { type: 'string' },
      },
      required: ['specific', 'reason'],
    };
  }

  /**
   * Task 101: Batch quality gate schema for buildBatchQualityPrompt.
   * Matches BatchQualityGateSchema: array of {curseId, specific, reason}
   */
  private batchQualityGateSchema(): any {
    return {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          curseId: { type: 'string' },
          specific: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['curseId', 'specific', 'reason'],
      },
    };
  }

  /**
   * Task 101: Curse replacement schema for buildReplacementPrompt.
   * Matches a single curse: {type, story, loophole}; the original id is kept.
   */
  private replaceCurseSchema(): any {
    return {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [
            'permissions',
            'time',
            'money',
            'scale',
            'abuse',
            'privacy',
            'accessibility',
            'data-loss',
            'concurrency',
            'edge-input',
          ],
        },
        story: { type: 'string' },
        loophole: { type: 'string' },
      },
      required: ['type', 'story', 'loophole'],
    };
  }
}
