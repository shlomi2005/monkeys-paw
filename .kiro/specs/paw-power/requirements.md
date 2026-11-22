# Paw Power — Requirements

## Introduction

The Monkey's Paw is a web app that curses a software requirement (product.md). Kiro users should get the same Paw
inside their own specs. The product brief, section 6, "The Paw inside Kiro", asks for a Kiro power named `monkeys-paw`:
an MCP server, the curse taxonomy, and a hook that makes the Paw comment on open loopholes whenever a
`.kiro/specs/*/requirements.md` file is saved. Section 7 of the brief asks for this repository's own Kiro hooks, five
custom agents (paw, genie, judge, qa with veto, legal with veto) and the missing steering file `tone.md`. The brief
itself is not in the repository.

**Product decision (owner, 20.11).** The product that stays on the market after the hackathon is the Kiro power, not
the website. The power must run on the user's own Kiro agent, with the user's own model and credits, and with no server
of ours, so that it costs us nothing however many people use it. The first version made `paw_curse` and `paw_bind` call
the Paw API, and the API calls Gemini on our money. That does not scale. So the power has two modes:

- **Local mode (the default).** The MCP server makes no network call and calls no model. It hands the Kiro agent the
  Paw's rules (`paw_rules`) and checks what the agent writes (`paw_check_curses`, `paw_check_verdict`). The agent writes
  the curses and judges the amendments itself. A Kiro hook with `"action": {"type": "agent"}` runs its prompt through
  Kiro's own agent in the user's IDE, so the hook works the same way.
- **Remote mode (opt-in).** Setting `PAW_API_URL` to a usable URL adds the tools `paw_curse` and `paw_bind`, which call a
  Paw API that the user runs. This is the old behaviour, unchanged.

The Paw API (`apps/api`) and its code are not changed by this spec. The website stays as a shop window and runs on
Gemini's free tier (see the paw-api spec).

**Scope:**

- `packages/paw-core`: the rule sections of the prompts as named constants, the EARS format line, and the exports that
  the MCP server needs. No prompt wording changes.
- `packages/paw-mcp`: the MCP server (stdio), its two modes, its tests, and its single-file bundle.
- `powers/monkeys-paw/`: the power folder (`plugin.json`, `mcp.json`, committed bundle, notice, README, three skills).
- This repository's `.kiro/settings/mcp.json`, three hooks in `.kiro/hooks/`, two guard scripts in `scripts/`, five
  agents in `.kiro/agents/`, and `.kiro/steering/tone.md`.
- Edits to `tech.md` and `structure.md` for the new package, folder, modes and tool names.
- Format tests for every JSON file this spec adds.

**Out of scope:** changes to `apps/api` or `apps/web` code; publishing to npm; deploying the API; Playwright setup
(paw-web task 42) and the receipt tests (paw-web task 49); running the hooks headless (they run only in the Kiro IDE
and CLI V3).

---

## Glossary

- **Power**: an Agent Plugins 1.0.0 folder (`plugin.json`, optional `mcp.json`, optional `skills/`) that Kiro installs
  from a folder or a repository URL. The format has no steering or hook component.
- **MCP server**: `packages/paw-mcp`, a stdio Model Context Protocol server built on `@modelcontextprotocol/sdk`.
- **Bundle**: `powers/monkeys-paw/server/paw-mcp.mjs`, one ESM file built from the server with esbuild and committed.
- **Local mode**: the default mode. The server registers three tools (`paw_rules`, `paw_check_curses`,
  `paw_check_verdict`), creates no API client and makes no network call.
- **Remote mode**: the mode that `PAW_API_URL` switches on. The server registers the three local tools and also
  `paw_curse` and `paw_bind`, which call the Paw API.
- **Local tools**: `paw_rules`, `paw_check_curses` and `paw_check_verdict`. They are pure: text in, text out.
- **Rule section**: one named string constant exported by `paw-core` that a prompt builder is composed from (the Paw's
  role, the curse rules, the taxonomy list, the guardrails, the curse JSON shape, the Judge's verdict rules, the
  verdict JSON shape).
- **Handle** (remote mode): the string `paw_bind` takes in `curse`: `<first 8 characters of the grant's wishId>:<curse
  id>`, for example `3f2a9c1e:curse-2`. Curse ids alone (`curse-0` to `curse-4`) repeat in every grant, so they are not
  unique.
- **Grant memory** (remote mode): the in-process store of the most recent grants, kept so `paw_bind` can send the whole
  grant.
- **Hook**: a JSON file in `.kiro/hooks/` with `version`, `hooks[]`, `trigger`, `matcher` and `action`
  (`agent` or `command`). File triggers fire only for changes made by the agent, not for manual edits.
- **Guard script**: a small Node script in `scripts/` that a `command` hook runs. It exits 0 when it skips.
- **Custom agent**: a JSON file in `.kiro/agents/` (`name`, `description`, `prompt`, `tools`, `includeMcpJson`,
  `resources`, `permissions`).
- **Veto agent**: `qa` or `legal`. Its last line is `VERDICT: PASS` or `VERDICT: VETO`.
- **Read-only agent**: an agent whose `tools` omit `write` and whose `permissions` deny `fs_write`.

---

## Requirements

### Requirement 1: The MCP server package

**User story:** As a maintainer, I want the server in its own workspace package that reuses the engine's schemas and
rules, so that tool contracts cannot drift from the engine or the API.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** provide `packages/paw-mcp` as a pnpm workspace package (TypeScript strict, ESM, Node 22) with a
   stdio transport built on `@modelcontextprotocol/sdk`.
2. **THE SYSTEM SHALL** import the schemas (`GrantResponseSchema`, `BindResponseSchema`, `GrantSchema`, `CurseSchema`,
   `CurseTypeSchema`, `VerdictSchema`, `BindingKindSchema`), `proposeBinding`, `isEarsCriterion`, the rule sections and
   the types from `paw-core`, and define no copy of them.
3. **THE SYSTEM SHALL** import only `paw-core`, the SDK, `zod`, `zod-to-json-schema`, and Node APIs. It never imports
   `apps/web` or `apps/api` (structure.md).
4. **THE SYSTEM SHALL** build the request body of `POST /api/bind` from `paw-core` types, because the API's request
   schema lives in `apps/api` and is not importable.
5. **THE SYSTEM SHALL** register the tools under the server name `paw`: exactly `paw_rules`, `paw_check_curses` and
   `paw_check_verdict` in local mode, and those three plus `paw_curse` and `paw_bind` in remote mode (Requirement 21).
6. **THE SYSTEM SHALL** declare `zod-to-json-schema` as a direct dependency of `paw-mcp`, pinned exactly to the version
   the SDK already resolves (`3.25.2`), installed with `pnpm --offline`. It is already in the bundle and in `NOTICE.md`.

### Requirement 2: Tool `paw_curse` (remote mode only)

**User story:** As a Kiro user who runs a Paw API, I want to hand the Paw one requirement and get its loopholes, so that
I can fix the spec before an agent builds it literally.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** accept `requirement` (string, trimmed, 1 to 500 characters) and `context` (optional string,
   trimmed, at most 200 characters; empty after trimming means absent).
2. **WHEN** the input is valid, **THE SYSTEM SHALL** send `POST /api/grant` with `{"wish": {"text", "context"?}}`.
3. **WHEN** the API answers 200, **THE SYSTEM SHALL** validate the body with `GrantResponseSchema` (iron rule 6)
   and store the grant in the grant memory.
4. **THE SYSTEM SHALL** return a text block that lists every curse (handle, type, story, loophole), and
   `structuredContent` with the same data: `wishId`, `narration` and `curses[]` of `handle`, `id`, `type`, `status`,
   `story`, `loophole`.
5. **THE SYSTEM SHALL** end the text with one line that shows how to call `paw_bind` with the first handle.
6. **THE SYSTEM SHALL NOT** retry a failed call. The API already retries the model once (iron rule 6).

### Requirement 3: Tool `paw_bind` (remote mode only)

**User story:** As a Kiro user who runs a Paw API, I want to test whether my amendment really closes a loophole, so that
I only keep clauses that work.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** accept `curse` (string, trimmed, 1 to 100 characters), `amendment` (string, trimmed, 1 to 500
   characters) and `kind` (optional, `ears-clause` by default, or `rewrite`).
2. **WHEN** `curse` is a handle that is in the grant memory, **THE SYSTEM SHALL** use that grant and that curse.
3. **WHEN** `curse` is a bare curse id such as `curse-1`, **THE SYSTEM SHALL** look it up in the most recent grant
   only.
4. **WHEN** the curse is found, **THE SYSTEM SHALL** send `POST /api/bind` with `{"grant", "curseId", "kind",
   "clause"}`, where `grant` is the whole stored grant, `curseId` the curse's own id and `clause` the amendment.
5. **WHEN** the API answers 200, **THE SYSTEM SHALL** validate the body with `BindResponseSchema`, replace the stored
   grant with the returned grant, and mark it the most recent.
6. **WHEN** the verdict has `closed: true`, **THE SYSTEM SHALL** return a text that starts with `CLOSED`, gives the
   Judge's reason, and gives the verdict's `property` if there is one.
7. **WHEN** the verdict has `closed: false`, **THE SYSTEM SHALL** return a text that starts with `OPEN`, gives the
   Judge's reason, and says the loophole remains. The result is not an error.
8. **THE SYSTEM SHALL** return `structuredContent` with `handle`, `closed`, `reason`, `property` (if any) and
   `openHandles` (handles of the grant's curses that are still open).
9. **IF** the curse is not in the grant memory, **THEN THE SYSTEM SHALL** return an error result that says the curse
   is unknown and that `paw_curse` must be called first. It makes no API call.

### Requirement 4: Grant memory (remote mode only)

**User story:** As a maintainer, I want grants kept in memory only and bounded, so that nothing about a user's spec
outlives the process (iron rule 2).

**Acceptance criteria:**

1. **THE SYSTEM SHALL** keep at most 20 grants, keyed by `wishId`, and drop the oldest when a 21st arrives.
2. **THE SYSTEM SHALL** keep them in process memory only. It never writes them to disk, a log or an environment
   variable.
3. **WHEN** the process exits, **THE SYSTEM SHALL** lose them. A restart means `paw_curse` must be called again.
4. **WHEN** `paw_bind` resolves a curse, **THE SYSTEM SHALL** match a full handle exactly, and a bare id against the
   newest grant. Two grants whose wishIds share the first 8 characters resolve to the newest.
5. **THE SYSTEM SHALL NOT** create the grant memory in local mode. The local tools keep no state between calls.

### Requirement 5: Mode and API client

**User story:** As a Kiro user, I want the power to work with nothing set, and to switch to my own Paw API with one
variable (and to confirm my age with a second, Requirement 26), so that I pay for no server and still can use one.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** read the environment variable `PAW_API_URL` once, at start-up, and choose the mode from it
   (Requirement 19).
2. **WHILE** the server is in remote mode, **THE SYSTEM SHALL** use the value of `PAW_API_URL` with trailing slashes
   stripped as the base URL of every API call. The placeholder `https://paw-api.invalid` is no longer used for any call.
3. **WHILE** the server is in remote mode, **THE SYSTEM SHALL** time out a request after 30 seconds, and refuse
   redirects.
4. **THE SYSTEM SHALL NOT** send or ship any key, token or cookie. Requests carry only `content-type` and `accept`, and `x-paw-adult-confirmed` when Requirement 26.2 says so.
5. **THE SYSTEM SHALL** use the platform `fetch`, with no HTTP dependency.
6. **WHILE** the server is in local mode, **THE SYSTEM SHALL NOT** create the API client (Requirement 20).

### Requirement 6: Errors are tool results

**User story:** As a Kiro user, I want a plain sentence when something fails, so that the agent can tell me what to do.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** return every failure of every tool as a result with `isError: true`. The server never throws out
   of a tool handler and never exits because of a tool call.
2. **WHEN** the API answers with a non-2xx status and a JSON `{"message": string}`, **THE SYSTEM SHALL** return that
   message unchanged, except a 403 with a known gate code (Requirement 26.3). A 503 therefore keeps "The paw is resting...". (Remote mode.)
3. **WHEN** the API answers non-2xx without such a body, **THE SYSTEM SHALL** return `The Paw API answered HTTP <status>.`
   (Remote mode.)
4. **WHEN** the request fails at the network level or times out, **THE SYSTEM SHALL** return
   `Cannot reach the Paw API at <origin>; set PAW_API_URL.` The origin has no path and no credentials. (Remote mode.)
5. **WHEN** a 2xx answer is not JSON or fails the `paw-core` schema, **THE SYSTEM SHALL** return a sentence that says
   the answer has a shape this tool does not understand. (Remote mode.)
6. **WHEN** the input breaks a limit of Requirement 2.1 or 3.1, **THE SYSTEM SHALL** return an error that names the
   field and the limit. No API call is made.
7. **WHEN** the input of a local tool breaks a rule of Requirement 23, 24 or 25, **THE SYSTEM SHALL** return an error
   that names the field or the path and the rule, one problem per line.

### Requirement 7: Privacy and stdio hygiene

**User story:** As a user, I want the server to keep my requirements to itself, so that nothing leaks through logs.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** write only JSON-RPC to stdout. Nothing else prints there, including during start-up.
2. **THE SYSTEM SHALL** write any log line to stderr, and only these: the start-up line, one line when a set
   `PAW_API_URL` was ignored, and one line per tool call. The start-up line is `paw-mcp <version> mode=local` in local
   mode and `paw-mcp <version> mode=remote api=<origin>` in remote mode. A remote call logs the tool name, the HTTP
   status and the duration. A local call logs the tool name, `ok` or `invalid`, and the duration.
3. **THE SYSTEM SHALL NOT** log, in any stream, the requirement, the context, the curses, the amendment, the verdict,
   a story, a loophole or a grant (iron rule 2), or the value of `PAW_API_URL`.
4. **THE SYSTEM SHALL** start without any environment variable set, and without network access at start-up.

### Requirement 8: The power folder

**User story:** As a Kiro user, I want to install the power from a folder or a repository URL without running npm,
so that it works on a clean machine.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** provide `powers/monkeys-paw/` at the top level of the repository. It is not a pnpm package.
2. **THE SYSTEM SHALL** make `plugin.json` contain exactly: `$schema`
   (`https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`), `name` (`monkeys-paw`), `version` (`0.2.0`),
   `description` (one sentence that says the power runs on your own Kiro agent, with your own model and credits, and
   sends nothing to any server of ours), `author` (`{"name": "Shlomicom"}`), `keywords` (about requirements, specs,
   loopholes, EARS and acceptance criteria) and `license` (`MIT`). It has no `homepage` and no `repository` while the
   public repository is an open decision.
3. **THE SYSTEM SHALL** make `mcp.json` contain the `$schema`
   `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json` and one server `paw` with `"type": "stdio"`,
   `"command": "node"`, `"args": ["${PLUGIN_ROOT}/server/paw-mcp.mjs"]` and `"env": {"PAW_API_URL": "${PAW_API_URL}"}`.
   An unset variable then means local mode.
4. **THE SYSTEM SHALL** commit the bundle `server/paw-mcp.mjs`: one ESM file, built with esbuild from
   `packages/paw-mcp`, with `paw-core` aliased to its committed source `packages/paw-core/src/index.ts` (never to the
   gitignored `dist/`), and with no runtime import of an npm package.
5. **THE SYSTEM SHALL** ship `server/NOTICE.md` with the name, version, licence and copyright line of every
   third-party package inside the bundle (iron rule 4).
6. **THE SYSTEM SHALL** ship a short `README.md` that says plainly: the power runs on your own Kiro agent, with your
   own model and credits; it sends nothing to any server of ours; `PAW_API_URL` is optional, and setting it switches on
   remote mode, with `paw_curse` and `paw_bind` against a Paw API you run. It also gives the install steps, the three
   local tools, the two remote tools, the hook skill, and the limit that file hooks fire only for agent saves.
7. **IF** the committed bundle differs from a fresh build of the sources, **THEN** a test SHALL fail.
8. **THE SYSTEM SHALL** keep the server version constant (`PAW_MCP_VERSION`) and `plugin.json`'s `version` both at
   `0.2.0`, because the tool contract changed.

### Requirement 9: The power's skills

**User story:** As a Kiro user, I want the taxonomy, a review workflow and the hook inside the power, so that one
install gives me everything.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** ship the skills `curse-taxonomy`, `curse-a-spec` and `spec-loophole-hook`, each as
   `skills/<name>/SKILL.md` with front matter `name` and `description`.
2. **THE SYSTEM SHALL** make the body of `curse-taxonomy` the same text as the body of
   `.kiro/steering/curse-taxonomy.md`, because the plugin format has no steering component.
3. **THE SYSTEM SHALL** make `curse-a-spec` give the local flow: read the spec's `requirements.md`; call `paw_rules`
   with `kind` `curse`; write the curses yourself; check them with `paw_check_curses`; report the loopholes; write one
   EARS clause per loophole; call `paw_rules` with `kind` `bind`; judge each clause yourself; check each verdict with
   `paw_check_verdict`; offer only the clauses that came back `CLOSED`. It says that the Judge is the user's own agent
   judging its own clause, so it must be strict.
4. **THE SYSTEM SHALL** make `spec-loophole-hook` copy `references/paw-reviews-requirements.json` into the user's
   `.kiro/hooks/`, without overwriting an existing file of that name, and tell the user that the hook costs one agent
   loop of their own credits per save, makes no Paw API call, and needs no `PAW_API_URL`.
5. **THE SYSTEM SHALL** keep `skills/spec-loophole-hook/references/paw-reviews-requirements.json` byte-identical to
   `.kiro/hooks/paw-reviews-requirements.json`. A test fails otherwise.

### Requirement 10: This repository's MCP config

**User story:** As a contributor, I want the repo's agents to reach the Paw tools, so that they work from a checkout.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** provide `.kiro/settings/mcp.json` with one server `monkeys-paw`: `command` `node`, `args`
   `["powers/monkeys-paw/server/paw-mcp.mjs"]`, `env` `{"PAW_API_URL": "${PAW_API_URL}"}`. Unset means local mode.
2. **THE SYSTEM SHALL** make that path point at a file that exists. A test checks it.
3. **THE SYSTEM SHALL NOT** put any key or URL with credentials in the file.

### Requirement 11: Hook `paw-reviews-requirements`

**User story:** As a Kiro user, I want the Paw to comment when my requirements change, so that loopholes show up while I
write, on my own agent and my own credits.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** provide `.kiro/hooks/paw-reviews-requirements.json` with trigger `PostFileSave` and a matcher
   that matches `.kiro/specs/<name>/requirements.md` as a relative or an absolute path, and no other file.
2. **THE SYSTEM SHALL** use an `agent` action whose prompt is the one in design.md. It uses local mode: it reads the
   `requirements.md` that triggered the hook; calls `paw_rules` with `kind` `curse` once and follows its rules; picks at
   most 3 requirements; for each, writes the curses itself and calls `paw_check_curses` with the requirement (its user
   story and key acceptance criteria, condensed to at most 500 characters) and the curses; and replies with one short
   comment in the Paw's voice.
3. **THE SYSTEM SHALL** make the prompt ask for at most 3 requirements, at most 1 `paw_rules` call and at most 6
   `paw_check_curses` calls per save.
4. **THE SYSTEM SHALL** make the prompt forbid editing, creating or deleting any file.
5. **IF** `paw_check_curses` fails, **THEN** the prompt SHALL make the agent fix the curses and call it once more. If it
   fails again, the agent skips that requirement and says so in one line.
6. **IF** the paw tools are missing, **THEN** the prompt SHALL make the agent say so in one line and stop.
7. **THE SYSTEM SHALL** make the hook's description say that the hook runs on your own Kiro agent (one agent loop per
   save, on your credits) and sends nothing to any server of ours. It does not mention Paw API calls. The trigger and
   the matcher do not change.

### Requirement 12: Hook `golden-wish-eval`

**User story:** As a prompt author, I want the 25 golden wishes to run when I change the prompts or the taxonomy, so
that quality drops are caught early.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** provide `.kiro/hooks/golden-wish-eval.json` with trigger `PostFileSave`, a matcher for
   `packages/paw-core/src/prompts.ts`, `.kiro/steering/curse-taxonomy.md` and
   `powers/monkeys-paw/skills/curse-taxonomy/SKILL.md` (relative or absolute), a `command` action running
   `node scripts/golden-wish-eval.mjs`, and `timeout` 900.
2. **THE SYSTEM SHALL** say in the hook's description that a run costs about 25 model calls.
3. **WHEN** `apps/api/.env` is missing or has no non-empty `GEMINI_API_KEY`, **THE SYSTEM SHALL** make the script print
   one line that starts with `skipped` and exit 0.
4. **WHEN** the key is present, **THE SYSTEM SHALL** make the script run `pnpm --filter @monkeyspaw/api eval` and exit
   with its exit code.
5. **THE SYSTEM SHALL NOT** print, log or pass on the key's value.

### Requirement 13: Hook `ui-screenshot-receipt`

**User story:** As a reviewer, I want screenshot receipts refreshed when the UI changes, so that I can see the effect.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** provide `.kiro/hooks/ui-screenshot-receipt.json` with trigger `PostFileSave`, a matcher for
   `apps/web/src/**/*.tsx` and `*.css` (relative or absolute), a `command` action
   `node scripts/ui-screenshot-receipt.mjs "{{filePath}}"` (the path is quoted, because paths may contain spaces), and
   `timeout` 300.
2. **WHEN** the saved file is a test file (`*.test.ts(x)`, `*.spec.ts(x)`, or under `__tests__/`), **THE SYSTEM SHALL**
   make the script print one `skipped` line and exit 0.
3. **WHEN** `@playwright/test` is not a dependency of `apps/web`, **THE SYSTEM SHALL** make the script print one
   `skipped` line and exit 0.
4. **WHEN** Playwright is a dependency and the file is not a test, **THE SYSTEM SHALL** make the script run `pnpm --filter @monkeyspaw/web exec playwright test --grep @receipt --pass-with-no-tests` and exit with its
   code, so the hook passes between paw-web task 42 and task 49, when no `@receipt` test exists yet.
5. **THE SYSTEM SHALL** add a one-line note to paw-web tasks 42 and 49 that names the `@receipt` tag and this hook.

### Requirement 14: Custom agents

**User story:** As a maintainer, I want five agents with narrow powers, so that review roles stay in their lane.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** provide `.kiro/agents/paw.json`, `genie.json`, `judge.json`, `qa.json` and `legal.json`, and
   no Markdown file under `.kiro/agents/`.
2. **THE SYSTEM SHALL** give each agent `name` (the file name), `description`, `prompt`, `tools`, `includeMcpJson`,
   `resources` and `permissions`, and none of `allowedTools`, `toolsSettings`, `toolAliases` or `hooks`.
3. **THE SYSTEM SHALL** make all five agents read-only (Glossary).
4. **THE SYSTEM SHALL** make `paw` find specific, plausible loopholes with the local flow. Its `tools` are `read`,
   `@monkeys-paw/paw_rules` and `@monkeys-paw/paw_check_curses`. Its prompt tells it to call `paw_rules` with `kind`
   `curse`, write the curses itself, check them with `paw_check_curses`, and fix them once if the check fails. It no
   longer calls `paw_curse`.
5. **THE SYSTEM SHALL** make `genie` narrate in the Paw's voice with `read` only.
6. **THE SYSTEM SHALL** make `judge` decide whether an amendment closes a loophole, reject generic curses, and answer in
   JSON only. Its `tools` are `read`, `@monkeys-paw/paw_rules` and `@monkeys-paw/paw_check_verdict`. To judge an
   amendment it calls `paw_rules` with `kind` `bind`, judges strictly with those rules, checks its verdict with
   `paw_check_verdict`, fixes it once if the check fails, and answers with the checked JSON only. Its curse-quality mode
   is unchanged.
7. **THE SYSTEM SHALL** make `qa` run only `pnpm` test, typecheck, lint and build commands, each as
   `pnpm -C <package dir> ...` (or `pnpm -r test|typecheck|build`), never write a file, deny `fs_write` on `**` and `shell`
   on `git push*`, `git commit*`, `rm *` and `*>*`, and end with `VERDICT: PASS` or `VERDICT: VETO` and the reasons.
8. **THE SYSTEM SHALL** make `legal` check the iron rules read-only (secrets, asset licences, fonts, audio, privacy,
   PG-13, real people, film or brand IP) and end with `VERDICT: PASS` or `VERDICT: VETO` and the reasons.
9. **THE SYSTEM SHALL** point each agent's `resources` at the steering files it needs, as `file://` paths from the
   workspace root.

### Requirement 15: Steering and documents

**User story:** As an author of Paw text, I want one written voice, so that the Paw sounds the same everywhere.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** provide `.kiro/steering/tone.md` with `inclusion: always` on its first line, about 40 lines,
   covering the voice (dry comedy-horror, eerie, elegant, never gory, PG-13, no real people, witty not cruel), short
   sentences, and good and bad example lines.
2. **THE SYSTEM SHALL** update `tech.md` and `structure.md` for `packages/paw-mcp`, `powers/monkeys-paw` and the tool
   names `paw_curse` and `paw_bind` (replacing `paw.curse` and `paw.bind`).
3. **THE SYSTEM SHALL** make `tech.md` and `structure.md` name the two modes (local by default, remote when
   `PAW_API_URL` is usable) and the three local tools `paw_rules`, `paw_check_curses` and `paw_check_verdict`, and say
   that `paw-mcp` is no longer only a thin client of `apps/api`.

### Requirement 16: Tests

**User story:** As a maintainer, I want tests that run offline, so that the spec's files cannot rot silently.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** run all `paw-mcp` tests with `pnpm vitest run` in `packages/paw-mcp`, with no network and no
   real API. Tests may start a stub HTTP server on `127.0.0.1` port 0 and may spawn the stdio server, and close both.
2. **THE SYSTEM SHALL** test the tool list and input schemas in each mode (exact names, required fields, limits).
3. **THE SYSTEM SHALL** test a round trip through an MCP client over the SDK's in-memory transport against the stub, in
   remote mode: `paw_curse`, then `paw_bind` on a returned handle, closed and open.
4. **THE SYSTEM SHALL** test the mode table of Requirement 19, and each error of Requirement 6 (400 message, 503
   resting, unreachable host, invalid shape, unknown curse, input too long).
5. **THE SYSTEM SHALL** test that the stub received the whole grant, the right `curseId` and the amendment as `clause`.
6. **THE SYSTEM SHALL** test that a spawned bundle writes only JSON-RPC to stdout and never logs the requirement, in
   both modes.
7. **THE SYSTEM SHALL** test every file format in Requirement 17.
8. **THE SYSTEM SHALL** test that local mode makes zero network calls (Requirement 20.3), that the tool list differs by
   mode (Requirement 21), and that `paw_rules` cannot drift from `paw-core` (Requirement 23.6).
9. **THE SYSTEM SHALL** test every check of Requirements 24 and 25 with good and bad input, the JSON-string form, the
   ids assigned by the system, and the warnings.
10. **THE SYSTEM SHALL** test in `paw-core` that every prompt builder's output equals a frozen fixture (Requirement 22.3).

### Requirement 17: Format tests

**User story:** As a maintainer, I want the Kiro file formats checked, so that a wrong field fails in CI, not in the IDE.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** check every `.kiro/hooks/*.json`: `version` is `v1`; each hook has `name`, `description`, a
   PascalCase `trigger`, a `matcher` that compiles as a regex and matches its intended example paths (relative and
   absolute) and rejects other paths, and an `action` of the right shape. The old `.kiro.hook` fields (`when`, `then`)
   are rejected. For `paw-reviews-requirements` the test also checks the new prompt (it names `paw_rules`,
   `paw_check_curses`, the limits 3, 1 and 6, and the ban on file changes) and the new description (no mention of API
   calls; it says your own Kiro agent and no server of ours).
2. **THE SYSTEM SHALL** check every `.kiro/agents/*.json` against Requirement 14.2 to 14.3, and that each `resources`
   file exists. For `paw` and `judge` it checks the `tools` lists and that the prompts name the local tools.
3. **THE SYSTEM SHALL** check that `plugin.json` and `mcp.json` have exactly the documented fields, that `version` is
   `0.2.0`, that the description says your own Kiro agent and no server of ours, and that the README says the same and
   says that `PAW_API_URL` is optional.
4. **THE SYSTEM SHALL** check that `.kiro/settings/mcp.json` points at an existing file.
5. **THE SYSTEM SHALL** check the copies: taxonomy skill against steering, hook reference against hook, plugin version
   against the server's version constant, bundle against a fresh build.
6. **THE SYSTEM SHALL** test the guard scripts' decisions as pure functions (key present or not, Playwright present or
   not, test file or not).
7. **THE SYSTEM SHALL** check that no file added by this spec contains an absolute local path or a secret-shaped string.

### Requirement 18: Reviewer checks

**User story:** As the owner, I want the checks that agents cannot run listed, so that nothing is claimed unverified.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** list as reviewer tasks, not agent tasks: a real stdio check of the built bundle in both modes
   (local with no `PAW_API_URL`, remote against a stub API); `kiro-cli agent validate --path` on each agent; installing
   the power from the folder; and, in the Kiro IDE, installing the power with no `PAW_API_URL`, confirming that only the
   three local tools appear, then making the agent save a `requirements.md` and confirming that the hook calls
   `paw_rules` and `paw_check_curses` and that nothing goes to any server.
2. **THE SYSTEM SHALL** record each result in tasks.md, with the date.

### Requirement 19: Mode resolution

**User story:** As a Kiro user, I want the power to work on my own agent with no setup, so that installing it costs
nobody anything.

**Acceptance criteria:**

1. **WHEN** the server starts, **THE SYSTEM SHALL** read `PAW_API_URL` once and choose the mode. A later change of the
   variable has no effect until the next start.
2. **WHEN** `PAW_API_URL` is a usable `http:` or `https:` URL without credentials, **THE SYSTEM SHALL** start in remote
   mode with that URL, trailing slashes stripped. Remote mode is the old behaviour, unchanged: `paw_curse` and
   `paw_bind` call the API exactly as before.
3. **WHEN** `PAW_API_URL` is unset, empty, only whitespace, or an unexpanded `${...}` placeholder, **THE SYSTEM SHALL**
   start in local mode and write no extra line.
4. **IF** `PAW_API_URL` is set to a value that cannot be parsed as a URL, is not `http:` or `https:`, or carries
   credentials, **THEN THE SYSTEM SHALL** start in local mode and write one stderr line that says the value was ignored.
   The line never contains the value.
5. **THE SYSTEM SHALL** make local mode the default: nothing in the environment, the arguments or a file is needed to
   get it.
6. **THE SYSTEM SHALL** write the mode in the start-up line (Requirement 7.2).

### Requirement 20: Local mode makes no network call

**User story:** As the owner, I want proof that the power costs us nothing, so that it can be installed by any number of
people.

**Acceptance criteria:**

1. **WHILE** the server is in local mode, **THE SYSTEM SHALL NOT** create the API client, open a socket or call `fetch`.
2. **THE SYSTEM SHALL** make the three local tools pure functions of their input and of `paw-core`. They call neither
   `fetch` nor any other network API, in either mode, and call no model.
3. **THE SYSTEM SHALL** test this with a `fetch` stub that fails the test when it is called, installed on `globalThis`
   and also passed as `fetchFn`, with every local tool called with valid and with invalid input.

### Requirement 21: Tools by mode, and instructions

**User story:** As a Kiro user, I want to see only tools that work, so that the agent never calls one that fails.

**Acceptance criteria:**

1. **WHILE** the server is in local mode, **THE SYSTEM SHALL** register exactly `paw_rules`, `paw_check_curses` and
   `paw_check_verdict`. `tools/list` returns those three and no other.
2. **WHILE** the server is in remote mode, **THE SYSTEM SHALL** register those three and also `paw_curse` and
   `paw_bind`.
3. **THE SYSTEM SHALL NOT** register `paw_curse` or `paw_bind` in local mode, because they would fail.
4. **THE SYSTEM SHALL** give every tool a name that matches `^[a-zA-Z0-9_-]{1,64}$`, with no dots.
5. **THE SYSTEM SHALL** pass `instructions` in `initialize` (the `McpServer` option), one text per mode. The local text
   describes the local flow in order: call `paw_rules`, write the curses or the verdict yourself, check with
   `paw_check_curses` or `paw_check_verdict`, fix once if the check fails. The remote text adds the two remote tools.

### Requirement 22: One source of truth for the rules

**User story:** As a maintainer, I want the rules written once, so that the website's Paw and Kiro's Paw never disagree.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** make `paw-core`'s `prompts.ts` export its rule sections as named constants: the Paw's role, the
   curse rules, the curse taxonomy list, the guardrails, the curse JSON shape, the Judge's verdict rules and the
   verdict JSON shape. `buildPawPrompt` and `buildJudgePrompt` (verdict mode) are composed from those constants.
2. **THE SYSTEM SHALL** make `ears.ts` export a one-line description of the EARS clause format next to its regexes, and
   make `index.ts` export `isEarsCriterion`, that line and the rule constants.
3. **THE SYSTEM SHALL** keep every prompt that `paw-core` builds byte-identical. Before the refactor, a `paw-core` test
   captures the exact output of every prompt builder for fixed inputs as a frozen fixture file. The test compares with
   `toBe`, not a snapshot that `-u` can rewrite, and it passes both before and after the refactor.
4. **THE SYSTEM SHALL NOT** change any prompt wording in this spec. The golden-wish eval therefore does not need to run.

### Requirement 23: Tool `paw_rules`

**User story:** As a Kiro agent, I want the Paw's rules as text, so that I can play the Paw or the Judge myself.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** accept `kind`: `curse` (finding loopholes) or `bind` (judging an amendment). Any other value is
   an input error that names the field and the two values.
2. **WHEN** `kind` is `curse`, **THE SYSTEM SHALL** return text and `structuredContent` built only from `paw-core`
   exports plus a local footer: the Paw's role and curse rules, the taxonomy (its 10 tags equal
   `CurseTypeSchema.options`), the guardrails, the curse JSON shape, and a JSON Schema of the `curses` array made from
   `paw-core`'s `CurseSchema` (`type`, `story`, `loophole`; 3 to 5 items, the limits of `GrantSchema`) with
   `zod-to-json-schema`. The footer says: write the curses yourself, include no ids, then call `paw_check_curses` with
   the requirement and the curses.
3. **WHEN** `kind` is `bind`, **THE SYSTEM SHALL** return the Judge's verdict rules, the verdict JSON shape (`closed`,
   `reason`, `property`), the EARS clause format the amendment must follow, and a JSON Schema made from `paw-core`'s
   `VerdictSchema` (`closed`, `reason`, `property`). The footer says: judge the amendment yourself, strictly, then call
   `paw_check_verdict`.
4. **THE SYSTEM SHALL** write the footers in `paw-mcp` and nothing else of the rules there. Every rule sentence comes
   from `paw-core`.
5. **THE SYSTEM SHALL** make no network call and keep no state.
6. **THE SYSTEM SHALL** have a drift test in `paw-mcp` that fails when `paw_rules` drifts from `paw-core`: every rule
   section it returns appears verbatim in the matching `paw-core` prompt (`buildPawPrompt`, or `buildJudgePrompt` in
   verdict mode) for a fixed input; the taxonomy tags equal `CurseTypeSchema.options`; the JSON Schema's `type` enum
   equals `CurseTypeSchema.options` and its limits equal the `paw-core` schema limits.

### Requirement 24: Tool `paw_check_curses`

**User story:** As a Kiro agent, I want my curses checked by rule, so that I fix them before I show them.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** accept `requirement` (string, trimmed, 1 to 500 characters, as `paw_curse`) and `curses`: an
   array of `{type, story, loophole}`, or a JSON string of such an array, because some clients send nested arguments as
   strings. Extra keys such as `id` or `status` are ignored. The system assigns the ids.
2. **THE SYSTEM SHALL** check, each failure as one line that names the path (for example `curses[2].type must be one of:
   permissions, time, ...`): the array holds 3 to 5 curses (`GrantSchema`); each curse parses with `CurseSchema`; `story`
   and `loophole` are not empty after trim; `story` is at most 360 characters (the schema); `loophole` is at most 1000
   characters (the API's bind cap); all types are distinct (the Paw prompt's rule).
3. **IF** any check fails, **THEN THE SYSTEM SHALL** return `isError: true` and the text `The curses do not pass yet:`
   followed by every problem, one per line, at most 10.
4. **WHEN** every check passes, **THE SYSTEM SHALL** return, in text and in `structuredContent`, the normalised curses:
   ids `curse-0` to `curse-<n-1>` assigned by the system, `status` `open`, strings trimmed.
5. **WHEN** a loophole shares no word of 4 or more letters with the requirement (compared case-insensitively), **THE
   SYSTEM SHALL** add a warning, not an error: `curse-2: the loophole does not quote the requirement; point to its exact
   words.` Warnings appear in the text and in `structuredContent`.
6. **THE SYSTEM SHALL** make no network call and keep no state.

### Requirement 25: Tool `paw_check_verdict`

**User story:** As a Kiro agent playing the Judge, I want my verdict checked by rule, so that it has the shape the
export needs.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** accept `curse` (a curse as `paw_check_curses` returns it, or a JSON string of one; `id` optional,
   default `curse-0`; checked with `CurseSchema`), `amendment` (string, trimmed, 1 to 500 characters, as `paw_bind`),
   `kind` (optional: `ears-clause` by default, or `rewrite`, from `BindingKindSchema`) and `verdict` (`{closed, reason,
   property?}`, or a JSON string of one).
2. **WHEN** `kind` is `ears-clause`, **THE SYSTEM SHALL** require that the amendment passes `isEarsCriterion`. The error
   says that it must start with WHEN, IF, WHILE, WHERE or THE SYSTEM SHALL and contain SHALL.
3. **THE SYSTEM SHALL** require that the verdict parses with `VerdictSchema` after the system injects `curseId` and
   `judgedAt`, as `judgeBinding` does, and that `reason` is not empty after trim.
4. **WHEN** `closed` is true, **THE SYSTEM SHALL** require a `property` that starts with `For any` and has at most 40
   words (the Judge prompt's rule). **WHEN** `closed` is false, **THE SYSTEM SHALL** drop `property`.
5. **IF** any check fails, **THEN THE SYSTEM SHALL** return `isError: true` and every problem, one per line, as in
   Requirement 24.3.
6. **WHEN** every check passes, **THE SYSTEM SHALL** return, in `structuredContent`, the normalised verdict (`curseId`,
   `closed`, `reason`, `property` only when closed, `judgedAt` from an injectable clock) and the binding made by
   `paw-core`'s `proposeBinding`. The text has `paw_bind`'s form: `CLOSED: <reason>` and `Property: <property>`, or
   `OPEN: <reason> The loophole remains. ...`. An open verdict is not an error.
7. **THE SYSTEM SHALL** make no network call and keep no state.

### Requirement 26: Age confirmation in remote mode

**User story:** As the owner, I want the remote tools to work against a gated Paw API only when the user has confirmed
for themselves that they are 18 or older. The confirmation is not proof of age and the gate is not legal advice
(paw-api Requirement 14).

**Acceptance criteria:**

1. **WHILE** the server is in local mode, **THE SYSTEM SHALL** stay as it is: the same three tools, no network call, and
   `PAW_I_AM_18_OR_OLDER` has no effect. Both `mcp.json` files do not change.
2. **WHILE** the server is in remote mode, **THE SYSTEM SHALL** read `PAW_I_AM_18_OR_OLDER` once at start-up. **ONLY
   WHEN** it is exactly `yes`, `paw_curse` and `paw_bind` send the header `X-Paw-Adult-Confirmed: yes`. It is set by the
   person in the server's environment and is never a tool argument.
3. **WHEN** the API answers 403 with the code `live_region_unavailable` or `adult_confirmation_required`, **THE SYSTEM
   SHALL** return an `isError` result with a fixed text, not the server's. Region: live wishes are not offered from here,
   and the three local tools still work. Adult: only the user can confirm, they set `PAW_I_AM_18_OR_OLDER=yes` themselves
   and restart the server, and the agent must not set it for them. Any other 403 follows Requirement 6.2 and 6.3.
4. **THE SYSTEM SHALL** say in the power README the variable, the gate, and that in remote mode wishes go to Gemini,
   where Google may use them and people there may read them.
5. **THE SYSTEM SHALL** test, with a fake `fetch`: the header is absent for unset, `Yes`, ` yes`, `true` and empty, and
   present for `yes`; no local tool sends it; both 403 texts; the value of the variable and the response body are never
   logged. The committed bundle is rebuilt and `bundle-fresh.test.ts` stays green.

