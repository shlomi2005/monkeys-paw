import type { ModelClient } from 'paw-core';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.5-flash';
const DEFAULT_FALLBACKS = 'gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite';
const DEFAULT_TIMEOUT_MS = 30_000;

/** HTTP statuses that mean "this model is unavailable right now": try the next one. */
const NEXT_MODEL_STATUSES = new Set([503, 429, 404]);

/** One metadata line per HTTP attempt. Never the prompt, the response text or the key. */
export interface ModelCallLogEntry {
  event: 'model_call';
  model: string;
  /** HTTP status, or 0 when no response arrived (timeout, network failure). */
  status: number;
  ms: number;
  ok: boolean;
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

/** The text parts of the first candidate, joined. Empty when blocked or empty. */
function candidateText(envelope: unknown): string {
  const candidates = (envelope as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(candidates)) return '';
  const parts = (candidates[0] as { content?: { parts?: unknown } } | undefined)?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (part && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
    .join('');
}

/**
 * Task 95: Gemini resilience. Default model `gemini-3.5-flash`; on 503/429/404
 * try the next model in GEMINI_MODEL_FALLBACKS before paw-core's retry/fallback.
 * Task 99: Remove gemini-2.5-flash from defaults, treat 404 like 503/429
 *
 * Talks to the REST API with plain `fetch`. The key travels only in the
 * `x-goog-api-key` header. Without a key the constructor still succeeds, the
 * client reports `available === false`, and `generate` rejects before any
 * request is made (Req 6.2: examples-only mode).
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

  /**
   * Call Gemini with structured JSON output mode.
   * Tries each model in sequence on 503/429/404; throws on other errors.
   * paw-core retries once then falls back.
   * Error messages carry only the model name and the HTTP status.
   */
  async generate(prompt: string): Promise<unknown> {
    if (!this.available) {
      throw new Error('Model client has no API key');
    }

    let lastError: Error = new Error('No Gemini model is configured');

    for (const modelName of this.models) {
      const outcome = await this.callModel(modelName, prompt);
      if (outcome.kind === 'ok') {
        return outcome.value;
      }
      lastError = outcome.error;
    }

    // All models exhausted
    throw lastError;
  }

  private async callModel(
    modelName: string,
    prompt: string,
  ): Promise<{ kind: 'ok'; value: unknown } | { kind: 'next'; error: Error }> {
    // Task 101: Use hand-written Gemini structured output schemas.
    // The prompt determines which schema to use based on the "Task:" prefix.
    let responseSchema: unknown;

    if (prompt.includes('Task: GRANT_WISH')) {
      responseSchema = this.grantWishSchema();
    } else if (prompt.includes('Task: JUDGE_VERDICT')) {
      responseSchema = this.verdictSchema();
    } else if (prompt.includes('Task: JUDGE_QUALITY')) {
      responseSchema = this.qualityGateSchema();
    } else if (prompt.includes('Task: JUDGE_BATCH_QUALITY')) {
      responseSchema = this.batchQualityGateSchema();
    } else if (prompt.includes('Task: REPLACE_CURSE')) {
      responseSchema = this.replaceCurseSchema();
    }

    const generationConfig: Record<string, unknown> = {
      responseMimeType: 'application/json',
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
      this.log({ event: 'model_call', model: modelName, status, ms: Date.now() - startedAt, ok });
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
