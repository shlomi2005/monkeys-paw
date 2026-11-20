# Wish Engine — Design

## Overview

The wish engine is the pure core of The Monkey's Paw. It lives in `packages/paw-core` and contains no DOM or
Node-specific code. Three AI roles do the model work — **Paw** (adversary, finds loopholes), **Genie** (narrator,
tells the literal grant), and **Judge** (decides if a binding closes a loophole, rejects generic curses). All model
output is untrusted and validated against zod schemas; on validation failure the engine retries once, then falls
back. A budget guard caps model calls by per-IP rate limit and a hard daily budget — over budget, only cached
example wishes are served.

The engine exposes a small public API from `index.ts`: `grantWish`, `proposeBinding`, `judgeBinding`,
`computeIntegrity`, `exportSpec`, and the budget guard. The actual model call is injected via a `ModelClient`
interface, implemented by `apps/api` (the only place that holds the Gemini key).

## Architecture

```
User → apps/web (fetch) → apps/api (Hono) → paw-core
                                              ├── grantWish(wish, ModelClient) → Grant
                                              │     ├── buildGrantPrompt  (Paw + Genie roles)
                                              │     ├── ModelClient.generate → raw JSON
                                              │     ├── GrantSchema.parse (validate, retry, fallback)
                                              │     └── Judge quality gate (reject generic curses)
                                              ├── proposeBinding(curse) → Binding
                                              ├── judgeBinding(curse, Binding, ModelClient) → Verdict
                                              ├── computeIntegrity(Grant) → IntegrityResult (0-5)
                                              └── exportSpec(Grant) → SpecExport (requirements.md + properties.md)
```

`paw-core` never imports from `apps/web`, `apps/api`, or `packages/paw-power`. It takes a `ModelClient` as a
dependency so the caller (API or power) provides the transport. The engine is pure logic: prompt construction,
schema validation, state transitions, and export generation.

## Components and Interfaces

All types live in `src/types.ts`. Zod schemas live in `src/schemas.ts`. The types below are the public contract.

### Core types

```typescript
// ── Curse types (from curse-taxonomy.md; never abbreviate or invent) ──────────

type CurseType =
  | 'permissions'
  | 'time'
  | 'money'
  | 'scale'
  | 'abuse'
  | 'privacy'
  | 'accessibility'
  | 'data-loss'
  | 'concurrency'
  | 'edge-input';

// ── Wish ─────────────────────────────────────────────────────────────────────

interface Wish {
  /** Stable id for the session; no identity attached (iron-rules §2). */
  readonly id: string;
  /** The requirement text. Non-empty after validation. */
  readonly text: string;
  /** Optional app context, e.g. "a clinic booking app". */
  readonly context?: string;
  /** Epoch ms; used only for rate-limit windowing, never stored with identity. */
  readonly createdAt: number;
}

// ── Curse ─────────────────────────────────────────────────────────────────────

type CurseStatus = 'open' | 'closed';

interface Curse {
  readonly id: string;
  /** Tag from curse-taxonomy.md. */
  readonly type: CurseType;
  /** Max 2 sentences: the literal-compliance disaster, dry comedy-horror. */
  readonly story: string;
  /** Quotes/points to the exact words in the wish that create the loophole. */
  readonly loophole: string;
  readonly status: CurseStatus;
  /** Present once the curse is judged closed. */
  readonly binding?: Binding;
  /** Present once judged. */
  readonly verdict?: Verdict;
}

// ── Grant ─────────────────────────────────────────────────────────────────────

interface Grant {
  readonly wishId: string;
  /** Genie narration: the literal grant in 1–2 sentences. */
  readonly narration: string;
  /** 3–5 curses. */
  readonly curses: Curse[];
}

// ── Binding ───────────────────────────────────────────────────────────────────

type BindingKind = 'rewrite' | 'ears-clause';

interface Binding {
  readonly curseId: string;
  readonly kind: BindingKind;
  /** The rewritten wish text, or the EARS clause. */
  readonly clause: string;
  readonly proposedAt: number;
}

// ── Verdict ───────────────────────────────────────────────────────────────────

interface Verdict {
  readonly curseId: string;
  /** True = the binding closes the loophole; false = still open. */
  readonly closed: boolean;
  /** Why the Judge ruled as it did. */
  readonly reason: string;
  readonly judgedAt: number;
}

// ── Integrity ──────────────────────────────────────────────────────────────────

interface IntegrityResult {
  /** 0–5, rounded down from closed/total ratio. 5 = all closed. */
  readonly score: number;
  readonly total: number;
  readonly closed: number;
  readonly open: number;
}

// ── Export ─────────────────────────────────────────────────────────────────────

interface SpecExport {
  readonly wishId: string;
  /** Kiro spec format: user story + EARS acceptance criteria. */
  readonly requirementsMd: string;
  /** One correctness property per closed curse. */
  readonly propertiesMd: string;
  readonly integrity: IntegrityResult;
}
```

### Model client interface

`paw-core` defines the interface; `apps/api` implements it with Gemini. This keeps the engine pure and testable
with a fake client.

```typescript
interface ModelClient {
  /**
   * Send a prompt and return parsed JSON validated against `schema`.
   * Implementations must return raw text; paw-core does the zod parse.
   * On parse failure the caller (grant/judge) retries once, then falls back.
   */
  generate(prompt: string): Promise<unknown>;
}
```

### Public API (`src/index.ts`)

```typescript
export async function grantWish(wish: Wish, model: ModelClient): Promise<Grant>;
export function proposeBinding(curse: Curse, clause: string, kind: BindingKind): Binding;
export async function judgeBinding(
  curse: Curse,
  binding: Binding,
  model: ModelClient,
): Promise<Verdict>;
export function computeIntegrity(grant: Grant): IntegrityResult;
export function exportSpec(grant: Grant): SpecExport;
```

## Prompted Roles

All three roles are prompt builders in `src/prompts.ts`. Each returns a string prompt to send to the model.

### Paw (adversary) — `buildPawPrompt(wish)`

Finds loopholes. The prompt:
- Instructs the model to produce 3–5 curses for the given wish + context.
- Embeds the curse taxonomy (all 10 types) and requires each curse to use a tag exactly.
- Enforces specificity (must quote the wish words that create the loophole), plausibility, difference (different
  type or stakeholder per curse), and bindability.
- Enforces PG-13, no real people, no harming people (iron-rules.md §3).
- Requires strict JSON output matching `GrantSchema`.

### Genie (narrator) — `buildGeniePrompt(wish)`

Tells the literal grant in 1–2 sentences in dry comedy-horror voice. This narration becomes `Grant.narration`.
The Genie prompt is combined with the Paw prompt in a single model call to produce the full `Grant`.

### Judge — `buildJudgePrompt(curse, binding)`

Two functions, one prompt builder with a mode parameter:

1. **Quality gate** (during grant): given a curse, decide if it is generic or specific. Output: `{ specific:
   boolean, reason: string }`. Generic curses are rejected and replaced.
2. **Binding verdict**: given a curse and a binding, decide if the binding closes the loophole. Output matches
   `VerdictSchema`. The Judge emits JSON only — no prose outside the schema.

## Zod Schemas (`src/schemas.ts`)

```typescript
import { z } from 'zod';

const CurseTypeSchema = z.enum([
  'permissions', 'time', 'money', 'scale', 'abuse',
  'privacy', 'accessibility', 'data-loss', 'concurrency', 'edge-input',
]);

const CurseSchema = z.object({
  id: z.string(),
  type: CurseTypeSchema,
  story: z.string().max(300),
  loophole: z.string().min(1),
  status: z.enum(['open', 'closed']).default('open'),
  binding: z.lazy(() => BindingSchema).optional(),
  verdict: z.lazy(() => VerdictSchema).optional(),
});

const GrantSchema = z.object({
  narration: z.string().max(200),
  curses: z.array(CurseSchema).min(3).max(5),
});

const BindingKindSchema = z.enum(['rewrite', 'ears-clause']);

const BindingSchema = z.object({
  curseId: z.string(),
  kind: BindingKindSchema,
  clause: z.string().min(1),
  proposedAt: z.number(),
});

const VerdictSchema = z.object({
  curseId: z.string(),
  closed: z.boolean(),
  reason: z.string().min(1),
  judgedAt: z.number(),
});

const IntegrityResultSchema = z.object({
  score: z.number().int().min(0).max(5),
  total: z.number().int().min(0),
  closed: z.number().int().min(0),
  open: z.number().int().min(0),
});

const SpecExportSchema = z.object({
  wishId: z.string(),
  requirementsMd: z.string(),
  propertiesMd: z.string(),
  integrity: IntegrityResultSchema,
});
```

## Error Handling

Model output is untrusted (iron-rules.md §6). Every model call follows the same pattern:

1. **Call** `ModelClient.generate(prompt)` → raw output.
2. **Parse** with the relevant zod schema (e.g. `GrantSchema`).
3. **On parse failure:** retry the model call **once**.
4. **On second failure:** fall back:
   - **Grant:** return a fallback grant with a Genie narration and a single generic curse marked `open`, or surface
     a structured error to the API so the client shows an in-character "the paw is resting" message.
   - **Judge:** default to `closed: false` (the loophole stays open) so the user can try again.

No model call is ever made without a budget check (Requirement 7, iron-rules §5).

## Rate Limit and Daily Budget (`src/budget.ts`)

The budget guard is injected at the API layer. `paw-core` provides the pure check logic:

```typescript
interface BudgetConfig {
  /** Max model calls per IP per window. */
  readonly perIpLimit: number;
  /** Window in ms for the per-IP counter. */
  readonly windowMs: number;
  /** Hard daily spend cap in cents. */
  readonly dailyBudgetCents: number;
}

interface BudgetState {
  readonly ipCalls: number;       // calls in current window for this IP
  readonly windowStart: number;
  readonly spentCents: number;     // spend today
  readonly dayStart: number;
}

/** Returns false if the call would exceed rate limit or budget. */
function canCall(state: BudgetState, config: BudgetConfig, now: number): boolean;

/** Records a call's cost; called after a successful model call. */
function recordCall(state: BudgetState, costCents: number, now: number): BudgetState;
```

The API layer holds the mutable counters (in-memory, short-lived — iron-rules §2) and calls `canCall` before every
model invocation. Over budget → examples-only mode: the API returns pre-computed grants for the 25 example wishes
without calling the model.

**Real cost accounting (paw-api tasks 102-109).** `canCall` and `recordCall` model the per-request check and the
day boundary. The cost of each model call is not an estimate. The API guard reserves a ceiling before every
`generate` (the sum, over the whole fallback chain, of input tokens × input price + output cap × output price),
refuses the call if spent + reserved + ceiling would pass `dailyBudgetCents`, and afterwards settles to the real
cost from the reported tokens, at the price of the model that answered, summed over every attempt. If the real
cost passes the ceiling it is still charged and every later call is refused, so the spend can pass the cap only
by that excess. Cents are fractional. The fixed per-call estimate is gone. Details: paw-api design,
"Cost accounting".

## Correctness Properties

These properties are verified with fast-check in `tests/properties.test.ts`. Each is a property-based test that
holds for all valid inputs.

| # | Property | Requirement | Description |
|---|----------|-------------|-------------|
| P1 | Export is always valid EARS | Req 6.2 | For any `Grant` with at least one closed curse, `exportSpec` produces `requirementsMd` where every acceptance criterion matches the EARS pattern `^(WHEN\|IF\|WHILE\|WHERE\|THE SYSTEM SHALL)` — no malformed criteria. |
| P2 | One property per closed curse | Req 6.3 | For any `Grant`, the number of properties in `propertiesMd` equals the number of curses with `status: 'closed'`. Exactly one, never zero, never two. |
| P3 | Schema round-trip | Req 2.5, 4.4 | For any valid `Grant`, `GrantSchema.parse(JSON.parse(JSON.stringify(grant)))` succeeds and is structurally equal to the original. Same for `VerdictSchema` and `SpecExportSchema`. |
| P4 | Integrity is monotonic and bounded | Req 5.1 | For any `Grant`, `computeIntegrity` returns `score` in 0–5, `score === Math.floor((closed / total) * 5)` when total > 0, and `5` when total is 0. Closing more curses never decreases the score. |
| P5 | Finger count equals open curses | Req 2.1, 4.2 | For any `Grant`, the number of fingers curled (open curses) equals `curses.filter(c => c.status === 'open').length`. Closing a curse reduces the count by exactly one. |
| P6 | All curses use taxonomy tags | Req 2.1 | For any `Grant` from `grantWish`, every curse `.type` is one of the 10 tags in `CurseTypeSchema`. No invented tags. |
| P7 | Curse types are unique per grant | Req 2.2 | For any `Grant` from `grantWish`, no two curses share the same `type` (each uses a different type or different stakeholder — verified at minimum by distinct type tags). |
| P8 | Budget never exceeded | Req 7.3 | For any sequence of `canCall` checks, `recordCall` never brings `spentCents` above `dailyBudgetCents`. Once over budget, `canCall` returns `false` for every subsequent call regardless of IP. |
