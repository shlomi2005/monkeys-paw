# Paw API — Requirements

## Introduction

The Paw API is the server side of The Monkey's Paw. It is a Hono server running on Node 24, deployed to Railway.
It is the **only** place that calls the model (iron-rules.md §1): it holds the Gemini API key in an environment
variable, never ships it to the client, and implements `paw-core`'s `ModelClient` interface. The web client
calls these endpoints via fetch; the Kiro power (`packages/paw-power`) imports `paw-core` directly and is
covered by a separate spec.

Scope of this spec: the HTTP server in `apps/api`, the `GeminiModelClient`, budget and per-IP rate-limit
enforcement, the cached examples endpoint, CORS, the golden-wish eval script, and the schema changes for
wish-engine task 25 (Genie returns `userStory`, Judge returns `property`).

### Out of scope

- The UI/3D scene (`apps/web`) — separate spec.
- The pure wish-engine logic (`packages/paw-core`) — covered by the wish-engine spec, except the task 25
  schema and type changes documented here.
- The Kiro power MCP server and hook (`packages/paw-power`) — separate spec.
- Prompt content — lives in `paw-core/src/prompts.ts`; this spec covers the transport, eval, and task 25
  schema changes, not prompt text.

### Runtime note

`tech.md` lists Node.js 22 (LTS). The repo's `.nvmrc` already pins Node 24 and the root `package.json` sets
`engines.node >= 22`. This spec targets Node 24 as the runtime, consistent with `.nvmrc`. The `tech.md`
runtime entry should be amended to Node 24 when convenient.

---

## Requirements

### Requirement 1: Grant a wish (POST /api/grant)

**User story:** As a spec author, I want to submit my wish to the API and receive a Grant with narration and
3–5 curses so I can see where my requirement breaks.

**Acceptance criteria:**

1. **WHEN** the client sends `POST /api/grant` with a JSON body containing `wish.text` (non-empty) and
   optional `wish.context` **THE SYSTEM SHALL** create a `Wish` record (generating `id` and `createdAt`),
   check the per-IP rate limit and daily budget (Requirement 7), and call `grantWish(wish, modelClient)` to
   produce a `Grant`.
2. **IF** `wish.text` is empty or whitespace-only **THE SYSTEM SHALL** return HTTP 400 with an in-character
   error message and no model call.
3. **IF** the wish concerns harming real people, hate, or gore **THE SYSTEM SHALL** refuse it with HTTP 400
   and a short in-character line (iron-rules.md §3), making no model call.
4. **WHEN** the budget or rate limit is exceeded **THE SYSTEM SHALL** return HTTP 503 with an in-character
   message directing the user to the examples (Requirement 8), making no model call.
5. **WHEN** the model call succeeds **THE SYSTEM SHALL** return HTTP 200 with the validated `Grant` as JSON,
   including `narration`, `curses`, and (after task 25) `userStory`.
6. **IF** the model output fails zod validation after retry (iron-rules.md §6) **THE SYSTEM SHALL** return
   the fallback `Grant` from `paw-core` (single generic curse) with HTTP 200, so the client always gets a
   usable response.
7. **WHEN** a Grant is returned **THE SYSTEM SHALL** record the model call cost via `recordCall` (Requirement 7)
   so the daily budget counter stays accurate.

### Requirement 2: Bind a loophole (POST /api/bind)

**User story:** As a spec author, I want to submit a binding for a specific curse and learn whether the Judge
accepts it, so I can close loopholes one at a time.

**Acceptance criteria:**

1. **WHEN** the client sends `POST /api/bind` with `{ grant, curseId, clause, kind }` where `kind` is
   `"rewrite"` or `"ears-clause"` and `clause` is non-empty **THE SYSTEM SHALL** locate the curse with
   `curseId` in the provided `grant`, construct a `Binding` via `proposeBinding`, check the budget
   (Requirement 7), and call `judgeBinding(curse, binding, modelClient)`.
2. **IF** `clause` is empty or `kind` is not a valid `BindingKind` **THE SYSTEM SHALL** return HTTP 400 with an
   in-character error and no model call.
3. **IF** `curseId` does not match any curse in the grant **THE SYSTEM SHALL** return HTTP 404 with an
   in-character error and no model call.
4. **WHEN** the Judge returns a verdict **THE SYSTEM SHALL** return HTTP 200 with `{ grant, verdict }` where
   `grant` has the curse updated (status set to `closed` if `verdict.closed` is true, `binding` and `verdict`
   attached) and `verdict` is the Judge's `Verdict` including (after task 25) `property` when closed.
5. **IF** the model output fails zod validation after retry **THE SYSTEM SHALL** fall back to
   `closed: false` (iron-rules.md §6) and return HTTP 200 with the fallback verdict.
6. **WHEN** the bind endpoint completes a model call **THE SYSTEM SHALL** record the cost via `recordCall`
   (Requirement 7).

### Requirement 3: Export the spec (POST /api/export)

**User story:** As a spec author, I want to export a Kiro-ready spec from my grant so I can drop it into a
`.kiro/specs/` folder.

**Acceptance criteria:**

1. **WHEN** the client sends `POST /api/export` with `{ grant, wish }` **THE SYSTEM SHALL** call
   `exportSpec(wish, grant)` and return the `SpecExport` as JSON with HTTP 200.
2. **WHEN** the export is requested **THE SYSTEM SHALL NOT** make a model call; export is pure logic from
   `paw-core`.
3. **IF** the grant or wish is malformed **THE SYSTEM SHALL** return HTTP 400 with a validation error.
4. **WHEN** the export is returned **THE SYSTEM SHALL** include `requirementsMd`, `propertiesMd`, and
   `integrity` in the response, assembling model-written `userStory` and `property` fields where present
   (Requirement 11, task 25) and falling back to the deterministic template otherwise.

### Requirement 4: Serve cached golden examples (GET /api/examples)

**User story:** As a spec author browsing the app, I want to see 25 pre-computed example wishes and their
grants so I can try the app without spending model budget.

**Acceptance criteria:**

1. **WHEN** the client sends `GET /api/examples` **THE SYSTEM SHALL** return HTTP 200 with an array of
   `{ wish, grant }` objects — one per golden wish from `docs/golden-wishes.json` — served from a cache file
   on disk, with no model call.
2. **WHEN** the server is in examples-only mode (Requirement 8) **THE SYSTEM SHALL** still serve this
   endpoint normally.
3. **IF** the cache file is missing or unreadable **THE SYSTEM SHALL** return HTTP 503 with a message
   indicating the examples cache is not yet generated.
4. **THE SYSTEM SHALL NOT** call the model to generate examples on the fly; the cache is pre-computed by the
   eval script (Requirement 12) or a build step.

### Requirement 5: Health check (GET /api/health)

**User story:** As an operator, I want a health endpoint so Railway and monitoring can verify the server is up
and see the current budget state.

**Acceptance criteria:**

1. **WHEN** the client sends `GET /api/health` **THE SYSTEM SHALL** return HTTP 200 with `{ status, mode,
   budget }` where `status` is `"ok"`, `mode` is `"normal"` or `"examples-only"`, and `budget` summarizes the
   remaining daily budget and per-IP rate-limit state.
2. **WHEN** the health endpoint is called **THE SYSTEM SHALL NOT** make a model call or reveal the API key
   or any wish text.
3. **THE SYSTEM SHALL** respond within 1 second under normal load.

### Requirement 6: Gemini model client

**User story:** As the operator, I want the API to call a fast Gemini Flash model with structured JSON output
so the Paw gets high-quality, schema-valid results at low cost.

**Acceptance criteria:**

1. **WHEN** the API server starts **THE SYSTEM SHALL** construct a `GeminiModelClient` that implements
   `paw-core`'s `ModelClient` interface (`generate(prompt: string): Promise<unknown>`).
2. **THE SYSTEM SHALL** read the API key exclusively from the `GEMINI_API_KEY` environment variable; if it is
   absent, the server starts but enters examples-only mode immediately (iron-rules.md §1, §5).
3. **WHEN** `generate` is called **THE SYSTEM SHALL** send the prompt to a fast Gemini Flash model using
   structured JSON output mode (response MIME type `application/json`) so the model returns parseable JSON.
4. **WHEN** `generate` is called **THE SYSTEM SHALL** enforce a configurable timeout (default 30 seconds);
   if the model does not respond in time, the call throws and the caller (paw-core) retries once then falls
   back (iron-rules.md §6).
5. **THE SYSTEM SHALL NOT** log the full prompt text or the model's raw response in production logs; only
   metadata (model name, duration, cost estimate, success/failure) is logged.
6. **WHEN** a model call completes **THE SYSTEM SHALL** return the raw text or parsed JSON to paw-core, which
   performs zod validation.

### Requirement 7: Budget and per-IP rate-limit enforcement

**User story:** As the operator, I want every model call gated by a per-IP rate limit and a hard daily budget
so costs are capped and the service stays up (iron-rules.md §5).

**Acceptance criteria:**

1. **WHEN** any endpoint is about to make a model call **THE SYSTEM SHALL** call `canCall(state, config, now)`
   from `paw-core/src/budget.ts` first; if it returns `false`, the call is refused and the endpoint returns
   HTTP 503 (grant/bind) or enters examples-only mode.
2. **WHEN** a model call succeeds **THE SYSTEM SHALL** call `recordCall(state, costCents, now)` to update the
   in-memory budget state so subsequent calls see the updated counters.
3. **THE SYSTEM SHALL** hold all budget state in memory (per-IP counters and daily spend); no persistent
   storage (iron-rules.md §2). Counters reset on server restart.
4. **THE SYSTEM SHALL** use the client IP (from the `x-forwarded-for` header or the Hono request) as the
   rate-limit key, never storing any identity or wish text with it.
5. **WHEN** the per-IP window has elapsed **THE SYSTEM SHALL** reset that IP's counter, as modeled by
   `canCall` returning `true` for the first call in a new window.
6. **WHEN** the daily budget is exhausted **THE SYSTEM SHALL** enter examples-only mode (Requirement 8) and
   never call the model under any circumstances.
7. **WHILE** the server runs **THE SYSTEM SHALL** expose the current budget state via `GET /api/health` so the
   operator can monitor spend.

### Requirement 8: Examples-only degraded mode

**User story:** As a spec author, I want the app to still work (showing examples) when the daily budget is
exhausted, so the app is never fully down.

**Acceptance criteria:**

1. **WHEN** the daily budget is exhausted or the `GEMINI_API_KEY` is absent **THE SYSTEM SHALL** enter
   examples-only mode and set `mode: "examples-only"` in health responses.
2. **WHILE** in examples-only mode **THE SYSTEM SHALL** serve `GET /api/examples` and `GET /api/health`
   normally, with no model calls.
3. **WHILE** in examples-only mode **THE SYSTEM SHALL** reject `POST /api/grant` and `POST /api/bind` with
   HTTP 503 and an in-character message: "The paw is resting. Browse the examples until it wakes."
4. **WHILE** in examples-only mode **THE SYSTEM SHALL** still serve `POST /api/export` since it makes no
   model call.
5. **WHEN** the daily budget resets (new day boundary) **THE SYSTEM SHALL** automatically exit examples-only
   mode and resume normal operation.

### Requirement 9: Privacy and safe logging

**User story:** As a user, I want my wish text never associated with my identity or IP in any log, so my
requirements stay private (iron-rules.md §2).

**Acceptance criteria:**

1. **THE SYSTEM SHALL NOT** store any identity (name, email, user ID, session cookie) with a wish.
2. **THE SYSTEM SHALL NOT** log wish text alongside an IP address or any identifier.
3. **THE SYSTEM SHALL** keep only short-lived, in-memory rate-limit counters keyed by IP; these are not
   persisted and are never written to disk.
4. **WHEN** the server logs a request **THE SYSTEM SHALL** log only: timestamp, HTTP method, path, status
   code, duration, and whether a model call was made. Never wish text, never the IP in combination with any
   wish content.
5. **THE SYSTEM SHALL NOT** set cookies or track users across requests.

### Requirement 10: CORS

**User story:** As a web client developer, I want the API to accept cross-origin requests from the web app so
the browser can call the API directly.

**Acceptance criteria:**

1. **WHEN** the server receives a request with an `Origin` header matching the configured web origin
   (`CORS_ORIGIN` env var) **THE SYSTEM SHALL** include `Access-Control-Allow-Origin`, `Access-Control-Allow-
   Methods` (GET, POST, OPTIONS), and `Access-Control-Allow-Headers` (Content-Type) in the response.
2. **WHEN** the server receives a preflight `OPTIONS` request **THE SYSTEM SHALL** return HTTP 204 with the
   CORS headers and no body.
3. **IF** the `Origin` header does not match the configured origin **THE SYSTEM SHALL** omit the
   `Access-Control-Allow-Origin` header, rejecting the cross-origin request.
4. **WHEN** `CORS_ORIGIN` is not set **THE SYSTEM SHALL** default to `*` for local development only.

### Requirement 11: Model-written user story and property (wish-engine task 25)

**User story:** As a spec author, I want the exported spec to contain a real user story written by the Genie
and real correctness properties written by the Judge, so my exported spec reads like a human wrote it, not a
template.

**Acceptance criteria:**

1. **WHEN** the Genie grants a wish **THE SYSTEM SHALL** include a `userStory` field in the model output and
   the `GrantSchema` shall validate it; `exportSpec` uses it as the `**User Story:**` line in
   `requirementsMd` instead of the generic template.
2. **WHEN** the Judge returns a `closed` verdict **THE SYSTEM SHALL** include a `property` field in the model
   output and the `VerdictSchema` shall validate it; `exportSpec` uses it as the property line in
   `propertiesMd` instead of the clause-restatement template.
3. **IF** the model does not return `userStory` or `property` (e.g. fallback path) **THE SYSTEM SHALL**
   fall back to the deterministic template in `exportSpec`, so the export is never malformed.
4. **WHEN** the `GrantSchema` is extended with `userStory` (optional string) and `VerdictSchema` is extended
   with `property` (optional string, present when `closed` is true) **THE SYSTEM SHALL** pass these fields
   through the API boundaries unchanged; the API does not interpret or modify them.
5. **WHEN** the prompts in `paw-core/src/prompts.ts` are updated to request `userStory` from the Genie and
   `property` from the Judge **THE SYSTEM SHALL** pass the updated prompt to the model via `GeminiModelClient`
   without changes to the transport layer.

### Requirement 12: Golden-wish eval script

**User story:** As the operator, I want to run all 25 golden wishes against the real model and score the
results so prompt changes are gated by quality and the examples cache is kept fresh.

**Acceptance criteria:**

1. **WHEN** the operator runs `pnpm eval` in the `apps/api` workspace **THE SYSTEM SHALL** load
   `docs/golden-wishes.json`, create a real `GeminiModelClient`, and run `grantWish` for each of the 25
   wishes.
2. **WHEN** each wish is granted **THE SYSTEM SHALL** run the Judge quality gate on every curse and record
   whether it was judged `specific: true` or `false`, along with the reason.
3. **WHEN** all 25 wishes are processed **THE SYSTEM SHALL** compute a specificity score (fraction of curses
   judged specific) and a type-coverage score (fraction of `expectedTypes` from the golden wishes found in
   the generated curses).
4. **WHEN** the eval completes **THE SYSTEM SHALL** write `docs/eval/latest.md` containing: a table of all
   25 wishes with their grant summary, per-curse specificity verdicts, type coverage, overall scores, and a
   pass/fail marker.
5. **WHEN** the eval script runs **THE SYSTEM SHALL** also write the pre-computed grants to the examples
   cache file (Requirement 4) so `GET /api/examples` serves fresh results.
6. **IF** the specificity score is below the configured threshold (default 0.80) **THE SYSTEM SHALL** exit
   with a non-zero status code, failing the release gate.
7. **WHEN** the eval script runs **THE SYSTEM SHALL** require `GEMINI_API_KEY` to be set; if absent, it exits
   with an error and no model calls.
8. **THE SYSTEM SHALL** make this script the release gate for prompt changes: a pull request that modifies
   `paw-core/src/prompts.ts` must pass the eval (non-zero exit) before merge.
