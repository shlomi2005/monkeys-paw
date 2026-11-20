# The Monkey's Paw API

A small Hono server on Node 24. It is the only place in the project that calls the model (Google Gemini). The web app and the MCP server call it over HTTP. The key stays in this server's environment.

Spec: [`.kiro/specs/paw-api`](../../.kiro/specs/paw-api/).

## Endpoints

- `GET /api/health`: reports the mode (`normal` or `examples-only`) and the remaining daily budget.
- `POST /api/grant`: takes a wish and returns a grant with up to five curses. Calls the model. `wish.text` is at most 500 characters after trim and `wish.context` at most 200, else 400 and no model call.
- `POST /api/bind`: takes a curse and an amendment and returns the Judge's verdict. Calls the model. `clause` is at most 1000 characters after trim and the `loophole` of the judged curse at most 1000, else 400 and no model call.
- `POST /api/export`: turns a grant into `requirements.md` and `properties.md`. No model call.
- `GET /api/examples`: serves the cached example grants from `examples-cache.json`. No model call.

In examples-only mode (no key, or the daily budget is spent) `grant` and `bind` answer 503. The other three keep working.

## Environment variables

Names match [`.env.example`](.env.example). `pnpm start` loads no `.env` file. Set the variables in the shell or on the host.

| Variable                     | Default                                                        | Meaning                                                                        |
|------------------------------|----------------------------------------------------------------|--------------------------------------------------------------------------------|
| `GEMINI_API_KEY`             | empty                                                          | Model key. Empty means examples-only mode.                                     |
| `GEMINI_MODEL`               | `gemini-3.6-flash`                                             | Primary model name. The retired name `gemini-3.5-flash` routes to it.          |
| `GEMINI_MODEL_FALLBACKS`     | `gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite` | Comma-separated models to try on 503, 429 or 404. A 429 whose quota is shared by all models stops the chain. |
| `GEMINI_TIMEOUT_MS`          | `30000`                                                        | Timeout of one model request.                                                  |
| `PORT`                       | `8787`                                                         | Port to listen on. Railway sets it.                                            |
| `PRICE_TABLE_JSON`           | the built-in 1.1.2027 table                                    | Optional JSON object `{"<model id>":{"inputUsdPerMTok":n,"outputUsdPerMTok":n}}` that replaces it. Invalid means the default table and one warning line. |
| `EXAMPLES_CACHE_PATH`        | `apps/api/examples-cache.json`, found from the package         | Path of the examples cache.                                                    |
| `CORS_ORIGIN`                | `*` when unset (`.env.example` uses `http://localhost:5173`)   | The origin allowed to call the API. Set it to the web app's exact origin.      |
| `TRUSTED_PROXY_HOPS`         | `1`                                                            | How many proxies of ours append to `x-forwarded-for`. An integer of 0 or more; anything else means 1. See "Client IP and proxies". |
| `PER_IP_LIMIT`               | `10`                                                           | Model calls per IP within one window.                                          |
| `RATE_WINDOW_MS`             | `60000`                                                        | Length of that window.                                                         |
| `DAILY_BUDGET_CENTS`         | `200`                                                          | Daily budget in cents ($2 a day). A fractional value is fine; missing, non-finite or negative means 200. When it is spent the server serves examples only. |
| `EVAL_SPECIFICITY_THRESHOLD` | `0.80`                                                         | Minimum specificity score the eval needs to pass.                              |

### How the budget guard charges

Every model call goes through the guard. Before the call it reserves a ceiling: for each model of the fallback chain, the estimated input tokens at the input rate plus the output cap (`MAX_OUTPUT_TOKENS`, 4096, thinking included) at the output rate. If the day's spend plus what is already reserved plus this ceiling is above `DAILY_BUDGET_CENTS`, the call is refused and the model is not called. After the call it releases the reservation and charges the real cost from the token counts in the response, at the price of the model that answered. An attempt that reported no token counts (a timeout, a network error, an HTTP error) is charged its ceiling, except a quota attempt (HTTP 429, or any error answer with `RESOURCE_EXHAUSTED`), which is charged 0 cents because Google does not bill it. The reservation of the whole chain before the call does not change. Cents are fractional and never rounded in the state. The prices are the ones that apply from 1.1.2027 (see `src/budget/prices.ts`). They are higher than today's, so the guard over-counts today and never under-counts. An unknown model is priced at the most expensive row.

## Running on the free tier

The website runs on Gemini's free tier. No bill is possible if the key comes from a project with no billing account.

1. In [Google AI Studio](https://aistudio.google.com/), create the key in a project that has no billing account.
2. Set it as `GEMINI_API_KEY`.

When the day's free quota ends, Gemini answers 429 `RESOURCE_EXHAUSTED`. The paw rests: `POST /api/grant` and `POST /api/bind` answer 503 "The paw is resting. Browse the examples until it wakes." and the site serves the ready examples. `/api/health` still says `normal`, and the next request tries the model again. A quota shared by all models stops the chain after one call. A quota of one model tries the next model. Daily free quotas reset at midnight Pacific time.

A quota attempt costs 0 cents. The budget guard still counts paid-tier prices on paper, as a second fence.

## Cost guard and worst case

Prices, USD per 1M tokens, Gemini API paid tier. Source: <https://ai.google.dev/gemini-api/docs/pricing> (checked 2026-11-20). The output price includes thinking tokens. The guard uses the rates that apply from 1.1.2027, which are the higher ones, so it over-counts today and never under-counts.

| Model                   | Input until 31.12.2026 | Output until 31.12.2026 | Input from 1.1.2027 | Output from 1.1.2027 |
|-------------------------|------------------------|-------------------------|---------------------|----------------------|
| `gemini-3.6-flash`      | 0.75                   | 3.75                    | 1.50                | 7.50                 |
| `gemini-3.8-flash`      | 0.75                   | 3.75                    | 1.50                | 7.50                 |
| `gemini-3.5-flash-lite` | 0.30                   | 2.50                    | 0.30                | 2.50                 |
| `gemini-3.1-flash-lite` | 0.25                   | 1.50                    | 0.25                | 1.50                 |

The built-in table (`src/budget/prices.ts`) also lists `gemini-3.5-flash`, a retired name that routes to `gemini-3.6-flash`, at the 3.6 rates. `gemini-3.1-flash-lite` shuts down on 2027-05-07.

**The ceiling.** `MAX_OUTPUT_TOKENS` is 4096, thinking tokens included, for every request. The ceiling of one `generate` call is, summed over every model of the default chain (`gemini-3.6-flash`, `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`):

```
input tokens  = ceil((prompt chars + response schema chars) / 3)
cents         = input tokens x input USD per 1M / 10 000  +  4096 x output USD per 1M / 10 000
ceiling       = the sum of cents over the four models
```

The whole chain is reserved because a 503, 429 or 404 moves on to the next model and every attempt can be billed. Reserving one attempt only would let parallel calls overspend. After the call the reservation is released and the real cost is charged, so a call that succeeds on the first model costs far less than its ceiling.

**Ceiling of each prompt kind, at its maximum size.** The input caps are 500 characters of wish text and 200 of context, and 1000 for a clause and for a loophole. A curse `story` is at most 360 characters (`CurseSchema`). The longest curse type tag is `accessibility` and the longer binding kind is `ears-clause`. Each line is chars, input tokens, then cents as input + output = total, per model.

- Genie (`buildPawPrompt` + `buildGeniePrompt`, the wish carried twice): 4540 prompt chars, 5033 with the schema, 1678 input tokens.
  - `gemini-3.6-flash` and `gemini-3.8-flash`: 0.2517 + 3.072 = 3.3237 each.
  - `gemini-3.5-flash-lite`: 0.05034 + 1.024 = 1.07434.
  - `gemini-3.1-flash-lite`: 0.04195 + 0.6144 = 0.65635.
  - Chain ceiling: 8.37809 cents.
- Batch judge (5 curses with story 360 and loophole 1000): 7859 prompt chars, 8044 with the schema, 2682 input tokens.
  - `gemini-3.6-flash` and `gemini-3.8-flash`: 0.4023 + 3.072 = 3.4743 each.
  - `gemini-3.5-flash-lite`: 0.08046 + 1.024 = 1.10446.
  - `gemini-3.1-flash-lite`: 0.06705 + 0.6144 = 0.68145.
  - Chain ceiling: 8.73451 cents.
- Replacement (the wish at its caps and one rejected curse): 2774 prompt chars, 3044 with the schema, 1015 input tokens.
  - `gemini-3.6-flash` and `gemini-3.8-flash`: 0.15225 + 3.072 = 3.22425 each.
  - `gemini-3.5-flash-lite`: 0.03045 + 1.024 = 1.05445.
  - `gemini-3.1-flash-lite`: 0.025375 + 0.6144 = 0.639775.
  - Chain ceiling: 8.142725 cents.
- Judge verdict (story 360, loophole 1000, clause 1000, kind `ears-clause`): 3318 prompt chars, 3476 with the schema, 1159 input tokens.
  - `gemini-3.6-flash` and `gemini-3.8-flash`: 0.17385 + 3.072 = 3.24585 each.
  - `gemini-3.5-flash-lite`: 0.03477 + 1.024 = 1.05877.
  - `gemini-3.1-flash-lite`: 0.028975 + 0.6144 = 0.643375.
  - Chain ceiling: 8.193845 cents.

**Worst case per grant.** `grantWish` in paw-core makes up to 14 `generate` calls:

- 2 for the Paw and Genie prompt (`for (attempt < 2)`, the retry after an answer that failed validation).
- 2 for the batch judge (`batchJudgeQuality`, `for (attempt < 2)`).
- 10 for replacements: up to 5 curses (`GrantSchema` allows 3 to 5), each replaced exactly once when the batch judge marks it generic, each replacement making up to 2 calls (`regenerateCurse`). 5 x 1 x 2 = 10.

10 of the 14 calls come from the replacements in paw-core. `ensureSpecific` replaces a generic curse once and does not judge the replacement again, so a weak curse costs 2 calls at most (wish-engine requirement 2.4). Before this fix the same loop replaced a generic curse 3 times (up to 34 calls and 278.51 cents per grant).

```
2 x 8.37809  +  2 x 8.73451  +  10 x 8.142725  =  16.75618 + 17.46902 + 81.42725
worst case per grant = 115.65 cents
```

**Worst case per bind.** `judgeBinding` makes up to 2 calls: 2 x 8.193845 = 16.38769, so **16.39 cents**.

**Against the 200-cent day.** One worst-case grant (115.65 cents) is less than the whole day, and a second (2 x 115.65245 = 231.30) would pass it, so the guard refuses the call that would pass the budget and the route answers 503. Worst-case binds fit 12 times (12 x 16.38769 = 196.65). A typical grant (a wish of 100 characters with 50 of context, 4 curses) makes 2 single-attempt calls, the genie and the batch judge. They reserve about 16.31 cents together (the whole-chain ceiling of each), then settle to their real usage.

The two worst-case figures above are recomputed by `src/budget/worst-case.ts` from the real prompt builders, `GeminiModelClient.plan()` and the default price table. A unit test fails when this section drifts from them. The 1000-character `loophole` of a model-written curse is an assumption of this worst case: paw-core caps the `story` of a curse but not its `loophole`. The guard does not depend on it, because it prices every call from its real prompt.

## Client IP and proxies

The per-IP limit needs the client's address. `TRUSTED_PROXY_HOPS` says how many proxies of ours sit in front of the server and append to `x-forwarded-for`. The server splits the header into trimmed, non-empty entries and, with hops of 1 or more and at least that many entries, takes the entry that the outermost trusted proxy saw: `entries[entries.length - hops]`. A client can put anything at the left of the header, so it cannot pick its own key. With hops 0, no header, or fewer entries than hops, the key is the socket address.

Use `1` on Railway, which puts a single proxy in front of the service (to be checked after the deploy). Use `0` when nothing sits in front of the server.

## Run locally

```sh
pnpm install
pnpm -C packages/paw-core build
cp apps/api/.env.example apps/api/.env   # then edit; .env is gitignored
pnpm -C apps/api dev
```

`dev` reads `.env` if it exists. Without a key the server starts in examples-only mode and logs `"mode":"examples-only"`.

## Tests

```sh
pnpm -C apps/api exec vitest run
pnpm -C apps/api typecheck
```

The tests use a fake model. They never call Gemini.

## The eval

```sh
pnpm -C apps/api eval              # the first 5 golden wishes
pnpm -C apps/api eval --limit 10   # the first N
pnpm -C apps/api eval --all        # all 25 wishes in docs/golden-wishes.json
```

The eval calls the real model, about two calls per wish, and costs money. It needs `GEMINI_API_KEY` and exits non-zero when it fails or the key is missing. It writes the report to [`docs/eval/latest.md`](../../docs/eval/latest.md) and the grants it produced to `apps/api/examples-cache.json`. It runs through the same budget guard. When the guard refuses a call it throws, prints one line that contains "budget exhausted", exits 1 and writes neither the report nor the cache.

## Build and Docker

```sh
pnpm -C apps/api build
docker build -f apps/api/Dockerfile .   # from the repo root
```

`build` bundles `src/server.ts`, `paw-core` and every npm dependency into the one file `apps/api/dist/server.mjs`, so the runtime needs no `node_modules`. `pnpm -C apps/api start` runs it with `node dist/server.mjs`. The Docker image copies that file and `examples-cache.json`, runs as the `node` user and listens on 8787. The image holds no key and no `.env`.

## Deploy on Railway (steps for the owner, not done)

Nothing is deployed and no account exists yet.

1. Regenerate `apps/api/examples-cache.json` with `pnpm -C apps/api eval --all` (real model calls, about 2 per wish). The committed cache holds only fallback grants, so `/api/examples` answers 503 until then. Commit the new file.
2. Create the Gemini key as described in "Running on the free tier": in a Google AI Studio project with no billing account.
3. Create a Railway project from the GitHub repository. Set the root directory to `/`.
4. Set these service variables:
   - `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`
   - `GEMINI_API_KEY` (the key from step 2)
   - `CORS_ORIGIN` (the web app's exact origin, for example `https://paw.example`)
   - `PER_IP_LIMIT`, `RATE_WINDOW_MS`, `DAILY_BUDGET_CENTS`, `TRUSTED_PROXY_HOPS` (1 for Railway's single proxy, to be checked after the deploy)
5. In the service settings, set the health check path to `/api/health`. Railway sets `PORT`.
6. Deploy. Open `/api/health` and check that it answers.
7. Point the web app at the Railway URL, and set `PAW_API_URL` to the same URL for the MCP server.

Railway's "Config as Code" (`railway.json`) is deprecated, so the repo uses the Dockerfile only.

## CI eval gate

`.github/workflows/prompt-eval.yml` runs the eval on pull requests that change `packages/paw-core/src/prompts.ts`, `.kiro/steering/curse-taxonomy.md` or `apps/api/src/client/gemini.ts`. It caps the run at `DAILY_BUDGET_CENTS=579`: `ceil(5 x 115.65)`, the worst case of the default 5-wish eval (5 grants at 115.65245 cents each, 578.26225 in all, no binds; see "Cost guard and worst case"). A run that stays inside its worst case is never refused. If the guard still refuses a call, the eval fails loudly with "budget exhausted" and writes nothing. To turn it on:

1. Add the repository secret `GEMINI_API_KEY`.
2. Make "Prompt eval" a required check on the main branch.

Without the secret (a fork, for example) the eval is skipped and the check passes.

## Privacy and logging

- A wish is never stored. Only short-lived rate-limit counters and the daily spend live in memory.
- The log line holds the method, the path, the status and the duration. It never holds wish text, curse text, a prompt, a model answer, an IP address or a key.
- The key is read from the environment on the server and never sent to a client.
- The server sets no cookies.
