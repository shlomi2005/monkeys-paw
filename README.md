# The Monkey's Paw

Make a wish. The Paw grants it, exactly.

You write a software requirement. The Paw follows it to the letter and acts out up to five ways it goes wrong. You close each loophole with a rewrite or an EARS clause, and a Judge decides whether it is really closed. When the paw rests, you export `requirements.md` and `properties.md` for Kiro.

## Quickstart

### Prerequisites

Node.js 24 (see `.nvmrc`), pnpm 12.21.0 (`npm install --global pnpm@12.21.0`), bash or zsh (tried on macOS), and free ports 8787 and 5173. Run everything from the root of the clone.

### Install and build

```sh
pnpm install
pnpm build
```

Vite warns about a chunk over 500 kB. That is expected.

### Play without a key

Terminal 1. It prints ".env not found. Continuing without it." That is normal. With no key the API runs in "examples-only" mode.

```sh
pnpm -C apps/api dev
```

Terminal 2:

```sh
pnpm -C apps/web dev
```

Open http://localhost:5173. The three ready rounds work from start to export. Choose an example, press "Make the wish", open each curse and press "Accept this clause". Then "Take the scroll" downloads a zip with `requirements.md` and `properties.md`. "Open in Kiro" offers the same two files as a folder and shows where to put it. The curses and verdicts were written in advance, and no model is called. Ctrl-C stops each terminal.

### A live wish with your own key

First, create a Gemini key (see [Running on the free tier](apps/api/README.md#running-on-the-free-tier)). The text of your wish goes to Google. Live wishes are for adults only and only where Google allows them. On the free tier that leaves out the EEA, Switzerland and the UK (see "Live wishes" below). Stop both servers.

Terminal 1. This reads the key without echo. Paste it as one line by itself, so the paste does not swallow the next command:

```sh
printf 'Gemini API key: '; read -rs GEMINI_API_KEY; export GEMINI_API_KEY; echo
```

Then:

```sh
GEMINI_TIER=free COUNTRY_HEADER=x-paw-dev-country pnpm -C apps/api dev
```

Terminal 2:

```sh
PAW_DEV_COUNTRY=XX pnpm -C apps/web dev
```

Replace `XX` with the two uppercase letters of the country you are really in. `XX` itself is refused. Open the same address, tick "I am 18 or older" and write a wish. Use `GEMINI_TIER=paid` only for a key from a project with billing. If the paw says "The paw mumbles nonsense. Try again.", the model call failed: the `model_call` line in terminal 1 shows its HTTP status.

Caution: this is for local use only. The API listens on every network interface, so anyone who can reach port 8787 can set that header and use your key. Use a network you trust, stop both servers afterwards and run `unset GEMINI_API_KEY`.

### Run the tests

Use a terminal without `GEMINI_API_KEY`. The tests use fakes and never call Google.

```sh
pnpm test
pnpm typecheck
pnpm -C apps/web lint
```

End-to-end tests need port 4173 free. The first command downloads Chromium once:

```sh
pnpm -C apps/web exec playwright install chromium
pnpm -C apps/web e2e
```

## Deploy your own (Cloudflare Workers Free)

You need a Cloudflare account on the Free plan (no card), the prerequisites of the quickstart, and optionally a Gemini key. Without a key the site plays the ready rounds.

Try it on your machine first, with no account. Run `pnpm build`, then `pnpm -C apps/api exec wrangler dev`, and open http://localhost:8787. Storage is local, under `apps/api/.wrangler/`. There is no jurisdiction locally, and `request.cf` comes from wrangler (a placeholder when it cannot fetch one), so the country shown there is not yours.

To deploy, run this from the root of the clone:

```sh
pnpm install
pnpm build
cd apps/api
pnpm exec wrangler login
pnpm exec wrangler secret put GEMINI_API_KEY   # optional; paste the key when asked
pnpm exec wrangler deploy
```

The last command prints the `workers.dev` address. Settings such as `DAILY_BUDGET_CENTS` go in `vars` of `apps/api/wrangler.json` or in the dashboard. `GEMINI_TIER` is `free`.

What runs:

- Static files come from `apps/web/dist`. The Worker runs only for `/api/*`.
- It sets the country from Cloudflare's own field and the address from `CF-Connecting-IP`, and drops any copy a visitor sends. It refuses live wishes from calls by other Workers.
- One Durable Object in the US jurisdiction holds the app and keeps the day's spend in its SQLite storage. The per-IP counts stay in memory.

The $0 limits, from Cloudflare's docs ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)):

- 100,000 Worker requests a day. Static files are free and do not count.
- Durable Objects: 100,000 requests and 13,000 GB-s a day.
- Over a limit, requests fail until 00:00 UTC. Nothing is billed, and static files keep working.
- 50 outbound requests per request. So the edge uses only the first three models of the chain, at most 42 calls per wish.
- 10 ms of CPU per Worker request. The Durable Object's CPU limit on Free was not measured.

If Google refuses the Worker's location, live wishes answer like a closed gate and visitors get the ready rounds. One real wish after the deploy shows which case you have.

### Check after the deploy

- [ ] A real live wish from the deployed site, repeated over a day, and from another country's network if possible.
- [ ] Forged country, both ways. From an allowed country, send a refused code: `curl -H 'x-paw-country: DE' -H 'cf-ipcountry: DE' https://<your-worker>/api/live` still says `"live":true`. From a refused country (for example over a VPN), send `US` in the same headers: it stays `"live":false`. There is no origin URL to try: preview URLs are off and the Durable Object has none.
- [ ] Eleven live calls, each with a different forged `x-forwarded-for`: the eleventh is refused, and a second real network is not.
- [ ] After an idle wait of a few minutes and a redeploy, `/api/health` still shows the day's spend.
- [ ] One full `paw_curse` and `paw_bind` from the Kiro power, with `PAW_API_URL` set to the `workers.dev` address.

## Repo map

| Path                 | What it holds                                                                                                                                                                                       |
|----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `apps/web`           | The UI: Vite, React and react-three-fiber.                                                                                                                                                          |
| `apps/api`           | The Hono server (Node and Cloudflare Workers). The only place that calls the model.                                                                                                                 |
| `packages/paw-core`  | Pure TypeScript logic shared by web, api and the MCP server.                                                                                                                                        |
| `packages/paw-mcp`   | The MCP server. It gives your own Kiro agent the Paw's rules and checks (`paw_rules`, `paw_check_curses`, `paw_check_verdict`), and adds `paw_curse` and `paw_bind` only when `PAW_API_URL` is set. |
| `powers/monkeys-paw` | The Kiro power: manifest, skills and the committed MCP bundle.                                                                                                                                      |
| `.kiro`              | Steering files, specs, hooks and agents.                                                                                                                                                            |

## Specs

- [wish-engine](.kiro/specs/wish-engine/): grants, curses, bindings, the Judge and the export.
- [paw-api](.kiro/specs/paw-api/): the HTTP server, rate limit, budget and eval.
- [paw-web](.kiro/specs/paw-web/): the web app.
- [paw-ink-shader](.kiro/specs/paw-ink-shader/): the ink shader for the paw scene.
- [paw-power](.kiro/specs/paw-power/): the Kiro power and its MCP server.

## More

- [Web app guide](apps/web/README.md): scripts, tests, screenshot receipts and the bundle budget.
- [API guide](apps/api/README.md): endpoints, environment variables, the eval, Docker and Railway.
- [Latest eval report](docs/eval/latest.md): the golden-wish results.
- [Power guide](powers/monkeys-paw/README.md): how to install and use the Kiro power.

## Live wishes

Live wishes call Google's Gemini API, so they follow Google's [terms](https://ai.google.dev/gemini-api/terms) and [available regions](https://ai.google.dev/gemini-api/docs/available-regions). The server grants them only where the free tier is allowed and only after the visitor confirms they are 18 or older. On unpaid services Google may use and read what is sent. Elsewhere the built-in ready examples play the round. The rules, the settings and the limits of this check are in [Who may make live wishes](apps/api/README.md#who-may-make-live-wishes).

## Licence

MIT. See [LICENSE](LICENSE).
