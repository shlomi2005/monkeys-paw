# Paw edge — Tasks

Agents run no `apps/api` test in the repository. The reviewer runs them in a clean copy that has no `.env`. Do not
read `apps/api/.env`.

- [x] 1. `wrangler` as a devDependency of `apps/api` at an exact version at least two weeks old, in the lockfile;
  `.wrangler/` and `.dev.vars*` in `.gitignore`. No other new runtime dependency. (Req 11.3, 11.4)
  Done: `wrangler` 4.158.0 is an exact devDependency of `apps/api` and in the lockfile; `workerd: false` under `allowBuilds`; `.wrangler/` and `.dev.vars*` are in `.gitignore`.
- [ ] 2. The store seam and the examples loader in `apps/api` (`src/budget/store.ts`, `budget/state.ts`,
  `budget/guarded-client.ts`, `app.ts`, `routes/examples.ts`), with tests: no store is as today, the load rule, a
  leftover reservation counts as spent, an unreadable row is a spent day, the save before the first upstream fetch,
  the examples loader and Node's path unchanged. Agents run no `apps/api` test in the repository. (Req 5, 7)
- [ ] 3. The edge modules (`src/edge/headers.ts`, `sql-store.ts`, `config.ts`, `types.ts`, `worker.ts` with
  `PawObject`) and `apps/api/wrangler.json`, with tests: forged headers in both directions, `CF-Worker`, `XX` and
  `T1`, the XFF overwrite and the per-IP limit, no IP in storage, the budget across an object restart, the config file
  checks, and properties 1 to 5. Agents run no `apps/api` test in the repository. (Req 1 to 4, 6, 9, 12)
- [ ] 4. The fetch-count test: chain cut to 3, at most 42 upstream fetches for a grant and 6 for a bind, with a fake
  `fetch`. Agents run no `apps/api` test in the repository. (Req 8)
- [ ] 5. The MCP `User-Agent: paw-mcp/<version>` in `packages/paw-mcp`, its tests, and the rebuilt bundle in
  `powers/monkeys-paw/server/`. (Req 10.1, 10.3)
- [ ] 6. README section "Deploy your own (Cloudflare Workers Free)" with the owner checks of task 7, and one line in
  the power README that `PAW_API_URL` may be the edge's https URL. (Req 10.2, 11.1)
- [ ] 7. Owner task, not an agent task: create the Cloudflare account, `wrangler login`, `wrangler secret put
  GEMINI_API_KEY`, `wrangler deploy`, then the deployed checks: (1) a real live wish from the deployed site, repeated
  over a day, and from another country's network if possible; (2) forged country in both directions: from an allowed
  country, send a refused code in `x-paw-country` and `cf-ipcountry`, and GET /api/live still says `live: true`; from a
  refused country (for example over a VPN), send `US` in the same headers, and it stays `live: false`; (3) eleven live
  calls, each with a different forged `x-forwarded-for`: the eleventh is refused, and a second real network is not;
  (4) an idle wait of a few minutes and a redeploy, then GET /api/health still shows the day's spend; (5) one full call
  from the MCP client with `PAW_API_URL` set to the workers.dev URL; and the items of "Not verifiable without a
  deploy" in the requirements.
