# Paw API — Tasks

Ordered checklist for implementing the Paw API. References requirements by number (Req N). Tests first where feasible.

## Setup and Infrastructure

- [x] 1. Create `apps/api` workspace with `package.json` (name `@monkeyspaw/api`, type `module`, scripts: `dev`, `build`, `start`, `test`, `eval`). (Req 1–12)
- [x] 2. Install dependencies: `hono`, `@hono/node-server`, `zod`, `@google/generative-ai`, `vitest`, `fast-check`. (Req 6, tech.md)
- [x] 3. Create `.env.example` with variable names: `GEMINI_API_KEY`, `CORS_ORIGIN`, `PER_IP_LIMIT`, `RATE_WINDOW_MS`, `DAILY_BUDGET_CENTS`, `EVAL_SPECIFICITY_THRESHOLD`. (Req 6, 7, 10, 12, iron-rules §1)
- [x] 4. Add `.env` to `.gitignore` if not already present. (iron-rules §1)
- [x] 5. Create `apps/api/src/index.ts` with Hono app scaffold, CORS middleware, health route stub. (Req 5, 10)

## Model Client

- [x] 6. Write `apps/api/src/client/gemini.test.ts`: test that `GeminiModelClient.generate` throws when API key is missing. (Req 6.2, 8.1)
- [x] 7. Write `apps/api/src/client/gemini.test.ts`: test timeout behavior (mock slow response, expect throw). (Req 6.4)
- [x] 8. Implement `apps/api/src/client/gemini.ts`: `GeminiModelClient` class implementing `ModelClient`, reads `GEMINI_API_KEY`, calls Gemini Flash with structured JSON output, 30s timeout, logs metadata only. (Req 6)
- [x] 9. Verify tests pass: `pnpm test` in `apps/api`. (Req 6)

## Budget and Rate-Limit Logic

- [x] 10. Write `apps/api/src/budget/middleware.test.ts`: test `canCall` returns false when per-IP limit exceeded. (Req 7.1)
- [x] 11. Write `apps/api/src/budget/middleware.test.ts`: test `canCall` returns false when daily budget exhausted. (Req 7.6)
- [x] 12. Write `apps/api/src/budget/middleware.test.ts`: test per-IP counter resets after window elapses. (Req 7.5)
- [x] 13. Implement `apps/api/src/budget/state.ts`: in-memory `GlobalState` (spentCents, dayStart, ipStates Map). (Req 7.3)
- [x] 14. Implement `apps/api/src/budget/config.ts`: load env vars with defaults (perIpLimit=10, windowMs=60000, dailyBudgetCents=500). (Req 7, design.md)
  Superseded by task 108: the default is now 200.
- [x] 15. Implement `apps/api/src/budget/middleware.ts`: `checkBudget` middleware that calls paw-core `canCall`, rejects with 503 if false, attaches state to Hono context. (Req 7.1, 7.2)
- [x] 16. Implement `apps/api/src/budget/record.ts`: helper that calls paw-core `recordCall` and updates `GlobalState`. (Req 7.2)
  Superseded by task 105: the guard reserves a ceiling and settles to the real cost; no fixed per-call cost.
- [x] 17. Verify budget tests pass. (Req 7)

## Schemas and Validation

- [x] 18. Create `apps/api/src/schemas.ts`: define `GrantRequestSchema`, `GrantResponseSchema`, `BindRequestSchema`, `BindResponseSchema`, `ExportRequestSchema`, `WishSchema` (id, text, context, createdAt). (Req 1–3, design.md)
- [x] 19. Write `apps/api/src/schemas.test.ts`: test each schema rejects invalid input (empty text, missing curseId, etc.). (Req 1.2, 2.2, 3.3)
- [x] 20. Verify schema tests pass. (Req 1–3)

## Routes

- [x] 21. Write `apps/api/src/routes/grant.test.ts`: test POST /api/grant with valid wish returns 200 with Grant (mock model). (Req 1.5)
- [x] 22. Write `apps/api/src/routes/grant.test.ts`: test empty wish returns 400. (Req 1.2)
- [x] 23. Write `apps/api/src/routes/grant.test.ts`: test harmful wish (e.g. "kill all users") returns 400 with in-character refusal. (Req 1.3)
- [x] 24. Write `apps/api/src/routes/grant.test.ts`: test over-budget returns 503. (Req 1.4)
- [x] 25. Implement `apps/api/src/routes/grant.ts`: parse request, validate, create Wish (generate id with `crypto.randomUUID()`, set createdAt), check budget, call `grantWish(wish, modelClient)`, record cost, return Grant. Handle fallback on validation failure (Req 1.6). (Req 1)
- [x] 26. Verify grant route tests pass. (Req 1)

- [x] 27. Write `apps/api/src/routes/bind.test.ts`: test POST /api/bind with valid binding returns 200 with updated Grant and Verdict. (Req 2.4)
- [x] 28. Write `apps/api/src/routes/bind.test.ts`: test empty clause returns 400. (Req 2.2)
- [x] 29. Write `apps/api/src/routes/bind.test.ts`: test unknown curseId returns 404. (Req 2.3)
- [x] 30. Implement `apps/api/src/routes/bind.ts`: parse request, find curse by id, check budget, call `proposeBinding` then `judgeBinding(curse, binding, modelClient)`, update curse (set status to 'closed' if verdict.closed, attach binding and verdict), record cost, return. Handle fallback (closed: false) on validation failure (Req 2.5). (Req 2)
- [x] 31. Verify bind route tests pass. (Req 2)

- [x] 32. Write `apps/api/src/routes/export.test.ts`: test POST /api/export with valid grant returns 200 with SpecExport. (Req 3.1)
- [x] 33. Write `apps/api/src/routes/export.test.ts`: test malformed grant returns 400. (Req 3.3)
- [x] 34. Implement `apps/api/src/routes/export.ts`: parse request, call paw-core `exportSpec(wish, grant)`, return. No model call. (Req 3)
- [x] 35. Verify export route tests pass. (Req 3)

- [x] 36. Write `apps/api/src/routes/examples.test.ts`: test GET /api/examples returns array of 25 wish/grant pairs when cache exists. (Req 4.1)
- [x] 37. Write `apps/api/src/routes/examples.test.ts`: test returns 503 when cache file missing. (Req 4.3)
- [x] 38. Implement `apps/api/src/routes/examples.ts`: read `apps/api/examples-cache.json`, parse as array of { wish, grant }, return. If file missing or parse fails, return 503. (Req 4)
- [x] 39. Verify examples route tests pass. (Req 4)

- [x] 40. Write `apps/api/src/routes/health.test.ts`: test GET /api/health returns status ok, mode normal, budget summary. (Req 5.1)
- [x] 41. Write `apps/api/src/routes/health.test.ts`: test mode is "examples-only" when daily budget exhausted. (Req 8.1)
- [x] 42. Implement `apps/api/src/routes/health.ts`: read current mode (check global budget state), return { status: "ok", mode, budget: { dailyBudgetCents, spentCents, remainingCents } }. (Req 5)
- [x] 43. Verify health route tests pass. (Req 5)

## Examples-Only Mode

- [x] 44. Write `apps/api/src/modes.test.ts`: test entering examples-only mode when `GEMINI_API_KEY` is absent. (Req 8.1)
- [x] 45. Write `apps/api/src/modes.test.ts`: test grant/bind return 503 in examples-only mode. (Req 8.3)
- [x] 46. Write `apps/api/src/modes.test.ts`: test examples and export work in examples-only mode. (Req 8.2, 8.4)
- [x] 47. Implement `apps/api/src/modes.ts`: global mode flag, check on server start (missing key or zero budget → examples-only), gate grant/bind handlers. (Req 8)
- [x] 48. Verify mode tests pass. (Req 8)

## Logging

- [x] 49. Implement `apps/api/src/logger.ts`: Hono logger middleware, JSON structured output, logs timestamp, method, path, status, duration, model-call flag. Never logs wish text, IP+wish, prompt, response, or API key. (Req 9, 6.5)
- [x] 50. Add logger middleware to Hono app in `src/index.ts`. (Req 9.4)
- [x] 51. Manual verification: inspect logs from a local test call, confirm no wish text or IP+wish appears. (Req 9.2)

## Integration

- [x] 52. Wire all routes into `src/index.ts`: POST /api/grant (with checkBudget), POST /api/bind (with checkBudget), POST /api/export, GET /api/examples, GET /api/health. (Req 1–5)
- [x] 53. Add CORS middleware to all routes. (Req 10)
- [x] 54. Start server locally (`pnpm dev`), test each endpoint with curl or Postman, verify responses match schemas. (Req 1–5)
  Run 20.11 with a fake ModelClient (no real model): health, grant, bind, export and examples answered and matched their paw-core schemas; error paths 400/404 as specified; `src/server.ts` without a key started in examples-only mode. `GET /api/examples` returns 503 with the committed cache, which holds 5 fallback grants with 1 curse each; it must be regenerated with the eval once the key is decided.
- [x] 55. Test budget enforcement: make 11 rapid calls to /api/grant from same IP, verify 11th returns 503. (Req 7.1)
  Run 20.11: grants 1-10 from one IP returned 200 and the 11th 503, both by x-forwarded-for and by socket address; with a 1-cent budget the model was called at most 7 times.
- [x] 56. Test CORS: send request with `Origin: http://localhost:5173`, verify CORS headers present. Send with wrong origin, verify no CORS headers. (Req 10)
  Run 20.11: matching Origin got Access-Control-Allow-Origin, a wrong Origin got none, the preflight returned 204 with GET,POST,OPTIONS and Content-Type; no Set-Cookie.

## Wish-Engine Task 25 (Schema Changes)

- [x] 57. Update `packages/paw-core/src/types.ts`: add `userStory?: string` to `Grant` interface. (Req 11.1)
- [x] 58. Update `packages/paw-core/src/types.ts`: add `property?: string` to `Verdict` interface. (Req 11.2)
- [x] 59. Update `packages/paw-core/src/schemas.ts`: add `userStory: z.string().optional()` to `GrantSchema`. (Req 11.1, 11.4)
- [x] 60. Update `packages/paw-core/src/schemas.ts`: add `property: z.string().optional()` to `VerdictSchema`. (Req 11.2, 11.4)
- [x] 61. Update `packages/paw-core/src/prompts.ts`: modify `buildGeniePrompt` to request `userStory` in JSON output (1–2 sentence user story for the wish). (Req 11.5)
- [x] 62. Update `packages/paw-core/src/prompts.ts`: modify `buildJudgePrompt` (verdict mode) to request `property` in JSON output when `closed: true` (a correctness property for fast-check). (Req 11.5)
- [x] 63. Update `packages/paw-core/src/export.ts`: use `grant.userStory` as the `**User Story:**` line in `requirementsMd` if present; fall back to template otherwise. (Req 11.3)
- [x] 64. Update `packages/paw-core/src/export.ts`: use `verdict.property` as the property line in `propertiesMd` if present; fall back to clause-restatement template otherwise. (Req 11.3)
- [x] 65. Write `packages/paw-core/tests/export.test.ts`: test export with model-written userStory and property includes them verbatim. (Req 11.3)
- [x] 66. Write `packages/paw-core/tests/export.test.ts`: test export without userStory/property falls back to template. (Req 11.3)
- [x] 67. Verify paw-core tests pass after schema changes. (Req 11)
- [x] 68. Update `apps/api` to pass through new fields unchanged. (Req 11.4)

## Eval Script

- [x] 69. Write `apps/api/src/eval/script.test.ts`: test golden wishes file parses as expected schema. (Req 12.1)
- [x] 70. Write `apps/api/src/eval/script.test.ts`: test specificity score calculation (mock 8/10 specific → 0.80). (Req 12.3)
- [x] 71. Write `apps/api/src/eval/script.test.ts`: test type coverage calculation (mock expectedTypes fully covered → 1.0). (Req 12.3)
- [x] 72. Implement `apps/api/src/eval/script.ts`: load `docs/golden-wishes.json`, create `GeminiModelClient`, loop over 25 wishes, call `grantWish`, judge each curse in quality mode, compute scores, write `docs/eval/latest.md` and `examples-cache.json`. Exit 0 if specificity ≥ threshold, else exit 1. (Req 12)
- [x] 73. Add `eval` script to `apps/api/package.json`: `"eval": "tsx src/eval/script.ts"`. (Req 12)
- [ ] 74. Run `pnpm eval` locally with real API key, verify `latest.md` and `examples-cache.json` are written. (Req 12.4, 12.5)
- [ ] 75. Verify eval script fails (exit 1) when specificity < 0.80 by temporarily lowering threshold. (Req 12.6)

## Property-Based Tests

- [x] 76. Write `apps/api/tests/properties.test.ts`: Property 1 (budget monotonicity) using fast-check. (design.md)
- [x] 77. Write `apps/api/tests/properties.test.ts`: Property 2 (rate-limit reset) using fast-check. (design.md)
- [x] 78. Write `apps/api/tests/properties.test.ts`: Property 3 (grant validation) using fast-check. (design.md)
- [x] 79. Write `apps/api/tests/properties.test.ts`: Property 4 (verdict idempotency) using fast-check. (design.md)
- [x] 80. Write `apps/api/tests/properties.test.ts`: Property 5 (export completeness) using fast-check. (design.md)
- [x] 81. Write `apps/api/tests/properties.test.ts`: Property 6 (examples cache schema) using fast-check. (design.md)
- [x] 82. Verify all property tests pass. (design.md)

## Deployment

- [x] 83. Create `apps/api/Dockerfile` or Railway config (`railway.json`) for Node 24 runtime. (tech.md, Req intro)
- [ ] 84. Set Railway env vars: `GEMINI_API_KEY`, `CORS_ORIGIN` (web app URL), budget/rate-limit config. (Req 6, 10)
  Owner: needs the deploy decision (key, billing, Railway account, CORS origin).
- [ ] 85. Deploy to Railway, verify `/api/health` returns ok in production. (Req 5)
  Owner: needs the deploy decision (key, billing, Railway account, CORS origin).
  Owner, after the deploy: check how Railway's proxy writes `x-forwarded-for` (how many entries it appends) and set `TRUSTED_PROXY_HOPS` to match. (Req 7.4, task 111)
- [ ] 86. Test production `/api/grant` with a real wish, verify response. (Req 1)
  Owner: needs the deploy decision (key, billing, Railway account, CORS origin).
- [ ] 87. Monitor logs: confirm no wish text, no IP+wish, no secrets appear. (Req 9)
  Owner: needs the deploy decision (key, billing, Railway account, CORS origin).

## CI Integration

- [x] 88. Add CI workflow: on PR touching `packages/paw-core/src/prompts.ts`, run `pnpm eval` in `apps/api`. (Req 12.8)
- [x] 89. Fail PR if eval exits non-zero. (Req 12.6, 12.8)
- [ ] 90. Test CI gate: open PR with intentionally bad prompt, verify eval fails and PR is blocked. (Req 12.8)
  Owner: needs a real PR with the secret set.

## Documentation

- [x] 91. Write `apps/api/README.md`: environment variables, how to run locally, how to run eval, deployment instructions. (Req intro)
- [x] 92. Update root `README.md`: link to paw-api spec and eval docs. (Req intro)

## First real run (owner, 18.11): findings
- [x] 93. `grantWish` assigns `wishId` and curse ids itself after parsing; the model never supplies them (the real
  model output failed zod only because `wishId` was missing). (Req 1, 2)
- [x] 94. Brevity by prompt, not by failure: Paw prompt demands each curse story <= 30 words (2 short sentences) and
  the Genie narration <= 25 words; zod limits become story <= 360 chars, narration <= 260 chars. Real Gemini output
  was rich but ran 300-450 chars. Circles in the UI need short text. (Req 2.1)
- [x] 95. Gemini resilience: default model `gemini-3.5-flash`; on 503/429 try the next model in `GEMINI_MODEL_FALLBACKS`
  (default `gemini-3.8-flash,gemini-flash-latest,gemini-2.5-flash`) before paw-core's retry/fallback. `gemini-3.8-flash`
  and `gemini-flash-latest` returned 503 "high demand" today. Fix the default in code AND in .env.example. (Req 6)
  Superseded by task 103: the default model is now `gemini-3.6-flash`; `gemini-3.5-flash` is a retired name that routes to it.
- [x] 96. Use Gemini structured output (`responseSchema` matching GrantSchema/VerdictSchema) so field names are fixed.
- [x] 97. The eval gate lied: it printed PASS with one fallback curse per wish and 0% type coverage. A wish FAILS when
  the fallback grant was used, when it has fewer than 3 curses, or when it hits none of its `expectedTypes`; the run
  PASSES only if >= 80% of wishes pass. Report path stays docs/eval/latest.md at the REPO ROOT (it was written to
  apps/api/docs). Load `.env` in the eval and dev scripts (`tsx --env-file=.env`). (Req eval)
- [x] 98. Batch the Judge quality gate: ONE model call per grant reviews all curses together and returns a verdict per
  curse (keep / replace + replacement curse), instead of one call per curse. The first full eval spent the key's daily
  free quota (HTTP 429) because each grant cost ~6 calls. Target: <= 2 model calls per grant. (Req 2.4, iron rule 5)
- [x] 99. Fallback chain: default `GEMINI_MODEL_FALLBACKS=gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite`;
  treat HTTP 404 (model retired for this key) and 429 (quota) like 503: skip to the next model. `gemini-2.5-flash`
  returns 404 now; remove it.
- [x] 100. Eval runs `--limit 5` by default (`--all` for 25) and waits 2 s between wishes; it prints how many model
  calls it made. Report path stays docs/eval/latest.md at the repo root.
- [x] 101. Real structured output. `zodToJsonSchema` in apps/api/src/client/gemini.ts returns a basic empty object
  schema, so Gemini answers `{}` and EVERY grant falls back (eval 0% pass). Remove it. Hand-write explicit Gemini
  `responseSchema` objects (OpenAPI subset the @google/generative-ai SDK accepts, with SchemaType) for the
  model-facing shapes only: grant output {narration, userStory, curses[{type: enum of the 10 taxonomy tags, story,
  loophole}]} with required fields; batched quality gate {verdicts[{index, keep, replacement?}]}; binding verdict
  {closed, reason, property}. Add unit tests that assert each schema lists its required properties and the enum.

## Real cost budget guard (20.11)

The fixed per-call charge let the real spend run past `DAILY_BUDGET_CENTS`. These tasks replace it with a reserved ceiling and the real cost from `usageMetadata`. Design: "Cost accounting" and "Worst case per grant and bind". Every test uses a stubbed `fetch` or a fake client and never reaches the network.

- [x] 102. Price table `apps/api/src/budget/prices.ts`: `ModelPrice`, `PriceTable`, `DEFAULT_PRICE_TABLE` (five rows at the 1.1.2027 rates: gemini-3.6-flash, gemini-3.8-flash, gemini-3.5-flash at the 3.6-flash rates, gemini-3.5-flash-lite, gemini-3.1-flash-lite), with the source URL and "checked 2026-11-20" in a comment; `priceFor(table, modelId)` (strip `models/`, exact match, longest `K-` prefix, else the most expensive row); cents as `tokens × usdPerMTok / 10_000`; `PRICE_TABLE_JSON` loading (non-empty object, every rate finite and 0 or more; invalid means the default table and one `{"event":"price_table_invalid"}` line with no part of the value). Remove `DEFAULT_MODEL_CALL_COST_CENTS`, `loadModelCallCost`, `MODEL_CALL_COST_CENTS` and every `costPerCallCents` option, so nothing charges a fixed per-call cost. (Req 7.12, 7.13, 7.14, 7.17)
  Done: `src/budget/prices.ts` holds the five-row table (source URL and "checked 2026-11-20" in a comment), `priceFor`, the cents formula and `loadPriceTable` (one `{"event":"price_table_invalid"}` line, no part of the value). `DEFAULT_MODEL_CALL_COST_CENTS`, `loadModelCallCost`, `MODEL_CALL_COST_CENTS` and every `costPerCallCents` are gone; `git grep` finds none in `apps/api`. `.env.example` and the README env table follow.
- [x] 103. Gemini client, request shape: `DEFAULT_MODEL = 'gemini-3.6-flash'` (fallbacks unchanged, with the 2027-05-07 shutdown date of `gemini-3.1-flash-lite` in a comment); `generationConfig.thinkingConfig.thinkingLevel = 'low'`; exported `MAX_OUTPUT_TOKENS` in `generationConfig.maxOutputTokens`, with the arithmetic in a comment (expected 4096, never above 8192 without a stated reason); `finishReason: "MAX_TOKENS"` or text that is not complete JSON throws "Model call failed (<model>: output cut off)" as a failed attempt, charged by usage and not moving to the next model; the model_call log line adds `promptTokens`, `outputTokens` and `finishReason` only. (Req 6.5, 6.7, 6.8, 6.9, 6.10)
  Done: `DEFAULT_MODEL` is `gemini-3.6-flash`; every request carries `thinkingLevel: 'low'` and `maxOutputTokens: MAX_OUTPUT_TOKENS` (4096, arithmetic in a comment: about 1515 tokens of answer plus about 2500 for thinking). MAX_TOKENS and cut-off JSON throw "output cut off" or "response is not JSON", are charged by usage and do not move to the next model. The log line adds `promptTokens`, `outputTokens` and `finishReason` only.
- [x] 104. Gemini client, metering: `plan(prompt): AttemptPlan[]` (pure, one entry per model of the chain, `inputTokens = ceil((prompt.length + JSON.stringify(responseSchema).length) / 3)`) and `generateMetered(prompt, onAttempt)` with exactly one report per HTTP attempt, whatever happened, before the next attempt and before the promise settles; `usage` only when `usageMetadata.promptTokenCount` is finite and non-negative; `generate(prompt)` is `generateMetered(prompt, () => {})`. paw-core's `ModelClient` stays as it is. (Req 6.11, 6.12, 6.13)
  Done: `plan()` and `generateMetered()` in `src/client/gemini.ts`; one report per HTTP attempt (success, 503/429/404, other statuses, network error, timeout, unreadable body, MAX_TOKENS, bad JSON), before the next attempt and before the promise settles. `generate` is `generateMetered` with no listener. paw-core's `ModelClient` is unchanged.
- [x] 105. Guard `apps/api/src/budget/guarded-client.ts`: the api-local `MeteredModelClient` type and one shared test helper for fakes; `GlobalState.reservedCents` (starts at 0, never reset by the day roll); reserve the whole-chain ceiling and refuse in the same tick when `spentCents + reservedCents + ceiling` is above the budget; in a `finally`, release the reservation and settle to the real cost at the answering model's price, summed over every attempt (an attempt without usage costs its ceiling; no report means the whole ceiling); real cost above the ceiling is still charged and documented; `costCents` per guard; constructor `(inner, state, config, now, prices)`; `prices?: PriceTable` in `AppDeps` and the eval options; wire the table into `createApp`, `server.ts` and the eval; health `remainingCents = max(0, budget - spent - reserved)` and `HealthResponseSchema` without `.int()`. (Req 7.1, 7.2, 7.7, 7.8, 7.9, 7.10, 7.11, 7.16)
  Done: `BudgetedModelClient` reserves the whole-chain ceiling in the same tick as the check and settles in a `finally` to the real cost; `GlobalState.reservedCents` (kept by the day roll), `costCents` per guard, constructor `(inner, state, config, now, prices)`. `prices?` is wired through `AppDeps`, `server.ts` and the eval options; the eval summary prints the cents charged with 4 decimals. Health `remainingCents` subtracts the reservation, and `HealthResponseSchema` takes fractional cents. Fakes come from `src/budget/fake-metered.ts`.
- [x] 106. Tests with stubbed `fetch` and stubbed `usageMetadata` (`apps/api/src/budget/guarded-client.test.ts`, `apps/api/src/client/gemini.test.ts`, `apps/api/tests/properties.test.ts`): settle charges the real cost, not the ceiling; a fallback chain sums its attempts; an attempt with no usage is charged its ceiling; the 1.1.2027 prices apply; an unknown model is priced at the top row; parallel calls near the cap can never overspend (fast-check, Property 7); `thinkingLevel` and `maxOutputTokens` are in the request body; MAX_TOKENS and cut-off JSON take the failure path and are charged by usage; `priceFor` rules and the `PRICE_TABLE_JSON` warning (Property 8). (Req 6.8, 6.9, 6.10, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14) Superseded for HTTP 400 and 500 by task 123.
  Done: tests in `guarded-client.test.ts` (fake client, and the real `GeminiModelClient` with a stubbed `fetch` carrying `usageMetadata` and `modelVersion`), `gemini.test.ts`, `prices.test.ts` and `tests/properties.test.ts` (P7 parallel calls under one budget, P8 price table). The P7 property fails when the guard ignores reservations or reserves one attempt only. `pnpm -C apps/api exec vitest run`: 253 passed.
- [x] 107. Input caps in `apps/api/src/schemas.ts` or the routes (not in paw-core): grant `wish.text` at most 500 chars after trim and `wish.context` at most 200; bind `clause` at most 1000 after trim and the judged curse's `loophole` at most 1000; each over the cap returns 400 with the existing kind of message and no model call. Tests for the limit and one over it, for each field. (Req 1.8, 2.7, 2.8)
  Done: `MAX_WISH_TEXT_CHARS` 500, `MAX_WISH_CONTEXT_CHARS` 200, `MAX_CLAUSE_CHARS` 1000 and `MAX_LOOPHOLE_CHARS` 1000 in `src/schemas.ts` (text, context and clause are trimmed before the cap; the loophole of the judged curse is checked in the bind route). Each over-long field gives 400 before the guard is created, so no model call is made. Route tests at 500/501, 200/201, 1000/1001 and 1000/1001 check the status, that the fake model got 0 calls, and that nothing was reserved or spent.
- [x] 108. Default `DAILY_BUDGET_CENTS` 200, parsed with `Number` (fractional allowed; missing, non-finite or negative means 200). In `apps/api/README.md`, the worst case per grant (34 generates) and per bind (2 generates) with the arithmetic and the default chain. A unit test recomputes both from the real prompt builders, `plan()` and the price table and checks that the README states them. (Req 7.15, 7.18)
  Done: `DAILY_BUDGET_CENTS` defaults to 200 (`parseDailyBudgetCents`, tests for the default, a fractional value and invalid values). `src/budget/worst-case.ts` computes the ceilings with the real paw-core prompt builders, the real `plan()` over the default chain and the default price table: genie 8.37809, batch judge 8.73451, replacement 8.142725, judge verdict 8.193845 cents. Worst case per grant = 2 + 2 + 30 = 34 generates = 278.51 cents (278.50695); per bind = 2 generates = 16.39 cents (16.38769). README section "Cost guard and worst case" has the price table, the arithmetic and what it means against the 200-cent day (one worst-case grant does not fit; 12 worst-case binds do). `src/budget/worst-case.test.ts` recomputes both and checks the README states them.
- [x] 109. CI eval cap: `DAILY_BUDGET_CENTS` in `.github/workflows/prompt-eval.yml` is `ceil(5 × worst case per grant)`, documented in the README. The eval runs through the same guard; when the guard refuses, it exits 1 with a message that contains "budget exhausted", writes no `docs/eval/latest.md` and no examples cache, and never passes. Tests: a refusing guard gives exit 1, the message, and no files written; the workflow value matches the README. (Req 12.9, 12.10, 12.11)
  Done: The CI eval step has `DAILY_BUDGET_CENTS: '1393'` = ceil(5 x 278.50695) with the arithmetic in a comment. A guard refusal makes `runEval` throw "Eval failed: budget exhausted after N model calls (k of m wishes done, X cents charged); nothing was written."; the new `runEvalCli` returns exit code 1 and writes neither report nor cache (tests with a real `runEval` over a fake model). `tests/ci-workflow.test.ts` checks the cap against the module's worst case and the README. README "CI eval gate" states the cap and why.
- [x] 110. Config docs: in `apps/api/README.md` and `apps/api/.env.example` remove `MODEL_CALL_COST_CENTS`; add `PRICE_TABLE_JSON` and `TRUSTED_PROXY_HOPS`; show the new defaults (`DAILY_BUDGET_CENTS` 200, `TRUSTED_PROXY_HOPS` 1, default model `gemini-3.6-flash`). `.env.example` lists names and safe defaults only, no key. (Req 7.4, 7.13, 7.15, 7.17, 6.7)
  Done: README env table has `DAILY_BUDGET_CENTS` 200 and `TRUSTED_PROXY_HOPS` 1, and the input caps are under the endpoints. `.env.example` has `DAILY_BUDGET_CENTS=200` with "($2 a day)" and `TRUSTED_PROXY_HOPS=1`. `git grep MODEL_CALL_COST` in `apps/api` and `.github` finds nothing.
- [x] 111. Per-IP key from `TRUSTED_PROXY_HOPS` in `apps/api/src/budget/middleware.ts`, passed to `checkBudget` as its own parameter (paw-core's `BudgetConfig` does not change). Tests: a faked leftmost entry does not bypass the limit; hops 0, 1 and 2 pick the right key; no header, or a header shorter than hops, uses the socket address; blank entries are ignored; an invalid value means 1. Document the rule in the README. (Req 7.4)
  Done: `clientKeyOf` and `checkBudget(state, config, clock, trustedProxyHops)` in `src/budget/middleware.ts`; `TRUSTED_PROXY_HOPS` is read in `server.ts` and passed through `createApp` (default 1; `parseTrustedProxyHops` in `config.ts`). Tests in `middleware.test.ts` and `app.test.ts`: a faked leftmost entry is still limited after `PER_IP_LIMIT`; hops 0 uses the socket; hops 2 takes the second entry from the right; no header or fewer entries than hops uses the socket; blank entries are ignored; an invalid value means 1. README "Client IP and proxies".
- [x] 112. Guardrail game-role rule in `apps/api/src/guardrail.ts`: example tests next to the batch-8 ones ("Players can attack other players" passes; a combat verb at a game role passes; a social-harm verb at a game role refuses; a real-person target refuses with any harm verb). The property tests change only for the new documented exemption. (Req 1.3)
  Done: `COMBAT_WORDS`, `SOCIAL_HARM_WORDS` (together `HARM_WORDS`) and `GAME_ROLE_WORDS` in `src/guardrail.ts`; a combat verb at a game role is no person target. The three new wishes pass and the five refusals still refuse. The person-word property excludes combat verb + game role only; two new properties (combat verb + game role passes; social-harm verb + player(s) refuses). The code matches the "Wish guardrail" section of `design.md`, so it is unchanged.

## Free tier (owner's decision, 20.11)

The website runs on Gemini's free tier with no billing account. When the day's free quota ends, the round falls back to the ready examples. Design: "Quota answers" and "Free tier"; Requirement 13. Every test uses a stubbed `fetch` or a fake client and never reaches the network. Do not read `apps/api/.env`, do not run the eval or `pnpm -C apps/api dev`, and run one test process at a time.

- [x] 113. Gemini client, quota answers (`apps/api/src/client/gemini.ts`, `gemini.test.ts`): read the body of every non-200 answer (at most 64 KB, under the attempt's timeout and abort signal; never logged, never in a message); an attempt is a quota attempt on HTTP 429 or on `error.status === "RESOURCE_EXHAUSTED"` in any non-200 body; `quotaScopeOf(body)` is `shared` only when every `QuotaFailure` violation has a `quotaId` with `PerProject` and without `PerModel` and `quotaDimensions` with no `model` (and there is at least one), else `per-model`; `shared` stops the chain, `per-model` tries the next model; `report.quota = true` on a quota attempt; export `QuotaExhaustedError` (fixed message) and throw it when the chain ends without success and at least one attempt was a quota attempt; every other failure keeps its own error. Update the comment on `NEXT_MODEL_STATUSES` and the class comment. Tests: a per-model 429 on the primary tries the next model (2 calls); a per-project 429 stops after 1 call; 429 on every model throws `QuotaExhaustedError`; 429 with an unreadable body or no violation tries the next model; `RESOURCE_EXHAUSTED` with status 403 and with 503 counts; a body over 64 KB is cut and does not hang; a per-model 429 then a success succeeds; a 500 still throws its own error; no log line and no thrown message contains the key or any part of the body. (Req 13.1–13.4, 6.5, 6.7, 6.10, 9.6)
  Done: `src/client/gemini.ts` reads the body of every non-200 answer (at most `MAX_ERROR_BODY_BYTES`, 64 KB, under the attempt's abort signal; a body that never arrives is given up at the timeout), reduces it to a verdict and drops it. A 429, or `error.status` `RESOURCE_EXHAUSTED` in any non-200 body, is a quota attempt (`report.quota = true`). `quotaScopeOf` is `shared` only for at least one violation, all `PerProject`, not `PerModel`, with `quotaDimensions` and no `model`; `shared` stops the chain, `per-model` tries the next model. Exported `QuotaExhaustedError` (fixed message) is thrown when the chain ends without success after at least one quota attempt; every other failure keeps its own error. Comments on `NEXT_MODEL_STATUSES` and the class are updated. Tests in `gemini.test.ts` cover every case of the task, including a stream that never ends, a body that never arrives and no key or body in any log, report or message. The old test "throws the last status when every model is unavailable" used 429 in its chain, which now ends as a quota answer, so it uses 503, 404, 503.
- [x] 114. Guard (`apps/api/src/budget/guarded-client.ts`, `guarded-client.test.ts`, `tests/properties.test.ts`): a quota attempt (`report.quota`) is charged 0 cents and every other attempt keeps today's rule (404 and other failures too); on `QuotaExhaustedError` the guard sets `quotaSpent` and `denied`, then rethrows; at the top of `generate`, before the day roll and any reservation, a guard with `quotaSpent` throws `BudgetExhaustedError` without calling the inner client; a budget refusal does not set `quotaSpent`; the reservation of the whole chain is unchanged and the worst-case numbers and their test (`worst-case.test.ts`) do not change. Tests: a quota attempt costs 0 and `spentCents` does not move while `reservedCents` returns to 0; a chain of a quota attempt then a success is charged only the success; after a quota answer a second `generate` makes no inner call, also through `grantWish` and `judgeBinding` (count the inner HTTP calls of a stubbed `fetch`: paw-core's retry makes none); fast-check properties 9 and 10 of the design. (Req 13.5, 13.6, 7.8–7.10) Superseded for HTTP 400 and 500 by task 123.
  Done: `BudgetedModelClient` has `quotaSpent`; `chargeOf` returns 0 for `report.quota`; on `QuotaExhaustedError` the guard sets `quotaSpent` and `denied` and rethrows; at the top of `generate`, before the day roll and any reservation, a guard with `quotaSpent` throws `BudgetExhaustedError` without calling the inner client. A budget refusal does not set `quotaSpent` (a later cheaper call on the same guard still fits, tested). The reservation, `worst-case.ts`, `worst-case.test.ts` and the README worst-case numbers are unchanged. `FakeMeteredModel` has a `quota` option. Tests in `guarded-client.test.ts` (0 cents and a released reservation; quota then success charged only the success; a 404 still charged its ceiling; no inner HTTP call after a quota answer, also through `grantWish` and `judgeBinding`, counted on a stubbed `fetch`) and properties 9 and 10 in `tests/properties.test.ts`. Both properties fail when the 0-cent rule or the `quotaSpent` check is removed.
- [x] 115. Routes and eval: no new route code is expected, because the routes already read `denied` after `grantWish` and `judgeBinding`; check that, and add tests in `app.test.ts`: a stubbed `fetch` that answers 429 on every model gives 503 with `RESTING_MESSAGE` on `/api/grant` and on `/api/bind`, not the fallback grant or verdict, and `/api/health` still says `mode: "normal"`; `RESOURCE_EXHAUSTED` in a body with another status gives the same 503. The eval (`src/eval/script.ts`): when the guard's `quotaSpent` is set, the "budget exhausted" error also says that the free quota is spent; tests: a quota answer makes `runEvalCli` return 1, write neither report nor cache, and print no pass. (Req 1.9, 2.9, 8.6, 12.12)
  Done: No route code changed: `grant.ts` and `bind.ts` already read `denied` after `grantWish` and `judgeBinding`. `app.test.ts` has 6 new tests with the real `GeminiModelClient` over a stubbed `fetch`: 429 on every model gives 503 with `RESTING_MESSAGE` on `/api/grant` and `/api/bind` (no fallback grant or verdict, 3 HTTP calls and no retry round); `RESOURCE_EXHAUSTED` in the body of a 403, 503 or 400 gives the same 503; a shared quota stops after 1 call; `/api/health` stays `normal` with 0 cents spent; the next request tries the model again. In `src/eval/script.ts` the "budget exhausted" line adds "; the free quota of the model is spent" when `quotaSpent` is set. Eval tests: a quota answer makes `runEvalCli` return 1, write neither report nor cache and print no pass; a plain refusal does not mention the quota.
- [x] 116. Docs (`apps/api/README.md`): update the sentence "An attempt that reported no token counts (a timeout, a network error, an HTTP error) is charged its ceiling." so that it says a quota attempt (429 or `RESOURCE_EXHAUSTED`) is charged 0 cents because Google does not bill it; add the section "Running on the free tier": create the key in a Google AI Studio project with no billing account, so no bill is possible; when the day's free quota ends Gemini answers 429 `RESOURCE_EXHAUSTED`, the paw rests (grant and bind answer 503 "The paw is resting..." and the site serves the ready examples), daily free quotas reset at midnight Pacific time, and the budget guard still counts paid-tier prices on paper, as a second fence; say in the `GEMINI_MODEL_FALLBACKS` row that a 429 whose quota is shared by all models stops the chain; in "Deploy on Railway" step 2, point to the new section for the key. The worst-case section does not change; `worst-case.test.ts` stays green. (Req 13.7, 13.8) Superseded for HTTP 400 and 500 by task 123.
  Done: `apps/api/README.md`: the sentence about attempts without token counts now says a quota attempt (429 or `RESOURCE_EXHAUSTED`) is charged 0 cents because Google does not bill it, and that the reservation does not change; new section "Running on the free tier" (key in a Google AI Studio project with no billing account, 429 `RESOURCE_EXHAUSTED`, the paw rests with 503 and the ready examples, daily free quotas reset at midnight Pacific time, paid-tier prices on paper as a second fence); the `GEMINI_MODEL_FALLBACKS` row says a shared-quota 429 stops the chain; "Deploy on Railway" step 2 points to the new section. The worst-case section is unchanged. `pnpm -C apps/api vitest run`: 393 passed (21 files); `typecheck`: only the 2 old errors in `src/logger.ts`; `build` passes.
- [ ] 117. Owner task, not an agent task: the design assumes the shape of Gemini's 429 body (`error.status`, `QuotaFailure` violations, `quotaId` strings with `PerProject` and `PerModel`, `quotaDimensions.model`). The first time a free-tier key really gets a 429, save that body (it holds no key) and compare it with the assumption. If the `quotaId` strings differ, adjust `quotaScopeOf` and its tests. Also confirm in Google AI Studio that the key's project has no billing account. Record the result and the date here. (Req 13.3)

## Live-call gate (owner's decision, 22.11)

Google's terms allow the free tier only in the available regions, outside the EEA, Switzerland and the UK, and not for people under 18. Design: "Live-call gate"; Requirement 14. Every test uses a fake client and never reaches the network. Do not read `apps/api/.env`. Agents run no `apps/api` test in the repository; the reviewer runs them in a clean copy without `.env`.

- [x] 118. Regions, gate, route and wiring (`apps/api/src/gate/regions.ts`, `gate.ts`, `routes/live.ts`, `app.ts`, `server.ts`): the table of 231 names and codes; `FREE_EXCLUDED`; the two allow-lists; `LIVE_ROUTES`; `countryAllowed` and `adultConfirmed`; the gate middleware after CORS and the logger and before the mode check, the per-IP count, the body and the guard; `GET /api/live`; `X-Paw-Adult-Confirmed` in the CORS allow-headers; `GateConfig` in `createApp` (omitted is free with no header); `server.ts` reads `GEMINI_TIER` and `COUNTRY_HEADER`. `/api/examples`, `/api/export` and `/api/health` and the eval CLI do not change. (Req 14.1–14.10, 10.1) Done: `gate/regions.ts`, `gate/config.ts` (the loader), `gate/middleware.ts` (the decision, the codes and `LIVE_ROUTES`), `routes/live.ts`, `app.ts`, `server.ts`; `pnpm -C apps/api typecheck` shows only the 2 old `logger.ts` errors.
- [x] 119. Tests (`apps/api/src/gate/gate.test.ts`, `app.test.ts`, `tests/properties.test.ts`, a fixture of the 231 names): the cases of Requirement 14.12, refusal order, 403 with `no-store`, `GET /api/live`, an invalid or unset `COUNTRY_HEADER` never throws, the country never in a log, body, header or error, a refusal leaves the IP count and the budget unmoved, and properties 11 and 12. Write them; the reviewer runs them in a clean copy without `.env`. (Req 14.12) Done, not run: the cases and properties 11 and 12 are in `gate/gate.test.ts` (not in `tests/properties.test.ts`), the old `app.test.ts` has a test gate, and the fixture is `tests/fixtures/gemini-available-regions.txt`. The reviewer runs them in a clean copy without `.env`.
- [x] 120. Docs (`apps/api/README.md`, `apps/api/.env.example`): the content of Requirement 14.11, with names only in `.env.example`. (Req 14.11) Done.

## Nothing a caller sent reaches a log (privacy fix, 22.11)

- [x] 121. Privacy of logs and errors (`src/logger.ts`, `src/error-log.ts`, `src/routes/body.ts`, `app.ts`, `server.ts`, `routes/grant.ts`, `bind.ts`, `export.ts`, `client/gemini.ts`, `eval/script.ts`, `src/privacy.test.ts`; and `packages/paw-mcp`, paw-power task 16). Our own request logger replaces `hono/logger`; one error line (fixed code, class from a fixed list); an unreadable body is a 400; `app.onError`; edge, `error`, `uncaughtException` and `unhandledRejection` handlers in `server.ts`; the Gemini log entry is limited to a finish-reason list, safe-integer token counts and a 100 to 599 status; the eval CLI prints code and class. (Req 9.4, 9.7) Done, not run in `apps/api`: `pnpm -C apps/api typecheck` is clean (the 2 old `logger.ts` errors are gone). No `apps/api` test was run, by rule. `src/privacy.test.ts` is new and was never run; the changed expectations in `client/gemini.test.ts` (finishReason `OTHER`, token and status limits) were not run either. The reviewer runs them in a clean copy without `.env`.

## Abuse limits (batch 17)

- [x] 122. Abuse limits (`apps/api/src/routes/body.ts`, `schemas.ts`, `fit.ts`, `app.ts`, `budget/state.ts`, `routes/grant.ts`, `bind.ts`, `export.ts`, `packages/paw-core/src/` trims, the guardrail; tests `tests/abuse.test.ts`, `src/fit.test.ts`, `src/guardrail.test.ts`, `src/budget/config.test.ts`, `packages/paw-core/tests/export-trim.test.ts`): capped body reader and 413, capped export and bind schemas, `fitGrant` and `fitVerdict`, linear trims, POST-only mode check and count in order gate, mode, count, body, pruned IP map. (Req 15)
  - Done: code and tests written; the paw-core build, typecheck and tests and the api typecheck were run, the api tests were not run (the reviewer runs them in a clean copy).

## Refused calls (batch 18)

- [ ] 123. Client, guard and fake (`apps/api/src/client/gemini.ts`, `apps/api/src/budget/guarded-client.ts`, the fake client) with tests in `client/gemini.test.ts`, `budget/guarded-client.test.ts`, `app.test.ts` and `tests/properties.test.ts`: an unbilled attempt (HTTP 400 or 500, body not cut off, no `usageMetadata`) is reported with `unbilled: true` and costs 0; valid usage is charged by usage; unreadable usage, a timeout and every other status keep the ceiling; property 13. The tests fail on the previous commit. (Req 16)
- [ ] 124. Comments and `apps/api/README.md`: the sentence on attempts without token counts names the quota and unbilled exceptions, with the source and its date. (Req 16)
