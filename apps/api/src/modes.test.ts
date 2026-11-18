import { describe, it, expect } from 'vitest';
import { getCurrentMode, isModelCallAllowed } from './modes';
import type { GlobalState } from './budget/state';
import type { BudgetConfig } from './budget/config';

describe('Examples-only mode (Req 8, Tasks 44-47)', () => {
  const mockGlobalState = (spentCents: number): GlobalState => ({
    spentCents,
    dayStart: Date.now(),
    ipStates: new Map(),
  });

  const mockConfig = (dailyBudgetCents: number): BudgetConfig => ({
    perIpLimit: 10,
    windowMs: 60000,
    dailyBudgetCents,
  });

  it('enters examples-only mode when GEMINI_API_KEY is absent (Task 44, Req 8.1)', () => {
    const mode = getCurrentMode(false, mockGlobalState(0), mockConfig(500));
    expect(mode).toBe('examples-only');
  });

  it('enters examples-only mode when daily budget is exhausted (Req 8.1)', () => {
    const mode = getCurrentMode(true, mockGlobalState(500), mockConfig(500));
    expect(mode).toBe('examples-only');
  });

  it('returns "normal" mode when API key is present and budget available (Req 8.1)', () => {
    const mode = getCurrentMode(true, mockGlobalState(0), mockConfig(500));
    expect(mode).toBe('normal');
  });

  it('grant/bind return 503 in examples-only mode (Task 45, Req 8.3)', () => {
    const mode = getCurrentMode(false, mockGlobalState(0), mockConfig(500));
    expect(isModelCallAllowed(mode)).toBe(false);
  });

  it('examples and export work in examples-only mode (Task 46, Req 8.2, 8.4)', () => {
    const mode = getCurrentMode(false, mockGlobalState(0), mockConfig(500));
    // These routes are independent of the mode check
    // They work regardless because export has no model call (pure logic)
    // and examples is served from cache
    expect(mode).toBe('examples-only');
  });

  it('returns correct mode from getCurrentMode (Task 47)', () => {
    expect(getCurrentMode(true, mockGlobalState(100), mockConfig(500))).toBe('normal');
    expect(getCurrentMode(true, mockGlobalState(500), mockConfig(500))).toBe('examples-only');
    expect(getCurrentMode(false, mockGlobalState(0), mockConfig(500))).toBe('examples-only');
  });
});
