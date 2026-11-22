# Paw Power — Design

## Overview

The Paw gets a second front door: Kiro. It runs on the user's own Kiro agent, with the user's own model and credits, so
it costs us nothing however many people use it (D14, D15). Five parts, all thin:

1. **`packages/paw-core`** gains the Paw's and the Judge's rule sections as named constants (`prompts.ts`), a one-line
   EARS format description (`ears.ts`) and the exports the server needs. Every prompt it builds stays byte-identical.
2. **`packages/paw-mcp`**: a stdio MCP server with two modes.
   - **Local mode (the default).** Three pure tools. `paw_rules` hands the agent the rules of the Paw or the Judge, built
     from `paw-core`. `paw_check_curses` and `paw_check_verdict` check what the agent wrote and normalise it. No network,
     no model, no state.
   - **Remote mode** (`PAW_API_URL` is a usable URL). The three local tools plus `paw_curse` and `paw_bind`, which call
     the existing Paw API over HTTP, validate every answer with the `paw-core` schemas, and keep recent grants in memory
     so `paw_bind` can send the whole grant. This is the old behaviour, unchanged.
3. **`powers/monkeys-paw/`**: an Agent Plugins 1.0.0 folder that installs the server (as a committed single-file bundle)
   and three skills (taxonomy, a review workflow, the hook installer).
4. **This repo's Kiro wiring**: `.kiro/settings/mcp.json`, three hooks, two guard scripts, five agents, `tone.md`.
5. **Format tests** that keep every JSON file, copy and bundle honest, since nobody can run hooks or agents headless.

No model is called by this code and no key exists in it. In local mode the model is the user's Kiro agent. In remote
mode it sits behind a Paw API that the user runs, and the API's `{message}` errors pass through as tool errors.

### Decisions and deviations

| # | Decision | Why |
|---|----------|-----|
| D1 | Tool names are `paw_curse` and `paw_bind`, not `paw.curse` and `paw.bind` (tech.md). Task 6 updates tech.md. | Dots are not valid tool names in every MCP client. Kiro reports tool ids as `mcp_<server>_<tool>`. |
| D2 | The power ships the taxonomy and the hook as **skills**. The hook skill's `references/` holds the hook JSON, and its steps copy it into the user's `.kiro/hooks/`. | The Agent Plugins format has no steering or hook component. |
| D3 | The server is committed as one bundle, `powers/monkeys-paw/server/paw-mcp.mjs`. A test rebuilds it in memory and compares. | Install from a folder or a repository URL runs no `npm install`. The cost is a generated file in git, kept honest by the test. |
| D4 | The default base URL is the placeholder `https://paw-api.invalid`. **Replaced by D14:** local mode is the default and no call uses the placeholder any more. | The deploy is an open decision. `.invalid` never resolves, so a missing setting gave a clear "cannot reach" error. |
| D5 | `paw_bind` takes a **handle** (`<wishId[0..8]>:<curse id>`), and also a bare id for the newest grant. | The brief says the tool takes the curse id. Ids are `curse-0` to `curse-4` in every grant (`paw-core/src/grant.ts`), so a bare id is ambiguous across grants. |
| D6 | The bind request body is built in `paw-mcp` from `paw-core` types. | `BindRequestSchema` lives in `apps/api`, which `paw-mcp` must not import. A test pins the body shape. |
| D7 | The hook prompt says "the tool `paw_rules`" (and `paw_check_curses`) and names no server. (Was `paw_curse` before D14.) | The same file then works in this repo (server `monkeys-paw`) and in an installed power (Kiro renames the server to `power-monkeys-paw-paw`). |
| D8 | Assumption: the pinned SDK returns input-validation failures as `isError` results. Task 2 checks this. If it throws a protocol error instead, the shape is registered without `.max()`, the limits go in the `.describe()` text, and the handler re-validates with the strict schema. | Req 6.1 wants a tool result, never a protocol error. |
|    | **D8 outcome (task 2):** SDK 1.32.2 turns an input-schema failure into an `isError` result (`MCP error -32602: Input validation error: Invalid arguments for tool <name>: <zod message> at <field>`), so the strict shapes with `.max()` are kept and D8's fallback is not needed. The zod messages are custom (`requirement must be at most 500 characters`), so the text names the field and the limit. | Checked by `tests/tools.test.ts`. |
| D9 | Hooks fire only for saves made by the agent, in the IDE and CLI V3. The review hook (a) costs an agent loop per save; since D14 it makes no API call (D23). | Kiro's documented behaviour. The README says so, and each hook has `enabled` that users can flip. |
| D10 | `qa` and `legal` cannot be made fully read-only for shell. `qa` has `shell`. Kiro matches `shell` rules as glob patterns on the whole command, so exact strings without `*` would allow almost nothing, and `cd x && ...` would match nothing. `qa` therefore runs every package command as `pnpm -C <package dir> <script or vitest run>`, and its rules are globs: allow the `pnpm` forms, deny `fs_write` on `**` and `shell` on `git push*`, `git commit*`, `rm *` and `*>*` (deny always wins). `legal` has no `shell`. | A shell can redirect output into a file. The prompt forbids it, and the reviewer checks the rules (task 7). |
| D11 | Guard scripts live in root `scripts/` (like `scripts/copy-paw-assets.mjs` in paw-web). Each exports a pure decision function. | The decision can be unit-tested without spawning pnpm or Playwright. |
| D12 | For TypeScript and Vitest, `paw-mcp` resolves `paw-core` the same way `apps/api` does. Task 1 reads `apps/api`'s config and copies the approach. D12 does not apply to the bundle: esbuild aliases `paw-core` to `packages/paw-core/src/index.ts` (see "The bundle"). | `paw-core` exports `dist/`. Do not invent a second way for the type checker and tests. `packages/paw-core/dist/` is gitignored, so a fresh clone has none, and a stale local one must not change the committed bundle or the freshness test. |
| D13 | The SDK, `zod` and `esbuild` versions are pinned in task 1 to what pnpm resolves, and `zod` is the one `paw-core` resolves. | Schemas from `paw-core` must be parsed by the same `zod` instance the SDK reads. |
| D14 | **Local mode is the default.** Remote mode is opt-in: it is on only when `PAW_API_URL` is a usable `http(s)` URL without credentials. Remote mode behaves exactly as before. | Owner decision, 20.11: the product that stays after the hackathon is the power, and it must cost us nothing. `paw_curse` and `paw_bind` called our API, and the API calls Gemini on our money. |
| D15 | In local mode the model is the user's own Kiro agent. The server only supplies rules (`paw_rules`) and checks the agent's output by rule (`paw_check_curses`, `paw_check_verdict`). It calls no model and no network API. | A hook with `"action": {"type": "agent"}` runs its prompt through Kiro's own agent in the user's IDE. Checks are plain code: free, instant, testable offline. |
| D16 | `tools/list` differs by mode. Local: `paw_rules`, `paw_check_curses`, `paw_check_verdict`. Remote: those three plus `paw_curse`, `paw_bind`. Remote-only tools are not registered in local mode. Every name matches `^[a-zA-Z0-9_-]{1,64}$`. | Kiro never sees a tool that would fail. No dots (D1). |
| D17 | **One source of truth for the rules.** `paw-core` exports its rule sections as named constants; `buildPawPrompt` and `buildJudgePrompt` (verdict mode) are composed from them; `paw_rules` returns them. Prompt output stays byte-identical, proved by a frozen fixture that is written before the refactor. A drift test in `paw-mcp` ties `paw_rules` to the prompts. No prompt wording changes, so the golden-wish eval need not run. | Two copies of the rules would drift. Each constant is a plain string with no interpolation and is a contiguous piece of the prompt, so "appears verbatim in the prompt" is a testable claim. The constants live in `prompts.ts`, which already exports five builders, so structure.md's one-export-per-file rule is not stretched further than it already is. |
| D18 | The check tools accept a value or a JSON string, ignore extra keys, assign the ids (`curse-0`...) and `judgedAt` themselves, and return the normalised data. Their input schemas take `unknown` items, so every problem is reported by the handler with its path (`curses[2].type must be one of: ...`). | Some clients send nested arguments as strings. The model never supplies ids or timestamps (paw-core: `grantWish` assigns ids, `judgeBinding` injects `curseId` and `judgedAt`). The SDK would turn a schema failure into a result too (D8), but its text would not name the path. |
| D19 | The checks test form, not truth. In local mode the Judge is the user's own agent judging the user's own clause, so the `bind` rules and the skill say it must be strict, and a verdict that passes the check can still be wrong. | Honest limit. The README and the skill say it. Remote mode keeps the API's separate Judge. |
| D20 | An unexpanded `${...}` counts as "not set": local mode, no warning. A value that is set but unusable (unparseable, not `http(s)`, or with credentials) gives local mode and one stderr line that says it was ignored, without printing the value. | Reading of the brief. An unset variable reaches the server as an empty string or as the literal `${PAW_API_URL}` from `mcp.json`, so that is what most users have. A warning on it would be noise on every start. |
| D21 | Version `0.2.0` in `version.ts` and `plugin.json`. | The tool contract changed: three tools are new, and in local mode two are gone. |
| D22 | `zod-to-json-schema` is a direct dependency of `paw-mcp`, pinned `3.25.2` (the version the SDK resolves), installed with `pnpm --offline`. | It is already in the lockfile, the bundle and `NOTICE.md`, so no new package enters the bundle. The JSON Schemas in `paw_rules` are made from `paw-core`'s schemas, so they cannot drift. |
| D23 | The review hook costs one agent loop per save, on the user's credits, and makes no API call: at most 1 `paw_rules` and 6 `paw_check_curses` calls (3 requirements, one retry each). | Replaces "up to 3 API calls per save" of D9. The skill and the README say it plainly. |
| D24 | Local calls log `<tool> <ok or invalid> <ms>ms` to stderr and nothing else. The logger takes `(tool, outcome, ms)` only, where `outcome` is an HTTP status in remote mode and `ok` or `invalid` in local mode. | A requirement, a curse or a verdict cannot be passed to it by mistake (Req 7.3). |
| D25 | Remote mode reads `PAW_I_AM_18_OR_OLDER` once at start; exactly `yes` adds `X-Paw-Adult-Confirmed: yes` to `paw_curse` and `paw_bind`, nothing else changes the header. It is never a tool argument, so an agent cannot confirm for the user. A 403 with `live_region_unavailable` or `adult_confirmation_required` gets a fixed text in `paw-mcp`. `mcp.json` (both files) does not change. | Google's terms bar the free tier for people under 18 and outside listed regions (paw-api Requirement 14). The confirmation must come from the person, not the agent. The host decides whether the variable reaches the server; the README tells the user to set it where Kiro starts the server. The text is not legal advice and not proof of age. |

---

## Architecture

```
packages/paw-core/
├── src/
│   ├── prompts.ts            # + rule sections as named constants (see "Rule sections"); builders composed from them
│   ├── ears.ts               # + EARS_CLAUSE_FORMAT, next to the regexes of isEarsCriterion
│   └── index.ts              # + exports isEarsCriterion, EARS_CLAUSE_FORMAT and the rule constants
└── tests/
    ├── prompts-frozen.test.ts        # every builder, fixed inputs, toBe against the fixture
    └── fixtures/prompts.frozen.json  # written from the code as it was BEFORE the refactor
packages/paw-mcp/
├── package.json              # name paw-mcp, private, type module, bin-less; scripts: build, bundle, test, typecheck
├── tsconfig.json
├── scripts/build-bundle.mjs  # esbuild → powers/monkeys-paw/server/paw-mcp.mjs, and NOTICE.md data
├── src/
│   ├── index.ts              # entry: resolveMode(env) + stderr lines + createPawServer(...) + StdioServerTransport; the only file with side effects
│   ├── server.ts             # createPawServer(options) → McpServer: tools by mode, instructions
│   ├── version.ts            # PAW_MCP_VERSION = '0.2.0' (must equal plugin.json)
│   ├── mode.ts               # resolveMode(raw) → { mode, ignored }, originOf(url). Replaces base-url.ts
│   ├── instructions.ts       # LOCAL_INSTRUCTIONS, REMOTE_INSTRUCTIONS
│   ├── json-arg.ts           # parseJsonArg(value, path): a value, or a JSON string of one
│   ├── rules.ts              # buildRules(kind) → { text, sections, jsonSchema, next } from paw-core exports
│   ├── check-curses.ts       # checkCurses(requirement, curses) → ok + curses + warnings, or problems[]   (pure)
│   ├── check-verdict.ts      # checkVerdict({ curse, amendment, kind, verdict }, now) → ok + verdict + binding, or problems[]   (pure)
│   ├── tool-rules.ts         # inputShape, outputShape, handleRules
│   ├── tool-check-curses.ts  # inputShape, outputShape, handleCheckCurses
│   ├── tool-check-verdict.ts # inputShape, outputShape, handleCheckVerdict
│   ├── api-client.ts         # remote only: postJson(path, body, schema) → Result; the error table
│   ├── grant-memory.ts       # remote only: createGrantMemory(max = 20): remember, resolve, openHandles
│   ├── handle.ts             # remote only: toHandle(wishId, curseId), parseHandle(text)
│   ├── tool-curse.ts         # remote only: inputShape, outputShape, handleCurse
│   ├── tool-bind.ts          # remote only: inputShape, outputShape, handleBind
│   └── render.ts             # renderCurses(...), renderVerdict(...), renderLocalVerdict(...) → plain text
└── tests/                    # see Testing strategy
scripts/golden-wish-eval.mjs  # hook (b) guard
scripts/ui-screenshot-receipt.mjs  # hook (c) guard
powers/monkeys-paw/           # see Power layout
.kiro/{settings/mcp.json, hooks/*.json, agents/*.json, steering/tone.md}
```

`index.ts` reads `process.env.PAW_API_URL` once and calls `resolveMode`. It writes one stderr line (`paw-mcp 0.2.0
mode=local`, or `paw-mcp 0.2.0 mode=remote api=<origin>`), then, if the value was set but unusable, one more line that
says it was ignored (never the value), and connects the stdio transport. Everything else is a pure module, so tests
build the server with a mode, a stub `fetchFn` or a stub URL. Nothing is written to stdout except by the transport.

`createPawServer(options)` takes `{ mode: 'local' | 'remote', baseUrl?, fetchFn?, timeoutMs?, log?, now? }`. In remote
mode `baseUrl` is required. In local mode the server does not call `createApiClient` and does not create the grant
memory; `fetchFn` and `baseUrl` are accepted and ignored, so a test can pass a failing stub and prove it is never
called. `now` (default `Date.now`) is the clock for `judgedAt`. `log` is `(tool, outcome, ms)`.

### Rule sections (paw-core)

The constants are plain strings, with no `${}` interpolation. Each one is a contiguous piece of the prompt it belongs to,
so the builders use it and the drift test can look for it verbatim. Proposed names (task 9 may adjust them, but the
set of sections stays):

| Constant | File | What it is | Used by |
|----------|------|------------|---------|
| `PAW_ROLE` | prompts.ts | "You are the Paw, an adversary ... go wrong." | `buildPawPrompt` |
| `CURSE_RULES` | prompts.ts | "Produce 3 to 5 curses ..." and the four MUST bullets | `buildPawPrompt` |
| `CURSE_TAXONOMY` | prompts.ts | "Curse taxonomy (...)" and the ten tag lines | `buildPawPrompt` |
| `GUARDRAILS` | prompts.ts | "Guardrails (iron rules): PG-13 only ..." | `buildPawPrompt` |
| `CURSES_JSON_SHAPE` | prompts.ts | the `"curses": [ { type, story, loophole } ]` block of the JSON shape | `buildPawPrompt` |
| `CURSES_ARRAY_RULE` | prompts.ts | "The "curses" array MUST contain between 3 and 5 items ... Do not include ids" | `buildPawPrompt` |
| `JUDGE_ROLE` | prompts.ts | "You are the Judge. Decide whether the proposed binding really CLOSES ... strict ..." | `buildJudgePrompt` (verdict) |
| `VERDICT_JSON_SHAPE` | prompts.ts | the `{ closed, reason, property }` block | `buildJudgePrompt` (verdict) |
| `VERDICT_RULES` | prompts.ts | "Set "closed" to true only if ..." to "Emit JSON only" | `buildJudgePrompt` (verdict) |
| `EARS_CLAUSE_FORMAT` | ears.ts | one line: a clause starts with WHEN, IF, WHILE, WHERE or THE SYSTEM SHALL and contains SHALL | `paw_rules` (bind), `paw_check_verdict` errors |

The curse JSON shape is split so that the local flow gets only the `curses` part: the full prompt shape also has
`narration`, `userStory` and `wishCriterion`, which the Genie fills and the local flow does not need. The prompt is
`header + CURSES_JSON_SHAPE + footer`, where header and footer stay inline in the builder and the resulting text is
unchanged.

**Frozen fixture.** Task 9 first writes `tests/fixtures/prompts.frozen.json` by running the current builders, then
refactors. The fixture holds the exact output of every builder for fixed inputs: `buildPawPrompt`, `buildGeniePrompt`
(each with and without context), `buildBatchQualityPrompt`, `buildJudgePrompt` (verdict with a binding, verdict
without, quality) and `buildReplacementPrompt`. `prompts-frozen.test.ts` compares with `toBe`. It is a plain JSON file,
not a Vitest snapshot, so `vitest -u` cannot rewrite it.

---

## Tool contracts

Every tool is registered with `McpServer.registerTool(name, { description, inputSchema, outputSchema }, handler)`. The
input shapes are zod raw shapes. Handlers re-parse with the strict schema and never throw. Local mode registers the
three local tools. Remote mode registers them and also `paw_curse` and `paw_bind`. Every name matches
`^[a-zA-Z0-9_-]{1,64}$`.

The server is created with `new McpServer({ name: 'paw', version }, { instructions })`. The instructions differ by mode:

- Local: "Local mode. To find loopholes: call paw_rules with kind curse, write 3 to 5 curses yourself, call
  paw_check_curses with the requirement and the curses, and fix what it reports once. To judge an amendment: call
  paw_rules with kind bind, judge it yourself and strictly, call paw_check_verdict, and fix what it reports once. These
  tools call no model and no server."
- Remote: the same text, then: "paw_curse and paw_bind call the Paw API at the origin in PAW_API_URL."

### `paw_rules` (both modes)

```ts
inputShape  = { kind: z.enum(['curse', 'bind']) };
outputShape = {
  kind: z.enum(['curse', 'bind']),
  sections: z.array(z.object({ name: z.string(), text: z.string() })),   // the rule sections, in prompt order
  jsonSchema: z.record(z.unknown()),                                     // the JSON Schema below
  next: z.string(),                                                      // the footer
};
```

Built only from `paw-core` exports, plus the footer (the only text written in `paw-mcp`). No network, no state.

- `curse`: sections `PAW_ROLE`, `CURSE_RULES`, `CURSE_TAXONOMY`, `GUARDRAILS`, `CURSES_JSON_SHAPE`, `CURSES_ARRAY_RULE`,
  in the order of the prompt (the shape says "one of the tags above", so the taxonomy comes first). The JSON Schema is
  of the `curses` array: `z.array(CurseSchema.pick({ type: true, story: true, loophole: true }))` with `.min` and `.max`
  read from `GrantSchema.shape.curses._def` (`minLength.value` 3, `maxLength.value` 5), converted with
  `zodToJsonSchema(schema, { $refStrategy: 'none' })`. Footer: "Write the curses yourself, following these rules.
  Include no ids; the system assigns them. Then call paw_check_curses with the requirement and your curses, and fix what
  it reports once."
- `bind`: sections `JUDGE_ROLE`, `VERDICT_JSON_SHAPE`, `VERDICT_RULES`, then `EARS_CLAUSE_FORMAT` as "The amendment must
  follow the EARS clause format: ...". The JSON Schema is of `VerdictSchema.pick({ closed: true, reason: true,
  property: true })`. Footer: "Judge the amendment yourself, strictly: if in doubt, closed is false. Then call
  paw_check_verdict with the curse, the amendment, its kind and your verdict, and fix what it reports once."

The text is the sections joined by blank lines, then `JSON Schema:` and the schema as indented JSON, then the footer.
`structuredContent` carries the same parts.

### `paw_check_curses` (both modes)

```ts
inputShape = {
  requirement: z.string().trim().min(1).max(500),            // as paw_curse
  curses: z.union([z.array(z.unknown()), z.string()]),        // an array, or a JSON string of one
};
outputShape = {
  curses: z.array(z.object({
    id: z.string(), type: CurseTypeSchema, status: z.literal('open'), story: z.string(), loophole: z.string(),
  })),
  warnings: z.array(z.string()),
};
```

`checkCurses(requirement, curses)` runs these checks, in order. Every failure is one line that names the path:

1. `curses` is an array, or a string that parses to one: `curses must be an array, or a JSON string of an array.`
2. 3 to 5 items (the limits of `GrantSchema.shape.curses`): `curses must have 3 to 5 items (got <n>).`
3. For each item `i`: it is an object (`curses[<i>] must be an object.`); `type` parses with `CurseTypeSchema`
   (`curses[<i>].type must be one of: permissions, time, ...`); `story` and `loophole` are strings that are not empty
   after trim (`curses[<i>].story must not be empty.`); `story` is at most 360 characters (the `CurseSchema` limit) and
   `loophole` at most 1000 (the API's bind cap), each with its limit in the line. The item, with the system's id
   `curse-<i>` and status `open`, then parses with `CurseSchema`, as a last guard.
4. All types are distinct: `curses[<j>].type repeats "<type>" (curses[<i>] has it); every curse needs its own type.`

Keys other than `type`, `story` and `loophole` are ignored, so a client that sends `id` or `status` is not an error and
cannot choose an id. The check collects every problem, so one call reports them all.

- Failure: `isError: true`, text `The curses do not pass yet:` and then the problems, one per line, at most 10 (an 11th
  and later are dropped). No `structuredContent`.
- Success: the strings trimmed, ids `curse-0` to `curse-<n-1>`, `status: 'open'`, in the text (one line per curse, like
  `paw_curse`'s) and in `structuredContent`. Then the warnings: for a loophole that shares no word of 4 or more letters
  with the requirement (a word is a run of `\p{L}`; compared lowercased), `curse-<i>: the loophole does not quote the
  requirement; point to its exact words.` A warning is not an error and does not change `isError`.

### `paw_check_verdict` (both modes)

```ts
inputShape = {
  curse: z.union([z.record(z.unknown()), z.string()]),       // as paw_check_curses returns it, or a JSON string of one
  amendment: z.string().trim().min(1).max(500),               // as paw_bind
  kind: BindingKindSchema.default('ears-clause'),
  verdict: z.union([z.record(z.unknown()), z.string()]),     // { closed, reason, property? }, or a JSON string of one
};
outputShape = {
  verdict: z.object({ curseId: z.string(), closed: z.boolean(), reason: z.string(),
                      property: z.string().optional(), judgedAt: z.number() }),
  binding: z.object({ curseId: z.string(), kind: BindingKindSchema, clause: z.string(), proposedAt: z.number() }),
};
```

`checkVerdict(input, now)` runs these checks and collects every problem, one line each, with its path:

1. `curse` is an object or a JSON string of one. `id` is optional and defaults to `curse-0`; `status` defaults to `open`.
   The result parses with `CurseSchema` (paths such as `curse.type must be one of: ...`).
2. `kind` is `ears-clause` or `rewrite`. When it is `ears-clause`, `isEarsCriterion(amendment)` must hold: `amendment must
   start with WHEN, IF, WHILE, WHERE or THE SYSTEM SHALL and contain SHALL.`
3. `verdict` is an object or a JSON string of one. `closed` is a boolean; `reason` is a string that is not empty after
   trim. When `closed` is true, `property` is required, starts with `For any` and has at most 40 words (split on
   whitespace): `verdict.property must start with "For any".`, `verdict.property must be at most 40 words (got <n>).`
   When `closed` is false, `property` is dropped. The system then injects `curseId` (the curse's id) and `judgedAt`
   (`now()`) and the object must parse with `VerdictSchema`, as `judgeBinding` does.

Failure: `isError: true`, every problem one per line (at most 10), as in `paw_check_curses`. Success: the binding comes
from `proposeBinding(curse, amendment, kind)` (its `proposedAt` is `Date.now()`, so a test asserts the type, or uses fake
timers). The text has `paw_bind`'s form, with no "Still open" line because nothing is stored:

```
CLOSED: <reason>
Property: <property>
```
or `OPEN: <reason> The loophole remains. Rewrite the amendment, judge it again, and call paw_check_verdict again.` An
open verdict is not an error. Neither the verdict nor the binding is stored anywhere.

## Remote tools

Registered only in remote mode. They behave as in the first version of this spec.

### `paw_curse`

```ts
inputShape = {
  requirement: z.string().trim().min(1).max(500),
  context: z.string().trim().max(200).optional(),   // '' after trim is treated as absent
};
outputShape = {
  wishId: z.string(),
  narration: z.string(),
  curses: z.array(z.object({
    handle: z.string(), id: z.string(), type: CurseTypeSchema,
    status: z.enum(['open', 'closed']), story: z.string(), loophole: z.string(),
  })),
};
```

Request: `POST {base}/api/grant` with `{"wish": {"text": requirement, "context"?: context}}`. Response schema:
`GrantResponseSchema`. On success the grant is remembered, and the text is:

```
The paw grants it. 4 loopholes:
[3f2a9c1e:curse-0] permissions: The owner quits. Nobody may delete the project, ever.
  Loophole: "Only the owner" names no successor.
...
Close one: paw_bind(curse="3f2a9c1e:curse-0", amendment="WHEN the owner leaves, THE SYSTEM SHALL ...")
```

### `paw_bind`

```ts
inputShape = {
  curse: z.string().trim().min(1).max(100),          // a handle, or a bare id for the newest grant
  amendment: z.string().trim().min(1).max(500),
  kind: BindingKindSchema.default('ears-clause'),    // 'ears-clause' | 'rewrite'
};
outputShape = {
  handle: z.string(), closed: z.boolean(), reason: z.string(),
  property: z.string().optional(), openHandles: z.array(z.string()),
};
```

Steps: resolve the grant and curse in the memory (unknown: error, no call); `POST {base}/api/bind` with
`{"grant": <whole stored grant>, "curseId": <curse.id>, "kind": kind, "clause": amendment}`; parse with
`BindResponseSchema`; store `response.grant` (same `wishId`, now newest). Text:

```
CLOSED: <reason>
Property: <property>            (only when the verdict has one)
Still open: [3f2a9c1e:curse-1], [3f2a9c1e:curse-3]
```
or `OPEN: <reason> The loophole remains. Rewrite the amendment and call paw_bind again.` An open verdict has
`isError` unset. The API's own fallback verdict (`closed: false`, "The Judge could not be roused...") is passed through.

---

## Mode and API client

### Mode resolution

`resolveMode(raw: string | undefined)` returns `{ mode, ignored }`, where `mode` is `{ kind: 'local' }` or
`{ kind: 'remote', baseUrl }` and `ignored` is true when the value was set but unusable. `index.ts` calls it once at
start-up and never again. It uses today's `resolveBaseUrl` rules, trailing slashes stripped; there is no placeholder
URL any more (`PLACEHOLDER_API_URL` is deleted, and no call can use it).

| `PAW_API_URL` | Mode | `ignored` (extra stderr line) |
|---------------|------|-------------------------------|
| unset | local | no |
| `''`, only whitespace | local | no |
| contains `${` (unexpanded placeholder) | local | no |
| not parseable (`not a url`), or protocol not `http:` or `https:` (`ftp://x`, `file:///x`) | local | yes |
| has `username` or `password` (`https://u:p@host`) | local | yes |
| `http://127.0.0.1:8787///` | remote, base `http://127.0.0.1:8787` | no |
| `  https://paw.example/  ` | remote, base `https://paw.example` | no |

The ignored line is fixed text and never contains the value: `paw-mcp <version> ignored PAW_API_URL: not a usable http(s)
URL without credentials; using local mode`.

### API client (remote mode only)

`postJson(path, body, schema)` uses `fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json',
accept: 'application/json', ...adultHeader }, body, signal: AbortSignal.timeout(30_000), redirect: 'error' })`. `adultHeader` is `{ 'x-paw-adult-confirmed': 'yes' }` when `PAW_I_AM_18_OR_OLDER` was exactly `yes` at start-up (read once, with `PAW_API_URL`, in `index.ts`), else empty; only `paw_curse` and `paw_bind` use `postJson`. No other header, no
cookie, no credentials. The client is created only in remote mode.

Errors (every row is `isError: true`, one sentence; `<origin>` is `URL.origin`):

| Condition | Text |
|-----------|------|
| Input breaks a limit | `Invalid input: <field> <rule>.` (for example `requirement must be at most 500 characters.`) |
| `paw_bind`: curse not in memory | `Unknown curse "<first 60 chars>". Call paw_curse first; handles last only while this server runs.` |
| 403 with JSON `{code: 'live_region_unavailable'}` | `The paw grants no live wishes from here. The three local tools still work: paw_rules, paw_check_curses and paw_check_verdict.` |
| 403 with JSON `{code: 'adult_confirmation_required'}` | `The Paw API grants live wishes only to people who confirm they are 18 or older. Only the user can confirm: ask them to set PAW_I_AM_18_OR_OLDER=yes in the server's environment themselves and restart it. Do not set it for them.` |
| Non-2xx with JSON `{message}` (400, 404, 500, 503, any other 403) | the `message`, unchanged |
| Non-2xx otherwise | `The Paw API answered HTTP <status>.` |
| `fetch` rejects, timeout, redirect | `Cannot reach the Paw API at <origin>; set PAW_API_URL.` |
| 2xx, body not JSON or fails the schema | `The Paw API answered in a shape this tool does not understand.` |
| Any other thrown error | `The Paw tool failed unexpectedly.` (the error is not logged with its message) |

Logging (stderr only). Start-up: `paw-mcp 0.2.0 mode=local`, or `paw-mcp 0.2.0 mode=remote api=<origin>`. Per call:
`paw_curse 200 412ms` in remote mode, and `paw_check_curses ok 3ms` or `paw_check_curses invalid 2ms` in local mode (`invalid`
means the tool returned an error result). The logger takes `(tool, outcome, ms)` only, so a requirement, a curse, an
amendment or a verdict cannot be passed to it by mistake. A call that the SDK rejects before the handler runs (a missing
field) is not logged.

Local tools have their own errors, all `isError: true` with the lines of "Tool contracts" (`The curses do not pass
yet:` and the problems; for `paw_check_verdict` the same lines under `The verdict does not pass yet:`). A thrown error
in a local handler becomes `The Paw tool failed unexpectedly.` as above.

---

## Grant memory (remote mode only)

`createGrantMemory(max = 20)` wraps a `Map<wishId, Grant>`. `remember(grant)` deletes then sets the key (so it becomes
the newest) and evicts the oldest while `size > max`. `resolve(text)`: if `parseHandle(text)` yields a prefix and a curse
id, scan grants newest first for `wishId.startsWith(prefix)` that hold the curse; otherwise treat `text` as a bare id and
look in the newest grant only. It returns `{ grant, curse, handle }` or `null`. `openHandles(grant)` lists open curses.
The memory holds no timers and writes nothing. The handle prefix is the first 8 characters of `wishId`. Local mode
creates no memory: the local tools keep nothing between calls.

---

## The bundle

`scripts/build-bundle.mjs` calls esbuild's API: entry `src/index.ts`, `bundle`, `platform: 'node'`, `target: 'node22'`,
`format: 'esm'`, `minify: false` (see the size rule below), `legalComments: 'none'`, a banner that defines `require` through
`createRequire(import.meta.url)` (some SDK dependencies are CommonJS), `metafile: true`, and an alias that sends
`paw-core` to `packages/paw-core/src/index.ts`, the committed source, never to `dist/` (D12 covers TypeScript and
Vitest only). Output: `powers/monkeys-paw/server/paw-mcp.mjs`. The script lists the third-party
packages from the metafile, reads each `package.json` for version, licence and author, and prints the data that
`NOTICE.md` is written from (the task writes the file by hand from that list, once; a test checks that every bundled
package name appears in it). The test `bundle-fresh.test.ts` runs the same esbuild call, with the same alias, with `write: false` and compares
bytes to the committed file, so it depends on nothing outside git. Size rule: if the unminified bundle is over 1 MB,
the script and the test use `minify: true`. When task 3 is done, the final size and the `minify` value are recorded
here: **770,678 bytes, `minify: false`** (task 3, esbuild 0.28.2 pinned exactly, eight third-party packages; the script is
`packages/paw-mcp/scripts/build-bundle.mjs`, run with `pnpm bundle`, and the test imports its `bundleOptions()`). The SDK is imported only through `server/mcp.js` and `server/stdio.js`, which keeps
HTTP and SSE transports out of the bundle.

Version 0.2.0 changes the sources, so the bundle is rebuilt (task 11) and the size is recorded here again. The sources add
`paw-core` prompt constants, `zod-to-json-schema` (already bundled through the SDK, so `NOTICE.md` keeps its eight
packages) and the new tools. Every task that changes `packages/paw-mcp/src` or `packages/paw-core/src` ends with
`pnpm -C packages/paw-mcp bundle`, so `bundle-fresh.test.ts` stays green.

**Version 0.2.0 (task 11): 793,239 bytes, `minify: false`** (under 1 MB, so the size rule keeps it unminified; still
eight third-party packages, `NOTICE.md` unchanged; esbuild 0.28.2).

**After the instructions fix (task 12): 793,432 bytes, `minify: false`** (the local and remote instruction texts now
share one flow constant and start with "Local mode." and "Remote mode."; same eight packages).

---

## Power layout

```
powers/monkeys-paw/
├── plugin.json
├── mcp.json
├── README.md
├── server/
│   ├── paw-mcp.mjs           # committed bundle
│   └── NOTICE.md
└── skills/
    ├── curse-taxonomy/SKILL.md
    ├── curse-a-spec/SKILL.md
    └── spec-loophole-hook/
        ├── SKILL.md
        └── references/paw-reviews-requirements.json
```

`plugin.json`:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "monkeys-paw",
  "version": "0.2.0",
  "description": "Find the loopholes in a software requirement and test your fix: the Paw runs on your own Kiro agent, with your own model and credits, and sends nothing to any server of ours.",
  "author": { "name": "Shlomicom" },
  "keywords": ["requirements", "specs", "loopholes", "EARS", "acceptance criteria", "monkey's paw", "spec review"],
  "license": "MIT"
}
```

`mcp.json`:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "paw": {
      "type": "stdio",
      "command": "node",
      "args": ["${PLUGIN_ROOT}/server/paw-mcp.mjs"],
      "env": { "PAW_API_URL": "${PAW_API_URL}" }
    }
  }
}
```

`PAW_API_URL` stays in both `mcp.json` files, so that setting it switches on remote mode. Unset (or the literal
`${PAW_API_URL}`) means local mode.

`README.md` says, in this order and in plain words: (1) the power runs on your own Kiro agent, with your own model and
credits; (2) it sends nothing to any server of ours; (3) install; (4) the three local tools, with one example call
each; (5) `PAW_API_URL` is optional: setting it switches on remote mode, with `paw_curse` and `paw_bind` against a Paw
API you run; (6) the skills; (7) the fine print: file hooks fire only for agent saves, one review costs one agent loop of
your credits, nothing is stored, the Judge in local mode is your own agent, so it must be strict.

Skills. Each has front matter `name` and `description`, then numbered steps.

- `curse-taxonomy`: front matter, then the exact body of `.kiro/steering/curse-taxonomy.md` (the part after its own
  front matter). The description says when to use it: "Use when classifying or writing a loophole in a requirement."
- `curse-a-spec` (local flow): (1) find `.kiro/specs/<feature>/requirements.md` and read it; (2) pick the requirements
  most likely to hide a loophole; (3) call `paw_rules` with `kind` `curse` and follow it; (4) write the curses yourself
  and call `paw_check_curses` with the requirement (500 characters at most) and the curses; fix them once if the check
  fails; (5) report loopholes by requirement number, type, story; (6) write one EARS clause per loophole; (7) call
  `paw_rules` with `kind` `bind`; (8) judge each clause yourself, strictly, and call `paw_check_verdict`; fix the
  verdict once if the check fails; (9) offer only the clauses that came back `CLOSED`; (10) never edit the spec without
  being asked. It says that the Judge here is your own agent judging your own clause, so it must be strict, and that a
  Paw API is not needed. If a tool errors twice, report its sentence and stop.
- `spec-loophole-hook`: (1) check that `.kiro/hooks/` exists in the user's workspace, create it if not; (2) if
  `.kiro/hooks/paw-reviews-requirements.json` exists, stop and say so; (3) copy
  `references/paw-reviews-requirements.json` there; (4) say that the hook runs one agent loop of your own credits on
  each agent save of a `requirements.md`, makes no Paw API call, needs no `PAW_API_URL`, and can be switched off with
  `"enabled": false`.

---

## Hooks

All three are in `.kiro/hooks/`, format `v1`. Matchers are regexes without lookahead, starting `(^|/)` so they match a
relative and an absolute path.

### (a) `paw-reviews-requirements.json`

Uses local mode: the hook's prompt runs on the user's own Kiro agent. At most 1 `paw_rules` call and 6
`paw_check_curses` calls per save (3 requirements, one retry each). It never calls a server of ours.

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "paw-reviews-requirements",
      "description": "After requirements.md is saved by the agent, the Monkey's Paw comments on open loopholes. Runs on your own Kiro agent: one agent loop per save, on your credits. Sends nothing to any server of ours.",
      "trigger": "PostFileSave",
      "matcher": "(^|/)\\.kiro/specs/[^/]+/requirements\\.md$",
      "action": {
        "type": "agent",
        "prompt": "You are the Monkey's Paw. The requirements.md file that triggered this hook was just saved. Read it. Call the tool paw_rules once, with kind \"curse\", and follow the rules it returns. Pick at most 3 requirements that are most likely to hide a loophole. For each one, write the curses yourself, then call the tool paw_check_curses with requirement = the user story and key acceptance criteria of that requirement, condensed to at most 500 characters, and curses = your curses. If the check fails, fix the curses and call paw_check_curses once more. If it fails again, skip that requirement and say so in one line. Then reply with one short comment in the Paw's dry, eerie voice. For each checked loophole list: the requirement number, the curse type, the story, the loophole, and one EARS clause (WHEN/WHILE/IF ... THE SYSTEM SHALL) that would close it. Never edit, create or delete any file. If the paw tools are missing, say so in one line and stop."
      }
    }
  ]
}
```

Assumption for task 8 and task 14: the agent loop knows which file triggered it (Kiro adds the event to the context). The
prompt says "that triggered this hook" for that reason. The hook no longer needs `PAW_API_URL`.

### (b) `golden-wish-eval.json`

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "golden-wish-eval",
      "description": "Runs the 25 golden wishes when the prompts or the curse taxonomy change. Costs about 25 model calls. Skips when apps/api/.env has no GEMINI_API_KEY.",
      "trigger": "PostFileSave",
      "matcher": "(^|/)(packages/paw-core/src/prompts\\.ts|\\.kiro/steering/curse-taxonomy\\.md|powers/monkeys-paw/skills/curse-taxonomy/SKILL\\.md)$",
      "action": { "type": "command", "command": "node scripts/golden-wish-eval.mjs" },
      "timeout": 900
    }
  ]
}
```

`scripts/golden-wish-eval.mjs` exports `decideEval(envText)` → `{ run: false, message } | { run: true }`. `run` is true
when a line matches `^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$` and the value, with surrounding quotes removed, is not empty.
The main part reads `apps/api/.env` (missing file = no key), prints `skipped: no GEMINI_API_KEY in apps/api/.env` or runs
`pnpm --filter @monkeyspaw/api eval` with inherited stdio and exits with its code. It never prints the file or the value.

### (c) `ui-screenshot-receipt.json`

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "ui-screenshot-receipt",
      "description": "Refreshes the @receipt screenshots when a web component or stylesheet changes. Skips until Playwright is set up in apps/web, and passes while no `@receipt` test exists.",
      "trigger": "PostFileSave",
      "matcher": "(^|/)apps/web/src/.+\\.(tsx|css)$",
      "action": { "type": "command", "command": "node scripts/ui-screenshot-receipt.mjs \"{{filePath}}\"" },
      "timeout": 300
    }
  ]
}
```

`scripts/ui-screenshot-receipt.mjs` exports `decideReceipt({ filePath, hasPlaywright })`. Skips when `filePath` matches
`\.(test|spec)\.tsx?$` or contains `/__tests__/`, or when `hasPlaywright` is false (`apps/web/package.json` lists
`@playwright/test` in `dependencies` or `devDependencies`). Otherwise it runs
`pnpm --filter @monkeyspaw/web exec playwright test --grep @receipt --pass-with-no-tests` and exits with its code. The
`--pass-with-no-tests` flag keeps the hook green in the gap between paw-web task 42 (Playwright installed) and task 49
(the `@receipt` tests). The hook command quotes the path, because paths may contain spaces. The file path comes from
`process.argv[2]`.

---

## Agents

All five are read-only: `tools` has no `write`, and `permissions` has `{ "capability": "fs_write", "match": ["**"],
"effect": "deny" }`. All set `includeMcpJson` to `true` only if they use an MCP tool. Kiro tool selectors:
`read`, `shell`, `@monkeys-paw/paw_rules`, `@monkeys-paw/paw_check_curses`, `@monkeys-paw/paw_check_verdict`. The agents use
only the local tools, so they work in local mode and in remote mode. None of them calls `paw_curse` or `paw_bind`.

| Agent | Role | `tools` | `includeMcpJson` | `resources` | Output |
|-------|------|---------|------------------|-------------|--------|
| `paw` | Finds loopholes. Specific, plausible, one stakeholder each, different types. Local flow. | `read`, `@monkeys-paw/paw_rules`, `@monkeys-paw/paw_check_curses` | true | `curse-taxonomy.md`, `tone.md`, `product.md` | Prose in the Paw's voice, one curse per loophole |
| `genie` | Narrates the grant in the Paw's voice. | `read` | false | `tone.md`, `product.md` | Short narration, at most 25 words |
| `judge` | Decides if an amendment closes a loophole, strictly, with the bind rules. Rejects generic curses. | `read`, `@monkeys-paw/paw_rules`, `@monkeys-paw/paw_check_verdict` | true | `curse-taxonomy.md`, `tone.md`, `iron-rules.md` | JSON only: `{"closed", "reason", "property"?}` or `{"specific", "reason"}` |
| `qa` | Veto. Runs tests, typecheck, lint, build. | `read`, `shell` | false | `tech.md`, `structure.md`, `iron-rules.md` | Findings, then `VERDICT: PASS` or `VERDICT: VETO` |
| `legal` | Veto. Checks the iron rules. | `read` | false | `iron-rules.md`, `product.md`, `tone.md` | Findings, then `VERDICT: PASS` or `VERDICT: VETO` |

`paw` and `judge` follow the local flow. Their prompts say (wording may be tightened in task 12, the content may not
change):

- `paw`: "You are the Monkey's Paw. You only read files and call the tools paw_rules and paw_check_curses. You never write,
  edit or delete a file. Follow tone.md for your voice. Take the requirement the user gives you, or read the file they
  name, and keep the requirement you check under 500 characters. Call paw_rules with kind "curse" once and follow its
  rules. Write 3 to 5 curses yourself, each with a type, a story and a loophole, and no ids. Call paw_check_curses with
  the requirement and your curses; if it fails, fix the curses and call it once more; if it fails again, say so in one
  line and stop. Then write one short curse per loophole, at most 2 sentences, and the one clause that would close it.
  Never write a generic curse. If the paw tools are missing, say so in one line and stop."
- `judge`: "You are the Judge of the Monkey's Paw. You only read files and call the tools paw_rules and paw_check_verdict.
  You never write, edit or delete a file. Your whole answer is one JSON object and nothing else. To judge an amendment,
  call paw_rules with kind "bind" once and follow its rules, judge strictly (if in doubt, closed is false), then call
  paw_check_verdict with the curse, the amendment, its kind and your verdict. If the check fails, fix the verdict and
  call it once more; if it fails again, answer {"closed": false, "reason": "The verdict did not pass its check."}.
  Answer with the verdict JSON that the check accepted: closed, reason, and property only when closed is true. To judge a
  curse, answer {"specific": true or false, "reason": "one short sentence"} as before; this mode needs no tool. If the
  paw tools are missing, judge from the text with the same strictness and answer the same JSON."

`resources` entries are `file://.kiro/steering/<file>`. Rules in `permissions` are glob patterns, and deny always wins. Prompts are inline, 5 to 12 lines, and tell the agent its
limits in the first lines. Full example, `qa.json`:

```json
{
  "name": "qa",
  "description": "Veto agent. Runs the test, typecheck, lint and build commands through pnpm and never writes a file.",
  "prompt": "You are QA for The Monkey's Paw, a pnpm workspace. You never write, edit or delete a file, and you never redirect output into a file. Run only pnpm commands, and run every package command as pnpm -C <package dir> followed by vitest run, test, typecheck, lint or build (for example pnpm -C packages/paw-core vitest run); the only other forms allowed are pnpm -r test, pnpm -r typecheck and pnpm -r build. Never chain commands with cd or &&. Never run git commands that change state, never start a dev server or a watcher. Report each command, its exit status and the pass and fail counts you saw. If any command fails, or you could not run it, or a test was skipped without a reason, veto. End with exactly one last line: VERDICT: PASS or VERDICT: VETO, and before it the reasons, one per line.",
  "tools": ["read", "shell"],
  "includeMcpJson": false,
  "resources": [
    "file://.kiro/steering/tech.md",
    "file://.kiro/steering/structure.md",
    "file://.kiro/steering/iron-rules.md"
  ],
  "permissions": {
    "rules": [
      { "capability": "fs_write", "match": ["**"], "effect": "deny" },
      {
        "capability": "shell",
        "match": ["git push*", "git commit*", "rm *", "*>*"],
        "effect": "deny"
      },
      {
        "capability": "shell",
        "match": [
          "pnpm -C * vitest run*", "pnpm -C * test", "pnpm -C * typecheck", "pnpm -C * lint", "pnpm -C * build",
          "pnpm -r test", "pnpm -r typecheck", "pnpm -r build"
        ],
        "effect": "allow"
      }
    ]
  },
  "welcomeMessage": "QA here. I run the checks and I can veto."
}
```

Assumption for task 7: commands that match neither list fall back to Kiro's default (`ask`), and a deny rule beats an allow rule when both match. The `*>*` rule also blocks a harmless command that contains `>`; that is accepted. `kiro-cli agent validate` and
a manual trial confirm it.

---

## Steering `tone.md`

About 40 lines, `inclusion: always` on line 1. Sections: Voice (dry comedy-horror, eerie, elegant, never gory, PG-13, no
real people, witty not cruel); Rules (short sentences, concrete nouns, one joke per line, the Paw never insults the user,
the stakeholder in a curse is a role, not a person); Words to prefer and avoid; Good and bad lines:

- Good: "The owner quits. Nobody may delete the project, ever." Bad: "A catastrophic data governance failure occurs!!"
- Good: "Granted. Exactly." Bad: "Great news, your wish was granted successfully!"
- Good: "The paw remembers." (verdict not closed) Bad: "Your clause is wrong."

It is the source for the `paw`, `genie` and `judge` prompts and for UI copy (paw-web).

---

## Error handling and safety

- The server never reads or writes files, never spawns processes, and has no tool that takes a path.
- Local mode makes no network call and calls no model: the three local tools are pure functions of their input and of
  `paw-core`, and the server does not create the API client. Nothing the user writes leaves the machine except through
  the user's own Kiro agent.
- Local tools keep no state between calls. Their logs hold the tool name, `ok` or `invalid`, and the duration.
- In remote mode a model answer never reaches the user unvalidated: both API answers pass a `paw-core` schema (iron rule 6).
  In local mode the agent's text is untrusted too, and the checks are the schema gate: the skills and agents only
  use curses and verdicts that passed `paw_check_curses` or `paw_check_verdict`.
- In remote mode the API enforces the budget and the per-IP limit (iron rule 5). The server adds no cache and no retry,
  so it cannot bypass them. Local mode has no budget to enforce, because it spends none of ours.
- The bundle contains no key. A format test greps the new files for secret-shaped strings and absolute local paths.

---

## Testing strategy

All in `packages/paw-mcp/tests/`, run with `pnpm vitest run`, no network except `127.0.0.1`. One more test lives in
`paw-core`.

| File | What it checks |
|------|----------------|
| `paw-core/tests/prompts-frozen.test.ts` | Every prompt builder, with fixed inputs, returns exactly the string in `tests/fixtures/prompts.frozen.json` (`toBe`). The fixture is written before the refactor of task 9 and never regenerated by a test run. Also: each rule constant is a substring of the prompt it belongs to |
| `mode.test.ts` | Every row of the mode table (replaces `base-url.test.ts`): mode, base URL, and whether `ignored` is set; the ignored line never contains the value; `originOf` strips path and credentials |
| `no-network.test.ts` | A `fetch` stub that fails the test when called is installed on `globalThis` and passed as `fetchFn`. In local mode, every local tool is called with valid and with invalid input, and the stub is never called. The server creates no API client. In remote mode the three local tools still never call it |
| `handle.test.ts`, `grant-memory.test.ts` | Handle round trip; eviction at 21; newest wins on a shared prefix; bare id uses the newest grant only; fast-check: memory never holds more than 20 |
| `tools.test.ts` | `listTools` by mode: local returns exactly `paw_rules`, `paw_check_curses`, `paw_check_verdict`; remote returns those and `paw_curse`, `paw_bind`; every name matches `^[a-zA-Z0-9_-]{1,64}$`; required fields; `maxLength` 500 and 200; `kind` enums and default; `initialize` carries the instructions text of its mode (`client.getInstructions()`) |
| `rules.test.ts` | `paw_rules` for each kind: text, `sections`, `jsonSchema` and footer; the footers name the check tool; a bad `kind` is an error that names the field; no network |
| `rules-drift.test.ts` | The drift test (Req 23.6). For a fixed wish and curse, every section of `paw_rules` `curse` is a substring of `buildPawPrompt`, and every section of `bind` (except the EARS line, which is checked against `EARS_CLAUSE_FORMAT` and `isEarsCriterion`) is a substring of `buildJudgePrompt(curse, binding, 'verdict')`; the taxonomy tags equal `CurseTypeSchema.options`; the JSON Schema `type` enum equals `CurseTypeSchema.options`, `minItems` and `maxItems` equal the limits of `GrantSchema`, `story.maxLength` equals the limit of `CurseSchema`; the verdict schema requires `closed` and `reason`. It fails if any rule text is copied into `paw-mcp` |
| `check-curses.test.ts` | Good input passes: ids `curse-0`..`curse-<n-1>`, status `open`, trimmed, text and `structuredContent` agree. The JSON-string form. Extra keys such as `id` and `status` are ignored and cannot choose an id. Each bad input gives its one line with its path: not an array, 2 and 6 curses, a non-object item, a bad `type`, an empty or missing `story` or `loophole`, story of 361, loophole of 1001, a repeated type, requirement of 501 or 0 characters. Several problems at once are all reported; 11 problems are cut to 10. The failure text starts with `The curses do not pass yet:` and has `isError`. A loophole with no 4-letter word in common with the requirement gives the exact warning line and no error |
| `check-verdict.test.ts` | Good closed and open verdicts pass, with an injected clock for `judgedAt`; `curseId` is injected; the binding comes from `proposeBinding` (shape, `proposedAt` a number); `property` is dropped when `closed` is false; a default `curse-0`; the JSON-string forms. Bad: an `ears-clause` that fails `isEarsCriterion` (the error names the keywords), a `rewrite` that does not need to; `closed` missing or not boolean; empty `reason`; `closed: true` with no property, one not starting with `For any`, one of 41 words (and 40 passes); a bad curse; amendment of 501 characters. Text starts with `CLOSED:` or `OPEN:` |
| `roundtrip.test.ts` | Remote mode. A stub HTTP server on `127.0.0.1:0` serves `/api/grant` and `/api/bind` with schema-valid bodies. An MCP `Client` over `InMemoryTransport.createLinkedPair()` calls `paw_curse`, then `paw_bind` on a returned handle (closed and open). Asserts the stub got the whole grant, the right `curseId`, and the amendment as `clause`; the memory holds the updated grant |
| `errors.test.ts` | Remote mode: 400 message, 503 "The paw is resting", 500, non-JSON error, unreachable host (closed port), timeout (stub that never answers, with a short injected timeout), invalid shape, unknown curse (no API call made), requirement of 501 characters, empty requirement, context of 201 |
| `stdio.test.ts` | Spawns `node powers/monkeys-paw/server/paw-mcp.mjs` twice. Local: no `PAW_API_URL`; `tools/list` returns the three local tools; start-up line `mode=local`; `paw_check_curses` works. Remote: `PAW_API_URL` set to the stub on `127.0.0.1`; `tools/list` returns five tools. In both, every stdout line parses as JSON-RPC, and stderr never contains the requirement text. Closes the child and the stub |
| `bundle-fresh.test.ts` | A fresh esbuild build (aliasing `paw-core` to its `src/index.ts`) equals the committed bundle; `NOTICE.md` names every bundled package |
| `power-format.test.ts` | `plugin.json` and `mcp.json` have exactly the documented fields; version `0.2.0` equals `PAW_MCP_VERSION`; the description says your own Kiro agent and no server of ours; the README says that, and that `PAW_API_URL` is optional; skills have front matter; the skills name the local tools; taxonomy body equals steering body; hook reference equals the hook file |
| `hooks-format.test.ts` | Hook files: `version`, `name`, `description`, PascalCase trigger, regex compiles, matcher accepts and rejects the example paths, action shape, no `when` or `then`. For `paw-reviews-requirements`: the prompt names `paw_rules`, `paw_check_curses`, "at most 3", the single `paw_rules` call and the retry once, and forbids file changes; the description says your own Kiro agent and no server of ours and has no "API call" |
| `agents-format.test.ts` | Required fields; no legacy fields; no `.md` in `.kiro/agents/`; read-only agents have no `write` and a `fs_write` deny; `paw` has `read`, `@monkeys-paw/paw_rules`, `@monkeys-paw/paw_check_curses` and names no `paw_curse`; `judge` has `read`, `@monkeys-paw/paw_rules`, `@monkeys-paw/paw_check_verdict` and names no `paw_bind`; `qa` has the deny rules `fs_write` on `**` and `shell` on `git push*`, `git commit*`, `rm *` and `*>*`; `resources` exist; veto agents' prompts mention both verdict lines |
| `repo-wiring.test.ts` | `.kiro/settings/mcp.json` path exists and keeps its `PAW_API_URL` entry; `tone.md` line 1 and `inclusion: always`; `tech.md` and `structure.md` name the three local tools; no absolute local path or secret-shaped string in the added files |
| `guards.test.ts` | `decideEval` (no file, empty key, quoted key, key set) and `decideReceipt` (test file, no Playwright, normal file, and the command it returns quotes the path and has `--pass-with-no-tests`); neither returns the key |

Matcher example paths for `hooks-format.test.ts`: accepted `.kiro/specs/paw-power/requirements.md` and
`/work/repo/.kiro/specs/x/requirements.md`; rejected `.kiro/specs/x/design.md`, `.kiro/specs/requirements.md`,
`docs/requirements.md`, `.kiro/specs/x/requirements.md.bak`.

Not testable here, so reviewer tasks: a real stdio check over the built bundle in both modes (local with no
`PAW_API_URL`, remote against a stub API), `kiro-cli agent validate`, installing the power, and, in the Kiro IDE,
installing it with no `PAW_API_URL`, confirming that only the three local tools appear, and watching the review hook
call `paw_rules` and `paw_check_curses` with nothing sent to any server.
