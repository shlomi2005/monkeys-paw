# Paw Power — Design

## Overview

The Paw gets a second front door: Kiro. Four parts, all thin:

1. **`packages/paw-mcp`**: a stdio MCP server with two tools. It calls the existing Paw API over HTTP, validates every
   answer with the `paw-core` schemas, and keeps recent grants in memory so `paw_bind` can send the whole grant.
2. **`powers/monkeys-paw/`**: an Agent Plugins 1.0.0 folder that installs the server (as a committed single-file
   bundle) and three skills (taxonomy, a review workflow, the hook installer).
3. **This repo's Kiro wiring**: `.kiro/settings/mcp.json`, three hooks, two guard scripts, five agents, `tone.md`.
4. **Format tests** that keep every JSON file, copy and bundle honest, since nobody can run hooks or agents headless.

No model is called here and no key exists here. The API's `{message}` errors pass through as tool errors.

### Decisions and deviations

| # | Decision | Why |
|---|----------|-----|
| D1 | Tool names are `paw_curse` and `paw_bind`, not `paw.curse` and `paw.bind` (tech.md). Task 6 updates tech.md. | Dots are not valid tool names in every MCP client. Kiro reports tool ids as `mcp_<server>_<tool>`. |
| D2 | The power ships the taxonomy and the hook as **skills**. The hook skill's `references/` holds the hook JSON, and its steps copy it into the user's `.kiro/hooks/`. | The Agent Plugins format has no steering or hook component. |
| D3 | The server is committed as one bundle, `powers/monkeys-paw/server/paw-mcp.mjs`. A test rebuilds it in memory and compares. | Install from a folder or a repository URL runs no `npm install`. The cost is a generated file in git, kept honest by the test. |
| D4 | The default base URL is the placeholder `https://paw-api.invalid`. | The deploy is an open decision. `.invalid` never resolves, so a missing setting gives a clear "cannot reach" error. |
| D5 | `paw_bind` takes a **handle** (`<wishId[0..8]>:<curse id>`), and also a bare id for the newest grant. | The brief says the tool takes the curse id. Ids are `curse-0` to `curse-4` in every grant (`paw-core/src/grant.ts`), so a bare id is ambiguous across grants. |
| D6 | The bind request body is built in `paw-mcp` from `paw-core` types. | `BindRequestSchema` lives in `apps/api`, which `paw-mcp` must not import. A test pins the body shape. |
| D7 | The hook prompt says "the tool `paw_curse`" and names no server. | The same file then works in this repo (server `monkeys-paw`) and in an installed power (Kiro renames the server to `power-monkeys-paw-paw`). |
| D8 | Assumption: the pinned SDK returns input-validation failures as `isError` results. Task 2 checks this. If it throws a protocol error instead, the shape is registered without `.max()`, the limits go in the `.describe()` text, and the handler re-validates with the strict schema. | Req 6.1 wants a tool result, never a protocol error. |
|    | **D8 outcome (task 2):** SDK 1.32.2 turns an input-schema failure into an `isError` result (`MCP error -32602: Input validation error: Invalid arguments for tool <name>: <zod message> at <field>`), so the strict shapes with `.max()` are kept and D8's fallback is not needed. The zod messages are custom (`requirement must be at most 500 characters`), so the text names the field and the limit. | Checked by `tests/tools.test.ts`. |
| D9 | Hooks fire only for saves made by the agent, in the IDE and CLI V3. The review hook (a) costs an agent loop and up to 3 API calls per save. | Kiro's documented behaviour. The README says so, and each hook has `enabled` that users can flip. |
| D10 | `qa` and `legal` cannot be made fully read-only for shell. `qa` has `shell`. Kiro matches `shell` rules as glob patterns on the whole command, so exact strings without `*` would allow almost nothing, and `cd x && ...` would match nothing. `qa` therefore runs every package command as `pnpm -C <package dir> <script or vitest run>`, and its rules are globs: allow the `pnpm` forms, deny `fs_write` on `**` and `shell` on `git push*`, `git commit*`, `rm *` and `*>*` (deny always wins). `legal` has no `shell`. | A shell can redirect output into a file. The prompt forbids it, and the reviewer checks the rules (task 7). |
| D11 | Guard scripts live in root `scripts/` (like `scripts/copy-paw-assets.mjs` in paw-web). Each exports a pure decision function. | The decision can be unit-tested without spawning pnpm or Playwright. |
| D12 | For TypeScript and Vitest, `paw-mcp` resolves `paw-core` the same way `apps/api` does. Task 1 reads `apps/api`'s config and copies the approach. D12 does not apply to the bundle: esbuild aliases `paw-core` to `packages/paw-core/src/index.ts` (see "The bundle"). | `paw-core` exports `dist/`. Do not invent a second way for the type checker and tests. `packages/paw-core/dist/` is gitignored, so a fresh clone has none, and a stale local one must not change the committed bundle or the freshness test. |
| D13 | The SDK, `zod` and `esbuild` versions are pinned in task 1 to what pnpm resolves, and `zod` is the one `paw-core` resolves. | Schemas from `paw-core` must be parsed by the same `zod` instance the SDK reads. |

---

## Architecture

```
packages/paw-mcp/
├── package.json              # name paw-mcp, private, type module, bin-less; scripts: build, bundle, test, typecheck
├── tsconfig.json
├── scripts/build-bundle.mjs  # esbuild → powers/monkeys-paw/server/paw-mcp.mjs, and NOTICE.md data
├── src/
│   ├── index.ts              # entry: createPawServer(...) + StdioServerTransport; the only file with side effects
│   ├── server.ts             # createPawServer({ baseUrl, fetchFn?, log? }) → McpServer with both tools
│   ├── version.ts            # PAW_MCP_VERSION = '0.1.0' (must equal plugin.json)
│   ├── base-url.ts           # PLACEHOLDER_API_URL, resolveBaseUrl(raw) → string, originOf(url)
│   ├── api-client.ts         # postJson(path, body, schema) → Result; the error table
│   ├── grant-memory.ts       # createGrantMemory(max = 20): remember, resolve, openHandles
│   ├── handle.ts             # toHandle(wishId, curseId), parseHandle(text)
│   ├── tool-curse.ts         # inputShape, outputShape, handleCurse
│   ├── tool-bind.ts          # inputShape, outputShape, handleBind
│   └── render.ts             # renderCurses(...), renderVerdict(...) → plain text
└── tests/                    # see Testing strategy
scripts/golden-wish-eval.mjs  # hook (b) guard
scripts/ui-screenshot-receipt.mjs  # hook (c) guard
powers/monkeys-paw/           # see Power layout
.kiro/{settings/mcp.json, hooks/*.json, agents/*.json, steering/tone.md}
```

`index.ts` reads `process.env.PAW_API_URL`, calls `resolveBaseUrl`, writes one stderr line (`paw-mcp 0.1.0 api=<origin>`),
and connects the stdio transport. Everything else is a pure module, so tests build the server with a stub `fetchFn` or a
stub URL. Nothing is written to stdout except by the transport.

---

## Tool contracts

Both tools are registered with `McpServer.registerTool(name, { description, inputSchema, outputSchema }, handler)`. The
input shapes are zod raw shapes. Handlers re-parse with the strict schema and never throw.

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

## API client and errors

`postJson(path, body, schema)` uses `fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json',
accept: 'application/json' }, body, signal: AbortSignal.timeout(30_000), redirect: 'error' })`. No other header, no
cookie, no credentials. `base` comes from `resolveBaseUrl(raw)`:

| `PAW_API_URL` | Result |
|---------------|--------|
| unset, `''`, whitespace | `https://paw-api.invalid` |
| contains `${` (unexpanded placeholder) | `https://paw-api.invalid` |
| not parseable, protocol not `http:` or `https:` | `https://paw-api.invalid` |
| has `username` or `password` | `https://paw-api.invalid` |
| `http://127.0.0.1:8787///` | `http://127.0.0.1:8787` (trailing slashes stripped) |

Errors (every row is `isError: true`, one sentence; `<origin>` is `URL.origin`):

| Condition | Text |
|-----------|------|
| Input breaks a limit | `Invalid input: <field> <rule>.` (for example `requirement must be at most 500 characters.`) |
| `paw_bind`: curse not in memory | `Unknown curse "<first 60 chars>". Call paw_curse first; handles last only while this server runs.` |
| Non-2xx with JSON `{message}` (400, 404, 500, 503) | the `message`, unchanged |
| Non-2xx otherwise | `The Paw API answered HTTP <status>.` |
| `fetch` rejects, timeout, redirect | `Cannot reach the Paw API at <origin>; set PAW_API_URL.` |
| 2xx, body not JSON or fails the schema | `The Paw API answered in a shape this tool does not understand.` |
| Any other thrown error | `The Paw tool failed unexpectedly.` (the error is not logged with its message) |

Logging: `log('paw_curse 200 412ms')` to stderr. The logger takes `(tool, status, ms)` only, so a requirement cannot be
passed to it by mistake.

---

## Grant memory

`createGrantMemory(max = 20)` wraps a `Map<wishId, Grant>`. `remember(grant)` deletes then sets the key (so it becomes
the newest) and evicts the oldest while `size > max`. `resolve(text)`: if `parseHandle(text)` yields a prefix and a curse
id, scan grants newest first for `wishId.startsWith(prefix)` that hold the curse; otherwise treat `text` as a bare id and
look in the newest grant only. It returns `{ grant, curse, handle }` or `null`. `openHandles(grant)` lists open curses.
The memory holds no timers and writes nothing. The handle prefix is the first 8 characters of `wishId`.

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
  "version": "0.1.0",
  "description": "Curse a software requirement: the Paw follows it to the letter and shows the loopholes, then judges your fix.",
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

Skills. Each has front matter `name` and `description`, then numbered steps.

- `curse-taxonomy`: front matter, then the exact body of `.kiro/steering/curse-taxonomy.md` (the part after its own
  front matter). The description says when to use it: "Use when classifying or writing a loophole in a requirement."
- `curse-a-spec`: (1) find `.kiro/specs/<feature>/requirements.md` and read it; (2) pick the requirements most likely
  to hide a loophole; (3) call `paw_curse` once per requirement (500 characters, context = one line about the feature);
  (4) report loopholes by requirement number, type, story; (5) write one EARS clause per loophole; (6) test each with
  `paw_bind`; (7) offer only the clauses that came back `CLOSED`; (8) never edit the spec without being asked. If the
  tool errors, report its sentence and stop.
- `spec-loophole-hook`: (1) check that `.kiro/hooks/` exists in the user's workspace, create it if not; (2) if
  `.kiro/hooks/paw-reviews-requirements.json` exists, stop and say so; (3) copy
  `references/paw-reviews-requirements.json` there; (4) say that the hook runs an agent loop and up to 3 Paw API calls on
  each agent save of a `requirements.md`, that it can be switched off with `"enabled": false`, and that `PAW_API_URL`
  must be set.

---

## Hooks

All three are in `.kiro/hooks/`, format `v1`. Matchers are regexes without lookahead, starting `(^|/)` so they match a
relative and an absolute path.

### (a) `paw-reviews-requirements.json`

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "paw-reviews-requirements",
      "description": "After requirements.md is saved by the agent, the Monkey's Paw comments on open loopholes. Runs an agent loop and up to 3 Paw API calls per save.",
      "trigger": "PostFileSave",
      "matcher": "(^|/)\\.kiro/specs/[^/]+/requirements\\.md$",
      "action": {
        "type": "agent",
        "prompt": "You are the Monkey's Paw. The requirements.md file that triggered this hook was just saved. Read it. Pick at most 3 requirements that are most likely to hide a loophole. For each, call the tool paw_curse once: requirement = the user story and key acceptance criteria of that requirement, condensed to at most 500 characters; context = one line about the feature. Then reply with one short comment in the Paw's dry, eerie voice. For each open loophole list: the requirement number, the curse type, the story, the loophole, and one EARS clause (WHEN/WHILE/IF ... THEN THE SYSTEM SHALL) that would close it. Never edit, create or delete any file. If the paw_curse tool is missing or returns an error, say so in one line and stop."
      }
    }
  ]
}
```

Assumption for task 8: the agent loop knows which file triggered it (Kiro adds the event to the context). The prompt says
"that triggered this hook" for that reason.

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
`read`, `shell`, `@monkeys-paw/paw_curse`, `@monkeys-paw/paw_bind`.

| Agent | Role | `tools` | `includeMcpJson` | `resources` | Output |
|-------|------|---------|------------------|-------------|--------|
| `paw` | Finds loopholes. Specific, plausible, one stakeholder each, different types. | `read`, `@monkeys-paw/paw_curse` | true | `curse-taxonomy.md`, `tone.md`, `product.md` | Prose in the Paw's voice, one curse per loophole |
| `genie` | Narrates the grant in the Paw's voice. | `read` | false | `tone.md`, `product.md` | Short narration, at most 25 words |
| `judge` | Decides if an amendment closes a loophole. Rejects generic curses. | `read`, `@monkeys-paw/paw_bind` | true | `curse-taxonomy.md`, `tone.md`, `iron-rules.md` | JSON only: `{"closed", "reason", "property"?}` or `{"specific", "reason"}` |
| `qa` | Veto. Runs tests, typecheck, lint, build. | `read`, `shell` | false | `tech.md`, `structure.md`, `iron-rules.md` | Findings, then `VERDICT: PASS` or `VERDICT: VETO` |
| `legal` | Veto. Checks the iron rules. | `read` | false | `iron-rules.md`, `product.md`, `tone.md` | Findings, then `VERDICT: PASS` or `VERDICT: VETO` |

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
- A model answer never reaches the user unvalidated: both API answers pass a `paw-core` schema (iron rule 6).
- The API enforces the budget and the per-IP limit (iron rule 5). The server adds no cache and no retry, so it cannot
  bypass them.
- The bundle contains no key. A format test greps the new files for secret-shaped strings and absolute local paths.

---

## Testing strategy

All in `packages/paw-mcp/tests/`, run with `pnpm vitest run`, no network except `127.0.0.1`.

| File | What it checks |
|------|----------------|
| `base-url.test.ts` | Every row of the URL table; `originOf` strips path and credentials |
| `handle.test.ts`, `grant-memory.test.ts` | Handle round trip; eviction at 21; newest wins on a shared prefix; bare id uses the newest grant only; fast-check: memory never holds more than 20 |
| `tools.test.ts` | `listTools` returns exactly `paw_curse`, `paw_bind`; required fields; `maxLength` 500 and 200; `kind` enum and default |
| `roundtrip.test.ts` | A stub HTTP server on `127.0.0.1:0` serves `/api/grant` and `/api/bind` with schema-valid bodies. An MCP `Client` over `InMemoryTransport.createLinkedPair()` calls `paw_curse`, then `paw_bind` on a returned handle (closed and open). Asserts the stub got the whole grant, the right `curseId`, and the amendment as `clause`; the memory holds the updated grant |
| `errors.test.ts` | 400 message, 503 "The paw is resting", 500, non-JSON error, unreachable host (closed port), timeout (stub that never answers, with a short injected timeout), invalid shape, unknown curse (no API call made), requirement of 501 characters, empty requirement, context of 201 |
| `stdio.test.ts` | Spawns `node powers/monkeys-paw/server/paw-mcp.mjs` with `PAW_API_URL` set to the stub, speaks JSON-RPC over its pipes, checks every stdout line parses as JSON-RPC, and that stderr never contains the requirement text. Closes the child and the stub |
| `bundle-fresh.test.ts` | A fresh esbuild build (aliasing `paw-core` to its `src/index.ts`) equals the committed bundle; `NOTICE.md` names every bundled package |
| `power-format.test.ts` | `plugin.json` and `mcp.json` have exactly the documented fields; version equals `PAW_MCP_VERSION`; skills have front matter; taxonomy body equals steering body; hook reference equals the hook file |
| `hooks-format.test.ts` | Hook files: `version`, `name`, `description`, PascalCase trigger, regex compiles, matcher accepts and rejects the example paths, action shape, no `when` or `then` |
| `agents-format.test.ts` | Required fields; no legacy fields; no `.md` in `.kiro/agents/`; read-only agents have no `write` and a `fs_write` deny; `qa` has the deny rules `fs_write` on `**` and `shell` on `git push*`, `git commit*`, `rm *` and `*>*`; `resources` exist; veto agents' prompts mention both verdict lines |
| `repo-wiring.test.ts` | `.kiro/settings/mcp.json` path exists; `tone.md` line 1 and `inclusion: always`; no absolute local path or secret-shaped string in the added files |
| `guards.test.ts` | `decideEval` (no file, empty key, quoted key, key set) and `decideReceipt` (test file, no Playwright, normal file, and the command it returns quotes the path and has `--pass-with-no-tests`); neither returns the key |

Matcher example paths for `hooks-format.test.ts`: accepted `.kiro/specs/paw-power/requirements.md` and
`/work/repo/.kiro/specs/x/requirements.md`; rejected `.kiro/specs/x/design.md`, `.kiro/specs/requirements.md`,
`docs/requirements.md`, `.kiro/specs/x/requirements.md.bak`.

Not testable here, so reviewer tasks: a real stdio check against a stub API, `kiro-cli agent validate`, installing the
power, and each hook firing in the Kiro IDE.
