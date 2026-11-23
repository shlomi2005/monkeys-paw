import type { Hono } from 'hono';
import { createApp } from '../app';
import { logError } from '../error-log';
import { edgeAppDeps, edgeBudgetConfig } from './config';
import { rewriteRequest } from './headers';
import { createSqlBudgetStore } from './sql-store';
import type { EdgeEnv, EdgeRequest, PawObjectNamespace, PawObjectState } from './types';

/** The fixed name of the one object. */
const OBJECT_NAME = 'paw';

const FAILURE_BODY = JSON.stringify({ message: 'An error occurred while handling the request' });

function failure(): Response {
  return new Response(FAILURE_BODY, { status: 500, headers: { 'content-type': 'application/json' } });
}

/**
 * The namespace in the "us" jurisdiction. The open-source runtime behind local `wrangler dev` has no
 * jurisdictions and throws "not implemented in workerd"; only that error falls back to the plain namespace.
 * Any other error is thrown on, so Cloudflare never silently moves the object out of the US.
 */
export function pawNamespace(env: EdgeEnv): PawObjectNamespace {
  try {
    return env.PAW.jurisdiction('us');
  } catch (err) {
    if (err instanceof Error && err.message.includes('not implemented in workerd')) return env.PAW;
    throw err;
  }
}

export default {
  async fetch(request: EdgeRequest, env: EdgeEnv): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/api/')) {
      try {
        const ns = pawNamespace(env);
        return await ns.get(ns.idFromName(OBJECT_NAME)).fetch(rewriteRequest(request));
      } catch (err) {
        logError('edge_failed', err);
        return failure();
      }
    }
    return env.ASSETS.fetch(request);
  },
};

/** The Durable Object: the same Hono app as Node, built once, over SQLite budget storage. */
export class PawObject {
  private readonly app: Hono;
  private readonly windowMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(state: PawObjectState, env: EdgeEnv) {
    this.app = createApp(edgeAppDeps(env, createSqlBudgetStore(state.storage.sql)));
    this.windowMs = edgeBudgetConfig(env).windowMs;
  }

  async fetch(request: Request): Promise<Response> {
    let response: Response;
    try {
      response = await this.app.fetch(request);
    } catch (err) {
      logError('edge_failed', err);
      response = failure();
    }
    if (request.method === 'POST') {
      const path = new URL(request.url).pathname;
      if (path === '/api/grant' || path === '/api/bind') this.holdWindow();
    }
    return response;
  }

  /** One timer for the rate window: a pending timer keeps the object, and its IP map, in memory. */
  private holdWindow(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
    }, this.windowMs);
  }
}
