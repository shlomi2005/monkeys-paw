# Paw API — Design

## Architecture

Hono server on Node 24 deployed to Railway. Three layers:

1. **HTTP routes** — validate input, enforce budget/rate-limit, call paw-core, return JSON.
2. **GeminiModelClient** — implements `ModelClient` interface, calls Gemini Flash with structured JSON output and timeouts.
3. **Budget middleware** — guards every model call with per-IP rate limit and daily budget, switches to examples-only mode when exhausted.

All model calls go through `canCall` → model → `recordCall`. Budget state is in-memory only (iron-rules §2). No wish text is stored or logged with identity (iron-rules §2, Requirement 9).

## Routes and Schemas

### POST /api/grant

**Request:** `GrantRequestSchema`
```typescript
z.object({
  wish: z.object({
    text: z.string().trim().min(1),
    context: z.string().optional()
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

**Errors:** 400 (empty/harmful wish), 503 (over budget), 500 (fallback after retry).

**Flow:** Validate → check budget → create Wish → `grantWish(wish, modelClient)` → record cost → return.

### Wish guardrail

`isHarmfulWish(text, context?)` in `apps/api/src/guardrail.ts` enforces iron-rules §3 (refuse wishes about harming people). It matches whole word tokens only, never substrings ("skills" is not "kill").
- A harm word (kill, hurt, harass, abuse, hate and similar, with inflections) counts only when aimed at a person or group: one of the first two words after it, skipping determiners, is a person word or a named person/group (capitalised, not an acronym, not modifying a following lowercase content word).
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
  clause: z.string().trim().min(1)
})
```

**Response (200):** `BindResponseSchema`
```typescript
z.object({
  grant: GrantSchema,     // updated with binding + verdict attached to the curse
  verdict: VerdictSchema  // includes property field (task 25) when closed
})
```

**Errors:** 400 (invalid input), 404 (curseId not found), 503 (over budget), 500 (fallback).

**Flow:** Validate → find curse → check budget → `proposeBinding` → `judgeBinding(curse, binding, modelClient)` → update curse status if closed → record cost → return.

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
    dailyBudgetCents: z.number(),
    spentCents: z.number(),
    remainingCents: z.number()
  })
})
```

**Flow:** Check current mode and budget state → return. No model call.

## GeminiModelClient

Implements `ModelClient` interface from paw-core:
```typescript
class GeminiModelClient implements ModelClient {
  async generate(prompt: string): Promise<unknown>
}
```

**Configuration:**
- API key from `GEMINI_API_KEY` env var (iron-rules §1).
- Model: Gemini 1.5 Flash (fast, low-cost).
- Response format: structured JSON (`application/json` MIME type).
- Timeout: 30 seconds (configurable).

**Behavior:**
- If API key is missing, constructor succeeds but all `generate` calls throw immediately (enables examples-only mode).
- Returns raw JSON string; paw-core does `JSON.parse` + zod validation.
- On timeout or network error, throws; caller (paw-core) retries once then falls back (iron-rules §6).
- Logs metadata only: model name, duration, cost estimate, success/failure. Never logs prompt or response text (Requirement 6.5).

**Cost estimation:** Gemini Flash pricing is ~$0.075 per million input tokens, ~$0.30 per million output tokens (2024 rates). Estimate 200 input + 400 output tokens per call ≈ 0.135 cents. Client reports estimate to `recordCall`.

## Budget and Rate-Limit Middleware

**In-memory state per IP:**
```typescript
type IpState = {
  ipCalls: number;
  windowStart: number;
};

type GlobalState = {
  spentCents: number;
  dayStart: number;
  ipStates: Map<string, IpState>;
};
```

**Configuration (env vars with defaults):**
```typescript
{
  perIpLimit: 10,           // PER_IP_LIMIT
  windowMs: 60_000,         // RATE_WINDOW_MS (1 minute)
  dailyBudgetCents: 500     // DAILY_BUDGET_CENTS ($5)
}
```

**Middleware (`checkBudget`):** Runs before every `/api/grant` and `/api/bind` handler.
1. Extract IP from `x-forwarded-for` or Hono `c.req.header()`.
2. Get or create `IpState` for this IP.
3. Call `canCall(state, config, Date.now())` from paw-core.
4. If `false`, return 503 with in-character message and skip handler.
5. If `true`, attach state to context and proceed.
6. After successful model call, call `recordCall(state, costCents, Date.now())` and update global state.

**Window reset:** `canCall` returns `true` if `now - windowStart >= windowMs`; middleware then resets `ipCalls` to 0 and `windowStart` to `now`.

**Day reset:** `canCall` and `recordCall` handle day boundary (paw-core logic). Middleware updates `dayStart` and resets `spentCents` when `recordCall` returns a new day.

**Examples-only mode:** Global flag set when `spentCents >= dailyBudgetCents` or `GEMINI_API_KEY` is absent. When active:
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
- Model call flag (yes/no), cost estimate, success/failure.
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
2. Create real `GeminiModelClient` (requires `GEMINI_API_KEY`).
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

**Threshold (configurable via env):** `EVAL_SPECIFICITY_THRESHOLD=0.80`.

**Release gate:** CI runs `pnpm eval` on every PR that touches `packages/paw-core/src/prompts.ts`. Non-zero exit fails the PR.

## Correctness Properties (fast-check)

**Property 1 (Budget monotonicity):** For any `state`, `config`, calling `recordCall(state, c, t)` where `c > 0` always produces `state'.spentCents >= state.spentCents` (unless day boundary crossed).

**Property 2 (Rate-limit reset):** If `canCall(state, config, t1) == false` and `t2 - state.windowStart >= config.windowMs`, then `canCall(state, config, t2) == true` (assuming budget allows).

**Property 3 (Grant validation):** For any prompt, if `GeminiModelClient.generate` returns JSON `x` and `GrantSchema.safeParse(x).success == true`, then `x.curses.length` is between 3 and 5 inclusive.

**Property 4 (Verdict idempotency):** Judging the same `(curse, binding)` pair twice produces verdicts with the same `closed` value (model non-determinism aside, use fixed seed in test).

**Property 5 (Export completeness):** For any `grant` with `n` closed curses, `exportSpec(wish, grant).propertiesMd` contains exactly `n` property lines starting with `- ` (or `n` user-written properties when task 25 is complete).

**Property 6 (Examples cache schema):** The file `examples-cache.json` always parses as `z.array({ wish: WishSchema, grant: GrantSchema })` with length 25 after eval runs.

**Test location:** `apps/api/tests/properties.test.ts` (uses Vitest + fast-check).
