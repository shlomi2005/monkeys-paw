import type { BudgetConfig } from 'paw-core';

export type { BudgetConfig };

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
