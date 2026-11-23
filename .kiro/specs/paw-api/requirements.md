# Paw API — Requirements

## Introduction

The Paw API is the server side of The Monkey's Paw. It is a Hono server running on Node 24, deployed to Railway.
It is the **only** place that calls the model (iron-rules.md §1): it holds the Gemini API key in an environment
variable, never ships it to the client, and implements `paw-core`'s `ModelClient` interface. The web client
calls these endpoints via fetch. The Kiro power (`packages/paw-mcp`, `powers/monkeys-paw`) runs on the user's own
Kiro agent and calls these endpoints only in its opt-in remote mode; it is covered by the paw-power spec.

**Free tier (owner's decision, 20.11).** The product that stays on the market is the Kiro power, not the website. The
website is a shop window for judges and visitors. It runs on Gemini's free tier with no billing account, so no bill is
possible. When the day's free quota ends, the round falls back to the ready examples (Requirement 13).

Scope of this spec: the HTTP server in `apps/api`, the `GeminiModelClient`, budget and per-IP rate-limit
enforcement, the cached examples endpoint, CORS, the golden-wish eval script, and the schema changes for
wish-engine task 25 (Genie returns `userStory`, Judge returns `property`), running on Gemini's free tier
(Requirement 13), and the live-call gate (Requirement 14).

### Out of scope

- The UI/3D scene (`apps/web`) — separate spec.
- The pure wish-engine logic (`packages/paw-core`) — covered by the wish-engine spec, except the task 25
  schema and type changes documented here.
- The Kiro power MCP server and hook (`packages/paw-mcp`, `powers/monkeys-paw`) — the paw-power spec.
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
   and a short in-character line (iron-rules.md §3), making no model call. Game roles are not real people:
   **WHEN** a combat verb (kill, attack, shoot, stab, hurt, harm, injure, poison, assault, with their
   inflections) is aimed only at a game-role word (player, character, NPC, avatar, enemy, monster, opponent,
   mob, in singular or plural) **THE SYSTEM SHALL** let the wish pass, so "Players can attack other players"
   is granted. A social-harm verb (harass, bully, threaten, stalk, abuse, hate, torture, murder) aimed at a game
   role, and any harm verb aimed at a real-person word (users, people, a named person or group), **THE SYSTEM
   SHALL** still refuse.
4. **WHEN** the budget or rate limit is exceeded **THE SYSTEM SHALL** return HTTP 503 with an in-character
   message directing the user to the examples (Requirement 8), making no model call.
5. **WHEN** the model call succeeds **THE SYSTEM SHALL** return HTTP 200 with the validated `Grant` as JSON,
   including `narration`, `curses`, and (after task 25) `userStory`.
6. **IF** the model output fails zod validation after retry (iron-rules.md §6) **THE SYSTEM SHALL** return
   the fallback `Grant` from `paw-core` (single generic curse) with HTTP 200, so the client always gets a
   usable response.
7. **WHEN** a Grant is returned **THE SYSTEM SHALL** have charged every model call of the request to the daily
   budget at its real token cost (Requirement 7), so the daily budget counter stays accurate.
8. **IF** `wish.text` is longer than 500 characters after trimming, or `wish.context` is longer than 200
   characters, **THE SYSTEM SHALL** return HTTP 400 with an in-character error and no model call.
9. **WHEN** the model's free quota is spent (Requirement 13.5) **THE SYSTEM SHALL** return HTTP 503 with the same
   in-character message as for an exhausted budget (`RESTING_MESSAGE`), and no Grant.

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
6. **WHEN** the bind endpoint makes model calls **THE SYSTEM SHALL** have charged each of them to the daily
   budget at its real token cost (Requirement 7).
7. **IF** `clause` is longer than 1000 characters after trimming **THE SYSTEM SHALL** return HTTP 400 with an
   in-character error and no model call.
8. **IF** the `loophole` of any curse in the grant is longer than 1000 characters **THE SYSTEM SHALL** return
   HTTP 400 with an in-character error and no model call. (`story` is already limited to 360 characters by
   `GrantSchema`.)
9. **WHEN** the model's free quota is spent (Requirement 13.5) **THE SYSTEM SHALL** return HTTP 503 with
   `RESTING_MESSAGE`, not the fallback verdict.

### Requirement 3: Export the spec (POST /api/export)

**User story:** As a spec author, I want to export a Kiro-ready spec from my grant so I can drop it into a
`.kiro/specs/` folder.

**Acceptance criteria:**

1. **WHEN** the client sends `POST /api/export` with `{ grant, wish }` **THE SYSTEM SHALL** call
   `exportSpec(wish, grant)` and return the `SpecExport` as JSON with HTTP 200.
2. **WHEN** the export is requested **THE SYSTEM SHALL NOT** make a model call; export is pure logic from
   `paw-core`.
3. **IF** the grant or wish is malformed or over a cap (Requirement 15.3) **THE SYSTEM SHALL** return HTTP 400 with a
   validation error; over the body cap (15.1) it is 413.
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
   metadata (model name, duration, token counts, finish reason, success/failure) is logged. Token counts are
   numbers and the finish reason is an enum. Never the prompt, the response text or the key.
6. **WHEN** a model call completes **THE SYSTEM SHALL** return the raw text or parsed JSON to paw-core, which
   performs zod validation.
7. **THE SYSTEM SHALL** use `gemini-3.6-flash` as the default model (`DEFAULT_MODEL`), with the default
   fallbacks `gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite` tried in order on HTTP 503, 429 and
   404, except that a 429 whose quota is shared by all models stops the chain (Requirement 13.3). The name `gemini-3.5-flash` is retired and routes to `gemini-3.6-flash`; it may still be set by the
   operator.
8. **WHEN** `generate` sends a request **THE SYSTEM SHALL** set `generationConfig.thinkingConfig.thinkingLevel`
   to `low` on every attempt, for every model in the chain.
9. **WHEN** `generate` sends a request **THE SYSTEM SHALL** set `generationConfig.maxOutputTokens` to
   `MAX_OUTPUT_TOKENS`, one exported constant that is the same for every task. It is a hard cap on thinking
   tokens plus response tokens together. Its value covers the largest valid grant (5 curses at their schema
   limits) with headroom for low-level thinking, is derived in a comment next to the constant, and is not
   above 8192 unless the comment says why.
10. **IF** the first candidate has `finishReason: "MAX_TOKENS"`, or its text is not complete JSON, **THE SYSTEM
    SHALL** treat the attempt as failed: it throws, paw-core retries once then falls back (iron-rules.md §6),
    and the attempt is still charged by its usage (Requirement 7). It does not move on to the next model; only
    HTTP 503, 429 and 404 do (and a 429 or `RESOURCE_EXHAUSTED` answer can stop the chain, Requirement 13.3).
11. **THE SYSTEM SHALL** expose `plan(prompt)` on `GeminiModelClient`: a pure function with no I/O that returns
    one entry `{ model, inputTokens, maxOutputTokens }` per model of the chain, in order. `inputTokens` is
    `ceil((prompt.length + length of the JSON of the response schema) / 3)`, with schema length 0 when the
    prompt has no schema.
12. **THE SYSTEM SHALL** expose `generateMetered(prompt, onAttempt)` on `GeminiModelClient`. It behaves as
    `generate` does and calls `onAttempt(report)` exactly once per HTTP attempt, whatever happened (success,
    timeout, network error, any HTTP status, unreadable body, MAX_TOKENS, bad JSON), before the next attempt
    starts and before the returned promise settles. The report is `{ model, inputTokens, maxOutputTokens,
    modelVersion?, usage? }`. `usage` is `{ promptTokens, outputTokens }`, where `outputTokens` is
    `candidatesTokenCount + thoughtsTokenCount` (a missing count is 0). It is present only when the response
    carried `usageMetadata` with a finite, non-negative `promptTokenCount`.
13. **THE SYSTEM SHALL** keep `generate(prompt)` as `generateMetered(prompt, () => {})` and leave `paw-core`'s
    `ModelClient` interface unchanged.

### Requirement 7: Budget and per-IP rate-limit enforcement

**User story:** As the operator, I want every model call gated by a per-IP rate limit and a hard daily budget
so costs are capped and the service stays up (iron-rules.md §5).

**Acceptance criteria:**

1. **WHEN** `POST /api/grant` or `POST /api/bind` is about to make model calls **THE SYSTEM SHALL** call
   `canCall(state, config, now)` from `paw-core/src/budget.ts` first (per-IP limit and daily budget); if it
   returns `false`, the request is refused with HTTP 503 or the server enters examples-only mode. Each
   `generate` call is then gated again by the reservation rule (7.8).
2. **WHEN** a `generate` call ends, whatever the outcome, **THE SYSTEM SHALL** release its reservation and
   charge its real cost to the in-memory daily spend (7.10). No fixed per-call cost is charged.
3. **THE SYSTEM SHALL** hold all budget state in memory (per-IP counters and daily spend); no persistent
   storage (iron-rules.md §2). Counters reset on server restart.
4. **THE SYSTEM SHALL** key the per-IP rate limit on the client address chosen by `TRUSTED_PROXY_HOPS`
   (default 1; an integer of 0 or more, anything else means 1), never storing any identity or wish text with it.
   Split `x-forwarded-for` into trimmed, non-empty entries. **WHEN** hops is at least 1 and the header has at
   least `hops` entries **THE SYSTEM SHALL** use `entries[entries.length - hops]`, the address the outermost
   trusted proxy saw. **WHEN** hops is 0, the header is absent, or it has fewer entries than hops **THE SYSTEM
   SHALL** use the socket address. A client that fakes entries at the left of the header does not change its
   key.
5. **WHEN** the per-IP window has elapsed **THE SYSTEM SHALL** reset that IP's counter, as modeled by
   `canCall` returning `true` for the first call in a new window.
6. **WHEN** the daily budget is exhausted **THE SYSTEM SHALL** enter examples-only mode (Requirement 8) and
   never call the model under any circumstances.
7. **WHILE** the server runs **THE SYSTEM SHALL** expose the current budget state via `GET /api/health` so the
   operator can monitor spend. `remainingCents` is `max(0, dailyBudgetCents - spentCents - reservedCents)`.
   The cents in the health response are fractional, non-negative numbers.
8. **WHEN** `generate` is called **THE SYSTEM SHALL** reserve a ceiling before the inner call. If
   `spentCents + reservedCents + ceiling` is above `dailyBudgetCents`, **THE SYSTEM SHALL** refuse the call
   with `BudgetExhaustedError`, mark the guard as denied and make no inner call. The check and the
   reservation happen in the same synchronous tick, with no `await` between them, so parallel calls cannot
   all pass the check. A refusal is treated as an exhausted budget (Requirements 1.4, 8.3).
9. **THE SYSTEM SHALL** compute the ceiling as the sum, over every model of the fallback chain given by
   `plan(prompt)`, of `inputTokens × inputRate + maxOutputTokens × outputRate` at that model's price. The whole
   chain is reserved because settling may charge every attempt of a fallback chain. An unbilled attempt (Requirement 16)
   is charged less, but the reservation does not change.
10. **WHEN** a `generate` call ends **THE SYSTEM SHALL**, in a `finally`, subtract its ceiling from
    `reservedCents` and add its charge to `spentCents`. The charge is the sum over its attempt reports: an
    attempt with usage costs `promptTokens × inputRate + outputTokens × outputRate` at the price of the model
    that answered (`modelVersion` when present, else the requested model); an attempt without usage costs its
    own ceiling, except a quota attempt (Requirement 13.1) and an unbilled attempt (Requirement 16), which cost 0
    cents because Google does not bill them.
    **IF** no report arrived at all **THE SYSTEM SHALL** charge the whole ceiling. The reservation of 7.8 and 7.9 is
    unchanged.
11. **IF** the real charge is above the ceiling **THE SYSTEM SHALL** still charge it, because it is real money.
    The spend can then pass `dailyBudgetCents` only by that excess (real prompt tokens above the chars/3
    estimate, or an answering model pricier than the one requested), and every later call is refused.
12. **THE SYSTEM SHALL** price tokens from a table in `apps/api/src/budget/prices.ts`, in USD per million
    tokens, at the rates in force from 1 January 2027 (higher than today's, so the guard over-counts and never
    under-counts). Cents are `tokens × usdPerMTok / 10_000`. `priceFor(table, modelId)` strips a leading
    `models/`, then uses the exact match, else the longest key K such that the id starts with `K-`, else the most
    expensive row (the highest input rate and the highest output rate in the table).
13. **WHERE** `PRICE_TABLE_JSON` is set to a non-empty JSON object of `{ "<model id>": { "inputUsdPerMTok": n,
    "outputUsdPerMTok": n } }` with every rate finite and 0 or more **THE SYSTEM SHALL** use it instead of the
    default table. **IF** it is set but invalid **THE SYSTEM SHALL** use the default table and log one line,
    `{"event":"price_table_invalid"}`, containing no part of the value.
14. **THE SYSTEM SHALL** keep cents as fractional numbers everywhere in the state and never round them. Only the
    health output may round, for display.
15. **THE SYSTEM SHALL** default `DAILY_BUDGET_CENTS` to 200 (two dollars a day). It is parsed with `Number`
    and may be fractional; a missing, non-finite or negative value means 200.
16. **WHEN** the day rolls over **THE SYSTEM SHALL** reset `spentCents` only. `reservedCents` is never reset,
    because calls started before the roll are still in flight.
17. **THE SYSTEM SHALL NOT** charge a fixed per-call cost anywhere. `MODEL_CALL_COST_CENTS`,
    `DEFAULT_MODEL_CALL_COST_CENTS` and every `costPerCallCents` option are removed.
18. **THE SYSTEM SHALL** state in `apps/api/README.md` the worst-case cost of one grant and of one bind, with
    the arithmetic, and a unit test **SHALL** recompute both from the real prompt builders, `plan()` and the
    price table and check that the README states them.

### Requirement 8: Examples-only degraded mode

**User story:** As a spec author, I want the app to still work (showing examples) when the daily budget is
exhausted, so the app is never fully down.

**Acceptance criteria:**

1. **WHEN** the daily budget is exhausted or the `GEMINI_API_KEY` is absent **THE SYSTEM SHALL** enter
   examples-only mode and set `mode: "examples-only"` in health responses. "Exhausted" means the budget cannot cover
   the start ceiling (Requirement 18).
2. **WHILE** in examples-only mode **THE SYSTEM SHALL** serve `GET /api/examples` and `GET /api/health`
   normally, with no model calls.
3. **WHILE** in examples-only mode **THE SYSTEM SHALL** reject `POST /api/grant` and `POST /api/bind` with
   HTTP 503 and an in-character message: "The paw is resting. Browse the examples until it wakes."
4. **WHILE** in examples-only mode **THE SYSTEM SHALL** still serve `POST /api/export` since it makes no
   model call.
5. **WHEN** the daily budget resets (new day boundary) **THE SYSTEM SHALL** automatically exit examples-only
   mode and resume normal operation.
6. **WHEN** a request ends because the model's free quota is spent (Requirement 13.5) **THE SYSTEM SHALL** answer
   that request as in 8.3 (503, `RESTING_MESSAGE`). It does not change `mode` in the health response and keeps no
   state for the next request: the next request tries the model again.

### Requirement 9: Privacy and safe logging

**User story:** As a user, I want my wish text never associated with my identity or IP in any log, so my
requirements stay private (iron-rules.md §2).

**Acceptance criteria:**

1. **THE SYSTEM SHALL NOT** store any identity (name, email, user ID, session cookie) with a wish.
2. **THE SYSTEM SHALL NOT** log wish text alongside an IP address or any identifier.
3. **THE SYSTEM SHALL** keep only short-lived, in-memory rate-limit counters keyed by IP; these are not
   persisted and are never written to disk.
4. **WHEN** the server logs a request **THE SYSTEM SHALL** write one JSON line with only: `event`, timestamp, method,
   path, status code, duration, and `modelCall`. The method is one of the allow-listed names, else `OTHER`. The path
   is one of the known routes (exact match), else `other`; the query string is never logged. `modelCall` is true only
   for a POST on a live route whose budget guard made a model call. Never wish text, never the IP.
5. **THE SYSTEM SHALL NOT** set cookies or track users across requests.
6. **THE SYSTEM SHALL NOT** log, in any stream, the body of a Gemini error answer, or any part of it (Requirement
   13.2). Only numbers and enums are logged (Requirement 6.5).
7. **THE SYSTEM SHALL NOT** write to stdout, stderr or a log, or send in an error response, any text that came from a
   user, a request (body, URL, path, query, method, header), a model or an upstream (an upstream message, status
   text, finish reason, or the message, stack or cause of a thrown value). **WHEN** an error is logged **THE SYSTEM
   SHALL** write one JSON line `{"event":"error","code":<fixed code>,"error":<class>}`, where the class comes from
   `instanceof` checks against a short list of known classes, else `Error` or `NonError`, never from `name`.
   **WHEN** a request body cannot be read **THE SYSTEM SHALL** answer 400 with the route's invalid-format message.

### Requirement 10: CORS

**User story:** As a web client developer, I want the API to accept cross-origin requests from the web app so
the browser can call the API directly.

**Acceptance criteria:**

1. **WHEN** the server receives a request with an `Origin` header matching the configured web origin
   (`CORS_ORIGIN` env var) **THE SYSTEM SHALL** include `Access-Control-Allow-Origin`, `Access-Control-Allow-
   Methods` (GET, POST, OPTIONS), and `Access-Control-Allow-Headers` (Content-Type, X-Paw-Adult-Confirmed) in the response.
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
9. **WHEN** the eval script runs **THE SYSTEM SHALL** make every model call through the same budget guard as the
   server (reserve, refuse, settle; Requirement 7), with the same price table and a `DAILY_BUDGET_CENTS`
   from the environment.
10. **IF** the guard refuses a call during the eval **THE SYSTEM SHALL** exit with status 1 and a message that
    contains "budget exhausted", write neither `docs/eval/latest.md` nor the examples cache, and never print or
    record a pass.
11. **THE SYSTEM SHALL** set `DAILY_BUDGET_CENTS` in the CI eval step of `.github/workflows/prompt-eval.yml`
    to `ceil(5 × worst case per grant)`, the cap for one default eval (5 golden wishes, no binds) with every
    call at its worst case, and document the value and its arithmetic in `apps/api/README.md`.
12. **IF** the guard marks itself denied because the free quota is spent (Requirement 13.5) **THE SYSTEM SHALL** stop
    the eval as on a refusal (12.10): exit 1, write neither `docs/eval/latest.md` nor the examples cache, never
    print a pass, and say in the message that the free quota is spent.

### Requirement 13: Running on Gemini's free tier

**User story:** As the operator, I want the website to run on Gemini's free tier with no billing, so that no bill is
possible and, when the day's free quota ends, visitors get the ready examples.

**Acceptance criteria:**

1. **WHEN** Gemini answers an attempt with HTTP 429, or with any non-200 answer whose JSON error body has
   `error.status` `"RESOURCE_EXHAUSTED"`, **THE SYSTEM SHALL** treat the attempt as a **quota attempt**: the free
   quota is spent.
2. **WHEN** an attempt gets a non-200 answer **THE SYSTEM SHALL** read its body, at most 64 KB and inside the attempt's
   timeout, to look for `error.status` and for the `QuotaFailure` violations in `error.details[]`. **THE SYSTEM
   SHALL NOT** log the body or any part of it, put it in an error message, or keep it after the attempt.
3. **WHEN** an attempt is a quota attempt **THE SYSTEM SHALL** decide whether the quota is shared by all models. It is
   shared **IF** `error.details[]` has at least one violation and every violation names a per-project quota that is not
   per model: its `quotaId` contains `PerProject` and not `PerModel`, and its `quotaDimensions` have no `model`. **IF**
   it is shared, **THEN THE SYSTEM SHALL** stop the chain and not try the remaining fallback models. **OTHERWISE** (a
   per-model quota, any other violation, no violation, or a body that cannot be read or parsed) **THE SYSTEM SHALL** try
   the next model as today, because each model has its own free quota.
4. **WHEN** the chain ends without a success, whether every model was tried or the chain was stopped by 13.3, and at
   least one attempt was a quota attempt, **THE SYSTEM SHALL** make `generateMetered` throw a distinct
   `QuotaExhaustedError`, with a fixed message that holds no body and no key. **WHEN** no attempt was a quota attempt,
   it throws as before.
5. **WHEN** the guard (`BudgetedModelClient`) catches `QuotaExhaustedError` **THE SYSTEM SHALL** mark itself denied, so
   that the routes answer 503 with `RESTING_MESSAGE` (Requirements 1.9, 2.9, 8.6) and the eval stops as on a refusal
   (Requirement 12.12), and **THE SYSTEM SHALL** refuse every later `generate` on the same guard without calling the
   model and without reserving anything, so that paw-core's retry spends no more quota. No new state outlives the
   request.
6. **WHEN** an attempt is a quota attempt **THE SYSTEM SHALL** charge it 0 cents, because Google does not bill it. The
   reservation of the whole chain before the call is unchanged (7.8, 7.9), so the worst-case numbers do not change. An
   unbilled attempt (HTTP 400 or 500 without usage, Requirement 16) costs 0 too. A 404 and every other failure keep
   the ceiling of 7.10.
7. **THE SYSTEM SHALL** update every note that says otherwise: the design's "Cost accounting" (step 5 and "Why the whole
   chain is reserved") and the sentence of `apps/api/README.md` that says "An attempt that reported no token counts (a
   timeout, a network error, an HTTP error) is charged its ceiling," so that it names the quota and unbilled exceptions.
8. **THE SYSTEM SHALL** give `apps/api/README.md` a section on running on the free tier: create the key in a Google AI
   Studio project with no billing account, so no bill is possible; when the day's free quota ends Gemini answers 429
   `RESOURCE_EXHAUSTED`, the paw rests (grant and bind answer 503 "The paw is resting..." and the site serves the ready
   examples), and daily free quotas reset at midnight Pacific time; the budget guard still counts paid-tier prices on
   paper, as a second fence.
9. **THE SYSTEM SHALL** test, with a stubbed `fetch` only and never the network: a 429 on the primary with a per-model
   `QuotaFailure` tries the next model; a per-project `QuotaFailure` stops the chain after one attempt; a 429 on every
   model gives 503 with `RESTING_MESSAGE` on `/api/grant` and on `/api/bind`; `RESOURCE_EXHAUSTED` in a body with
   another status counts too; a quota attempt costs 0 cents and `spentCents` does not move; after a quota answer
   paw-core's retry makes no second HTTP call; the key and the body never reach a log.

### Requirement 14: Live-call gate

**User story:** As the operator, I want the server to call the model only for visitors in regions where Google's terms
allow the free tier, and only after they confirm they are 18 or older, so that the site stays within those terms. The
gate is not legal advice and the confirmation is not proof of age.

Sources (read 2026-11-22): the Gemini API terms (https://ai.google.dev/gemini-api/terms, effective 2026-03-23) and the
available regions (https://ai.google.dev/gemini-api/docs/available-regions). On unpaid services Google may use content
to improve its products and human reviewers may read it.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** list the routes that can call the model, `POST /api/grant` and `POST /api/bind`, in one constant
   (`LIVE_ROUTES`) and run the gate on exactly those routes. It runs right after CORS and the logger and **BEFORE** the
   mode check, the per-IP count, reading the body, any budget reservation and any model call.
2. **THE SYSTEM SHALL** read `GEMINI_TIER`: exactly `paid` is the paid tier. Unset, blank and every other value is the
   free tier (the default).
3. **THE SYSTEM SHALL** hold one table of the 231 available regions, each name mapped to one ISO 3166-1 alpha-2 code
   (Kosovo is `XK`, user-assigned). The paid allow-list is all 231 codes. The free allow-list is the same table without
   the 27 EU states, `IS`, `LI`, `NO`, `CH`, `GB` and, to be conservative, their territories that have their own code
   (`AX`; `FO` `GL`; `GF` `GP` `MQ` `RE` `YT` `MF` `BL` `PM` `PF` `NC` `WF` `TF`; `AW` `CW` `SX` `BQ`; `SJ` `BV`; `GI` `GG`
   `JE` `IM` `AI` `BM` `IO` `VG` `KY` `FK` `GS` `MS` `PN` `SH` `TC`). That leaves 172 codes.
4. **THE SYSTEM SHALL** read the country only from the header named by `COUNTRY_HEADER` and from no other header. It has
   no default and no fallback. **IF** it is unset, blank or not a valid HTTP header name, **THEN THE SYSTEM SHALL** treat
   the country as not allowed and never throw. **IF** that header is missing, empty, not exactly two uppercase ASCII
   letters, repeated (it then arrives joined, as `US, GB`) or not on the allow-list of the tier (`XX`, `T1`, `CN`),
   **THEN THE SYSTEM SHALL** treat the country as not allowed. Every other header is ignored.
5. **THE SYSTEM SHALL** use the country value for that one decision only. It is never stored, logged, echoed in a body
   or header, or put in an error.
6. **WHEN** the country is allowed **THE SYSTEM SHALL** also require the request header `X-Paw-Adult-Confirmed` to be
   exactly `yes`, on both tiers. It is a header and not a body field, so the gate reads no body.
7. **IF** the gate refuses **THEN THE SYSTEM SHALL** answer HTTP 403 with `cache-control: no-store` and JSON
   `{ code, message }`. The country is checked first: `live_region_unavailable` with "The paw grants no live wishes where
   you stand. The examples need no permission."; then `adult_confirmation_required` with "The paw grants live wishes only
   to those who confirm they are 18 or older." A refusal costs 0, reserves nothing, makes no model call and does not
   count against the IP.
8. **THE SYSTEM SHALL** serve `GET /api/live` and answer 200 `{ "live": boolean }`, `true` only when the country is
   allowed, plus `"resting": true` when it is allowed and the model cannot be called (mode or budget). It ignores age, sets `cache-control: no-store`, makes no model call and counts nothing.
9. **THE SYSTEM SHALL NOT** gate or change `/api/examples`, `/api/export` and `/api/health`.
10. **THE SYSTEM SHALL** have `createApp` take the gate config; **WHEN** it is omitted the config is the free tier with
    no country header, so the gate fails closed. `server.ts` reads the environment. The eval CLI is an operator tool, not
    a route, and has no gate.
11. **THE SYSTEM SHALL** document in `apps/api/README.md` and `apps/api/.env.example` both variables, the deploy
    settings, both source URLs with their dates, the warning that `COUNTRY_HEADER` may be set only where the host
    overwrites that header and nobody can reach the server around that host, and that Railway documents no country
    header, so on plain Railway live wishes are off until a host in front supplies one. The README says the gate is not
    legal advice and the confirmation is not proof of age.
12. **THE SYSTEM SHALL** test, with a fake client and no network: the 231 names map one-to-one (against a fixture of the
    names); `US` and `IL` pass; `GB`, `FR`, `CH`, `CN`, an unknown code and no header are refused; a missing
    confirmation is refused; a spoofed other header is ignored; nothing is logged. **FOR ANY** excluded code, with any
    confirmation and any other headers, on the free tier the model gets 0 calls and nothing is reserved or spent.

### Requirement 15: Abuse limits

**User story:** As the operator, I want no anonymous request able to freeze the single thread, exhaust memory or
spend a visitor's quota.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** read the raw body of every POST route through one capped reader. **IF** the body is more
   than `MAX_BODY_BYTES` = 196,608 bytes (192 KiB), whatever `Content-Length` says or if it is absent, **THE SYSTEM
   SHALL** answer a fixed 413 `{"message":"The request is too large."}`. It counts bytes while reading and stops
   there. A declared length over the cap is refused before reading. Nothing of the body is logged, only the
   request line.
2. **THE SYSTEM SHALL** size the cap to fit the largest legitimate export and bind. At the field caps an export has
   26,460 characters of free text and a bind 26,760. At JSON's worst case of 6 bytes a character that is 158,760
   and 160,560 bytes, plus under 4 KiB of keys, numbers and punctuation: about 165 KB at most, so 192 KiB.
3. **THE SYSTEM SHALL** give export and bind requests one shared capped grant, and give export's wish grant's
   caps: text 1-500 and context at most 200 (both after trim); every `id`, `wishId` and `curseId` at most 100;
   narration 260; `userStory` and `wishCriterion` 1000 each; 3-5 curses (the count is checked before any element
   is parsed); story 360; loophole 1000; binding clause 1000; verdict `reason` and `property` 1000 each. **IF** a
   value is over a cap **THE SYSTEM SHALL** return the route's existing 400 and make no model call. The shared
   `paw-core` schemas keep their shape, so model output does not start failing.
4. **THE SYSTEM SHALL** make every schema-valid grant that it serves from grant, bind or examples pass those caps, so it can be bound and exported. One pure `fitGrant` cuts an over-long id, loophole, clause or reason at its cap without
   splitting a surrogate pair, and leaves out an over-long optional `userStory`, `wishCriterion` or `property`
   (export then uses its templates). A grant inside the caps is unchanged. Every ready round and cached example
   exports. The one-curse fallback grant of a failed model is not schema-valid (3 to 5 curses) and does not export; that is older than this requirement and not changed by it.
5. **THE SYSTEM SHALL** do work on caller text in linear time: `stripTrailingPunctuation` in `paw-core`, the
   guardrail's apostrophe trim, and any other regex or loop over caller text. The output of both trims is
   identical to the old expressions.
6. **THE SYSTEM SHALL** apply the mode check and the per-IP count to POST on `/api/grant` and `/api/bind` only, in
   the order gate, mode, count, body. GET, HEAD and any other method never create, read or increment an IP entry,
   and never answer the resting 503.
7. **WHEN** a request is admitted **THE SYSTEM SHALL** prune expired IP entries. Entries are kept in the order
   their windows started and removed from the front, so the map holds only the IPs of the current window and each
   admission is amortised constant time. An IP key is at most 64 characters (the right-most).
   **IF** `RATE_WINDOW_MS` is not an integer of 1 or more **THE SYSTEM SHALL** use 60000, so no entry can live
   forever.
8. **THE SYSTEM SHALL** test, and the tests **SHALL** fail on the previous commit: a streamed body with no, a too
   low and a too high `Content-Length`, over real HTTP too, with the server staying up; nothing of it in a log; the
   largest legitimate bodies and all ready rounds pass; properties for 15.4 and 15.5; methods and pruning.

### Requirement 16: A refused call costs nothing

**User story:** As the operator, I want a call that Google refuses to cost nothing on paper, so that a few dozen
refusals do not rest the paw for a day.

#### Acceptance Criteria

1. **WHEN** an attempt gets HTTP status exactly 400 or 500, its body was not cut off by the attempt's timeout, and the
   body carries no `usageMetadata`, **THE SYSTEM SHALL** treat it as an unbilled attempt: the report has
   `unbilled?: true` and the guard charges it 0 cents.
2. **IF** such a body carries a valid `usageMetadata` **THE SYSTEM SHALL** charge the attempt by that usage (7.10).
   **IF** it carries `usageMetadata` that cannot be read as usage **THE SYSTEM SHALL** keep the ceiling.
3. **THE SYSTEM SHALL** keep the ceiling for a timeout (also while the error body is being read), for no response, and
   for every other status (401, 403, 404, 499, 501, 502, 503, 504 and the rest). The quota rule (13.6) is unchanged
   and is applied first. **IF** no report arrived at all **THE SYSTEM SHALL** charge the whole ceiling.
4. **THE SYSTEM SHALL** leave unchanged the reservation before the call, the worst-case numbers and the chain: 400 and
   500 do not try the next model. The per-IP limit and Google's quota still bound repeated failures.
5. **THE SYSTEM SHALL** log, put in a message or keep nothing of the upstream text: only the flag and numeric token
   counts, under the existing log limits, and, beside valid usage, the answering model's name, used only for the
   price (7.10) and never logged.
6. **THE SYSTEM SHALL** test, with a stubbed `fetch` only: 400 and 500 with no usage, with valid usage, with unreadable
   usage, cut off by the timeout, and every other status. The example and property tests SHALL fail on the previous
   commit.

Source: Google's billing FAQ, https://ai.google.dev/gemini-api/docs/billing (read 2026-11-22): a request that fails
with a 400 or 500 error is not charged for tokens, though it still counts against the quota.

### Requirement 17: A location refusal gives the ready rounds

**User story:** As a visitor, I want the ready rounds when Google refuses the server's location, so that I am not
told to try again for nothing.

#### Acceptance Criteria

1. **WHEN** an attempt gets HTTP 400 and its error body has an `error.message` that contains "user location is not
   supported" (any case) **THE SYSTEM SHALL** treat it as a location refusal: it stays an unbilled attempt
   (Requirement 16, 0 cents), the chain does not try the next model, and the client throws `LocationRefusedError`
   with a fixed message.
2. **THE SYSTEM SHALL** then have the guard set `locationRefused` and `denied` and make no further inner call on that
   guard, so paw-core's retry sends no second upstream request.
3. **THE SYSTEM SHALL** answer `POST /api/grant` and `POST /api/bind` exactly as the closed gate does: 403,
   `cache-control: no-store`, `{ code: "live_region_unavailable", message: <the gate's message> }`, so the web and
   the power play the ready rounds, and not a 200 fallback with "Try again".
4. **THE SYSTEM SHALL** log and keep nothing of the upstream text. The mode does not change and no state is kept for
   the next request (as 8.6). The error log class list gains `LocationRefusedError`.
5. **THE SYSTEM SHALL** test with a stubbed `fetch`, and the tests **SHALL** fail on the previous commit: grant and
   bind get the 403 gate body and 1 upstream fetch (the previous commit gives 200 with the fallback and 2 fetches);
   a 400 without that message keeps today's behaviour.

### Requirement 18: Health and live agree on whether a live wish can start

**User story:** As a visitor, I want the site to say the same thing everywhere, so that "live" is never followed by a
503.

#### Acceptance Criteria

1. **THE SYSTEM SHALL** decide "a live wish can start" in one function: the key is set AND the spend of the current
   day (after the day roll) + `reservedCents` + the start ceiling <= `dailyBudgetCents`. The start ceiling is the
   larger of the whole-chain ceilings of the first `generate` call of a grant (the genie prompt at the maximum wish
   and context) and of a bind (the judge prompt at the maximum clause and loophole), computed once in `createApp`
   from the configured client's `plan()` and the price table.
2. **THE SYSTEM SHALL** have `GET /api/health` say `mode: "normal"` iff a live wish can start, else
   `"examples-only"`; have `GET /api/live` add `resting: true` iff the country is allowed and a live wish cannot
   start; and have the mode check of grant and bind use the same function. `remainingCents` is unchanged.
3. **THE SYSTEM SHALL** behave so in this example: with the budget 200 and 191.98 spent, health says `examples-only`,
   live says `resting: true` and a grant gets the 503 resting answer (the previous commit says `normal` with no
   `resting` while every grant gets 503). Just below the threshold both say live and a grant's first call is
   reserved.
4. **THE SYSTEM SHALL** test, and the tests **SHALL** fail on the previous commit, including a property: for any
   spent and reserved, health's mode is normal iff live has no `resting` (for an allowed country) iff a grant passes
   the mode check.
