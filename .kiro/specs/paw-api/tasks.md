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
- [x] 15. Implement `apps/api/src/budget/middleware.ts`: `checkBudget` middleware that calls paw-core `canCall`, rejects with 503 if false, attaches state to Hono context. (Req 7.1, 7.2)
- [x] 16. Implement `apps/api/src/budget/record.ts`: helper that calls paw-core `recordCall` and updates `GlobalState`. (Req 7.2)
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
- [ ] 54. Start server locally (`pnpm dev`), test each endpoint with curl or Postman, verify responses match schemas. (Req 1–5)
- [ ] 55. Test budget enforcement: make 11 rapid calls to /api/grant from same IP, verify 11th returns 503. (Req 7.1)
- [ ] 56. Test CORS: send request with `Origin: http://localhost:5173`, verify CORS headers present. Send with wrong origin, verify no CORS headers. (Req 10)

## Wish-Engine Task 25 (Schema Changes)

- [x] 57. Update `packages/paw-core/src/types.ts`: add `userStory?: string` to `Grant` interface. (Req 11.1)
- [x] 58. Update `packages/paw-core/src/types.ts`: add `property?: string` to `Verdict` interface. (Req 11.2)
- [x] 59. Update `packages/paw-core/src/schemas.ts`: add `userStory: z.string().optional()` to `GrantSchema`. (Req 11.1, 11.4)
- [x] 60. Update `packages/paw-core/src/schemas.ts`: add `property: z.string().optional()` to `VerdictSchema`. (Req 11.2, 11.4)
- [ ] 61. Update `packages/paw-core/src/prompts.ts`: modify `buildGeniePrompt` to request `userStory` in JSON output (1–2 sentence user story for the wish). (Req 11.5)
- [ ] 62. Update `packages/paw-core/src/prompts.ts`: modify `buildJudgePrompt` (verdict mode) to request `property` in JSON output when `closed: true` (a correctness property for fast-check). (Req 11.5)
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

- [ ] 83. Create `apps/api/Dockerfile` or Railway config (`railway.json`) for Node 24 runtime. (tech.md, Req intro)
- [ ] 84. Set Railway env vars: `GEMINI_API_KEY`, `CORS_ORIGIN` (web app URL), budget/rate-limit config. (Req 6, 10)
- [ ] 85. Deploy to Railway, verify `/api/health` returns ok in production. (Req 5)
- [ ] 86. Test production `/api/grant` with a real wish, verify response. (Req 1)
- [ ] 87. Monitor logs: confirm no wish text, no IP+wish, no secrets appear. (Req 9)

## CI Integration

- [ ] 88. Add CI workflow: on PR touching `packages/paw-core/src/prompts.ts`, run `pnpm eval` in `apps/api`. (Req 12.8)
- [ ] 89. Fail PR if eval exits non-zero. (Req 12.6, 12.8)
- [ ] 90. Test CI gate: open PR with intentionally bad prompt, verify eval fails and PR is blocked. (Req 12.8)

## Documentation

- [ ] 91. Write `apps/api/README.md`: environment variables, how to run locally, how to run eval, deployment instructions. (Req intro)
- [ ] 92. Update root `README.md`: link to paw-api spec and eval docs. (Req intro)
