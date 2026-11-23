# Paw edge — Requirements

## Introduction

The site can run at $0 with no card on Cloudflare Workers Free. A Worker serves the web build as static assets and
runs first only on `/api/*`. One Durable Object runs the same Hono app as Node. Nothing is deployed by this spec. A
fork's owner deploys with their own account.

The Node path works exactly as before: the README quickstart, `pnpm -C apps/api dev`, `pnpm start`, Docker and every
test.

Out of scope: deploying, any account action, a custom domain, the paid Gemini tier, and the content of the ready
rounds.

Facts about Cloudflare rest on Cloudflare's docs, named in the criteria that use them.

### Requirement 1: Static assets and the Worker

**User story:** As a fork's owner, I want one config file, so that one command deploys the site.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** have one config file `apps/api/wrangler.json`, plain JSON, so a test can parse it.
2. **THE SYSTEM SHALL** set `main` to the edge entry `apps/api/src/edge/worker.ts`, put `nodejs_compat` in
   `compatibility_flags`, and set a fixed `compatibility_date` no later than the bundled workerd supports.
3. **THE SYSTEM SHALL** set `assets` with `directory` `../web/dist`, `binding` `ASSETS` and `run_worker_first` exactly
   `["/api/*"]`, so every other path is a static file and does not invoke the Worker.
4. **THE SYSTEM SHALL** set `workers_dev` to true, `preview_urls` to false and `send_metrics` to false.
5. **THE SYSTEM SHALL** keep `account_id`, `route`, zone and any secret out of the file.
6. **THE SYSTEM SHALL** keep `server.ts`, `paths.ts` and `@hono/node-server` out of the edge bundle.

### Requirement 2: Trusted country

**User story:** As the operator, I want the country to come from Cloudflare only, so that no visitor can claim one.

#### Acceptance Criteria

1. **WHEN** a request for `/api/*` arrives **THE SYSTEM SHALL** have the Worker build the request it forwards. It
   deletes every inbound header whose name starts with `x-paw-`, except `x-paw-adult-confirmed`.
2. **THE SYSTEM SHALL** keep `x-paw-adult-confirmed`. It is the visitor's own statement and the gate reads it as
   today. Deleting it would refuse every live wish.
3. **THE SYSTEM SHALL** then set `x-paw-country` from `request.cf.country`, and only when that value is exactly two
   uppercase letters and the request has no `CF-Worker` header.
4. **IF** the request carries `CF-Worker` **THE SYSTEM SHALL** set no country. Calls from another Worker carry that
   header, and the country they show is unknown (fail closed). Grant and bind then answer the gate's 403
   `live_region_unavailable`, and `GET /api/live` says `live: false`.
5. **THE SYSTEM SHALL** never allow `XX` (unknown) or `T1` (Tor).
6. **THE SYSTEM SHALL**, on the edge, fix the gate's header to `x-paw-country`, whatever `COUNTRY_HEADER` says.
7. **THE SYSTEM SHALL** never log or store the country.

### Requirement 3: Trusted IP

**User story:** As the operator, I want the per-IP limit to key on Cloudflare's address, so that a forged header
does not buy a fresh limit.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** have the Worker delete inbound `x-forwarded-for`, `x-real-ip` and `forwarded`.
2. **WHEN** `CF-Connecting-IP` is present **THE SYSTEM SHALL** set `x-forwarded-for` to its single value. Otherwise it
   sets none.
3. **THE SYSTEM SHALL**, on the edge, use 1 trusted hop for the per-IP key, whatever `TRUSTED_PROXY_HOPS` says.
4. **THE SYSTEM SHALL** never let a forged `X-Forwarded-For` change the key.

### Requirement 4: One Durable Object

**User story:** As the operator, I want one place that holds the budget, so that the daily cap is one number.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** have the Worker forward each `/api/*` request to one object of the class exported from the
   entry, got by a fixed name from `env.PAW.jurisdiction("us")`. Cloudflare's docs: a jurisdiction runs the object
   only in that region, while a location hint alone is best effort.
2. **THE SYSTEM SHALL** make the class SQLite-backed: the migrations list it under `new_sqlite_classes`. Cloudflare's
   docs: the Free plan needs this.
3. **THE SYSTEM SHALL** build the app once in the object with `createApp` and answer every request with it.
4. **THE SYSTEM SHALL** give the object no URL of its own.

### Requirement 5: Budget state that survives a restart

**User story:** As the operator, I want the day's spend to survive a restart, so that a restart does not refill the
budget.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** let `createApp` accept an optional budget store. Without one, everything is as today (memory
   only).
2. **WHEN** the app is created with a store **THE SYSTEM SHALL** load the saved `spentCents`, `reservedCents` and
   `dayStart`.
3. **WHEN** a reservation is left over **THE SYSTEM SHALL** add it to `spentCents` and start `reservedCents` at 0. A
   call that was in flight when the object stopped may have been billed.
4. **IF** the saved row cannot be read (missing fields, not finite, negative) **THE SYSTEM SHALL** count a whole spent
   day from now (fail closed).
5. **THE SYSTEM SHALL** save every change of the three values: the reservation, the settle and the day roll.
6. **THE SYSTEM SHALL** save the reservation of a call before its first upstream fetch.
7. **THE SYSTEM SHALL** store only those three numbers: never an IP, wish, clause, country or key.
8. **THE SYSTEM SHALL**, on the edge, use the object's SQLite storage (`ctx.storage.sql`), one row in one table.
   Cloudflare's docs: the object loses its memory after about 10 idle seconds or at any shutdown.

### Requirement 6: The IP map stays in memory

**User story:** As a visitor, I want my address kept nowhere on disk, so that the limit leaves no record of me.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** keep the per-IP counts in the object's memory and never write them to storage.
2. **WHEN** a POST to grant or bind is answered **THE SYSTEM SHALL** keep a timer until that rate window ends, so the
   object stays in memory while a window is open. Cloudflare's docs: a pending timer prevents hibernation.
3. **THE SYSTEM SHALL** test that no IP reaches storage.

### Requirement 7: Examples

**User story:** As a visitor, I want the ready rounds on the edge, so that the site works with no key.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** serve the committed `apps/api/examples-cache.json`, imported into the bundle, with today's
   validation and today's 503 when it is invalid.
2. **THE SYSTEM SHALL** let `createApp` take the examples either as today's file path (Node) or as a loader (edge).
   Node is unchanged.
3. **THE SYSTEM SHALL** answer `GET /api/examples` with 200 and the committed file (paw-api Requirement 20).
4. **THE SYSTEM SHALL** hold paw-api Requirement 19 through the entry: a failed live call answers 503 with the resting
   message, never a 200 fallback, with the edge's 3-model chain.

### Requirement 8: The model on the edge

**User story:** As the operator, I want the live path to fit the Free plan's limits.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** read the key only from the Worker secret `GEMINI_API_KEY`. Missing or blank is examples-only,
   as today.
2. **THE SYSTEM SHALL** call `globalThis.fetch.bind(globalThis)`, because an unbound `this.fetchFn(...)` can throw
   "Illegal invocation" in Workers, and log one JSON line through `console.log`.
3. **THE SYSTEM SHALL** use the configured chain (same variables and parsing as Node) cut to its first 3 models. The
   default is `gemini-3.6-flash`, `gemini-3.8-flash`, `gemini-3.5-flash-lite`.
4. **THE SYSTEM SHALL** stay within Cloudflare's docs: Free allows 50 external subrequests per request. A grant makes
   at most 14 `generate` calls, so at most 14 x 3 = 42 upstream fetches. A bind makes at most 2 x 3 = 6.
5. **THE SYSTEM SHALL** test the count.
6. **THE SYSTEM SHALL** leave the Node chain and the README worst case for Node unchanged.

### Requirement 9: Settings on the edge

#### Acceptance Criteria

1. **THE SYSTEM SHALL** read from the Worker's environment, with Node's parsing: `GEMINI_TIER`, `DAILY_BUDGET_CENTS`,
   `PER_IP_LIMIT`, `RATE_WINDOW_MS`, `PRICE_TABLE_JSON`, `GEMINI_MODEL`, `GEMINI_MODEL_FALLBACKS`,
   `GEMINI_TIMEOUT_MS` and `CORS_ORIGIN`.
2. **THE SYSTEM SHALL** never read them from a file.

### Requirement 10: The MCP client on workers.dev

#### Acceptance Criteria

1. **THE SYSTEM SHALL** have `packages/paw-mcp` (remote mode) send its own `User-Agent: paw-mcp/<version>` on every
   request. Cloudflare's docs: workers.dev runs a browser integrity check that blocks some default library user
   agents (error 1010).
2. **THE SYSTEM SHALL** say in the power README that `PAW_API_URL` may be the edge's https URL.
3. **THE SYSTEM SHALL** rebuild the power bundle.

### Requirement 11: Local run

#### Acceptance Criteria

1. **WHEN** `wrangler dev` runs in local mode from `apps/api` after `pnpm build` **THE SYSTEM SHALL** serve the web
   build and the API with no account and no key: the ready rounds play to the export, `GET /api/health` answers, and
   no live wish can start.
2. **THE SYSTEM SHALL** keep the budget row across a restart of the dev server (local storage under `.wrangler/`).
3. **THE SYSTEM SHALL** gitignore `.wrangler/` and `.dev.vars*`.
4. **THE SYSTEM SHALL** list `wrangler` as a devDependency of `apps/api` at an exact version at least two weeks old,
   in the lockfile. No other new runtime dependency.
5. **WHEN** the runtime has no jurisdictions (local `wrangler dev`) **THE SYSTEM SHALL** use the plain namespace, and on
   any other error answer the fixed 500.

### Requirement 12: Tests

#### Acceptance Criteria

1. **THE SYSTEM SHALL** test with unit and property (fast-check) tests, with fakes only and no network.
2. **THE SYSTEM SHALL** cover forged headers in both directions: an allowed `request.cf.country` with forged
   `x-paw-country`, `cf-ipcountry` and similar headers naming a refused country stays allowed; a refused or missing
   country with forged headers naming `US` stays refused.
3. **THE SYSTEM SHALL** cover the `CF-Worker` refusal, and the refusal of `XX` and `T1`.
4. **THE SYSTEM SHALL** cover the XFF overwrite and the per-IP limit under forged XFF: the 11th live call from one
   `CF-Connecting-IP` is refused, and another address is not.
5. **THE SYSTEM SHALL** cover: the budget surviving an object restart; a leftover reservation counting as spent; the
   reservation saved before each upstream fetch; no IP in storage; the chain cut and the fetch count; and the config
   file checks of Requirements 1 and 4.
6. **THE SYSTEM SHALL** use `node:sqlite` in tests that need SQLite if Vitest can load it, else a fake with the same
   `exec(...).toArray()` subset.

## Not verifiable without a deploy

These are not criteria.

- The Durable Object CPU limit on Free.
- Whether Gemini accepts the object's outbound address.
- Whether the `us` jurisdiction always exits with an address Google reads as US.
- The 1-second startup limit on the real platform.
