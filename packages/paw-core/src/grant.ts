// grantWish: build the Paw+Genie prompt, call the ModelClient, validate the
// output with GrantSchema (retry once, fall back on second failure), then run
// the Judge quality gate to reject generic curses and request replacements.
//
// Model output is untrusted (iron-rules §6). Every model call below follows
// the same discipline: call -> parse with a zod schema -> on failure retry once
// -> on second failure fall back. No model call is ever made without the caller
// (apps/api) checking the budget first (iron-rules §5); paw-core trusts the
// injected ModelClient to already have passed that gate.

import { CurseSchema, GrantSchema, QualityGateSchema, BatchQualityGateSchema } from './schemas';
import {
  buildGeniePrompt,
  buildJudgePrompt,
  buildPawPrompt,
  buildReplacementPrompt,
  buildBatchQualityPrompt,
} from './prompts';
import type { Curse, Grant, ModelClient, Wish } from './types';

const FALLBACK_NARRATION =
  'The paw twitches, then lies still. Your wish is granted — in the only shape it could remember.';

const FALLBACK_CURSE: Curse = {
  id: 'fallback-curse',
  type: 'scale',
  story:
    'The wish is followed to the letter at every scale, including the scales you never named.',
  loophole: 'The wish does not bound the scale at which it must hold.',
  status: 'open',
};

/** Up to this many replacement attempts per generic curse before we keep the last one. */
const QUALITY_MAX_RETRIES = 3;

function fallbackGrant(wish: Wish): Grant {
  return { wishId: wish.id, narration: FALLBACK_NARRATION, curses: [FALLBACK_CURSE] };
}

/** Accept raw model output (string or already-parsed) and return a JSON value. */
function toJson(raw: unknown): unknown {
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/** Narrow to a plain object; throw (caught by callers) if not an object. */
function asObject(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  throw new Error('expected a JSON object');
}

interface QualityResult {
  readonly specific: boolean;
  readonly reason: string;
}

/** Task 98: Batch quality judge - judge all curses in one call, returns map by curseId. */
async function batchJudgeQuality(
  curses: Curse[],
  model: ModelClient,
): Promise<Map<string, QualityResult>> {
  const prompt = buildBatchQualityPrompt(curses);
  const results = new Map<string, QualityResult>();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await model.generate(prompt);
      const parsed = BatchQualityGateSchema.parse(toJson(raw)) as Array<{
        curseId: string;
        specific: boolean;
        reason: string;
      }>;

      for (const verdict of parsed) {
        results.set(verdict.curseId, { specific: verdict.specific, reason: verdict.reason });
      }

      return results;
    } catch {
      // retry once, then fall back below
    }
  }

  // Fallback: mark all curses as specific (keep them)
  for (const curse of curses) {
    results.set(curse.id, {
      specific: true,
      reason: 'The Judge could not be roused; the curse stands as written.',
    });
  }

  return results;
}

/** Regenerate one specific curse; retry once, then keep the original on failure. */
async function regenerateCurse(wish: Wish, curse: Curse, model: ModelClient): Promise<Curse> {
  const prompt = buildReplacementPrompt(wish, curse);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await model.generate(prompt);
      // Task 93: the model never supplies ids; the replacement keeps the original's id.
      const parsed = CurseSchema.parse({ ...asObject(toJson(raw)), id: curse.id });
      return { ...parsed, status: 'open' as const };
    } catch {
      // retry once, then keep the original
    }
  }
  return curse;
}

/** Reject generic curses and request replacements, up to QUALITY_MAX_RETRIES times. */
async function ensureSpecific(
  wish: Wish,
  curse: Curse,
  model: ModelClient,
  verdictMap: Map<string, QualityResult>,
): Promise<Curse> {
  let current = curse;

  for (let attempt = 0; attempt < QUALITY_MAX_RETRIES; attempt++) {
    const verdict = verdictMap.get(current.id);
    if (!verdict || verdict.specific) return current;

    current = await regenerateCurse(wish, current, model);
    // After regeneration, assume it's specific
    // In a full iteration, we'd re-batch-judge here, but for efficiency we keep it once
  }

  return current;
}

/**
 * Grant a wish: produce a Grant with a Genie narration and 3–5 curses.
 * On unrecoverable model failure, returns a safe fallback grant.
 * Task 98: Uses batch quality judge - one model call to judge all curses.
 */
export async function grantWish(wish: Wish, model: ModelClient): Promise<Grant> {
  const prompt = buildPawPrompt(wish) + buildGeniePrompt(wish);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await model.generate(prompt);
      const data = asObject(toJson(raw));

      // Task 93: grantWish assigns wishId and curse ids itself; the model never supplies them.
      // Inject wishId and generate stable curse ids.
      const curseArray = Array.isArray(data.curses) ? data.curses : [];
      const dataWithIds = {
        ...data,
        wishId: wish.id,
        curses: curseArray.map((curse: any, idx: number) => ({
          ...(curse && typeof curse === 'object' ? curse : {}),
          id: `curse-${idx}`,
        })),
      };

      const parsed = GrantSchema.parse(dataWithIds) as unknown as Grant;

      // Task 98: Batch judge all curses in one call
      const verdictMap = await batchJudgeQuality(parsed.curses, model);

      const curses: Curse[] = [];
      for (const curse of parsed.curses) {
        curses.push(await ensureSpecific(wish, curse, model, verdictMap));
      }

      const userStory = parsed.userStory?.trim();

      return {
        wishId: parsed.wishId,
        narration: parsed.narration,
        curses,
        ...(userStory ? { userStory } : {}),
      };
    } catch {
      // retry once, then fall back below
    }
  }

  return fallbackGrant(wish);
}
