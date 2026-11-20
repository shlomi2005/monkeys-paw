import type { ModelClient } from 'paw-core';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * `gemini-3.5-flash` is a retired name; its endpoint routes to `gemini-3.6-flash`.
 * Source: https://ai.google.dev/gemini-api/docs/deprecations (checked 2026-11-20).
 */
export const DEFAULT_MODEL = 'gemini-3.6-flash';

/** `gemini-3.1-flash-lite` shuts down on 2027-05-07. It stays as the last fallback until then. */
const DEFAULT_FALLBACKS = 'gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite';

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

/** HTTP statuses that mean "this model is unavailable right now": try the next one. */
const NEXT_MODEL_STATUSES = new Set([503, 429, 404]);

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
}

/** One metadata line per HTTP attempt. Numbers and enums only; never the prompt, the response text or the key. */
export interface ModelCallLogEntry {
  event: 'model_call';
  model: string;
  /** HTTP status, or 0 when no response arrived (timeout, network failure). */
  status: number;
  ms: number;
  ok: boolean;
  promptTokens?: number;
  outputTokens?: number;
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

function timeoutFromEnv(): number {
  const parsed = Number(process.env.GEMINI_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
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

/** The finish reason of the first candidate, only when it looks like an enum (e.g. STOP, MAX_TOKENS). */
function finishReasonOf(envelope: unknown): string | undefined {
  const reason = firstCandidate(envelope)?.finishReason;
  return typeof reason === 'string' && /^[A-Z_]{1,40}$/.test(reason) ? reason : undefined;
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
   * Tries each model in sequence on 503/429/404; throws on other errors.
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

    for (const modelName of this.models) {
      const outcome = await this.callModel(modelName, prompt, responseSchema, inputTokens, onAttempt);
      if (outcome.kind === 'ok') {
        return outcome.value;
      }
      lastError = outcome.error;
    }

    // All models exhausted
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
  ): Promise<{ kind: 'ok'; value: unknown } | { kind: 'next'; error: Error }> {
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
        status = response.status;

        if (status !== 200) {
          // Not read; release the connection.
          void response.body?.cancel().catch(() => undefined);
          const error = new Error(`Model call failed (${modelName}: HTTP ${status})`);
          if (NEXT_MODEL_STATUSES.has(status)) {
            return { kind: 'next', error };
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
      const modelVersion = (envelope as { modelVersion?: unknown } | null)?.modelVersion;
      if (typeof modelVersion === 'string' && modelVersion !== '') report.modelVersion = modelVersion;
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
      if (report.usage) {
        entry.promptTokens = report.usage.promptTokens;
        entry.outputTokens = report.usage.outputTokens;
      }
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
