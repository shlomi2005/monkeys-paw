import type { AppDeps } from '../app';
import { loadBudgetConfig } from '../budget/config';
import { loadPriceTable } from '../budget/prices';
import type { BudgetStore } from '../budget/store';
import { DEFAULT_FALLBACKS, DEFAULT_MODEL, GeminiModelClient, parseTimeoutMs } from '../client/gemini';
import { loadGateConfig } from '../gate/config';
import examplesCache from '../../examples-cache.json';
import { EDGE_COUNTRY_HEADER } from './headers';
import type { EdgeSettings } from './types';

/** Free allows 50 subrequests. A grant makes at most 14 generate calls: 14 x 3 = 42. */
export const EDGE_MAX_MODELS = 3;

/** Node's variables and defaults, trimmed, deduplicated, cut to the first 3. */
export function edgeModelChain(env: EdgeSettings): string[] {
  const primary = env.GEMINI_MODEL || DEFAULT_MODEL;
  const fallbacks = env.GEMINI_MODEL_FALLBACKS || DEFAULT_FALLBACKS;
  const names = [primary, ...fallbacks.split(',')].map((name) => name.trim()).filter(Boolean);
  return Array.from(new Set(names)).slice(0, EDGE_MAX_MODELS);
}

/** The budget settings of the Worker's environment, with Node's parser. */
export function edgeBudgetConfig(env: EdgeSettings) {
  return loadBudgetConfig({
    PER_IP_LIMIT: env.PER_IP_LIMIT,
    RATE_WINDOW_MS: env.RATE_WINDOW_MS,
    DAILY_BUDGET_CENTS: env.DAILY_BUDGET_CENTS,
  });
}

/** The Worker's environment as `AppDeps`. `COUNTRY_HEADER` and `TRUSTED_PROXY_HOPS` are never read. */
export function edgeAppDeps(env: EdgeSettings, store: BudgetStore): AppDeps {
  return {
    model: new GeminiModelClient({
      apiKey: env.GEMINI_API_KEY ?? '',
      models: edgeModelChain(env),
      timeoutMs: parseTimeoutMs(env.GEMINI_TIMEOUT_MS),
      fetch: globalThis.fetch.bind(globalThis),
      log: (entry) => console.log(JSON.stringify(entry)),
    }),
    budget: edgeBudgetConfig(env),
    prices: loadPriceTable(env.PRICE_TABLE_JSON),
    gate: { tier: loadGateConfig({ GEMINI_TIER: env.GEMINI_TIER }).tier, countryHeader: EDGE_COUNTRY_HEADER },
    trustedProxyHops: 1,
    corsOrigin: env.CORS_ORIGIN || '*',
    budgetStore: store,
    loadExamples: async () => JSON.stringify(examplesCache),
  };
}
