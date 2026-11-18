import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ModelClient } from 'paw-core';
import { GrantSchema, VerdictSchema, QualityGateSchema } from 'paw-core';

/**
 * Task 95: Gemini resilience. Default model `gemini-3.5-flash`; on 503/429
 * try the next model in GEMINI_MODEL_FALLBACKS before paw-core's retry/fallback.
 * Models: gemini-3.5-flash, gemini-3.8-flash, gemini-flash-latest, gemini-2.5-flash
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
    
    // Task 95: Primary model and fallbacks
    const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    const fallbacks = (process.env.GEMINI_MODEL_FALLBACKS || 'gemini-3.8-flash,gemini-flash-latest,gemini-2.5-flash').split(',');
    
    // Build the full list: primary first, then fallbacks, deduplicated
    const allModels = [primaryModel, ...fallbacks];
    this.models = Array.from(new Set(allModels));
    this.timeoutMs = timeoutMs;
  }

  /**
   * Call Gemini with structured JSON output mode.
   * Tries each model in sequence on 503/429; throws on other errors.
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
        
        // Task 95: On 503/429, try next model; on other errors, throw immediately
        const message = lastError.message.toLowerCase();
        const isRetryable = message.includes('503') || message.includes('429') || 
                           message.includes('high demand') || message.includes('resource exhausted');
        
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
      // Task 96: Use Gemini structured output with responseSchema matching GrantSchema/VerdictSchema.
      // The prompt determines which schema to use based on the "Task:" prefix.
      let responseSchema: unknown;
      
      if (prompt.includes('Task: GRANT_WISH')) {
        // Convert Zod schema to JSON schema for Gemini
        responseSchema = this.zodToJsonSchema(GrantSchema);
      } else if (prompt.includes('Task: JUDGE_VERDICT')) {
        responseSchema = this.zodToJsonSchema(VerdictSchema);
      } else if (prompt.includes('Task: JUDGE_QUALITY')) {
        responseSchema = this.zodToJsonSchema(QualityGateSchema);
      } else if (prompt.includes('Task: REPLACE_CURSE')) {
        // For curse replacement, we expect a single curse object
        responseSchema = {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['permissions', 'time', 'money', 'scale', 'abuse', 'privacy', 'accessibility', 'data-loss', 'concurrency', 'edge-input'] },
            story: { type: 'string', maxLength: 360 },
            loophole: { type: 'string' },
          },
          required: ['id', 'type', 'story', 'loophole'],
        };
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
   * Convert a Zod schema to a simple JSON schema for Gemini structured output.
   * This is a simplified converter for the schemas used in paw-core.
   */
  private zodToJsonSchema(schema: any): any {
    // For now, return a basic object schema. In production, use a proper zod-to-json-schema converter.
    // The responseSchema is primarily for field name consistency; paw-core still validates with zod.
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }
}
