# Paw Power — Tasks

Ordered checklist for the Paw inside Kiro. Requirements are cited as `Req N.M` (see `requirements.md`), decisions as
`D1`–`D24` (design.md, "Decisions and deviations"). Each task is sized for one agent run. Tests are in the task that adds
the code, run with `pnpm vitest run` in `packages/paw-mcp`. No agent can run a hook, validate an agent in the IDE or
install a power, so tasks 7, 8, 13 and 14 are the reviewer's. Do not change `apps/api` or `apps/web` code in any task.
Tasks 9 to 14 add local mode (the owner's decision of 20.11, D14 to D24): the power runs on the user's own Kiro agent and
calls no server of ours. Rules for every agent run in tasks 9 to 12: pnpm only; one test process at a time (the machine
is low on memory); never read `apps/api/.env`, never run the eval or `pnpm -C apps/api dev`, never call a real model or
any network service; no dev server, watcher or browser; no Playwright. Every task that changes `packages/paw-core/src`
or `packages/paw-mcp/src` ends with `pnpm -C packages/paw-core build` (so `paw-mcp` sees the new exports) and
`pnpm -C packages/paw-mcp bundle`, so `bundle-fresh.test.ts` stays green.

- [x] 1. Scaffold `packages/paw-mcp` and its pure modules: `package.json` (name `paw-mcp`, private, ESM, scripts `build`,
  `bundle`, `test`, `typecheck`; dependencies `@modelcontextprotocol/sdk`, `zod`, `paw-core`; dev dependency `esbuild`),
  `tsconfig.json`, `src/version.ts`, `base-url.ts`, `handle.ts`, `grant-memory.ts`, `render.ts`. Resolve `paw-core` the
  way `apps/api` does (D12) and pin the versions pnpm resolves (D13). Tests: `base-url.test.ts` (every row of the URL
  table), `handle.test.ts`, `grant-memory.test.ts` (eviction at 21, newest wins, bare id uses the newest grant, a
  fast-check property that the memory never exceeds 20). Run the new suite and `pnpm typecheck`. (Req 1.1–1.3, 4, 5.1–5.3)
- [x] 2. The tools and the server: `api-client.ts` (timeout, `redirect: 'error'`, the error table), `tool-curse.ts`,
  `tool-bind.ts`, `server.ts`, `index.ts` (stdio, one stderr line, no stdout writes). First check which way the pinned SDK
  reports input-validation failures and apply D8 if needed. Tests: `tools.test.ts`, `roundtrip.test.ts` (stub HTTP server
  on `127.0.0.1:0`, MCP client over the in-memory transport, curse then bind closed and open, stub sees the whole grant,
  `curseId` and `clause`), `errors.test.ts` (400, 503, 500, non-JSON error, unreachable host, timeout, invalid shape,
  unknown curse with no API call, over-long and empty input). Close every server. (Req 1.4–1.5, 2, 3, 5.4–5.6, 6, 7.1–7.4,
  16.1–16.5)
- [x] 3. The bundle: `scripts/build-bundle.mjs`, the committed `powers/monkeys-paw/server/paw-mcp.mjs`,
  `server/NOTICE.md` (from the metafile's package list). The esbuild call aliases `paw-core` to
  `packages/paw-core/src/index.ts`, never to `dist/` (design.md "The bundle", D12). If the unminified bundle is over 1 MB,
  set `minify: true` in the script and in the test; record the final size and the `minify` value in design.md "The
  bundle". Tests: `bundle-fresh.test.ts` (same call and alias, `write: false`, bytes equal the committed file; `NOTICE.md`
  names every bundled package), `stdio.test.ts` (spawn the bundle against the stub; stdout is JSON-RPC only; stderr never
  has the requirement). Check that the build and the tests pass on a tree with no `packages/paw-core/dist/`. Confirm with
  `git check-ignore` that no new file is ignored. (Req 7.1, 8.4, 8.5, 8.7, 16.6)
- [x] 4. The power folder: `powers/monkeys-paw/plugin.json`, `mcp.json`, `README.md`, the three skills, and
  `references/paw-reviews-requirements.json` (a copy of the hook from task 5; if task 5 is not done, write the hook file
  first, exactly as in design.md, and let task 5 only verify it). Confirm with `git check-ignore` that no new file is
  ignored. Test: `power-format.test.ts`. (Req 8.1–8.3, 8.6, 9, 17.3, 17.5)
- [x] 5. Repo wiring: `.kiro/settings/mcp.json`, the three hooks in `.kiro/hooks/` exactly as in design.md,
  `scripts/golden-wish-eval.mjs` and `scripts/ui-screenshot-receipt.mjs` (each exports its pure decision function).
  Tests: `hooks-format.test.ts` (including the matcher example paths), `guards.test.ts`, `repo-wiring.test.ts` (the MCP
  path exists). Never print or log the Gemini key in any test. The `@receipt` notes in paw-web tasks 42 and 49 were added
  when this spec was written; verify they are still there. Do not run the real eval. (Req 10, 11, 12, 13, 17.1, 17.4,
  17.6)
- [x] 6. The five agents in `.kiro/agents/` (`paw`, `genie`, `judge`, `qa`, `legal`, as in design.md "Agents"),
  `.kiro/steering/tone.md` (about 40 lines), and the edits to `tech.md` and `structure.md`: replace `packages/paw-power`
  and `paw.curse`/`paw.bind` with `packages/paw-mcp`, `powers/monkeys-paw` and `paw_curse`/`paw_bind`, and add the MCP SDK
  and the committed bundle to the stack tables. Tests: `agents-format.test.ts` (including the `qa` deny rules: `fs_write` on `**`; `shell` on `git push*`, `git commit*`, `rm *`, `*>*`; and its prompt says every package command is `pnpm -C <package dir> ...`), plus the `tone.md` check in
  `repo-wiring.test.ts` and the no-absolute-path and no-secret scan over every file this spec added. Run the whole
  `paw-mcp` suite. (Req 14, 15, 17.2, 17.7)
- [ ] 7. Reviewer task, not an agent task: the checks agents cannot run. (a) Start a stub API, run the built bundle over
  real stdio (for example with the MCP inspector or a small client), call both tools. (b) Run `kiro-cli agent validate
  --path` on each of the five agent files, and try `qa` with a command that matches no rule to see the default, and with `git commit` to see the deny (design.md
  "Agents", assumption). (c) Install the power from the `powers/monkeys-paw` folder in the Powers panel, set
  `PAW_API_URL`, confirm that the two tools and the three skills appear. Record each result here with the date.
  (Req 18.1, 18.2)
  - 20.11.2026 (a) Done: the committed bundle was started over real stdio by a small JSON-RPC client against a stub API
    on 127.0.0.1. `initialize` (protocol 2025-06-18, server `paw` 0.1.0), `tools/list` returned exactly `paw_curse` and
    `paw_bind` with their limits, `paw_curse` returned 3 curses with handles, `paw_bind` on one returned CLOSED with the
    property and the 2 open handles, an unknown curse returned `isError`. The stub saw `POST /api/grant` and
    `POST /api/bind` with no auth header and no cookie. stdout carried JSON-RPC only; stderr had the start line and
    `tool status ms` lines, never the requirement. With `PAW_API_URL` unset or a literal `${PAW_API_URL}`, `paw_curse`
    answered "Cannot reach the Paw API at https://paw-api.invalid; set PAW_API_URL." and a 501-character requirement was
    refused before any call.
  - 20.11.2026 (b) Done in part: `kiro-cli agent validate --path` exits 0 for all five agents, and `kiro-cli agent list`
    shows them as workspace agents in v3 format. Not yet tried: `qa` with a command off its allow-list (needs an
    interactive session).
  - 20.11.2026 Extra: `plugin.json` and `mcp.json` validate against the published Agent Plugins 1.0.0 JSON schemas
    (`https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` and `.../mcp.schema.json`).
  - 20.11.2026 (c) Not done: installing the power needs the Kiro IDE Powers panel (owner). Kiro's docs do not say whether
    Kiro expands `${PLUGIN_ROOT}` in `mcp.json`; the Agent Plugins spec requires it. Check this first when installing.
- [ ] 8. Reviewer task, not an agent task, in the Kiro IDE: make the agent save a `requirements.md` and confirm that
  `paw-reviews-requirements` fires, finds the file that triggered it, and calls `paw_curse` at most 3 times; save
  `prompts.ts` and confirm `golden-wish-eval` prints `skipped` without a key; save a `.tsx` file in `apps/web/src` and
  confirm `ui-screenshot-receipt` prints `skipped` until paw-web task 42 lands. Record the results and the date here.
  Then decide the open items: the deployed API URL (replace the placeholder in the README and tests), `homepage` and
  `repository` in `plugin.json`. (Req 11, 12, 13, 18.1, 18.2)
  - The hook no longer needs `PAW_API_URL` (it runs in local mode, see task 14), so the first check above is now whether it calls
    `paw_rules` and `paw_check_curses`, not `paw_curse`.

- [x] 9. `paw-core`: rule constants, the EARS format line, the exports, and the frozen prompt fixture. (Req 22, 16.10)
  1. **Before any refactor**, write `packages/paw-core/tests/fixtures/prompts.frozen.json` by calling the unchanged
     builders (a throwaway test or script that writes the file, deleted afterwards; do not type the strings by hand):
     `buildPawPrompt` and `buildGeniePrompt` (each with and without `context`), `buildBatchQualityPrompt` (3 curses),
     `buildJudgePrompt` (verdict with a binding, verdict without a binding, quality) and `buildReplacementPrompt`, all
     with fixed inputs. Write `tests/prompts-frozen.test.ts`, which compares each output with `toBe` (not a Vitest
     snapshot). Run it: it must pass on the unchanged code.
  2. Refactor `src/prompts.ts`: export the rule sections of the design's "Rule sections" table as named constants, plain
     strings with no `${}`, each a contiguous piece of its prompt, and compose `buildPawPrompt` and `buildJudgePrompt`
     (verdict mode) from them. `PAW_ROLE` and the curses shape are used by the Paw prompt, the Judge's constants by the
     verdict prompt. The names in the table may change; the set of sections may not. Change no wording.
  3. `src/ears.ts`: export `EARS_CLAUSE_FORMAT`, one line, next to the regexes, naming WHEN, IF, WHILE, WHERE and THE
     SYSTEM SHALL and the need for SHALL. `src/index.ts`: export `isEarsCriterion`, `EARS_CLAUSE_FORMAT` and the rule
     constants.
  4. Tests: the frozen test still passes (this is the proof that nothing changed); a test that each constant is a
     substring of the prompt it belongs to; a test that `EARS_CLAUSE_FORMAT` names every keyword that `isEarsCriterion`
     accepts; a test that `index.ts` exports the new names. The existing `prompts.test.ts` and the rest of the
     `paw-core` suite still pass. No eval run is needed, because no wording changed.
  5. Run `pnpm -C packages/paw-core vitest run`, `pnpm -C packages/paw-core typecheck`, then
     `pnpm -C packages/paw-core build` and `pnpm -C packages/paw-mcp bundle`; if `bundle-fresh.test.ts` fails, the bundle
     was rebuilt by the step before it and must be committed as rebuilt. Do not touch `apps/*`.
  - Done (20.11.2026): the fixture `tests/fixtures/prompts.frozen.json` was written by a throwaway test from the
    unchanged builders (9 strings: Paw and Genie with and without context, batch quality, Judge verdict with and without
    a binding, Judge quality, replacement) and deleted afterwards. `tests/prompts-frozen.test.ts` compares with `toBe`
    and passed on the unchanged code (105 tests) and again after the refactor with the fixture untouched. `prompts.ts`
    now exports nine constants (`PAW_ROLE`, `CURSE_RULES`, `CURSE_TAXONOMY`, `GUARDRAILS`, `CURSES_JSON_SHAPE`,
    `CURSES_ARRAY_RULE`, `JUDGE_ROLE`, `VERDICT_JSON_SHAPE`, `VERDICT_RULES`) and `buildPawPrompt` and the verdict mode of
    `buildJudgePrompt` are composed from them; no wording changed. `ears.ts` exports `EARS_CLAUSE_FORMAT` ("An EARS
    clause must start with WHEN, IF, WHILE, WHERE or THE SYSTEM SHALL and contain SHALL."), and `index.ts` exports it,
    `isEarsCriterion` and the nine constants. New tests: `prompts-frozen.test.ts` (22 with the substring, order and
    taxonomy checks), `ears-format.test.ts` (4), `index-exports.test.ts` (2). `paw-core`: 123 tests pass (was 95),
    typecheck and build clean. The bundle was rebuilt and did not change, because `paw-mcp` imports no prompt builder.
- [x] 10. `paw-mcp`: modes, the three local tools, the server by mode, instructions, logging, and their tests.
  (Req 1.2–1.6, 5, 6.1, 6.7, 7.2–7.3, 16.2, 16.4, 16.8, 16.9, 19, 20, 21, 23, 24, 25)
  1. Add `zod-to-json-schema` as a direct dependency, exact version `3.25.2`, with `pnpm --offline` (it is already in
     the lockfile; if the offline install fails, stop and report, do not go online).
  2. `src/mode.ts` (replaces `base-url.ts`, and `base-url.test.ts` becomes `mode.test.ts`): `resolveMode(raw)` and
     `originOf`, every row of the design's mode table. Delete `PLACEHOLDER_API_URL`. `src/index.ts`: read
     `PAW_API_URL` once, write the start-up line (`paw-mcp <version> mode=local` or `... mode=remote api=<origin>`),
     the one ignored line when `ignored` (never the value), and a per-call logger `(tool, outcome, ms)`.
  3. `src/json-arg.ts`, `rules.ts`, `check-curses.ts`, `check-verdict.ts` (pure, as in "Tool contracts"), and
     `tool-rules.ts`, `tool-check-curses.ts`, `tool-check-verdict.ts` with their input and output shapes. `paw_rules`
     builds text, `sections` and `jsonSchema` only from `paw-core` exports (rule constants, `CurseSchema`,
     `VerdictSchema`, `GrantSchema` limits, `CurseTypeSchema`, `EARS_CLAUSE_FORMAT`) and `zodToJsonSchema`; only the two
     footers are written in `paw-mcp`. `paw_check_verdict` uses `isEarsCriterion`, `VerdictSchema`, `CurseSchema`,
     `BindingKindSchema` and `proposeBinding`, and an injectable clock.
  4. `src/server.ts`: `createPawServer({ mode, baseUrl?, fetchFn?, timeoutMs?, log?, now? })`. Local registers exactly
     the three local tools and does not call `createApiClient` or create the grant memory. Remote registers those and
     `paw_curse`, `paw_bind` as before. Pass `instructions` (one text per mode, `src/instructions.ts`) as the
     `McpServer` option. Give each tool a description. Local handlers log `ok` or `invalid` and the duration, never
     content.
  5. Tests (all offline): `mode.test.ts`; `no-network.test.ts` (a failing `fetch` stub on `globalThis` and as
     `fetchFn`, every local tool with valid and invalid input, in both modes); `tools.test.ts` (exact names by mode,
     name regex, limits, instructions via `client.getInstructions()`); `rules.test.ts`; `rules-drift.test.ts`;
     `check-curses.test.ts`; `check-verdict.test.ts` (every check of Requirements 24 and 25, the JSON-string forms, ids
     assigned by the system, the warning line). `roundtrip.test.ts` and `errors.test.ts` move to remote mode and stay
     green. Close every server and stub.
  6. Run `pnpm -C packages/paw-mcp vitest run` (one process), `pnpm -C packages/paw-mcp typecheck`, then
     `pnpm -C packages/paw-mcp bundle`. Check that nothing in `packages/paw-mcp/src` imports `apps/*`, and that no
     rule sentence is copied into `paw-mcp` outside the two footers (the drift test is the proof).
  - Done (20.11.2026): `zod-to-json-schema` 3.25.2 added to `paw-mcp` with `pnpm --offline` (lockfile: that one importer
    entry). New: `mode.ts` (replaces `base-url.ts`; `resolveMode`, `originOf`, `startupLine`, `ignoredLine`; no
    placeholder URL), `call-log.ts` (`CallLogger` takes `(tool, outcome, ms)`), `json-arg.ts`, `issue.ts` (zod issue
    to one line; `describeInputError` moved here), `limits.ts` (3 and 5 and 360 read from `paw-core`; 1000 and 40 are
    the API's cap and the Judge's word limit), `rules.ts`, `check-curses.ts`, `check-verdict.ts`, `tool-rules.ts`,
    `tool-check-curses.ts`, `tool-check-verdict.ts`, `instructions.ts`, `render.ts` (+3 renderers). `server.ts`
    takes `{ mode, baseUrl?, fetchFn?, timeoutMs?, log?, now? }`: local registers three tools and creates no API client
    and no grant memory (a test proves both); remote registers five; `instructions` per mode; local handlers log `ok`
    or `invalid`. `index.ts` reads `PAW_API_URL` once and writes the start-up and ignored lines. Choices the design left
    open: section names in `paw_rules` are `role`, `curse-rules`, `taxonomy`, `guardrails`, `json-shape`,
    `array-rule` (curse) and `role`, `json-shape`, `verdict-rules`, `ears-format` (bind); the `paw_check_verdict` error for a
    bad clause is `amendment is not an EARS clause.` plus `EARS_CLAUSE_FORMAT`, so no rule sentence is copied;
    `originOf` of an unparseable string is `an unusable URL`. Tests: `mode.test.ts` (20, replaces `base-url.test.ts`),
    `no-network.test.ts` (3, both modes), `local-mode.test.ts` (5: no client or memory in local, logging),
    `tools.test.ts` (16, exact names by mode, name regex, limits, instructions, `.describe()` texts), `rules.test.ts`
    (11), `rules-drift.test.ts` (13, includes a scan that no rule line is copied into `src/`), `check-curses.test.ts`
    (25), `check-verdict.test.ts` (21). `roundtrip.test.ts` and `errors.test.ts` keep every assertion, now in remote
    mode (the placeholder-host test uses a closed `127.0.0.1` port with a path). Nothing in `src/` imports `apps/*`.
- [x] 11. Version `0.2.0`, the bundle, and `stdio.test.ts` in both modes. (Req 8.2, 8.4, 8.5, 8.7, 8.8, 16.6, 17.5)
  1. `src/version.ts` `PAW_MCP_VERSION = '0.2.0'` and the `version` field of `powers/monkeys-paw/plugin.json` (only that
     field here; the description is task 12). Update the `0.1.0` expectations in the tests.
  2. `pnpm -C packages/paw-mcp bundle` rebuilds `powers/monkeys-paw/server/paw-mcp.mjs`. Confirm that `NOTICE.md` still
     names every bundled package (add a package only if the metafile lists a new one; `zod-to-json-schema` was already
     there). Record the new size and the `minify` value in design.md "The bundle". Confirm with `git check-ignore` that no
     new file is ignored.
  3. `stdio.test.ts` spawns the bundle twice. Local: no `PAW_API_URL`; `initialize` carries the local instructions;
     `tools/list` returns exactly the three local tools; start-up line `mode=local`; `paw_check_curses` returns a result.
     Remote: `PAW_API_URL` set to the stub on `127.0.0.1`; `tools/list` returns the five tools. In both, stdout holds
     only JSON-RPC and stderr never has the requirement. Close the child and the stub.
  4. `bundle-fresh.test.ts` and the whole `paw-mcp` suite pass (one process).
  - Done (20.11.2026): `PAW_MCP_VERSION` and `plugin.json` `version` (that field only) are `0.2.0` (no test held a
    literal `0.1.0`; `power-format.test.ts` compares the two, and `stdio.test.ts` now asserts the `0.2.0` start-up
    line). `pnpm -C packages/paw-mcp bundle` rebuilt the bundle: 793,239 bytes, `minify: false`, the same eight
    third-party packages, all named in `NOTICE.md` (unchanged); `git check-ignore` reports no new file ignored.
    `stdio.test.ts` spawns the bundle twice: local (no `PAW_API_URL`: local instructions, exactly three tools,
    `mode=local`, `paw_check_curses` result, no request reaches the stub) and remote (stub URL: remote instructions,
    five tools, `mode=remote api=<origin>`, `paw_curse` reaches the stub); both check JSON-RPC-only stdout and no
    requirement on stderr. Final counts: `paw-core` 123, `paw-mcp` 246 (19 files, run again after the last bundle
    rebuild, `bundle-fresh` green), `apps/api` 328.
- [ ] 12. Wiring, agents, skills, docs and their format tests. (Req 8.2, 8.3, 8.6, 9, 11, 14.4, 14.6, 15.3, 17.1–17.3, 17.7)
  1. `.kiro/hooks/paw-reviews-requirements.json`: the local-mode hook of design "Hooks (a)", prompt and description as
     written there; trigger and matcher unchanged. Copy it byte for byte to
     `powers/monkeys-paw/skills/spec-loophole-hook/references/paw-reviews-requirements.json`.
  2. `.kiro/agents/paw.json` and `judge.json` as in design "Agents" (tools, prompts, `includeMcpJson` true, read-only).
     `genie`, `qa` and `legal` stay as they are.
  3. Skills: `curse-a-spec` (the local flow) and `spec-loophole-hook` (one agent loop of your credits per save, no Paw API
     call, no `PAW_API_URL` needed). `curse-taxonomy` stays.
  4. `powers/monkeys-paw/README.md` and the `description` of `plugin.json` say plainly: the power runs on your own Kiro
     agent, with your own model and credits; it sends nothing to any server of ours; `PAW_API_URL` is optional, and
     setting it switches on remote mode with `paw_curse` and `paw_bind` against a Paw API you run. `plugin.json`'s
     description says the first two in one sentence. Remove the placeholder-URL paragraph. `powers/monkeys-paw/mcp.json`
     and `.kiro/settings/mcp.json` keep their `PAW_API_URL` entry.
  5. `.kiro/steering/tech.md` and `structure.md`: name the two modes and the three local tools, and drop "a thin client of
     `apps/api`" for `paw-mcp`.
  6. Update the format tests: `hooks-format.test.ts`, `agents-format.test.ts`, `power-format.test.ts` and
     `repo-wiring.test.ts` as in design "Testing strategy" (new hook prompt and description, the `paw` and `judge` tool
     lists, version `0.2.0`, README wording, steering names, the copy check, no absolute path or secret-shaped string).
  7. Run the whole `paw-mcp` suite (one process) and `pnpm -C packages/paw-mcp typecheck`. Do not run `kiro-cli`.
- [ ] 13. Reviewer task, not an agent task: a real MCP check over stdio, in both modes. Build nothing new; use the
  committed bundle. (a) Local: no `PAW_API_URL` (also try the literal `${PAW_API_URL}` and an empty value). Run
  `initialize`, `tools/list` (exactly `paw_rules`, `paw_check_curses`, `paw_check_verdict`), `paw_rules` with `curse` and
  with `bind`, `paw_check_curses` with good and bad curses (an array and a JSON string), `paw_check_verdict` with a closed,
  an open and a bad verdict. Watch the network (for example a firewall prompt or `lsof -i` on the process) and confirm
  that the process opens no socket. Check stdout is JSON-RPC only and stderr has `mode=local` and `tool ok|invalid ms`
  lines, never the requirement. (b) A set but unusable value (`ftp://x`): local mode, one ignored line, no value in it.
  (c) Remote: `PAW_API_URL` set to a stub API on `127.0.0.1`; five tools; `paw_curse` then `paw_bind` as in task 7.
  Record each result here with the date. (Req 18.1, 18.2, 19, 20, 21)
- [ ] 14. Reviewer task, not an agent task, in the Kiro IDE: install the power from the `powers/monkeys-paw` folder with no
  `PAW_API_URL` set, and confirm that only the three local tools appear (no `paw_curse`, no `paw_bind`). Make the agent
  save a `requirements.md` under `.kiro/specs/` and confirm that `paw-reviews-requirements` fires, calls `paw_rules` once
  and `paw_check_curses` at most 6 times, edits no file, and that nothing goes to any server (no Paw API call; watch
  the network for traffic other than Kiro's own). Confirm that `${PLUGIN_ROOT}` expands (the open question of task 7(c)).
  Confirm the cost: one agent loop per save. Then run `curse-a-spec` on a spec and check the Judge step (paw_rules `bind`,
  `paw_check_verdict`). Run the `paw` and `judge` agents once each. Record the results and the date here. (Req 11,
  14.4, 14.6, 18.1, 18.2)
