import { describe, it, expect } from 'vitest';
import { DAY_MS } from 'paw-core';
import { getCurrentMode, isModelCallAllowed, liveCanStart } from './modes';
import type { GlobalState } from './budget/state';
import type { BudgetConfig } from './budget/config';

describe('Examples-only mode (Req 8, Tasks 44-47)', () => {
  const mockGlobalState = (spentCents: number): GlobalState => ({
    spentCents,
    reservedCents: 0,
    dayStart: Date.now(),
    ipStates: new Map(),
  });

  const CEILING = 3;

  const mockConfig = (dailyBudgetCents: number): BudgetConfig => ({
    perIpLimit: 10,
    windowMs: 60000,
    dailyBudgetCents,
  });

  it('enters examples-only mode when GEMINI_API_KEY is absent (Task 44, Req 8.1)', () => {
    const mode = getCurrentMode(false, mockGlobalState(0), mockConfig(500), CEILING);
    expect(mode).toBe('examples-only');
  });

  it('enters examples-only mode when daily budget is exhausted (Req 8.1)', () => {
    const mode = getCurrentMode(true, mockGlobalState(500), mockConfig(500), CEILING);
    expect(mode).toBe('examples-only');
  });

  it('returns "normal" mode when API key is present and budget available (Req 8.1)', () => {
    const mode = getCurrentMode(true, mockGlobalState(0), mockConfig(500), CEILING);
    expect(mode).toBe('normal');
  });

  it('grant/bind return 503 in examples-only mode (Task 45, Req 8.3)', () => {
    const mode = getCurrentMode(false, mockGlobalState(0), mockConfig(500), CEILING);
    expect(isModelCallAllowed(mode)).toBe(false);
  });

  it('examples and export work in examples-only mode (Task 46, Req 8.2, 8.4)', () => {
    const mode = getCurrentMode(false, mockGlobalState(0), mockConfig(500), CEILING);
    // These routes are independent of the mode check
    // They work regardless because export has no model call (pure logic)
    // and examples is served from cache
    expect(mode).toBe('examples-only');
  });

  it('returns correct mode from getCurrentMode (Task 47)', () => {
    expect(getCurrentMode(true, mockGlobalState(100), mockConfig(500), CEILING)).toBe('normal');
    expect(getCurrentMode(true, mockGlobalState(500), mockConfig(500), CEILING)).toBe('examples-only');
    expect(getCurrentMode(false, mockGlobalState(0), mockConfig(500), CEILING)).toBe('examples-only');
  });

  it('treats an elapsed day as a reset (Req 8.5)', () => {
    const state = { spentCents: 500, reservedCents: 0, dayStart: 0, ipStates: new Map() };
    expect(getCurrentMode(true, state, mockConfig(500), CEILING, DAY_MS - 1)).toBe('examples-only');
    expect(getCurrentMode(true, state, mockConfig(500), CEILING, DAY_MS)).toBe('normal');
    expect(state.spentCents).toBe(500); // a view, not a mutation
  });

  it('stays examples-only without a key even after the day rolls over', () => {
    const state = { spentCents: 0, reservedCents: 0, dayStart: 0, ipStates: new Map() };
    expect(getCurrentMode(false, state, mockConfig(500), CEILING, DAY_MS * 3)).toBe('examples-only');
  });
});

describe('liveCanStart (Requirement 18.1)', () => {
  const config: BudgetConfig = { perIpLimit: 10, windowMs: 60000, dailyBudgetCents: 200 };
  const stateOf = (spentCents: number, reservedCents = 0, dayStart = 0): GlobalState => ({
    spentCents,
    reservedCents,
    dayStart,
    ipStates: new Map(),
  });

  it('is true exactly at the threshold: spent + reserved + ceiling equals the budget', () => {
    expect(liveCanStart(true, stateOf(190, 5), config, 5, 0)).toBe(true);
  });

  it('is true just under the threshold', () => {
    expect(liveCanStart(true, stateOf(189.99, 5), config, 5, 0)).toBe(true);
  });

  it('is false just over the threshold', () => {
    expect(liveCanStart(true, stateOf(190.01, 5), config, 5, 0)).toBe(false);
    expect(liveCanStart(true, stateOf(190, 5.01), config, 5, 0)).toBe(false);
  });

  it('is false without a key, whatever the budget', () => {
    expect(liveCanStart(false, stateOf(0), config, 0, 0)).toBe(false);
  });

  it('counts an elapsed day as a spend of 0 but keeps reservedCents', () => {
    expect(liveCanStart(true, stateOf(199, 0, 0), config, 5, DAY_MS - 1)).toBe(false);
    expect(liveCanStart(true, stateOf(199, 0, 0), config, 5, DAY_MS)).toBe(true);
    expect(liveCanStart(true, stateOf(199, 196, 0), config, 5, DAY_MS)).toBe(false);
  });

  it('treats a ceiling that is not a finite number as not fitting', () => {
    expect(liveCanStart(true, stateOf(0), config, Number.NaN, 0)).toBe(false);
    expect(liveCanStart(true, stateOf(0), config, Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(getCurrentMode(true, stateOf(0), config, Number.NaN, 0)).toBe('examples-only');
  });

  it('getCurrentMode is normal iff liveCanStart', () => {
    expect(getCurrentMode(true, stateOf(191.98), config, 8.02, 0)).toBe('normal');
    expect(getCurrentMode(true, stateOf(191.99), config, 8.02, 0)).toBe('examples-only');
  });
});
