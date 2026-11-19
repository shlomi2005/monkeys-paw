import { serve } from '@hono/node-server';

import { createApp } from './app';
import { GeminiModelClient } from './client/gemini';
import { loadBudgetConfig, loadModelCallCost } from './budget/config';
import { createGlobalState } from './budget/state';
import { getCurrentMode } from './modes';
import { defaultExamplesCachePath } from './paths';

const budget = loadBudgetConfig();
const model = new GeminiModelClient();
const port = Number(process.env.PORT) || 8787;

const app = createApp({
  model,
  budget,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  examplesCachePath: defaultExamplesCachePath(),
  costPerCallCents: loadModelCallCost(),
});

const mode = getCurrentMode(model.available, createGlobalState(), budget);

const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  // One start line: the port and the mode, never the key.
  console.log(JSON.stringify({ event: 'listening', port: info.port, mode }));
});

function shutdown(): void {
  server.close(() => process.exit(0));
  if ('closeIdleConnections' in server) server.closeIdleConnections();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
