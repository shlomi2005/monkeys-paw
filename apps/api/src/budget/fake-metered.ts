import type { AttemptPlan, AttemptReport } from '../client/gemini';
import { MAX_OUTPUT_TOKENS } from '../client/gemini';
import type { MeteredModelClient } from './guarded-client';

/**
 * A fake `MeteredModelClient` for tests. It makes no HTTP call. Each
 * `generateMetered` runs `answer`, then reports one attempt, whether `answer`
 * returned or threw (a failed call is billed too).
 *
 * Tests that are about settling a real fallback chain use the real
 * `GeminiModelClient` with a stubbed `fetch` instead.
 */
export interface FakeMeteredOptions {
  /** False means no API key. Default true. */
  available?: boolean;
  /** The answer to a prompt. Default `{ ok: true }`. Subclasses may override `answer`. */
  answer?: (prompt: string) => Promise<unknown>;
  /**
   * The attempts `plan` returns. Default: one attempt on gemini-3.6-flash with
   * `ceil(prompt.length / 3)` input tokens and the real `MAX_OUTPUT_TOKENS`.
   */
  plan?: AttemptPlan[];
  /**
   * What the one reported attempt used. Default: the planned input tokens and 100
   * output tokens. `null` reports no usage at all. `'ceiling'` uses the planned
   * input tokens and the whole output cap.
   */
  usage?: { promptTokens: number; outputTokens: number } | null | 'ceiling';
  /** The `modelVersion` of the reported attempt. Default none. */
  modelVersion?: string;
  /** Report nothing, as a client that dies before any attempt would. */
  silent?: boolean;
}

export class FakeMeteredModel implements MeteredModelClient {
  /** `generate` and `generateMetered` calls that reached the fake. */
  calls = 0;
  available: boolean;

  constructor(protected readonly options: FakeMeteredOptions = {}) {
    this.available = options.available ?? true;
  }

  protected async answer(prompt: string): Promise<unknown> {
    return this.options.answer ? this.options.answer(prompt) : { ok: true };
  }

  plan(prompt: string): AttemptPlan[] {
    return (
      this.options.plan ?? [
        {
          model: 'gemini-3.6-flash',
          inputTokens: Math.ceil(prompt.length / 3),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      ]
    );
  }

  async generateMetered(
    prompt: string,
    onAttempt: (report: AttemptReport) => void,
  ): Promise<unknown> {
    this.calls += 1;
    try {
      return await this.answer(prompt);
    } finally {
      if (!this.options.silent) onAttempt(this.report(prompt));
    }
  }

  generate(prompt: string): Promise<unknown> {
    return this.generateMetered(prompt, () => {});
  }

  private report(prompt: string): AttemptReport {
    const planned = this.plan(prompt)[0];
    const report: AttemptReport = { ...planned };
    const usage = this.options.usage;
    if (usage === 'ceiling') {
      report.usage = { promptTokens: planned.inputTokens, outputTokens: planned.maxOutputTokens };
    } else if (usage === undefined) {
      report.usage = { promptTokens: planned.inputTokens, outputTokens: 100 };
    } else if (usage !== null) {
      report.usage = usage;
    }
    if (this.options.modelVersion) report.modelVersion = this.options.modelVersion;
    return report;
  }
}
