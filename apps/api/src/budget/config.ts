import type { BudgetConfig } from 'paw-core';

export type { BudgetConfig };

/** The daily budget when `DAILY_BUDGET_CENTS` is missing or invalid: 200 cents, $2 a day. */
export const DEFAULT_DAILY_BUDGET_CENTS = 200;

/** Proxies between the client and this server when `TRUSTED_PROXY_HOPS` is missing or invalid. */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/**
 * `DAILY_BUDGET_CENTS` parsed with `Number`, so a fractional value is fine ("12.5").
 * Missing, blank, non-finite or negative means 200.
 */
export function parseDailyBudgetCents(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_DAILY_BUDGET_CENTS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DAILY_BUDGET_CENTS;
}

/**
 * `TRUSTED_PROXY_HOPS`: how many proxies of ours append to `x-forwarded-for`.
 * An integer of 0 or more; anything else (missing, blank, negative, fractional,
 * not a number) means 1.
 */
export function parseTrustedProxyHops(raw: string | undefined): number {
  const text = raw?.trim() ?? '';
  if (!/^\d+$/.test(text)) return DEFAULT_TRUSTED_PROXY_HOPS;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : DEFAULT_TRUSTED_PROXY_HOPS;
}

/**
 * Load budget configuration from environment variables with sensible defaults.
 * (Task 14, Req 7; task 108)
 */
export function loadBudgetConfig(): BudgetConfig {
  return {
    perIpLimit: parseInt(process.env.PER_IP_LIMIT || '10', 10),
    windowMs: parseInt(process.env.RATE_WINDOW_MS || '60000', 10),
    dailyBudgetCents: parseDailyBudgetCents(process.env.DAILY_BUDGET_CENTS),
  };
}

/** `TRUSTED_PROXY_HOPS` from the environment (task 111). */
export function loadTrustedProxyHops(): number {
  return parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);
}
