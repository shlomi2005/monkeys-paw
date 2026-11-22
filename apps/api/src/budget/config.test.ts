import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DAILY_BUDGET_CENTS,
  DEFAULT_TRUSTED_PROXY_HOPS,
  loadBudgetConfig,
  loadTrustedProxyHops,
  parseDailyBudgetCents,
  parseTrustedProxyHops,
  parseWindowMs,
} from './config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('DAILY_BUDGET_CENTS', () => {
  it('defaults to 200 cents ($2 a day)', () => {
    expect(DEFAULT_DAILY_BUDGET_CENTS).toBe(200);
    expect(parseDailyBudgetCents(undefined)).toBe(200);
    expect(parseDailyBudgetCents('')).toBe(200);
    expect(parseDailyBudgetCents('   ')).toBe(200);
  });

  it('is 200 when the variable is unset in the environment', () => {
    vi.stubEnv('DAILY_BUDGET_CENTS', '');
    expect(loadBudgetConfig().dailyBudgetCents).toBe(200);
  });

  it('accepts a whole or fractional value, and zero', () => {
    expect(parseDailyBudgetCents('25')).toBe(25);
    expect(parseDailyBudgetCents('12.5')).toBe(12.5);
    expect(parseDailyBudgetCents('0.75')).toBe(0.75);
    expect(parseDailyBudgetCents('0')).toBe(0);
    vi.stubEnv('DAILY_BUDGET_CENTS', '37.25');
    expect(loadBudgetConfig().dailyBudgetCents).toBe(37.25);
  });

  it.each(['abc', '-1', '-0.5', 'NaN', 'Infinity', '-Infinity', '1e999', '12 cents'])(
    'falls back to 200 for the invalid value %j',
    (raw) => {
      expect(parseDailyBudgetCents(raw)).toBe(200);
    },
  );
});

describe('TRUSTED_PROXY_HOPS', () => {
  it('defaults to 1', () => {
    expect(DEFAULT_TRUSTED_PROXY_HOPS).toBe(1);
    expect(parseTrustedProxyHops(undefined)).toBe(1);
    expect(parseTrustedProxyHops('')).toBe(1);
  });

  it('accepts an integer of 0 or more', () => {
    expect(parseTrustedProxyHops('0')).toBe(0);
    expect(parseTrustedProxyHops('1')).toBe(1);
    expect(parseTrustedProxyHops(' 2 ')).toBe(2);
    vi.stubEnv('TRUSTED_PROXY_HOPS', '3');
    expect(loadTrustedProxyHops()).toBe(3);
  });

  it.each(['-1', '1.5', 'two', 'NaN', 'Infinity', '1e3', '0x2', '99999999999999999999'])(
    'means 1 for the invalid value %j',
    (raw) => {
      expect(parseTrustedProxyHops(raw)).toBe(1);
    },
  );
});

describe('RATE_WINDOW_MS', () => {
  it('is all digits, a safe integer of 1 or more; anything else is 60000', () => {
    expect(parseWindowMs(undefined)).toBe(60000);
    expect(parseWindowMs(' 5000 ')).toBe(5000);
    for (const bad of ['', '0', '-1', '1.5', '1e3', 'abc', '12abc', '99999999999999999999']) {
      expect(parseWindowMs(bad), bad).toBe(60000);
    }
  });
  it('loadBudgetConfig uses it', () => {
    vi.stubEnv('RATE_WINDOW_MS', 'nope');
    expect(loadBudgetConfig().windowMs).toBe(60000);
    vi.stubEnv('RATE_WINDOW_MS', '1000');
    expect(loadBudgetConfig().windowMs).toBe(1000);
  });
});
