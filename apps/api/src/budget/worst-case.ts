import {
  buildBatchQualityPrompt,
  buildGeniePrompt,
  buildJudgePrompt,
  buildPawPrompt,
  buildReplacementPrompt,
} from 'paw-core';
import type { Binding, Curse, Wish } from 'paw-core';
import { DEFAULT_MODEL_CHAIN, GeminiModelClient } from '../client/gemini';
import {
  MAX_CLAUSE_CHARS,
  MAX_LOOPHOLE_CHARS,
  MAX_WISH_CONTEXT_CHARS,
  MAX_WISH_TEXT_CHARS,
} from '../schemas';
import { DEFAULT_PRICE_TABLE, attemptCostCents, priceFor } from './prices';
import type { PriceTable } from './prices';

/**
 * The worst case of one grant and one bind, in cents (paw-api task 108).
 *
 * Pure: it builds the real prompts with paw-core's prompt builders at their
 * maximum size, asks the real `GeminiModelClient.plan()` (default model chain,
 * no key needed) what each attempt could cost at most, and prices that with the
 * price table. Nothing here calls the network.
 *
 * The call counts come from `packages/paw-core/src/grant.ts` and `judge.ts`
 * exactly as they are today. A grant makes up to 34 `generate` calls:
 * - GENIE_CALLS = 2: the Paw+Genie prompt, `for (attempt < 2)` in `grantWish`;
 *   the second attempt is the retry after a first answer that failed validation.
 *   Only a failed genie answer retries, and a failed answer never reaches the next step.
 * - BATCH_CALLS = 2: `batchJudgeQuality`, `for (attempt < 2)`.
 * - REPLACEMENT_CALLS = 30: `ensureSpecific` runs `QUALITY_MAX_RETRIES = 3`
 *   regenerations per curse, never judging the replacement again (the verdict map is
 *   fixed), and `regenerateCurse` makes up to 2 `generate` calls each; up to 5 curses
 *   (GrantSchema allows 3 to 5): 5 x 3 x 2 = 30.
 * A bind makes up to 2 calls: `judgeBinding`, `for (attempt < 2)`.
 * Each `generate` call is charged at most its full chain ceiling.
 */

/** `grantWish`: the Paw+Genie prompt is tried at most twice. */
export const GENIE_CALLS = 2;
/** `batchJudgeQuality`: tried at most twice. */
export const BATCH_CALLS = 2;
/** Most curses in a grant: `GrantSchema` allows 3 to 5. */
export const MAX_CURSES = 5;
/** `QUALITY_MAX_RETRIES` in paw-core's `grant.ts`: regenerations per generic curse. */
export const REGENERATIONS_PER_CURSE = 3;
/** `regenerateCurse`: each regeneration tries `generate` at most twice. */
export const CALLS_PER_REGENERATION = 2;
/** 5 curses x 3 regenerations x 2 calls. */
export const REPLACEMENT_CALLS = MAX_CURSES * REGENERATIONS_PER_CURSE * CALLS_PER_REGENERATION;
/** 2 + 2 + 30. */
export const GRANT_CALLS = GENIE_CALLS + BATCH_CALLS + REPLACEMENT_CALLS;
/** `judgeBinding`: tried at most twice. */
export const BIND_CALLS = 2;

/** `story` is capped by `CurseSchema` (30 words, about 360 characters). */
export const MAX_STORY_CHARS = 360;
/** The longest curse type tag. */
export const LONGEST_CURSE_TYPE = 'accessibility';
/** The longer of the two binding kinds. */
export const LONGEST_BINDING_KIND = 'ears-clause';

/** The golden wishes the CI eval grants (`pnpm -C apps/api eval` defaults to `--limit 5`). */
export const CI_EVAL_WISHES = 5;

export type PromptKind = 'genie' | 'batch' | 'replacement' | 'judge';

export interface AttemptCeiling {
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCents: number;
  outputCents: number;
  cents: number;
}

/** The ceiling of one `generate` call of one kind at its maximum size, over the whole chain. */
export interface PromptCeiling {
  kind: PromptKind;
  /** Prompt characters. */
  promptChars: number;
  /** Prompt plus response schema characters: what the input estimate divides by 3. */
  requestChars: number;
  attempts: AttemptCeiling[];
  ceilingCents: number;
}

export interface WorstCase {
  genie: PromptCeiling;
  batch: PromptCeiling;
  replacement: PromptCeiling;
  judge: PromptCeiling;
  /** 2 genie + 2 batch + 30 replacement ceilings. */
  grantCents: number;
  /** 2 judge ceilings. */
  bindCents: number;
  /** `ceil(5 x grantCents)`: the cap of the CI eval. */
  ciEvalCapCents: number;
  /**
   * What a typical grant reserves: one genie call and one batch judge call at typical
   * sizes, each at its whole-chain ceiling. Both then settle to their real usage.
   */
  typicalGrantReserveCents: number;
}

const filler = (length: number, char: string): string => char.repeat(length);

function wishOf(textChars: number, contextChars: number): Wish {
  return {
    id: 'worst-case',
    text: filler(textChars, 'w'),
    context: filler(contextChars, 'c'),
    createdAt: 0,
  };
}

function curseOf(index: number, storyChars: number, loopholeChars: number): Curse {
  return {
    id: `curse-${index}`,
    type: LONGEST_CURSE_TYPE as Curse['type'],
    story: filler(storyChars, 's'),
    loophole: filler(loopholeChars, 'l'),
    status: 'open',
  };
}

/**
 * A typical grant, for contrast only: a wish of 100 characters with 50 of context,
 * and 4 curses with a 200-character story and a 100-character loophole.
 */
export const TYPICAL_WISH_CHARS = 100;
export const TYPICAL_CONTEXT_CHARS = 50;
export const TYPICAL_CURSES = 4;
export const TYPICAL_STORY_CHARS = 200;
export const TYPICAL_LOOPHOLE_CHARS = 100;

function ceilingOf(
  kind: PromptKind,
  prompt: string,
  client: GeminiModelClient,
  prices: PriceTable,
): PromptCeiling {
  const attempts = client.plan(prompt).map((attempt): AttemptCeiling => {
    const price = priceFor(prices, attempt.model);
    const inputCents = attemptCostCents(price, attempt.inputTokens, 0);
    const outputCents = attemptCostCents(price, 0, attempt.maxOutputTokens);
    return {
      model: attempt.model,
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.maxOutputTokens,
      inputCents,
      outputCents,
      cents: attemptCostCents(price, attempt.inputTokens, attempt.maxOutputTokens),
    };
  });
  return {
    kind,
    promptChars: prompt.length,
    requestChars: client.requestChars(prompt),
    attempts,
    ceilingCents: attempts.reduce((sum, attempt) => sum + attempt.cents, 0),
  };
}

/** Compute the worst case with the real prompts, the real `plan()` and `prices`. */
export function computeWorstCase(prices: PriceTable = DEFAULT_PRICE_TABLE): WorstCase {
  const client = new GeminiModelClient({ apiKey: '', models: [...DEFAULT_MODEL_CHAIN] });
  const wish = wishOf(MAX_WISH_TEXT_CHARS, MAX_WISH_CONTEXT_CHARS);
  const maxCurse = (index: number) => curseOf(index, MAX_STORY_CHARS, MAX_LOOPHOLE_CHARS);
  const batchCurses = Array.from({ length: MAX_CURSES }, (_, index) => maxCurse(index));
  const binding: Binding = {
    curseId: 'curse-0',
    kind: LONGEST_BINDING_KIND,
    clause: filler(MAX_CLAUSE_CHARS, 'b'),
    proposedAt: 0,
  };

  const genie = ceilingOf('genie', buildPawPrompt(wish) + buildGeniePrompt(wish), client, prices);
  const batch = ceilingOf('batch', buildBatchQualityPrompt(batchCurses), client, prices);
  const replacement = ceilingOf(
    'replacement',
    buildReplacementPrompt(wish, maxCurse(0)),
    client,
    prices,
  );
  const judge = ceilingOf('judge', buildJudgePrompt(maxCurse(0), binding, 'verdict'), client, prices);

  const grantCents =
    GENIE_CALLS * genie.ceilingCents +
    BATCH_CALLS * batch.ceilingCents +
    REPLACEMENT_CALLS * replacement.ceilingCents;
  const bindCents = BIND_CALLS * judge.ceilingCents;

  const typicalWish = wishOf(TYPICAL_WISH_CHARS, TYPICAL_CONTEXT_CHARS);
  const typicalGenie = ceilingOf(
    'genie',
    buildPawPrompt(typicalWish) + buildGeniePrompt(typicalWish),
    client,
    prices,
  );
  const typicalBatch = ceilingOf(
    'batch',
    buildBatchQualityPrompt(
      Array.from({ length: TYPICAL_CURSES }, (_, index) =>
        curseOf(index, TYPICAL_STORY_CHARS, TYPICAL_LOOPHOLE_CHARS),
      ),
    ),
    client,
    prices,
  );

  return {
    typicalGrantReserveCents: typicalGenie.ceilingCents + typicalBatch.ceilingCents,
    genie,
    batch,
    replacement,
    judge,
    grantCents,
    bindCents,
    ciEvalCapCents: Math.ceil(CI_EVAL_WISHES * grantCents),
  };
}

/** Cents with 2 decimals, as the README states them. */
export function formatCents(cents: number): string {
  return cents.toFixed(2);
}
