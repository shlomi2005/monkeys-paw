# Paw API — Design

## Architecture

Hono server on Node 24 deployed to Railway. Three layers:

1. **HTTP routes** — validate input, enforce budget/rate-limit, call paw-core, return JSON.
2. **GeminiModelClient** — implements `ModelClient` interface, calls Gemini Flash with structured JSON output and timeouts.
3. **Budget middleware** — guards every model call with per-IP rate limit and daily budget, switches to examples-only mode when exhausted.

Every request passes `canCall` once (per-IP limit and daily budget). Every `generate` call then goes through the guard: reserve a ceiling → model → settle to the real cost (see "Cost accounting"). Budget state is in-memory only (iron-rules §2). No wish text is stored or logged with identity (iron-rules §2, Requirement 9).

## Routes and Schemas

### POST /api/grant

**Request:** `GrantRequestSchema`
```typescript
z.object({
  wish: z.object({
    text: z.string().trim().min(1).max(500),
    context: z.string().trim().max(200).optional()
  })
})
```

**Response (200):** `GrantResponseSchema`
```typescript
z.object({
  wish: WishSchema,      // includes generated id, createdAt
  grant: GrantSchema     // from paw-core, includes narration, curses[], userStory (task 25)
})
```

**Errors:** 400 (empty, too long or harmful wish), 503 (over budget), 500 (fallback after retry).

**Flow:** Validate (caps: text 500, context 200; Req 1.8) → check budget → create Wish → `grantWish(wish, modelClient)` (the guard charges each call) → return.

### Wish guardrail

`isHarmfulWish(text, context?)` in `apps/api/src/guardrail.ts` enforces iron-rules §3 (refuse wishes about harming people). It matches whole word tokens only, never substrings ("skills" is not "kill").
- A harm word (kill, hurt, harass, abuse, hate and similar, with inflections) counts only when aimed at a person or group: one of the first two words after it, skipping determiners, is a person word or a named person/group (capitalised, not an acronym, not modifying a following lowercase content word).
- **Game-role rule.** The game-role words (player, players, character, characters, npc, npcs, avatar, avatars, enemy, enemies, monster, monsters, opponent, opponents, mob, mobs) are not real-person targets for the combat verbs (kill, attack, shoot, stab, hurt, harm, injure, poison, assault, with their inflections). "Players can attack other players" passes. The social-harm verbs (harass, bully, threaten, stalk, abuse, hate, torture, murder) aimed at a game role still refuse, because they reach the real people behind the avatars. Real-person words (users, people, a named person or group) still refuse with any harm verb. The rule is a documented exemption, so the guardrail property tests change only for it.
- A prevention or safety word (prevent, stop, block, report, protect, from, no, never and similar) within the four words before the harm word cancels it.
- Only genocide, massacre, rape and gore are refused without a target. "Holocaust" is not listed, so history and archive wishes pass.
- Refused wishes get 400 and the in-character line, before any budget check or model call.

### POST /api/bind

**Request:** `BindRequestSchema`
```typescript
z.object({
  grant: GrantSchema,
  curseId: z.string().min(1),
  kind: BindingKindSchema,   // "rewrite" | "ears-clause"
  clause: z.string().trim().min(1).max(1000)
})
```
The judged curse's `loophole` must also be at most 1000 characters (checked in `apps/api/src/schemas.ts` or the route, not in paw-core). `story` is already at most 360 by `GrantSchema`.

**Response (200):** `BindResponseSchema`
```typescript
z.object({
  grant: GrantSchema,     // updated with binding + verdict attached to the curse
  verdict: VerdictSchema  // includes property field (task 25) when closed
})
```

**Errors:** 400 (invalid or too long input), 404 (curseId not found), 503 (over budget), 500 (fallback).

**Flow:** Validate (caps: clause 1000, loophole 1000; Req 2.7, 2.8) → find curse → check budget → `proposeBinding` → `judgeBinding(curse, binding, modelClient)` (the guard charges each call) → update curse status if closed → return.

### POST /api/export

**Request:** `ExportRequestSchema`
```typescript
z.object({
  wish: WishSchema,
  grant: GrantSchema
})
```

**Response (200):** `SpecExportSchema` (from paw-core).

**Errors:** 400 (malformed grant).

**Flow:** Validate → `exportSpec(wish, grant)` → return. No model call.

### GET /api/examples

**Response (200):** Array of `{ wish, grant }` from cached file.

**Errors:** 503 (cache missing).

**Flow:** Read `apps/api/examples-cache.json` → return. No model call. Served in all modes.

### GET /api/health

**Response (200):**
```typescript
z.object({
  status: z.literal("ok"),
  mode: z.enum(["normal", "examples-only"]),
  budget: z.object({
    dailyBudgetCents: z.number().nonnegative(),
    spentCents: z.number().nonnegative(),
    remainingCents: z.number().nonnegative()
  })
})
```

The cents are fractional numbers (no `.int()`). `remainingCents = max(0, dailyBudgetCents - spentCents - reservedCents)`. Only this output may round, for display.

**Flow:** Check current mode and budget state → return. No model call.

## GeminiModelClient

Implements `ModelClient` from paw-core (unchanged) and adds two side methods that the guard uses:
```typescript
type AttemptPlan = { model: string; inputTokens: number; maxOutputTokens: number };
type AttemptReport = {
  model: string; inputTokens: number; maxOutputTokens: number;
  modelVersion?: string;
  usage?: { promptTokens: number; outputTokens: number };
};

class GeminiModelClient implements ModelClient {
  async generate(prompt: string): Promise<unknown>                  // = generateMetered(prompt, () => {})
  plan(prompt: string): AttemptPlan[]                               // pure, no I/O
  async generateMetered(prompt: string, onAttempt: (r: AttemptReport) => void): Promise<unknown>
}
```

**Configuration:**
- API key from `GEMINI_API_KEY` env var (iron-rules §1).
- Model: `DEFAULT_MODEL = 'gemini-3.6-flash'`. The name `gemini-3.5-flash` is retired and routes to `gemini-3.6-flash` (deprecations page, checked 2026-11-20). Fallbacks stay `gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite`; `gemini-3.1-flash-lite` shuts down on 2027-05-07 and is the last fallback.
- Response format: structured JSON (`application/json` MIME type) with a hand-written `responseSchema` per task.
- Thinking: every request sets `generationConfig.thinkingConfig.thinkingLevel = 'low'`. `low` is supported by all four models of the chain (3.8-flash has no `minimal`). Source: https://ai.google.dev/gemini-api/docs/thinking (checked 2026-11-20).
- Output cap: every request sets `generationConfig.maxOutputTokens = MAX_OUTPUT_TOKENS`, one exported constant, the same for every task. The cap covers thinking tokens plus response tokens together. When it is hit, the candidate has `finishReason: "MAX_TOKENS"` and cut-off or empty text, and the tokens are still billed.
- Choosing the value: take the largest real response, a grant with 5 curses (narration up to 260 chars, `userStory` and `wishCriterion` up to 40 words each, 5 × (story up to 360 chars + loophole + type) plus the JSON keys). Estimate it in tokens at chars/3, then add headroom for low-level thinking. The arithmetic goes in a comment next to the constant. The expected value is 4096. It does not go above 8192 without a stated reason.
- Timeout: 30 seconds (configurable).

**Behavior:**
- If API key is missing, constructor succeeds but all `generate` calls throw immediately (enables examples-only mode).
- Returns parsed JSON; paw-core validates it with zod.
- `plan(prompt)` returns one entry per model of the chain, in order. `inputTokens = ceil((prompt.length + JSON.stringify(responseSchema).length) / 3)`, with schema length 0 when there is no schema.
- `generateMetered` calls `onAttempt(report)` exactly once per HTTP attempt, whatever happened (success, timeout, network error, any HTTP status, unreadable body, MAX_TOKENS, bad JSON), before the next attempt starts and before the promise settles. `usage` is `{ promptTokens: promptTokenCount, outputTokens: candidatesTokenCount + thoughtsTokenCount }` (a missing count is 0), present only when the response carried `usageMetadata` with a finite, non-negative `promptTokenCount`. Thoughts are billed at the output rate. `modelVersion` is copied from the response when present.
- `finishReason: "MAX_TOKENS"` on the first candidate, or text that is not complete JSON, is a failed attempt: it throws (for example "Model call failed (<model>: output cut off)"), so paw-core's retry-once-then-fallback runs. It is charged by its usage. It does not move on to the next model; only 503, 429 and 404 do.
- On timeout or network error, throws; caller (paw-core) retries once then falls back (iron-rules §6).
- Logs metadata only: model name, duration, status, `promptTokens`, `outputTokens`, `finishReason`, success/failure. Numbers and enums only. Never logs prompt or response text or the key (Requirement 6.5).

## Cost accounting

The guard charges the real cost of every model call, from the token counts in `usageMetadata`, at the price of the model that answered. There is no fixed per-call cost.

**Price table** (`apps/api/src/budget/prices.ts`, `DEFAULT_PRICE_TABLE`), USD per million tokens, Gemini API paid tier. The output price includes thinking tokens. Source: https://ai.google.dev/gemini-api/docs/pricing (checked 2026-11-20). The URL and the date sit in a comment next to the table.

| Model | Input until 31.12.2026 | Output until 31.12.2026 | Input from 1.1.2027 (used) | Output from 1.1.2027 (used) |
|---|---|---|---|---|
| gemini-3.6-flash | 0.75 | 3.75 | 1.50 | 7.50 |
| gemini-3.8-flash | 0.75 | 3.75 | 1.50 | 7.50 |
| gemini-3.5-flash (retired name, same rates as 3.6-flash) | n/a | n/a | 1.50 | 7.50 |
| gemini-3.5-flash-lite | 0.30 | 2.50 | 0.30 | 2.50 |
| gemini-3.1-flash-lite | 0.25 | 1.50 | 0.25 | 1.50 |

The guard uses the 1.1.2027 rates. They are conservative: it over-counts today and never under-counts.

**Looking up a price.** `priceFor(table, modelId)` strips a leading `models/`; takes the exact match; else the longest key K such that the id starts with `K-` (a versioned name of a known model, such as `gemini-3.6-flash-001`); else the most expensive row, meaning the highest input rate and the highest output rate in the table. An unknown model is therefore never under-priced. `cents = tokens × usdPerMTok / 10_000` (1000 tokens at 7.50 USD per million is 0.75 cents). Cents are fractional numbers everywhere and are never rounded in the state.

**Ceiling.** For one `generate`, `ceiling = Σ over plan(prompt) of (inputTokens × inputRate + maxOutputTokens × outputRate)`, in cents, each entry at its requested model's price.

**Why the whole chain is reserved.** A `generate` can make several HTTP attempts: 503, 429 and 404 move on to the next model, and each attempt may be billed. Settling may therefore charge every attempt of the chain. Reserving one attempt only would let parallel calls overspend, so the guard reserves the sum.

**Reserve and settle, in order.**
1. Roll the day. If the client is not available, mark `denied` and throw `BudgetExhaustedError`.
2. Compute the ceiling from `plan(prompt)`.
3. If `spentCents + reservedCents + ceiling > dailyBudgetCents`, mark `denied` and throw `BudgetExhaustedError`. No inner call.
4. In the same synchronous tick (no `await` between 3 and 4): `reservedCents += ceiling`, `calls += 1`.
5. `await inner.generateMetered(prompt, collect)`. In a `finally`: `reservedCents -= ceiling`, then charge the sum over the collected reports. With usage, an attempt costs `promptTokens × inputRate + outputTokens × outputRate` at `priceFor(modelVersion ?? model)`. Without usage, it costs its own ceiling. If no report arrived at all, the charge is the whole ceiling. `spentCents += charge`; the guard's own `costCents += charge`.

paw-core swallows errors from `generate`, so a refusal inside `grantWish` or `judgeBinding` turns into retries and the fallback result. The callers read the guard's `denied` flag afterwards and answer 503 (routes) or exit 1 (eval).

**Edge case: the real cost passes the ceiling.** The real cost is charged even when it is above the ceiling, because it is real money. This happens when real prompt tokens exceed the chars/3 estimate, or when the answering model is pricier than the one requested (an unlisted `modelVersion` is priced at the top row). The spend can pass the cap only by that excess. Every later call is then refused, because `spentCents` alone is above the cap.

**`PRICE_TABLE_JSON`.** Optional env var: a JSON object `{ "<model id>": { "inputUsdPerMTok": n, "outputUsdPerMTok": n } }`, non-empty, every rate finite and 0 or more. It replaces the default table. If it is set but invalid, the default table is used and one line `{"event":"price_table_invalid"}` is logged. The line contains no part of the value. `server.ts` and the eval load the table this way and pass it as `prices` to `createApp` and the guard.

### Worst case per grant and bind

The worst case is what one request can cost when every call runs to its ceiling. Each `generate` is charged at most its full chain ceiling, so `worst case = Σ over the generates of chainCeiling(prompt at maximum size)`.

- **Grant** (`grantWish` as written today): 34 generates. The Genie call 2 (retry once), the batch quality judge 2, and for each of up to 5 curses `QUALITY_MAX_RETRIES = 3` regenerations of 2 generates each, 30. Prompts at maximum size: wish 500 and context 200 chars (the API caps; the Genie prompt carries the wish twice), model-written curse fields at story 360 and loophole 1000 chars.
- **Bind** (`judgeBinding`): 2 generates, the judge prompt with story 360, loophole 1000 and clause 1000.
- The CI eval grants 5 golden wishes and makes no binds, so its cap is `ceil(5 × worst case per grant)`.

The numbers, with the arithmetic, live in `apps/api/README.md`. A unit test recomputes both from the real prompt builders, `plan()` and the price table, and checks that the README states them.

## Budget and Rate-Limit Middleware

**In-memory state per IP:**
```typescript
type IpState = {
  ipCalls: number;
  windowStart: number;
};

type GlobalState = {
  spentCents: number;      // fractional cents, never rounded
  reservedCents: number;   // ceilings of the generate calls in flight; starts at 0
  dayStart: number;
  ipStates: Map<string, IpState>;
};
```

**Configuration (env vars with defaults):**
```typescript
{
  perIpLimit: 10,           // PER_IP_LIMIT
  windowMs: 60_000,         // RATE_WINDOW_MS (1 minute)
  dailyBudgetCents: 200     // DAILY_BUDGET_CENTS ($2); parsed with Number, fractional allowed;
                            // missing, non-finite or negative -> 200
}
// TRUSTED_PROXY_HOPS: default 1; an integer >= 0, anything else -> 1.
// It is passed to checkBudget as its own parameter. paw-core's BudgetConfig does not change.
```

**Middleware (`checkBudget`):** Runs before every `/api/grant` and `/api/bind` handler.
1. Pick the IP key by the `TRUSTED_PROXY_HOPS` rule. Split `x-forwarded-for` into trimmed, non-empty entries. With `hops >= 1` and at least `hops` entries, the key is `entries[entries.length - hops]`, the address the outermost trusted proxy saw. With hops 0, no header, or fewer entries than hops, the key is the socket address. A client can add entries at the left of the header but cannot change the entries the trusted proxies append, so a faked leftmost entry does not bypass the limit.
2. Get or create `IpState` for this IP.
3. Call `canCall(state, config, Date.now())` from paw-core.
4. If `false`, return 503 with in-character message and skip handler.
5. If `true`, count the request against the IP, attach state to context and proceed.

The cost of each model call is not charged here. The guard (`BudgetedModelClient`) reserves and settles per `generate` (see "Cost accounting"). There is no `recordCall` with a fixed cost.

**Guard (`BudgetedModelClient`, `apps/api/src/budget/guarded-client.ts`):** constructor `(inner, state, config, now = Date.now, prices = DEFAULT_PRICE_TABLE)`. `inner` is a `MeteredModelClient = ModelClient & { available; plan(prompt); generateMetered(prompt, onAttempt) }`, an api-local type; `GeminiModelClient` implements it and test fakes get it from one small shared test helper. The guard keeps `calls`, `denied` and `costCents` (its own spend). `AppDeps` and the eval options take `prices?: PriceTable` in place of the old per-call cost option.

**Window reset:** `canCall` returns `true` if `now - windowStart >= windowMs`; middleware then resets `ipCalls` to 0 and `windowStart` to `now`.

**Day reset:** `rollDayIfElapsed` resets `spentCents` and sets `dayStart`. It never resets `reservedCents`: calls started before the roll are still in flight, and they settle into the new day.

**Examples-only mode:** Global flag set when `spentCents >= dailyBudgetCents` or `GEMINI_API_KEY` is absent. A guard refusal during a request counts the same way. When active:
- `/api/grant` and `/api/bind` return 503 immediately (no budget check).
- `/api/examples`, `/api/export`, `/api/health` work normally.
- Mode resets automatically at day boundary.

## Examples Cache File Format

**Location:** `apps/api/examples-cache.json`

**Structure:**
```typescript
z.array(z.object({
  wish: WishSchema,
  grant: GrantSchema
}))
```

**Generated by:** eval script (Requirement 12) or a build step (`pnpm build:examples`).

**Served by:** `GET /api/examples` with no transformation.

**Fallback:** If file is missing, `/api/examples` returns 503 with "Examples cache not yet generated."

## CORS

**Middleware (`cors`):** Runs on all routes.
- Read `CORS_ORIGIN` env var (default `*` for local dev).
- Check `Origin` header: if matches, set `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods` (GET, POST, OPTIONS), `Access-Control-Allow-Headers` (Content-Type).
- On `OPTIONS` preflight, return 204 with headers and no body.
- If no match, omit CORS headers (browser blocks request).

## Logging Rules

**Logged (metadata only):**
- Timestamp, HTTP method, path, status, duration.
- Model call flag (yes/no), token counts, success/failure.
- Budget/rate-limit decision (allowed/denied).

**Never logged:**
- Wish text or curse content.
- IP address alongside any wish data.
- Full prompt or model response.
- API key.

**Structured logging:** Use Hono logger middleware with JSON output. Log level: INFO in production, DEBUG in dev.

## Eval Script Design

**Command:** `pnpm eval` in `apps/api` workspace.

**Input:** `docs/golden-wishes.json` (25 wishes with `id`, `wish`, `context`, `expectedTypes`).

**Flow:**
1. Load golden wishes.
2. Create real `GeminiModelClient` (requires `GEMINI_API_KEY`) and wrap it in the same `BudgetedModelClient` guard as the server, with the price table loaded by the `PRICE_TABLE_JSON` rule and `DAILY_BUDGET_CENTS` from the environment.
3. For each wish:
   - Call `grantWish(wish, modelClient)`.
   - For each curse, call Judge in `quality` mode: `buildJudgePrompt(curse, undefined, 'quality')` → model → parse `QualityGateSchema`.
   - Record: curse id, type, `specific` verdict, reason.
4. Compute scores:
   - **Specificity:** fraction of curses with `specific: true`.
   - **Type coverage:** for each wish, check if `expectedTypes` ⊆ generated curse types; report fraction.
5. Write `docs/eval/latest.md`:
   - Table: wish id, wish text (first 50 chars), curses count, specificity per curse (✓/✗), type coverage (Y/N), overall verdict (PASS/FAIL).
   - Summary: total specificity score, total type coverage, timestamp.
6. Write `apps/api/examples-cache.json`: array of `{ wish, grant }` for all 25.
7. Exit 0 if specificity ≥ 0.80, else exit 1 (fail release gate).

**Budget refusal.** paw-core swallows the guard's refusal, so the eval checks the guard's `denied` flag after each wish. If the guard refused, the eval exits 1 with a message that contains "budget exhausted", writes no `docs/eval/latest.md` and no examples cache, and never prints a pass (Requirement 12.10).

**CI cap.** The CI step runs `pnpm -C apps/api eval`, which grants the first 5 golden wishes and makes no binds. Its `DAILY_BUDGET_CENTS` in `.github/workflows/prompt-eval.yml` is `ceil(5 × worst case per grant)` (see "Worst case per grant and bind"), so a normal run never hits the guard.

**Threshold (configurable via env):** `EVAL_SPECIFICITY_THRESHOLD=0.80`.

**Release gate:** CI runs `pnpm eval` on every PR that touches `packages/paw-core/src/prompts.ts`. Non-zero exit fails the PR.

## Correctness Properties (fast-check)

**Property 1 (Budget monotonicity):** For any `state`, `config`, calling `recordCall(state, c, t)` where `c > 0` always produces `state'.spentCents >= state.spentCents` (unless day boundary crossed).

**Property 2 (Rate-limit reset):** If `canCall(state, config, t1) == false` and `t2 - state.windowStart >= config.windowMs`, then `canCall(state, config, t2) == true` (assuming budget allows).

**Property 3 (Grant validation):** For any prompt, if `GeminiModelClient.generate` returns JSON `x` and `GrantSchema.safeParse(x).success == true`, then `x.curses.length` is between 3 and 5 inclusive.

**Property 4 (Verdict idempotency):** Judging the same `(curse, binding)` pair twice produces verdicts with the same `closed` value (model non-determinism aside, use fixed seed in test).

**Property 5 (Export completeness):** For any `grant` with `n` closed curses, `exportSpec(wish, grant).propertiesMd` contains exactly `n` property lines starting with `- ` (or `n` user-written properties when task 25 is complete).

**Property 6 (Examples cache schema):** The file `examples-cache.json` always parses as `z.array({ wish: WishSchema, grant: GrantSchema })` with length 25 after eval runs.

**Property 7 (No overspend):** For any number of parallel `generate` calls through one guard, with each real cost at most its ceiling, `spentCents` never passes `dailyBudgetCents` and `reservedCents` is back to 0 once all calls settle. When a real cost passes its ceiling, the spend passes the cap by at most that excess.

**Property 8 (Unknown model is never cheaper):** For any model id with no exact or versioned match, `priceFor(table, id)` returns the highest input rate and the highest output rate in the table, so no row is cheaper than it.

**Test location:** `apps/api/tests/properties.test.ts` (uses Vitest + fast-check).
