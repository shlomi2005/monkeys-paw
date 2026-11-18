import { describe, it, expect, beforeAll } from 'vitest';
import type { GoldenWish, EvalResult } from './types';
import { loadGoldenWishes, calculateSpecificityScore, calculateTypeCoverage } from './script';

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
    const expectedTypes = ['permissions', 'time', 'money'];
    const generatedTypes = ['permissions', 'time', 'money', 'scale'];
    const coverage = calculateTypeCoverage(expectedTypes, generatedTypes);
    expect(coverage).toBe(1.0);
  });

  it('partial type coverage is calculated correctly', () => {
    // Mock: 2 out of 3 expected types found → 0.67
    const expectedTypes = ['permissions', 'time', 'money'];
    const generatedTypes = ['permissions', 'time', 'scale'];
    const coverage = calculateTypeCoverage(expectedTypes, generatedTypes);
    expect(coverage).toBeCloseTo(0.67, 2);
  });
});
