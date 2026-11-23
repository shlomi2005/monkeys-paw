# Paw edge — Design

## Files and roles

| File | Role |
|------|------|
| `apps/api/src/edge/worker.ts` | The entry. Exports the Worker `fetch` and the Durable Object class `PawObject`. |
| `apps/api/src/edge/headers.ts` | Pure request rewrite (country, IP, `x-paw-*`). |
| `apps/api/src/edge/sql-store.ts` | The SQLite budget store over a minimal `exec(...).toArray()` interface. |
| `apps/api/src/edge/config.ts` | Worker environment to `AppDeps`, with Node's parsing. |
| `apps/api/src/budget/store.ts` | The `BudgetStore` interface and the load rule. |
| `apps/api/src/app.ts` | The seam: optional `store`, and examples as a path or a loader. |
| `apps/api/wrangler.json` | The one config file. |

## Order inside the Worker

1. The static assets layer answers every path except `/api/*`. It does not invoke the Worker.
2. For `/api/*` the Worker calls `rewriteRequest(request)` from `headers.ts`: delete `x-forwarded-for`, `x-real-ip`,
   `forwarded` and every `x-paw-*` header except `x-paw-adult-confirmed`; set `x-forwarded-for` from
   `CF-Connecting-IP`; set `x-paw-country` from `request.cf.country` if it is two uppercase letters, not `XX` or
   `T1`, and `CF-Worker` is absent.
3. It gets the object with `const ns = env.PAW.jurisdiction("us"); ns.get(ns.idFromName(FIXED_NAME))` and forwards the
   rewritten request. An id made by the plain namespace is not valid in the jurisdiction.
4. `PawObject` builds the app once with `createApp` and answers with `app.fetch`. After each POST to grant or bind it
   keeps a timer until the rate window ends.

## Why the adult header is kept

`x-paw-adult-confirmed` is the visitor's own statement, not a fact about the network. The gate (paw-api Requirement
14) reads it as today. Deleting it would refuse every live wish. Every other `x-paw-*` header is deleted, so no caller
can supply `x-paw-country`.

## Edge settings

On the edge `config.ts` fixes the gate header to `x-paw-country` and the trusted hops to 1, and cuts the model chain
to its first 3 models. The rest (tier, budget, limits, prices, models, timeout, CORS) come from the Worker's `env`
with the same parsers as Node. A blank key is no key.

## Budget store

`src/budget/store.ts`:

```ts
export interface BudgetSnapshot { spentCents: number; reservedCents: number; dayStart: number }
export interface BudgetStore { load(): BudgetSnapshot | undefined; save(s: BudgetSnapshot): void }
```

Load rule, applied once in `createApp`: no row gives a fresh state. A row with a missing, non-finite or negative field
gives a whole spent day from now (`spentCents` = the daily budget, `dayStart` = now). A readable row gives
`spentCents = spent + reserved`, `reservedCents = 0`, and the saved `dayStart`.

Save hook. `createApp` hands the store to the state. The guard calls it:

- after the reserve and before the inner call (so before the first upstream fetch);
- after the settle;
- after a day roll.

Without a store the hook does nothing. A save failure is not caught by the guard: the request ends in the app's
error handler (fixed 500), and the call is not made.

## Table schema

```sql
CREATE TABLE IF NOT EXISTS budget (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  spent_cents REAL NOT NULL,
  reserved_cents REAL NOT NULL,
  day_start INTEGER NOT NULL
);
```

One row. `INSERT ... ON CONFLICT(id) DO UPDATE`. No other column, so no IP, wish, clause, country or key can be
stored. `sql-store.ts` takes `{ exec(sql, ...bindings): { toArray(): unknown[] } }`, which `ctx.storage.sql` has.

## Why Node is unchanged

`server.ts` and `paths.ts` stay as they are and are the only Node-only files. `createApp` gains optional inputs, and
their defaults are today's behaviour: no store (memory only), examples as a file path. The edge modules are new files
that Node never imports.

## Types

The Cloudflare objects (`DurableObjectState`, the namespace, `request.cf`) have minimal own types in
`src/edge/types.ts`. `@cloudflare/workers-types` is not needed, so Node's typecheck is unchanged.

## zod

zod stays at 3.x. Cloudflare advises 4.5 or later for memory. The startup time is measured in the local run and on
the deploy.

## Fetch count

The chain is cut to 3, so a grant makes at most 14 x 3 = 42 upstream fetches and a bind at most 2 x 3 = 6, under
Cloudflare's 50 subrequests on Free. A fake that fails every attempt would stop after the genie's 2 calls (6 fetches), so
the test scripts the worst path: on every call the first two models answer 503 and the third answers a scripted body,
so that all 14 `generate` calls of a grant happen (genie: an invalid answer, then a valid grant with 5 curses; batch
judge: an invalid answer, then all 5 curses generic; each of the 5 replacements: an invalid answer, then a valid
curse), and it counts 42 fetches; a bind whose judge answers are invalid twice counts 6.

## Correctness Properties

**Property 1 (Trusted country):** For any inbound headers and any `request.cf`, the forwarded `x-paw-country` equals
`request.cf.country` iff that is two uppercase letters, not `XX` or `T1`, and the request has no `CF-Worker` header;
otherwise there is no `x-paw-country`.

**Property 2 (No forged `x-paw-*`):** For any inbound headers, no `x-paw-*` header survives in the forwarded request
except `x-paw-adult-confirmed` and the one `x-paw-country` the Worker set.

**Property 3 (Trusted IP):** For any inbound headers, the forwarded `x-forwarded-for` equals `CF-Connecting-IP` when
present, else it is absent; `x-real-ip` and `forwarded` are absent.

**Property 4 (Reload keeps the spend):** After any sequence of reserve, settle and day roll, a reload from the store
gives `spentCents` = the saved `spentCents` + the saved `reservedCents`, and `reservedCents` = 0.

**Property 5 (No IP in storage):** After any sequence of requests with any addresses, storage holds only the one
budget row with its three numbers.
