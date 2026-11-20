import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import type { Context, Next } from 'hono';

import { createGrantRoute } from './routes/grant';
import { createBindRoute } from './routes/bind';
import { createExportRoute } from './routes/export';
import { createExamplesRoute } from './routes/examples';
import { createHealthRoute } from './routes/health';
import { checkBudget } from './budget/middleware';
import type { BudgetConfig } from './budget/config';
import { BudgetedModelClient } from './budget/guarded-client';
import type { MeteredModelClient } from './budget/guarded-client';
import type { PriceTable } from './budget/prices';
import { RESTING_MESSAGE } from './budget/messages';
import { createGlobalState } from './budget/state';
import { getCurrentMode, isModelCallAllowed } from './modes';

export interface AppDeps {
  /** The model client. `available` is false when no API key is set (examples-only mode). */
  model: MeteredModelClient;
  budget: BudgetConfig;
  corsOrigin: string;
  /** Absolute path of the examples cache file. */
  examplesCachePath: string;
  /** Epoch-ms clock. Defaults to Date.now. */
  clock?: () => number;
  /** Model prices for the budget guard. Defaults to the 1.1.2027 table. */
  prices?: PriceTable;
}

/**
 * Build the whole Hono app with fresh in-memory budget state. No module-level
 * side effects: it reads no environment and starts no server.
 */
export function createApp(deps: AppDeps): Hono {
  const { model, budget, corsOrigin, examplesCachePath } = deps;
  const clock = deps.clock ?? Date.now;

  const app = new Hono();
  const globalState = createGlobalState(clock());

  // CORS middleware (Req 10, Task 53)
  app.use(
    '*',
    cors({
      origin: corsOrigin,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    }),
  );

  // Logger middleware (Req 9, Task 50)
  app.use('*', logger());

  // Mode check for routes that need a model call (Req 8.3). It runs before the
  // budget check, so a request that cannot be served is not counted against an IP.
  const checkMode = async (c: Context, next: Next) => {
    const mode = getCurrentMode(model.available, globalState, budget, clock());
    if (!isModelCallAllowed(mode)) {
      return c.json({ message: RESTING_MESSAGE }, 503);
    }
    return next();
  };

  // Per-request IP limit and daily budget (Req 7, Task 52)
  const admit = checkBudget(globalState, budget, clock);
  for (const route of ['/api/grant', '/api/bind']) {
    app.use(route, checkMode);
    app.use(route, admit);
  }

  // Each request gets its own guard; all guards share the one global state.
  const createClient = () =>
    new BudgetedModelClient(model, globalState, budget, clock, deps.prices);

  createHealthRoute(app, globalState, budget, () => model.available, clock);
  createGrantRoute(app, createClient);
  createBindRoute(app, createClient);
  createExportRoute(app);
  createExamplesRoute(app, examplesCachePath);

  return app;
}
