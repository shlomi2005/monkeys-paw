# Wish Engine — Tasks

Ordered implementation checklist. Each task references the requirement(s) it satisfies. Tests first where the
component has a pure interface. All work happens in `packages/paw-core` unless noted.

- [x] **1. Scaffold `packages/paw-core`** — `package.json`, `tsconfig.json` (strict, `noImplicitAny`), `src/index.ts`
  barrel. No DOM/Node imports; may import `zod` and `fast-check` (dev). (structure.md, tech.md)
- [x] **2. Define core types** — `src/types.ts` with `Wish`, `Curse`, `CurseType`, `CurseStatus`, `Grant`, `Binding`,
  `BindingKind`, `Verdict`, `IntegrityResult`, `SpecExport`, `ModelClient`. (Req 1–6, design §Core types)
- [x] **3. Write zod schemas** — `src/schemas.ts` with `CurseTypeSchema`, `CurseSchema`, `GrantSchema`,
  `BindingSchema`, `VerdictSchema`, `IntegrityResultSchema`, `SpecExportSchema`. (Req 2.5, 4.4, design §Zod Schemas)
- [x] **4. Schema round-trip test** — `tests/schemas.test.ts`: verify `GrantSchema.parse(JSON.parse(JSON.stringify(x)))`
  round-trips for generated valid grants. (P3)
- [x] **5. Implement budget guard** — `src/budget.ts`: `canCall(state, config, now)` and `recordCall(state, cost, now)`.
  Pure, no side effects. (Req 7)
- [x] **6. Budget property test** — `tests/properties.test.ts` (P8): fast-check any call sequence, assert
  `canCall` is false once over budget and `spentCents` never exceeds `dailyBudgetCents`. (P8, Req 7.3)
- [x] **7. Write prompt builders** — `src/prompts.ts`: `buildPawPrompt(wish)` (adversary, taxonomy + guardrails),
  `buildGeniePrompt(wish)` (narrator, 1–2 sentences), `buildJudgePrompt(curse, binding)` (quality gate + binding
  verdict modes). All return strings; no model calls. (Req 2, 4, design §Prompted Roles)
- [x] **8. Implement `grantWish`** — `src/grant.ts`: build Paw+Genie prompt, call `ModelClient.generate`, parse with
  `GrantSchema`, retry once on failure, fall back on second failure. Run Judge quality gate: reject generic curses,
  request replacements (up to 3 retries per curse). (Req 2.1–2.6, design §Error Handling)
- [x] **9. `grantWish` unit tests** — `tests/grant.test.ts`: fake `ModelClient` returning valid JSON → valid `Grant`
  with 3–5 curses; invalid JSON → retry once; second failure → fallback grant. (Req 2.5, P6, P7)
- [x] **10. Implement `proposeBinding`** — `src/bind.ts`: construct `Binding` from curse id, clause text, and kind
  (`rewrite` or `ears-clause`). Reject empty clause. (Req 3.1–3.4)
- [x] **11. Implement `judgeBinding`** — `src/judge.ts`: build Judge prompt, call model, parse with `VerdictSchema`,
  retry once, fall back to `closed: false` on second failure. Apply verdict: set curse status + attach
  binding/verdict. (Req 4.1–4.5)
- [x] **12. `judgeBinding` unit tests** — `tests/judge.test.ts`: fake model returning `closed: true` → curse becomes
  `closed`; `closed: false` → stays `open`; invalid output → fallback `closed: false`. (Req 4.3, 4.4)
- [x] **13. Implement `computeIntegrity`** — `src/integrity.ts`: count open/closed, compute `Math.floor(closed/total *
  5)` (0 if total 0 → return 5). Return `IntegrityResult`. (Req 5.1–5.4)
- [x] **14. Integrity property test** — add to `tests/properties.test.ts` (P4): fast-check random grant states, assert
  score in 0–5, formula holds, closing more never decreases. (P4, Req 5)
- [x] **15. Implement `exportSpec`** — `src/export.ts`: generate `requirementsMd` (user story + EARS acceptance
  criteria from closed bindings) and `propertiesMd` (one property per closed curse). Include `IntegrityResult`.
  (Req 6.1–6.5)
- [x] **16. Export EARS validity test** — `tests/export.test.ts`: assert every acceptance criterion in
  `requirementsMd` matches EARS pattern. (P1, Req 6.2)
- [x] **17. One-property-per-curse test** — add to `tests/properties.test.ts` (P2): fast-check grants, assert
  property count in `propertiesMd` equals closed curse count. (P2, Req 6.3)
- [x] **18. Finger-count invariant test** — add to `tests/properties.test.ts` (P5): assert open-curse count equals
  finger count, closing reduces by exactly one. (P5)
- [x] **19. Wire public API** — `src/index.ts`: export `grantWish`, `proposeBinding`, `judgeBinding`,
  `computeIntegrity`, `exportSpec`, budget types, and all schemas/types. One export per file. (structure.md)
- [x] **20. Full property suite run** — `pnpm test` in `paw-core`: all unit + property tests pass (P1–P8).
  (Req 1–7)
- [x] **21. API integration stub** — `apps/api` implements `ModelClient` with Gemini, wires budget guard before
  every call, serves cached examples when over budget. (Req 7, iron-rules §5) — *separate spec; stub here for
  interface check only.*
  Files: `apps/api/src/client/gemini.ts`, `apps/api/src/budget/guarded-client.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/eval/script.ts`, `packages/paw-core/src/budget.ts` (`canSpend`).

## Review findings (owner review, 18.11)

- [x] **22. Export in true Kiro spec format** — `exportSpec` must take the original `Wish` and emit Kiro's
  `requirements.md` layout: `# Requirements Document`, `## Introduction` (the wish and its context), then
  `### Requirement 1` with `**User Story:** As a …, I want …, so that …` and numbered `#### Acceptance Criteria`
  in EARS (one per closed curse, plus the original wish as criterion 1). Today it emits a flat list with no
  user story. (Req 6.1, 6.2)
- [x] **23. Properties phrased as properties** — each line of `properties.md` must read as a universally
  quantified, testable statement ("*For any* … , … ") derived from the curse and its binding, tagged with the
  curse type, and name the requirement it validates. Today it only repeats the clause. (Req 6.3, P2)
- [x] **24. Tidy imports** — move the `import type { Curse }` in `export.ts` to the top. (structure.md)
- [x] **25. Model-written story and properties** — the deterministic template still writes weak English
  (criterion 1 is meta, the user story is generic, properties restate the clause). Let the Genie return a real
  `userStory` with the grant, and the Judge return a `property` ("For any project whose owner has left, at least
  one member can still delete it") with every `closed` verdict; `exportSpec` assembles those and keeps the
  template only as a fallback. Criterion 1 becomes the original wish rewritten in EARS. (Req 6, P1, P2)
  Done: `Grant.wishCriterion` (Genie-written EARS, kept by `grantWish` only if it starts with an EARS keyword and has SHALL); `exportSpec` uses it as criterion 1 (EARS fallback otherwise), all criteria are plain EARS, and every property line is `- *For any* … [`type`] (Requirement 1.k)`.
