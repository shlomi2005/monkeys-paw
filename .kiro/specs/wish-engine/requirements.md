# Wish Engine — Requirements

## Introduction

The wish engine is the core feature of The Monkey's Paw. A user submits a wish — a software requirement, optionally
with app context. The Paw grants it literally: a Genie narrates the literal grant in one or two dry sentences, and the
Paw finds 3–5 loopholes, each told as a **curse** — a short, concrete, plausible story of the requirement being
followed to the letter and going wrong. Each curse is tagged with a curse type from the taxonomy and curls one finger
of the paw.

For each open curse the user either rewrites the wish or **binds** a loophole with an EARS clause. The Judge decides
whether the binding really closes the loophole. When it does, the finger opens. When all fingers are open (or the
user stops), the engine computes a **Wish Integrity** score (0–5) and exports a Kiro-ready spec: `requirements.md`
(user story + EARS acceptance criteria) and `properties.md` (one correctness property per closed curse, ready for
property-based tests).

Scope of this spec: the pure logic that lives in `packages/paw-core` — granting, binding, judging, integrity, and
export. The UI/3D scene, the Kiro power (MCP server + hook), and the rate-limit/budget enforcement at the API layer
are separate specs. The curse taxonomy (`curse-taxonomy.md`) and iron rules (`iron-rules.md`) are binding throughout.

---

## Requirements

### Requirement 1: Submit a wish

**User story:** As a spec author, I want to submit a requirement with optional app context so the Paw can find
loopholes in it.

**Acceptance criteria:**

1. **WHEN** the user submits a wish with non-empty text and optional context **THE SYSTEM SHALL** accept it and
   create a `Wish` record containing the text and context.
2. **IF** the wish text is empty or whitespace-only **THE SYSTEM SHALL** reject it and return an in-character error
   message.
3. **IF** the wish concerns harming real people, hate, or gore **THE SYSTEM SHALL** refuse it with a short
   in-character line (iron-rules.md §3).
4. **WHEN** a wish is submitted **THE SYSTEM SHALL NOT** store any identity with it; only short-lived rate-limit
   counters may be retained (iron-rules.md §2).

### Requirement 2: Grant the wish into 3–5 curses

**User story:** As a spec author, I want the Paw to grant my wish literally and produce 3–5 curses so I can see where
my requirement breaks.

**Acceptance criteria:**

1. **WHEN** a wish is granted **THE SYSTEM SHALL** produce a `Grant` containing a Genie narration (1–2 sentences,
   dry comedy-horror) and 3–5 curses, each tagged with a curse type from `curse-taxonomy.md`.
2. **WHILE** generating curses **THE SYSTEM SHALL** ensure each curse is specific to the wish, plausible, different
   from the others in the same grant (different type or different stakeholder), and bindable.
3. **WHEN** a curse is generated **THE SYSTEM SHALL** include a `loophole` field that quotes or points to the exact
   words in the wish that create the loophole.
4. **IF** any curse in the set is generic (not specific to the wish) **THE SYSTEM SHALL** reject it via the Judge and
   request a replacement from the Paw.
5. **IF** the model output fails zod schema validation **THE SYSTEM SHALL** retry the model call once; if it fails
   again **THE SYSTEM SHALL** fall back to a safe default or return an error (iron-rules.md §6).
6. **WHEN** a model call is about to be made **THE SYSTEM SHALL** check the budget first and never call the model
   without a budget check (iron-rules.md §5).

### Requirement 3: Bind a loophole

**User story:** As a spec author, I want to close a loophole by either rewriting the wish or binding an EARS clause
so the Paw stops curling that finger.

**Acceptance criteria:**

1. **WHEN** the user chooses to bind a curse **THE SYSTEM SHALL** accept either a rewrite (new wish text) or an EARS
   clause and create a `Binding` linked to that curse.
2. **IF** the binding text is empty **THE SYSTEM SHALL** reject it.
3. **WHEN** a binding is created **THE SYSTEM SHALL** set the binding's `kind` to `rewrite` or `ears-clause`
   accordingly and record it on the curse.
4. **WHILE** a curse has an open binding awaiting judgement **THE SYSTEM SHALL** keep the curse status `open`.

### Requirement 4: Judge the binding

**User story:** As a spec author, I want the Judge to decide whether my binding really closes the loophole, so only
genuine fixes open the finger.

**Acceptance criteria:**

1. **WHEN** a binding is submitted for a curse **THE SYSTEM SHALL** pass the curse and the binding to the Judge and
   receive a `Verdict` with a `closed` boolean and a `reason` string.
2. **IF** the Judge decides the binding closes the loophole **THE SYSTEM SHALL** set the curse status to `closed` and
   attach the `Verdict` and `Binding` to the curse.
3. **IF** the Judge decides the binding does not close the loophole **THE SYSTEM SHALL** keep the curse status `open`
   and return the Judge's reason to the user ("The paw remembers.").
4. **IF** the Judge output fails zod schema validation **THE SYSTEM SHALL** retry once, then fall back
   (iron-rules.md §6).
5. **WHEN** the Judge is invoked **THE SYSTEM SHALL** emit JSON only — no prose outside the schema.

### Requirement 5: Compute wish integrity (0–5)

**User story:** As a spec author, I want a Wish Integrity score so I can see how airtight my wish has become.

**Acceptance criteria:**

1. **WHEN** the user requests the integrity score (or the paw rests) **THE SYSTEM SHALL** compute an integer 0–5
   where 5 means all curses are closed and 0 means none are.
2. **THE SYSTEM SHALL** compute integrity as the count of closed curses divided by the total curses, scaled to a
   0–5 integer (round down).
3. **WHILE** there are zero curses **THE SYSTEM SHALL** return integrity 5 (nothing to bind).
4. **WHEN** integrity is computed **THE SYSTEM SHALL** include the counts of total, closed, and open curses in the
   result for display.

### Requirement 6: Export the spec

**User story:** As a spec author, I want to export a Kiro-ready spec (`requirements.md` + `properties.md`) so I can
drop it into a `.kiro/specs/` folder and start building.

**Acceptance criteria:**

1. **WHEN** the user requests an export **THE SYSTEM SHALL** produce a `SpecExport` containing `requirementsMd`
   (user story + EARS acceptance criteria) and `propertiesMd` (one correctness property per closed curse).
2. **WHILE** generating `requirements.md` **THE SYSTEM SHALL** include the original wish as the user story and
   convert each closed binding into an EARS acceptance criterion (WHEN/IF/WHILE … THE SYSTEM SHALL …).
3. **WHILE** generating `properties.md` **THE SYSTEM SHALL** produce exactly one property per closed curse, phrased
   as a testable invariant.
4. **IF** no curses are closed **THE SYSTEM SHALL** still produce valid (possibly empty-criteria) export files; the
   export must never be malformed.
5. **WHEN** the export is produced **THE SYSTEM SHALL** include the current wish integrity score in the `SpecExport`.

### Requirement 7: Enforce rate limit and daily budget

**User story:** As the operator, I want the engine to enforce a per-IP rate limit and a daily model budget so costs
are capped and the service stays up.

**Acceptance criteria:**

1. **WHEN** a model call is requested **THE SYSTEM SHALL** check the per-IP rate limit and reject calls that exceed it
   with an in-character message.
2. **WHEN** a model call is requested **THE SYSTEM SHALL** check the remaining daily budget and, if exhausted, serve
   cached example wishes only (iron-rules.md §5).
3. **IF** the daily budget is exceeded **THE SYSTEM SHALL NOT** call the model under any circumstances.
4. **WHILE** in examples-only mode **THE SYSTEM SHALL** return pre-computed grants for the 25 example wishes without a
   model call.
5. **WHEN** a model call ends **THE SYSTEM SHALL** charge the daily budget its real cost: the tokens the model
   reported, at that model's price, summed over every attempt of the call. A fixed per-call estimate is not
   used anywhere.
6. **WHEN** a model call is requested **THE SYSTEM SHALL** reserve a ceiling for it first (the largest cost the
   call can reach, over its whole fallback chain) and refuse the call if the spend plus the reservations plus
   that ceiling would pass the daily budget, so parallel calls cannot pass the budget.
7. **IF** the real cost of a call turns out to be above its ceiling **THE SYSTEM SHALL** still charge it, and
   refuse every later call. The daily spend can pass the budget only by that excess.
