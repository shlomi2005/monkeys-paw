import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import type { GoldenWish, EvalResult } from './types';
import {
  loadGoldenWishes,
  calculateSpecificityScore,
  calculateTypeCoverage,
  runEval,
  EvalAbortError,
} from './script';
import type { CurseType } from 'paw-core';
import { FakeMeteredModel } from '../budget/fake-metered';

describe('Eval script (Req 12, Tasks 69-72)', () => {
  let goldenWishes: GoldenWish[];

  beforeAll(async () => {
    // Load the golden wishes file
    goldenWishes = await loadGoldenWishes();
  });

  it('loads golden wishes file and parses as expected schema (Task 69)', () => {
    expect(Array.isArray(goldenWishes)).toBe(true);
    expect(goldenWishes.length).toBe(25);

    // Check first wish structure
    const firstWish = goldenWishes[0];
    expect(firstWish).toHaveProperty('id');
    expect(firstWish).toHaveProperty('wish');
    expect(firstWish).toHaveProperty('context');
    expect(firstWish).toHaveProperty('expectedTypes');
    expect(Array.isArray(firstWish.expectedTypes)).toBe(true);
  });

  it('calculates specificity score correctly (Task 70)', () => {
    // Mock: 8 out of 10 curses are specific → 0.80
    const specificCount = 8;
    const totalCount = 10;
    const score = calculateSpecificityScore(specificCount, totalCount);
    expect(score).toBeCloseTo(0.80, 2);
  });

  it('calculates type coverage correctly (Task 71)', () => {
    // Mock: expectedTypes fully covered → 1.0
    const expectedTypes: CurseType[] = ['permissions', 'time', 'money'];
    const generatedTypes: CurseType[] = ['permissions', 'time', 'money', 'scale'];
    const coverage = calculateTypeCoverage(expectedTypes, generatedTypes);
    expect(coverage).toBe(1.0);
  });

  it('partial type coverage is calculated correctly', () => {
    // Mock: 2 out of 3 expected types found → 0.67
    const expectedTypes: CurseType[] = ['permissions', 'time', 'money'];
    const generatedTypes: CurseType[] = ['permissions', 'time', 'scale'];
    const coverage = calculateTypeCoverage(expectedTypes, generatedTypes);
    expect(coverage).toBeCloseTo(0.67, 2);
  });
});

/** A fake model: valid JSON for the grant and batch-gate prompts, and a count of its calls. */
class FakeModel extends FakeMeteredModel {
  protected override async answer(prompt: string): Promise<unknown> {
    if (prompt.includes('Task: GRANT_WISH')) {
      return {
        narration: 'Granted.',
        curses: [
          { id: 'x', type: 'permissions', story: 'The owner quits.', loophole: '"owner"' },
          { id: 'x', type: 'time', story: 'Midnight where?', loophole: '"midnight"' },
          { id: 'x', type: 'scale', story: 'Zero items.', loophole: '"items"' },
        ],
      };
    }
    return ['curse-0', 'curse-1', 'curse-2'].map((curseId) => ({
      curseId,
      specific: true,
      reason: 'Specific.',
    }));
  }
}

describe('Eval script budget guard (iron-rules §5, Req 12.7)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('without a key it stops before any model call', async () => {
    const model = new FakeModel({ available: false });
    const error = await runEval(2, { model, delayMs: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EvalAbortError);
    expect((error as Error).message).toContain('GEMINI_API_KEY');
    expect((error as Error).message).not.toContain('\n');
    expect(model.calls).toBe(0);
  });

  it('reports the real number of model calls, not the number of wishes', async () => {
    const model = new FakeModel();
    const result = await runEval(2, { model, delayMs: 0, dailyBudgetCents: 500 });
    expect(result.wishes).toHaveLength(2);
    expect(model.calls).toBe(4); // per wish: the grant and the batch quality gate
    expect(result.modelCalls).toBe(model.calls);
    expect(result.costCents).toBeGreaterThan(0); // the real cost of four small answers
    expect(result.costCents).toBeLessThan(1);
  });

  it('stops the loop in one line when the guard refuses a call', async () => {
    const model = new FakeModel({ usage: 'ceiling' });
    // Each call reserves about 3.3 cents and is charged about the same. 11 cents pays for three:
    // wish 1 uses two, wish 2 is refused on its second call.
    const error = await runEval(5, {
      model,
      delayMs: 0,
      dailyBudgetCents: 11,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EvalAbortError);
    const message = (error as Error).message;
    expect(message).toContain('budget guard');
    expect(message).toContain('3 model calls');
    expect(message).not.toContain('\n');
    expect(model.calls).toBe(3);
  });
});
