import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DAILY_BUDGET_CENTS } from './config';
import { DEFAULT_PRICE_TABLE } from './prices';
import {
  BIND_CALLS,
  BATCH_CALLS,
  CI_EVAL_WISHES,
  GENIE_CALLS,
  GRANT_CALLS,
  REPLACEMENT_CALLS,
  computeWorstCase,
  formatCents,
} from './worst-case';
import { DEFAULT_MODEL_CHAIN, MAX_OUTPUT_TOKENS } from '../client/gemini';

const API_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const readme = readFileSync(path.join(API_ROOT, 'README.md'), 'utf8');
const worst = computeWorstCase();

describe('worst case per grant and per bind (task 108)', () => {
  it('counts 14 generate calls per grant and 2 per bind, as grant.ts and judge.ts do', () => {
    expect(GENIE_CALLS).toBe(2);
    expect(BATCH_CALLS).toBe(2);
    expect(REPLACEMENT_CALLS).toBe(10); // 5 curses x 1 replacement x 2 calls
    expect(GRANT_CALLS).toBe(14);
    expect(BIND_CALLS).toBe(2);
  });

  it('prices every model of the default chain, each with the full output cap', () => {
    for (const kind of [worst.genie, worst.batch, worst.replacement, worst.judge]) {
      expect(kind.attempts.map((attempt) => attempt.model)).toEqual([...DEFAULT_MODEL_CHAIN]);
      for (const attempt of kind.attempts) {
        expect(attempt.outputTokens).toBe(MAX_OUTPUT_TOKENS);
        expect(attempt.cents).toBeCloseTo(attempt.inputCents + attempt.outputCents, 10);
      }
      expect(kind.ceilingCents).toBeCloseTo(
        kind.attempts.reduce((sum, attempt) => sum + attempt.cents, 0),
        10,
      );
      // The prompt plus its schema, divided by 3 and rounded up.
      expect(kind.attempts[0].inputTokens).toBe(Math.ceil(kind.requestChars / 3));
    }
  });

  it('adds up to 2 genie + 2 batch + 10 replacement ceilings, and 2 judge ceilings', () => {
    expect(worst.grantCents).toBeCloseTo(
      2 * worst.genie.ceilingCents + 2 * worst.batch.ceilingCents + 10 * worst.replacement.ceilingCents,
      9,
    );
    expect(worst.bindCents).toBeCloseTo(2 * worst.judge.ceilingCents, 9);
    expect(worst.ciEvalCapCents).toBe(Math.ceil(CI_EVAL_WISHES * worst.grantCents));
  });

  it('follows the price table', () => {
    const cheap = computeWorstCase({
      ...DEFAULT_PRICE_TABLE,
      'gemini-3.6-flash': { inputUsdPerMTok: 0, outputUsdPerMTok: 0 },
    });
    expect(cheap.grantCents).toBeLessThan(worst.grantCents);
  });

  it('shows the grant and the bind worst case in the README with 2 decimals', () => {
    expect(readme).toContain(`worst case per grant = ${formatCents(worst.grantCents)} cents`);
    expect(readme).toContain(`**${formatCents(worst.bindCents)} cents**`);
    expect(readme).toContain(`(${formatCents(worst.grantCents)} cents) is less than the whole day`);
  });

  it('states the sizes and the ceiling of each prompt kind in the README', () => {
    for (const kind of [worst.genie, worst.batch, worst.replacement, worst.judge]) {
      expect(readme).toContain(
        `${kind.promptChars} prompt chars, ${kind.requestChars} with the schema, ${kind.attempts[0].inputTokens} input tokens`,
      );
      expect(readme).toContain(`Chain ceiling: ${Number(kind.ceilingCents.toFixed(6))} cents`);
    }
    expect(readme).toContain(`\`MAX_OUTPUT_TOKENS\` is ${MAX_OUTPUT_TOKENS}`);
  });

  it('says how many worst-case binds fit in the default day, and what a typical grant reserves', () => {
    const fits = Math.floor(DEFAULT_DAILY_BUDGET_CENTS / worst.bindCents);
    expect(readme).toContain(`Worst-case binds fit ${fits} times`);
    expect(worst.grantCents).toBeLessThan(DEFAULT_DAILY_BUDGET_CENTS);
    expect(2 * worst.grantCents).toBeGreaterThan(DEFAULT_DAILY_BUDGET_CENTS);
    expect(readme).toContain(`about ${formatCents(worst.typicalGrantReserveCents)} cents together`);
    expect(worst.typicalGrantReserveCents).toBeLessThan(worst.grantCents);
  });

  it('says that 10 of the 14 calls are replacements, each generic curse replaced once', () => {
    expect(readme).toContain('up to 14 `generate` calls');
    expect(readme).toContain('10 of the 14 calls come from the replacements in paw-core');
    expect(readme).toContain('replaces a generic curse once');
    expect(readme).not.toContain('QUALITY_MAX_RETRIES = 3` times');
  });

  it('keeps the price table, its source and the check date in the README', () => {
    expect(readme).toContain('https://ai.google.dev/gemini-api/docs/pricing');
    expect(readme).toContain('checked 2026-11-20');
    expect(readme).toContain(
      '| `gemini-3.6-flash`      | 0.75                   | 3.75                    | 1.50                | 7.50                 |',
    );
  });

  it('never mentions a fixed per-call cost', () => {
    expect(readme).not.toContain('MODEL_CALL_COST');
  });
});
