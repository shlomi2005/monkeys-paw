import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Context, Next } from 'hono';

import { createGrantRoute } from './routes/grant';
import { createBindRoute } from './routes/bind';
import { createExportRoute } from './routes/export';
import { createExamplesRoute, fileExamplesLoader } from './routes/examples';
import { createHealthRoute } from './routes/health';
import { createLiveRoute } from './routes/live';
import { DEFAULT_GATE_CONFIG } from './gate/config';
import type { GateConfig } from './gate/config';
import { createGate, LIVE_ROUTES } from './gate/middleware';
import { checkBudget } from './budget/middleware';
import type { BudgetConfig } from './budget/config';
import { BudgetedModelClient } from './budget/guarded-client';
import type { MeteredModelClient } from './budget/guarded-client';
import { DEFAULT_PRICE_TABLE } from './budget/prices';
import type { PriceTable } from './budget/prices';
import { computeStartCeilingCents } from './budget/worst-case';
import { RESTING_MESSAGE } from './budget/messages';
import { createGlobalState } from './budget/state';
import { applyLoaded, snapshotOf } from './budget/store';
import type { BudgetStore } from './budget/store';
import { liveCanStart } from './modes';
import { logError } from './error-log';
import { requestLogger, trackModelCalls } from './logger';

export interface AppDeps {
  /** The model client. `available` is false when no API key is set (examples-only mode). */
  model: MeteredModelClient;
  budget: BudgetConfig;
  corsOrigin: string;
  /** Absolute path of the examples cache file. Read with a dynamic `node:fs/promises` import. */
  examplesCachePath?: string;
  /** Gives the raw JSON text of the examples cache. Wins over `examplesCachePath`. */
  loadExamples?: () => Promise<string>;
  /** Keeps the three budget numbers over restarts. Omitted is memory only, as before. */
  budgetStore?: BudgetStore;
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
 * Build the whole Hono app with fresh in-memory budget state (or the state of `budgetStore`, when given). No module-level
 * side effects: it reads no environment and starts no server.
 */
export function createApp(deps: AppDeps): Hono {
  const { model, budget, corsOrigin, examplesCachePath, budgetStore } = deps;
  const clock = deps.clock ?? Date.now;

  const app = new Hono();
  const globalState = createGlobalState(clock());
  const gate = deps.gate ?? DEFAULT_GATE_CONFIG;

  // With a store: load once (an unreadable row is a spent day), save the loaded state, and let the
  // guard and the day roll save after every change. Without a store nothing is saved.
  if (budgetStore) {
    applyLoaded(globalState, budgetStore.load(), budget.dailyBudgetCents, clock());
    globalState.persist = () => budgetStore.save(snapshotOf(globalState));
    globalState.persist();
  }

  // CORS middleware (Req 10, Task 53)
  app.use(
    '*',
    cors({
      origin: corsOrigin,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-Paw-Adult-Confirmed'],
    }),
  );

  // Logger middleware (Req 9, Task 50): our own line, nothing the caller chose.
  app.use('*', requestLogger());

  // Any error that reaches the app: a fixed answer, a fixed code and class in the log (Req 9.7).
  // Hono's default handler would print the error and send the message of an HTTPException.
  app.onError((err, c) => {
    logError('request_failed', err);
    return c.json({ message: 'An error occurred while handling the request' }, 500);
  });

  // Live-call gate (paw-api Req 14): headers only, so it runs before the mode check, the per-IP
  // count, the body and the guard.
  const liveGate = createGate(gate);
  for (const route of LIVE_ROUTES) app.post(route, liveGate);

  // Mode check for POSTs that need a model call (Req 8.3). It runs before the
  // budget check, so a request that cannot be served is not counted against an IP.
  // One start ceiling, computed once, shared by the mode check, health and live (Requirement 18).
  const startCeilingCents = computeStartCeilingCents(model, deps.prices ?? DEFAULT_PRICE_TABLE);
  const canStart = () => liveCanStart(model.available, globalState, budget, startCeilingCents, clock());

  const checkMode = async (c: Context, next: Next) => {
    if (!canStart()) {
      return c.json({ message: RESTING_MESSAGE }, 503);
    }
    return next();
  };

  // Per-POST IP limit and daily budget (Req 7, Task 52)
  const admit = checkBudget(globalState, budget, clock, deps.trustedProxyHops);
  // POST only, registered after the gate: order is gate, mode, count, then the body. Other methods
  // never reach the mode check or the IP map.
  for (const route of LIVE_ROUTES) app.post(route, checkMode, admit);

  // Each request gets its own guard; all guards share the one global state.
  const createClient = () => {
    const guard = new BudgetedModelClient(model, globalState, budget, clock, deps.prices);
    trackModelCalls(() => guard.calls); // for the `modelCall` field of the request log
    return guard;
  };

  createHealthRoute(app, globalState, budget, () => model.available, startCeilingCents, clock);
  createLiveRoute(app, gate, () => !canStart());
  createGrantRoute(app, createClient);
  createBindRoute(app, createClient);
  createExportRoute(app);
  createExamplesRoute(
    app,
    deps.loadExamples ??
      (examplesCachePath !== undefined
        ? fileExamplesLoader(examplesCachePath)
        : async () => {
            throw new Error('no examples source');
          }),
  );

  return app;
}
