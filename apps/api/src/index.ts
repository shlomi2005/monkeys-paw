import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import path from 'path';

import { GeminiModelClient } from './client/gemini';
import { createGrantRoute } from './routes/grant';
import { createBindRoute } from './routes/bind';
import { createExportRoute } from './routes/export';
import { createExamplesRoute } from './routes/examples';
import { createHealthRoute } from './routes/health';
import { checkBudget } from './budget/middleware';
import { loadBudgetConfig } from './budget/config';
import { GlobalState } from './budget/state';
import { getCurrentMode, isModelCallAllowed } from './modes';
import type { Next } from 'hono';
import type { Context } from 'hono';

const app = new Hono();

// Load configuration
const budgetConfig = loadBudgetConfig();
const hasApiKey = !!process.env.GEMINI_API_KEY;

// Initialize global state
const globalState: GlobalState = {
  spentCents: 0,
  dayStart: Date.now(),
  ipStates: new Map(),
};

// Determine initial mode
const initialMode = getCurrentMode(hasApiKey, globalState, budgetConfig);

// Create model client
const modelClient = new GeminiModelClient();

// CORS middleware (Req 10, Task 53)
app.use(
  '*',
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
);

// Logger middleware (Req 9, Task 50)
app.use('*', logger());

// Mode-checking middleware for routes that require a model call
// (Req 8: reject grant/bind if in examples-only mode)
const checkMode = async (c: Context, next: Next) => {
  const currentMode = getCurrentMode(hasApiKey, globalState, budgetConfig);
  c.set('mode', currentMode);
  
  if (!isModelCallAllowed(currentMode)) {
    return c.json(
      {
        message:
          'The paw is resting. Browse the examples until it wakes.',
      },
      503,
    );
  }
  
  await next();
};

// Budget middleware (Req 7, Task 52)
app.use('/api/grant', checkBudget(globalState, budgetConfig));
app.use('/api/bind', checkBudget(globalState, budgetConfig));

// Add mode check before route handlers
app.use('/api/grant', checkMode);
app.use('/api/bind', checkMode);

// Health check route (always available)
createHealthRoute(app, globalState, budgetConfig.dailyBudgetCents, initialMode);

// Grant route (with budget check middleware and mode check)
createGrantRoute(app, modelClient, globalState);

// Bind route (with budget check middleware and mode check)
createBindRoute(app, modelClient, globalState);

// Export route (no model call, always available)
createExportRoute(app);

// Examples route (always available, served from cache)
const cacheFile = path.join(process.cwd(), 'examples-cache.json');
createExamplesRoute(app, cacheFile);

export default app;
