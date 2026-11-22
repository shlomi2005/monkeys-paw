import { serve } from '@hono/node-server';

import { createApp } from './app';
import { GeminiModelClient } from './client/gemini';
import { loadBudgetConfig, loadTrustedProxyHops } from './budget/config';
import { loadGateConfig } from './gate/config';
import { loadPriceTable } from './budget/prices';
import { createGlobalState } from './budget/state';
import { getCurrentMode } from './modes';
import { defaultExamplesCachePath } from './paths';
import { logError, logErrorSync } from './error-log';

// A crash writes one fixed line (code and class) and exits 1. Without these handlers Node prints
// the message and the stack of the error, which can hold part of a request.
process.on('uncaughtException', (err) => {
  logErrorSync('uncaught_exception', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logErrorSync('unhandled_rejection', reason);
  process.exit(1);
});

const budget = loadBudgetConfig();
const model = new GeminiModelClient();
const port = Number(process.env.PORT) || 8787;

const app = createApp({
  model,
  budget,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  examplesCachePath: defaultExamplesCachePath(),
  prices: loadPriceTable(),
  trustedProxyHops: loadTrustedProxyHops(),
  gate: loadGateConfig(process.env),
});

const mode = getCurrentMode(model.available, createGlobalState(), budget);

const EDGE_FAILURE_BODY = JSON.stringify({ message: 'An error occurred while handling the request' });

// serve() does not forward an errorHandler, and its default for a rejected fetch logs nothing.
// This wrapper is the edge: an error that got past app.onError (a thrown non-Error) is logged as
// code and class and answered with a fixed 500.
const server = serve(
  {
    fetch: async (request, env) => {
      try {
        return await app.fetch(request, env);
      } catch (err) {
        logError('edge_failed', err);
        return new Response(EDGE_FAILURE_BODY, {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    },
    port,
    hostname: '0.0.0.0',
  },
  (info) => {
    // One start line: the port and the mode, never the key.
    console.log(JSON.stringify({ event: 'listening', port: info.port, mode }));
  },
);

// A listen failure (the port is taken) would otherwise print the error.
server.on('error', (err) => {
  logErrorSync('server_failed', err);
  process.exit(1);
});

function shutdown(): void {
  server.close(() => process.exit(0));
  if ('closeIdleConnections' in server) server.closeIdleConnections();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
