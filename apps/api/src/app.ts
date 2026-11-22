import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import type { Context, Next } from 'hono';

import { createGrantRoute } from './routes/grant';
import { createBindRoute } from './routes/bind';
import { createExportRoute } from './routes/export';
import { createExamplesRoute } from './routes/examples';
import { createHealthRoute } from './routes/health';
import { createLiveRoute } from './routes/live';
import { DEFAULT_GATE_CONFIG } from './gate/config';
import type { GateConfig } from './gate/config';
import { createGate, LIVE_ROUTES } from './gate/middleware';
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
  /** Proxies of ours in front of the server, for the per-IP key. Defaults to 1. */
  trustedProxyHops?: number;
  /** Who may make live wishes. Omitted is the free tier with no country header: the gate refuses all. */
  gate?: GateConfig;
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
  const gate = deps.gate ?? DEFAULT_GATE_CONFIG;

  // CORS middleware (Req 10, Task 53)
  app.use(
    '*',
    cors({
      origin: corsOrigin,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-Paw-Adult-Confirmed'],
    }),
  );

  // Logger middleware (Req 9, Task 50)
  app.use('*', logger());

  // Live-call gate (paw-api Req 14): headers only, so it runs before the mode check, the per-IP
  // count, the body and the guard.
  const liveGate = createGate(gate);
  for (const route of LIVE_ROUTES) app.post(route, liveGate);

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
  const admit = checkBudget(globalState, budget, clock, deps.trustedProxyHops);
  for (const route of ['/api/grant', '/api/bind']) {
    app.use(route, checkMode);
    app.use(route, admit);
  }

  // Each request gets its own guard; all guards share the one global state.
  const createClient = () =>
    new BudgetedModelClient(model, globalState, budget, clock, deps.prices);

  createHealthRoute(app, globalState, budget, () => model.available, clock);
  createLiveRoute(app, gate);
  createGrantRoute(app, createClient);
  createBindRoute(app, createClient);
  createExportRoute(app);
  createExamplesRoute(app, examplesCachePath);

  return app;
}
