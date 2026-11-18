import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ModelClient } from 'paw-core';

/**
 * Implements ModelClient for Gemini Flash.
 * Reads API key from GEMINI_API_KEY env var; throws if absent.
 * Enforces configurable timeout (default 30s).
 * Returns raw JSON text for paw-core to validate.
 */
export class GeminiModelClient implements ModelClient {
  private client: GoogleGenerativeAI;
  private timeoutMs: number;

  constructor(timeoutMs: number = 30_000) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY env var is not set');
    }
    this.client = new GoogleGenerativeAI(apiKey);
    this.timeoutMs = timeoutMs;
  }

  /**
   * Call Gemini Flash with structured JSON output mode.
   * Throws on timeout or network error; paw-core retries once then falls back.
   */
  async generate(prompt: string): Promise<unknown> {
    const model = this.client.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      const response = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
        },
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
}
