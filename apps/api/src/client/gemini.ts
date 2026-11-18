import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ModelClient } from 'paw-core';

/**
 * Task 95: Gemini resilience. Default model `gemini-3.5-flash`; on 503/429/404
 * try the next model in GEMINI_MODEL_FALLBACKS before paw-core's retry/fallback.
 * Task 99: Remove gemini-2.5-flash from defaults, treat 404 like 503/429
 */
export class GeminiModelClient implements ModelClient {
  private client: GoogleGenerativeAI;
  private models: string[];
  private timeoutMs: number;

  constructor(timeoutMs: number = 30_000) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY env var is not set');
    }
    this.client = new GoogleGenerativeAI(apiKey);

    // Task 99: Primary model and fallbacks (no gemini-2.5-flash)
    const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    const fallbacks = (
      process.env.GEMINI_MODEL_FALLBACKS ||
      'gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite'
    ).split(',');

    // Build the full list: primary first, then fallbacks, deduplicated
    const allModels = [primaryModel, ...fallbacks];
    this.models = Array.from(new Set(allModels));
    this.timeoutMs = timeoutMs;
  }

  /**
   * Call Gemini with structured JSON output mode.
   * Tries each model in sequence on 503/429/404; throws on other errors.
   * paw-core retries once then falls back.
   */
  async generate(prompt: string): Promise<unknown> {
    let lastError: Error | null = null;

    // Try each model in the list
    for (const modelName of this.models) {
      try {
        return await this.callModel(modelName, prompt);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Task 99: On 503/429/404, try next model; on other errors, throw immediately
        const message = lastError.message.toLowerCase();
        const isRetryable =
          message.includes('503') ||
          message.includes('429') ||
          message.includes('404') ||
          message.includes('high demand') ||
          message.includes('resource exhausted') ||
          message.includes('not found');

        if (!isRetryable) {
          throw lastError;
        }

        // Continue to next model
      }
    }

    // All models exhausted
    throw lastError || new Error('All Gemini models failed');
  }

  private async callModel(modelName: string, prompt: string): Promise<unknown> {
    const model = this.client.getGenerativeModel({ model: modelName });

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
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

      const generationConfig: any = {
        responseMimeType: 'application/json',
      };

      if (responseSchema) {
        generationConfig.responseSchema = responseSchema;
      }

      const response = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      });

      clearTimeout(timeoutHandle);

      const text = response.response.text();
      // Return parsed JSON for paw-core to validate
      return JSON.parse(text);
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Model call timed out');
      }
      throw err;
    }
  }

  /**
   * Task 101: Grant output schema for buildPawPrompt + buildGeniePrompt.
   * Matches GrantSchema: {narration, userStory?, curses[{id, type, story, loophole}]}
   */
  private grantWishSchema(): any {
    return {
      type: 'object',
      properties: {
        narration: { type: 'string' },
        userStory: { type: 'string' },
        curses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
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
            required: ['id', 'type', 'story', 'loophole'],
          },
        },
      },
      required: ['narration', 'curses'],
    };
  }

  /**
   * Task 101: Verdict schema for buildJudgePrompt (verdict mode).
   * Matches VerdictSchema: {curseId, closed, reason, judgedAt, property?}
   */
  private verdictSchema(): any {
    return {
      type: 'object',
      properties: {
        curseId: { type: 'string' },
        closed: { type: 'boolean' },
        reason: { type: 'string' },
        judgedAt: { type: 'number' },
        property: { type: 'string' },
      },
      required: ['curseId', 'closed', 'reason', 'judgedAt'],
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
   * Matches a single curse: {id, type, story, loophole}
   */
  private replaceCurseSchema(): any {
    return {
      type: 'object',
      properties: {
        id: { type: 'string' },
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
      required: ['id', 'type', 'story', 'loophole'],
    };
  }
}
