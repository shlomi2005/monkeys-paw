import type { BudgetConfig } from 'paw-core';

export type { BudgetConfig };

/** Design estimate for one Gemini Flash call (200 input + 400 output tokens), in cents. */
export const DEFAULT_MODEL_CALL_COST_CENTS = 0.135;

/**
 * Load budget configuration from environment variables with sensible defaults.
 * (Task 14, Req 7)
 */
export function loadBudgetConfig(): BudgetConfig {
  return {
    perIpLimit: parseInt(process.env.PER_IP_LIMIT || '10', 10),
    windowMs: parseInt(process.env.RATE_WINDOW_MS || '60000', 10),
    dailyBudgetCents: parseInt(process.env.DAILY_BUDGET_CENTS || '500', 10),
  };
}

/**
 * Cost charged to the daily spend for every model call, in cents.
 * MODEL_CALL_COST_CENTS overrides the default; a value that is not a
 * non-negative number is ignored.
 */
export function loadModelCallCost(): number {
  const parsed = Number(process.env.MODEL_CALL_COST_CENTS);
  const set = (process.env.MODEL_CALL_COST_CENTS ?? '').trim() !== '';
  return set && Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MODEL_CALL_COST_CENTS;
}
