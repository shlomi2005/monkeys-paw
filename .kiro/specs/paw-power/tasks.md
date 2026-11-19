# Paw Power — Tasks

Ordered checklist for the Paw inside Kiro. Requirements are cited as `Req N.M` (see `requirements.md`), decisions as
`D1`–`D13` (design.md, "Decisions and deviations"). Each task is sized for one agent run. Tests are in the task that adds
the code, run with `pnpm vitest run` in `packages/paw-mcp`. No agent can run a hook, validate an agent in the IDE or
install a power, so tasks 7 and 8 are the reviewer's. Do not change `apps/api` or `apps/web` code in any task.

- [ ] 1. Scaffold `packages/paw-mcp` and its pure modules: `package.json` (name `paw-mcp`, private, ESM, scripts `build`,
  `bundle`, `test`, `typecheck`; dependencies `@modelcontextprotocol/sdk`, `zod`, `paw-core`; dev dependency `esbuild`),
  `tsconfig.json`, `src/version.ts`, `base-url.ts`, `handle.ts`, `grant-memory.ts`, `render.ts`. Resolve `paw-core` the
  way `apps/api` does (D12) and pin the versions pnpm resolves (D13). Tests: `base-url.test.ts` (every row of the URL
  table), `handle.test.ts`, `grant-memory.test.ts` (eviction at 21, newest wins, bare id uses the newest grant, a
  fast-check property that the memory never exceeds 20). Run the new suite and `pnpm typecheck`. (Req 1.1–1.3, 4, 5.1–5.3)
- [ ] 2. The tools and the server: `api-client.ts` (timeout, `redirect: 'error'`, the error table), `tool-curse.ts`,
  `tool-bind.ts`, `server.ts`, `index.ts` (stdio, one stderr line, no stdout writes). First check which way the pinned SDK
  reports input-validation failures and apply D8 if needed. Tests: `tools.test.ts`, `roundtrip.test.ts` (stub HTTP server
  on `127.0.0.1:0`, MCP client over the in-memory transport, curse then bind closed and open, stub sees the whole grant,
  `curseId` and `clause`), `errors.test.ts` (400, 503, 500, non-JSON error, unreachable host, timeout, invalid shape,
  unknown curse with no API call, over-long and empty input). Close every server. (Req 1.4–1.5, 2, 3, 5.4–5.6, 6, 7.1–7.4,
  16.1–16.5)
- [ ] 3. The bundle: `scripts/build-bundle.mjs`, the committed `powers/monkeys-paw/server/paw-mcp.mjs`,
  `server/NOTICE.md` (from the metafile's package list). The esbuild call aliases `paw-core` to
  `packages/paw-core/src/index.ts`, never to `dist/` (design.md "The bundle", D12). If the unminified bundle is over 1 MB,
  set `minify: true` in the script and in the test; record the final size and the `minify` value in design.md "The
  bundle". Tests: `bundle-fresh.test.ts` (same call and alias, `write: false`, bytes equal the committed file; `NOTICE.md`
  names every bundled package), `stdio.test.ts` (spawn the bundle against the stub; stdout is JSON-RPC only; stderr never
  has the requirement). Check that the build and the tests pass on a tree with no `packages/paw-core/dist/`. Confirm with
  `git check-ignore` that no new file is ignored. (Req 7.1, 8.4, 8.5, 8.7, 16.6)
- [ ] 4. The power folder: `powers/monkeys-paw/plugin.json`, `mcp.json`, `README.md`, the three skills, and
  `references/paw-reviews-requirements.json` (a copy of the hook from task 5; if task 5 is not done, write the hook file
  first, exactly as in design.md, and let task 5 only verify it). Confirm with `git check-ignore` that no new file is
  ignored. Test: `power-format.test.ts`. (Req 8.1–8.3, 8.6, 9, 17.3, 17.5)
- [ ] 5. Repo wiring: `.kiro/settings/mcp.json`, the three hooks in `.kiro/hooks/` exactly as in design.md,
  `scripts/golden-wish-eval.mjs` and `scripts/ui-screenshot-receipt.mjs` (each exports its pure decision function).
  Tests: `hooks-format.test.ts` (including the matcher example paths), `guards.test.ts`, `repo-wiring.test.ts` (the MCP
  path exists). Never print or log the Gemini key in any test. The `@receipt` notes in paw-web tasks 42 and 49 were added
  when this spec was written; verify they are still there. Do not run the real eval. (Req 10, 11, 12, 13, 17.1, 17.4,
  17.6)
- [ ] 6. The five agents in `.kiro/agents/` (`paw`, `genie`, `judge`, `qa`, `legal`, as in design.md "Agents"),
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
- [ ] 8. Reviewer task, not an agent task, in the Kiro IDE: make the agent save a `requirements.md` and confirm that
  `paw-reviews-requirements` fires, finds the file that triggered it, and calls `paw_curse` at most 3 times; save
  `prompts.ts` and confirm `golden-wish-eval` prints `skipped` without a key; save a `.tsx` file in `apps/web/src` and
  confirm `ui-screenshot-receipt` prints `skipped` until paw-web task 42 lands. Record the results and the date here.
  Then decide the open items: the deployed API URL (replace the placeholder in the README and tests), `homepage` and
  `repository` in `plugin.json`. (Req 11, 12, 13, 18.1, 18.2)
