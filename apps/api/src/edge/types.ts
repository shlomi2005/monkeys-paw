/** Minimal own types for the Cloudflare objects the edge uses. No `@cloudflare/workers-types`. */

export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

/** The part of a Durable Object's state that the object uses. */
export interface PawObjectState {
  storage: { sql: SqlLike };
}

export interface PawObjectStub {
  fetch(request: Request): Promise<Response>;
}

export interface PawObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): PawObjectStub;
}

export interface PawNamespace extends PawObjectNamespace {
  jurisdiction(name: 'us'): PawObjectNamespace;
}

export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

/** The settings of Requirement 9, as the Worker's environment gives them. */
export interface EdgeSettings {
  GEMINI_API_KEY?: string;
  GEMINI_TIER?: string;
  DAILY_BUDGET_CENTS?: string;
  PER_IP_LIMIT?: string;
  RATE_WINDOW_MS?: string;
  PRICE_TABLE_JSON?: string;
  GEMINI_MODEL?: string;
  GEMINI_MODEL_FALLBACKS?: string;
  GEMINI_TIMEOUT_MS?: string;
  CORS_ORIGIN?: string;
}

export interface EdgeEnv extends EdgeSettings {
  PAW: PawNamespace;
  ASSETS: AssetsBinding;
}

/** A request as the Workers runtime gives it: `cf` is set by Cloudflare. */
export type EdgeRequest = Request & { cf?: { country?: unknown } };
