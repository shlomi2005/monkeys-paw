# Paw Power — Requirements

## Introduction

The Monkey's Paw is a web app that curses a software requirement (product.md). Kiro users should get the same Paw
inside their own specs. The product brief, section 6, "The Paw inside Kiro", asks for a Kiro power named `monkeys-paw`:
an MCP server with two tools (curse a requirement, judge an amendment), the curse taxonomy, and a hook that makes the
Paw comment on open loopholes whenever a `.kiro/specs/*/requirements.md` file is saved. Section 7 of the brief asks for
this repository's own Kiro hooks, five custom agents (paw, genie, judge, qa with veto, legal with veto) and the missing
steering file `tone.md`. The brief itself is not in the repository.

The Paw API (`apps/api`) already exists and is not changed. The MCP server is a thin client of it: the server never
calls a model and holds no key (tech.md: the API is the only place that calls the model).

**Scope:**

- `packages/paw-mcp`: the MCP server (stdio), its tests, and its single-file bundle.
- `powers/monkeys-paw/`: the power folder (`plugin.json`, `mcp.json`, committed bundle, notice, README, three skills).
- This repository's `.kiro/settings/mcp.json`, three hooks in `.kiro/hooks/`, two guard scripts in `scripts/`, five
  agents in `.kiro/agents/`, and `.kiro/steering/tone.md`.
- Edits to `tech.md` and `structure.md` for the new package, folder and tool names.
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
- **Placeholder URL**: `https://paw-api.invalid`, a reserved name that never resolves. It stands in until the API is
  deployed.
- **Handle**: the string `paw_bind` takes in `curse`: `<first 8 characters of the grant's wishId>:<curse id>`, for
  example `3f2a9c1e:curse-2`. Curse ids alone (`curse-0` to `curse-4`) repeat in every grant, so they are not unique.
- **Grant memory**: the in-process store of the most recent grants, kept so `paw_bind` can send the whole grant.
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

**User story:** As a maintainer, I want the server in its own workspace package that reuses the engine's schemas, so
that tool contracts cannot drift from the API.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** provide `packages/paw-mcp` as a pnpm workspace package (TypeScript strict, ESM, Node 22) with a
   stdio transport built on `@modelcontextprotocol/sdk`.
2. **THE SYSTEM SHALL** import `GrantResponseSchema`, `BindResponseSchema`, `GrantSchema`, `BindingKindSchema` and the
   types from `paw-core`, and define no copy of them.
3. **THE SYSTEM SHALL** import only `paw-core`, the SDK, `zod`, and Node APIs. It never imports `apps/web` or `apps/api`
   (structure.md).
4. **THE SYSTEM SHALL** build the request body of `POST /api/bind` from `paw-core` types, because the API's request
   schema lives in `apps/api` and is not importable.
5. **THE SYSTEM SHALL** register exactly two tools, `paw_curse` and `paw_bind`, under the server name `paw`.

### Requirement 2: Tool `paw_curse`

**User story:** As a Kiro user, I want to hand the Paw one requirement and get its loopholes, so that I can fix the spec
before an agent builds it literally.

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

### Requirement 3: Tool `paw_bind`

**User story:** As a Kiro user, I want to test whether my amendment really closes a loophole, so that I only keep
clauses that work.

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

### Requirement 4: Grant memory

**User story:** As a maintainer, I want grants kept in memory only and bounded, so that nothing about a user's spec
outlives the process (iron rule 2).

**Acceptance criteria:**

1. **THE SYSTEM SHALL** keep at most 20 grants, keyed by `wishId`, and drop the oldest when a 21st arrives.
2. **THE SYSTEM SHALL** keep them in process memory only. It never writes them to disk, a log or an environment
   variable.
3. **WHEN** the process exits, **THE SYSTEM SHALL** lose them. A restart means `paw_curse` must be called again.
4. **WHEN** `paw_bind` resolves a curse, **THE SYSTEM SHALL** match a full handle exactly, and a bare id against the
   newest grant. Two grants whose wishIds share the first 8 characters resolve to the newest.

### Requirement 5: API client and base URL

**User story:** As a Kiro user, I want to point the power at any Paw API with one variable, so that I can switch from
the placeholder to the deployed API.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** read the base URL from the environment variable `PAW_API_URL`.
2. **IF** `PAW_API_URL` is unset, empty, only whitespace, a literal `${...}` placeholder, not an `http:` or `https:`
   URL, or carries credentials in the URL, **THEN THE SYSTEM SHALL** use the placeholder URL `https://paw-api.invalid`.
3. **THE SYSTEM SHALL** strip trailing slashes from the base URL.
4. **THE SYSTEM SHALL** time out a request after 30 seconds, and refuse redirects.
5. **THE SYSTEM SHALL NOT** send or ship any key, token or cookie. Requests carry only `content-type` and `accept`.
6. **THE SYSTEM SHALL** use the platform `fetch`, with no HTTP dependency.

### Requirement 6: Errors are tool results

**User story:** As a Kiro user, I want a plain sentence when something fails, so that the agent can tell me what to do.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** return every failure as a result with `isError: true` and one plain sentence of text. The
   server never throws out of a tool handler and never exits because of a tool call.
2. **WHEN** the API answers with a non-2xx status and a JSON `{"message": string}`, **THE SYSTEM SHALL** return that
   message unchanged. A 503 therefore keeps "The paw is resting...".
3. **WHEN** the API answers non-2xx without such a body, **THE SYSTEM SHALL** return `The Paw API answered HTTP <status>.`
4. **WHEN** the request fails at the network level or times out, **THE SYSTEM SHALL** return
   `Cannot reach the Paw API at <origin>; set PAW_API_URL.` The origin has no path and no credentials.
5. **WHEN** a 2xx answer is not JSON or fails the `paw-core` schema, **THE SYSTEM SHALL** return a sentence that says
   the answer has a shape this tool does not understand.
6. **WHEN** the input breaks a limit of Requirement 2.1 or 3.1, **THE SYSTEM SHALL** return an error that names the
   field and the limit. No API call is made.

### Requirement 7: Privacy and stdio hygiene

**User story:** As a user, I want the server to keep my requirements to itself, so that nothing leaks through logs.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** write only JSON-RPC to stdout. Nothing else prints there, including during start-up.
2. **THE SYSTEM SHALL** write any log line to stderr, and only these: the API origin at start-up, and for each call the
   tool name, the HTTP status and the duration.
3. **THE SYSTEM SHALL NOT** log, in any stream, the requirement, the context, the amendment, a story, a loophole or a
   grant (iron rule 2).
4. **THE SYSTEM SHALL** start without any environment variable set, and without network access at start-up.

### Requirement 8: The power folder

**User story:** As a Kiro user, I want to install the power from a folder or a repository URL without running npm,
so that it works on a clean machine.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** provide `powers/monkeys-paw/` at the top level of the repository. It is not a pnpm package.
2. **THE SYSTEM SHALL** make `plugin.json` contain exactly: `$schema`
   (`https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`), `name` (`monkeys-paw`), `version` (`0.1.0`),
   `description`, `author` (`{"name": "Shlomicom"}`), `keywords` (about requirements, specs, loopholes, EARS and
   acceptance criteria) and `license` (`MIT`). It has no `homepage` and no `repository` while the public repository
   and the deploy are open decisions.
3. **THE SYSTEM SHALL** make `mcp.json` contain the `$schema`
   `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json` and one server `paw` with `"type": "stdio"`,
   `"command": "node"`, `"args": ["${PLUGIN_ROOT}/server/paw-mcp.mjs"]` and `"env": {"PAW_API_URL": "${PAW_API_URL}"}`.
4. **THE SYSTEM SHALL** commit the bundle `server/paw-mcp.mjs`: one ESM file, built with esbuild from
   `packages/paw-mcp`, with `paw-core` aliased to its committed source `packages/paw-core/src/index.ts` (never to the
   gitignored `dist/`), and with no runtime import of an npm package.
5. **THE SYSTEM SHALL** ship `server/NOTICE.md` with the name, version, licence and copyright line of every
   third-party package inside the bundle (iron rule 4).
6. **THE SYSTEM SHALL** ship a short `README.md`: install (import from a folder or a repository URL), setting
   `PAW_API_URL`, the two tools, the hook skill, and the limit that file hooks fire only for agent saves.
7. **IF** the committed bundle differs from a fresh build of the sources, **THEN** a test SHALL fail.

### Requirement 9: The power's skills

**User story:** As a Kiro user, I want the taxonomy, a review workflow and the hook inside the power, so that one
install gives me everything.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** ship the skills `curse-taxonomy`, `curse-a-spec` and `spec-loophole-hook`, each as
   `skills/<name>/SKILL.md` with front matter `name` and `description`.
2. **THE SYSTEM SHALL** make the body of `curse-taxonomy` the same text as the body of
   `.kiro/steering/curse-taxonomy.md`, because the plugin format has no steering component.
3. **THE SYSTEM SHALL** make `curse-a-spec` give these steps: read the spec's `requirements.md`; call `paw_curse` for
   each requirement; report the loopholes; propose one EARS clause per loophole; check each with `paw_bind`; keep only
   clauses the Judge closes.
4. **THE SYSTEM SHALL** make `spec-loophole-hook` copy `references/paw-reviews-requirements.json` into the user's
   `.kiro/hooks/`, without overwriting an existing file of that name, and tell the user that the hook costs credits.
5. **THE SYSTEM SHALL** keep `skills/spec-loophole-hook/references/paw-reviews-requirements.json` byte-identical to
   `.kiro/hooks/paw-reviews-requirements.json`. A test fails otherwise.

### Requirement 10: This repository's MCP config

**User story:** As a contributor, I want the repo's agents to reach the Paw tools, so that they work from a checkout.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** provide `.kiro/settings/mcp.json` with one server `monkeys-paw`: `command` `node`, `args`
   `["powers/monkeys-paw/server/paw-mcp.mjs"]`, `env` `{"PAW_API_URL": "${PAW_API_URL}"}`.
2. **THE SYSTEM SHALL** make that path point at a file that exists. A test checks it.
3. **THE SYSTEM SHALL NOT** put any key or URL with credentials in the file.

### Requirement 11: Hook `paw-reviews-requirements`

**User story:** As a Kiro user, I want the Paw to comment when my requirements change, so that loopholes show up while I
write.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** provide `.kiro/hooks/paw-reviews-requirements.json` with trigger `PostFileSave` and a matcher
   that matches `.kiro/specs/<name>/requirements.md` as a relative or an absolute path, and no other file.
2. **THE SYSTEM SHALL** use an `agent` action whose prompt is the one in design.md.
3. **THE SYSTEM SHALL** make the prompt ask for at most 3 requirements and at most 3 `paw_curse` calls per save.
4. **THE SYSTEM SHALL** make the prompt forbid editing any file.
5. **IF** the tool is missing or returns an error, **THEN** the prompt SHALL make the agent say so in one line and stop.

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
4. **THE SYSTEM SHALL** make `paw` find specific, plausible loopholes using `@monkeys-paw/paw_curse`.
5. **THE SYSTEM SHALL** make `genie` narrate in the Paw's voice with `read` only.
6. **THE SYSTEM SHALL** make `judge` decide whether an amendment closes a loophole, reject generic curses, answer in
   JSON only, and use `@monkeys-paw/paw_bind` when it needs the live Judge.
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

### Requirement 16: Tests

**User story:** As a maintainer, I want tests that run offline, so that the spec's files cannot rot silently.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** run all `paw-mcp` tests with `pnpm vitest run` in `packages/paw-mcp`, with no network and no
   real API. Tests may start a stub HTTP server on `127.0.0.1` port 0 and may spawn the stdio server, and close both.
2. **THE SYSTEM SHALL** test the tool list and input schemas (names, required fields, limits).
3. **THE SYSTEM SHALL** test a round trip through an MCP client over the SDK's in-memory transport against the stub:
   `paw_curse`, then `paw_bind` on a returned handle, closed and open.
4. **THE SYSTEM SHALL** test the URL rules of Requirement 5, and each error of Requirement 6 (400 message, 503 resting,
   unreachable host, invalid shape, unknown curse, input too long).
5. **THE SYSTEM SHALL** test that the stub received the whole grant, the right `curseId` and the amendment as `clause`.
6. **THE SYSTEM SHALL** test that a spawned bundle writes only JSON-RPC to stdout and never logs the requirement.
7. **THE SYSTEM SHALL** test every file format in Requirement 17.

### Requirement 17: Format tests

**User story:** As a maintainer, I want the Kiro file formats checked, so that a wrong field fails in CI, not in the IDE.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** check every `.kiro/hooks/*.json`: `version` is `v1`; each hook has `name`, `description`, a
   PascalCase `trigger`, a `matcher` that compiles as a regex and matches its intended example paths (relative and
   absolute) and rejects other paths, and an `action` of the right shape. The old `.kiro.hook` fields (`when`, `then`)
   are rejected.
2. **THE SYSTEM SHALL** check every `.kiro/agents/*.json` against Requirement 14.2 to 14.3, and that each `resources`
   file exists.
3. **THE SYSTEM SHALL** check that `plugin.json` and `mcp.json` have exactly the documented fields.
4. **THE SYSTEM SHALL** check that `.kiro/settings/mcp.json` points at an existing file.
5. **THE SYSTEM SHALL** check the copies: taxonomy skill against steering, hook reference against hook, plugin version
   against the server's version constant, bundle against a fresh build.
6. **THE SYSTEM SHALL** test the guard scripts' decisions as pure functions (key present or not, Playwright present or
   not, test file or not).
7. **THE SYSTEM SHALL** check that no file added by this spec contains an absolute local path or a secret-shaped string.

### Requirement 18: Reviewer checks

**User story:** As the owner, I want the checks that agents cannot run listed, so that nothing is claimed unverified.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** list as reviewer tasks, not agent tasks: a real stdio check of the built bundle against a stub
   API; `kiro-cli agent validate --path` on each agent; installing the power from the folder; and, in the Kiro IDE,
   that each hook fires on an agent save.
2. **THE SYSTEM SHALL** record each result in tasks.md, with the date.
