// judgeBinding: build Judge prompt, call model, parse with VerdictSchema,
// retry once, fall back to closed: false on second failure.

import { VerdictSchema } from './schemas';
import { buildJudgePrompt } from './prompts';
import type { Binding, Curse, ModelClient, Verdict } from './types';

/** Accept raw model output (string or already-parsed) and return a JSON value. */
function toJson(raw: unknown): unknown {
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

const FALLBACK_VERDICT = (curse: Curse, binding: Binding): Verdict => ({
  curseId: curse.id,
  closed: false,
  reason: 'The Judge could not be roused; the loophole remains open.',
  judgedAt: Date.now(),
});

/**
 * Judge a binding: decide whether it closes the loophole in the curse.
 * On model failure (after one retry), falls back to closed: false.
 */
export async function judgeBinding(
  curse: Curse,
  binding: Binding,
  model: ModelClient,
): Promise<Verdict> {
  const prompt = buildJudgePrompt(curse, binding, 'verdict');

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await model.generate(prompt);
      const parsed = VerdictSchema.parse(toJson(raw)) as Verdict;
      return { ...parsed, judgedAt: Date.now() };
    } catch {
      // retry once, then fall back below
    }
  }

  return FALLBACK_VERDICT(curse, binding);
}
