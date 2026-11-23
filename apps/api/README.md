# The Monkey's Paw API

A small Hono server on Node 24. It is the only place in the project that calls the model (Google Gemini). The web app and the MCP server call it over HTTP. The key stays in this server's environment.

Spec: [`.kiro/specs/paw-api`](../../.kiro/specs/paw-api/).

## Endpoints

- `GET /api/health`: reports the mode (`normal` or `examples-only`) and the remaining daily budget.
- `GET /api/live`: answers `{ "live": true }` when the visitor's country may make live wishes, else `{ "live": false }`. When it is allowed but the paw rests (no key, or the daily budget is spent) the answer also has `"resting": true`. It never calls the model and counts nothing. See "Who may make live wishes".
- `POST /api/grant`: takes a wish and returns a grant with up to five curses. Calls the model, so it is gated: 403 unless the country is allowed and `X-Paw-Adult-Confirmed: yes` is sent. `wish.text` is at most 500 characters after trim and `wish.context` at most 200, else 400 and no model call.
- `POST /api/bind`: takes a curse and an amendment and returns the Judge's verdict. Calls the model, so it is gated like `grant`. `clause` is at most 1000 characters after trim and every `loophole` at most 1000, else 400 and no model call.
- `POST /api/export`: turns a grant into `requirements.md` and `properties.md`. No model call.
- `GET /api/examples`: serves the cached examples from `examples-cache.json`. No model call. The committed cache holds the three ready rounds of the web app, built by `pnpm -C apps/api examples:ready` with no model call, so it answers 200. `pnpm -C apps/api eval --all` replaces it with real grants (model calls) when the owner runs it.

Abuse limits: a request body is read up to 192 KiB (196608 bytes). A declared length over that is refused unread, and a stream is given up as soon as it passes the cap, whatever the headers say. The answer is 413 `{ "message": "The request is too large." }`. `export` and `bind` also cap the fields of the grant (ids 100, narration 260, story 360, loophole, clause, reason, property, `userStory` and `wishCriterion` 1000, 3 to 5 curses) and `export` the wish (id 100, text 500, context 200), else 400 and no model call. The server cuts its own grants and verdicts to these caps, so a served grant of 3 to 5 curses can be sent back. The server never serves the one-curse fallback of a failed model, so none comes back (see "Running on the free tier"). Only POSTs to `grant` and `bind` reach the mode check and the per-IP count, after the gate. An oversized live POST still counts. `RATE_WINDOW_MS` must be all digits and at least 1, else 60000.

In examples-only mode (no key, or the daily budget is spent) `grant` and `bind` answer 503. `export`, `examples`, `health` and `live` keep working, and none of them is gated.

## Environment variables

On Cloudflare Workers, `COUNTRY_HEADER` and `TRUSTED_PROXY_HOPS` are fixed by the edge entry (see the root README). Names match [`.env.example`](.env.example). `pnpm start` loads no `.env` file. Set the variables in the shell or on the host.

| Variable                     | Default                                                        | Meaning                                                                        |
|------------------------------|----------------------------------------------------------------|--------------------------------------------------------------------------------|
| `GEMINI_API_KEY`             | empty                                                          | Model key. Empty means examples-only mode.                                     |
| `GEMINI_TIER`                | `free`                                                         | `paid` only for a key from a project with billing. Unset, blank and every other value is `free`. See "Who may make live wishes". |
| `COUNTRY_HEADER`             | unset                                                          | The name of the one request header that holds the visitor's country, set by the host in front of the server. Unset means every live wish is refused. Read "Who may make live wishes" before you set it. |
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

Every model call goes through the guard. Before the call it reserves a ceiling: for each model of the fallback chain, the estimated input tokens at the input rate plus the output cap (`MAX_OUTPUT_TOKENS`, 4096, thinking included) at the output rate. If the day's spend plus what is already reserved plus this ceiling is above `DAILY_BUDGET_CENTS`, the call is refused and the model is not called. After the call it releases the reservation and charges the real cost from the token counts in the response, at the price of the model that answered. An attempt with token counts costs them. An HTTP 400 or 500 without token counts costs 0 cents, because Google does not charge it for tokens, though it still counts against the quota ([billing FAQ](https://ai.google.dev/gemini-api/docs/billing), read 2026-11-22). A quota attempt (HTTP 429, or any error answer with `RESOURCE_EXHAUSTED`) costs 0 cents too. A timeout (also while the error body is read), no response, unreadable token counts and any other status keep the ceiling. The reservation of the whole chain before the call does not change. Cents are fractional and never rounded in the state. The prices are the ones that apply from 1.1.2027 (see `src/budget/prices.ts`). They are higher than today's, so the guard over-counts today and never under-counts. An unknown model is priced at the most expensive row.

## Running on the free tier

The website runs on Gemini's free tier. No bill is possible if the key comes from a project with no billing account.

1. In [Google AI Studio](https://aistudio.google.com/), create the key in a project that has no billing account.
2. Set it as `GEMINI_API_KEY`.

When the day's free quota ends, Gemini answers 429 `RESOURCE_EXHAUSTED`. The paw rests: `POST /api/grant` and `POST /api/bind` answer 503 "The paw is resting. Browse the examples until it wakes." and the site serves the ready examples. `/api/health` still says `normal`, and the next request tries the model again. A quota shared by all models stops the chain after one call. A quota of one model tries the next model. Daily free quotas reset at midnight Pacific time.

Any failure of every model now rests the paw the same way: an overload (503), 500, 404 or any other error status, a timeout, no response, or invalid output twice. `POST /api/grant` and `POST /api/bind` answer the same 503 "The paw is resting. Browse the examples until it wakes." as for a spent quota, never 200 with a made-up grant or verdict, and the site plays the ready rounds. When Google gave a hint (a `retryDelay` in the error body or a `Retry-After` header of a 429 or 503, in whole seconds from 1 to 86400, the smallest of the request), the body also has `retryAfter` and the response has a `Retry-After` header with the same number. With no hint there is neither. Nothing is kept for the next request: the model is tried again, and `/api/health` and `/api/live` do not change.

A Gemini location refusal (HTTP 400 "User location is not supported") costs 0 cents. It stops the wish after one call and answers the closed gate's 403 `live_region_unavailable`, so the visitor gets the ready rounds.

`/api/health` `mode`, `/api/live` `resting` and the check before grant and bind use one rule. A live wish can start only if the day's spend, the reservations in flight and the start ceiling fit under `DAILY_BUDGET_CENTS`. The start ceiling is the larger of two whole-chain ceilings: a grant's first call and a bind's first call, each at maximum size.

A quota attempt costs 0 cents. So does a 400 or 500 without token counts, so refused calls do not rest the paw; the per-IP limit and Google's quota bound them. The budget guard still counts paid-tier prices on paper, as a second fence.

The paper charges do not change with the 503 answer. A quota attempt and a 400 or 500 without usage cost 0. An attempt with usage costs its usage. A 404, a 503, any other status, a timeout and no response keep their ceilings. So an overload on every model of the 3-model edge chain costs about 15 cents per short wish on paper (about 15.1 for a grant, 14.6 for a bind; each call is tried twice), and a long overload rests the paw by budget. The free tier bills nothing.

## Who may make live wishes

A live wish is a call to `POST /api/grant` or `POST /api/bind`. The server makes it only when the visitor's country is allowed and the request says the visitor is 18 or older. `/api/examples`, `/api/export` and `/api/health` need neither.

The rules come from Google's terms, read on 2026-11-22:

- [Gemini API terms](https://ai.google.dev/gemini-api/terms), effective 2026-03-23.
- [Available regions](https://ai.google.dev/gemini-api/docs/available-regions).

On unpaid services Google may use the content it receives to improve its products, and human reviewers may read it. A wish sent on the free tier is such content. The free tier is for the available regions, outside the EEA, Switzerland and the United Kingdom, and not for people under 18.

| `GEMINI_TIER` | Allowed countries |
|---------------|-------------------|
| `free` (the default, and any value but `paid`) | The 231 available regions without the 27 EU states, Iceland, Liechtenstein, Norway, Switzerland, the United Kingdom and, to be careful, their territories that have their own code: 172 codes. |
| `paid` | All 231 available regions. |

Set `paid` only for a key from a project with billing. The table is in `src/gate/regions.ts` and a test compares its names with the page above.

**The country.** The server reads it only from the header named by `COUNTRY_HEADER`, with no default and no fallback to any other header, query or body. The value must be exactly two uppercase letters and on the list of the tier. A missing, empty, lowercase, repeated (`US, GB`) or unlisted value (`XX`, `T1`, `CN`) is refused. So is a `COUNTRY_HEADER` that is unset, blank or not a valid header name. The server fails closed: with nothing configured, every live wish is refused.

**The age.** The request must carry `X-Paw-Adult-Confirmed: yes`, exactly, on both tiers. The web app and the MCP server send it after the user confirms. It is self-declared.

**The refusal.** HTTP 403, `cache-control: no-store`, and `{ code, message }`. The country is checked first.

| `code` | `message` |
|--------|-----------|
| `live_region_unavailable` | The paw grants no live wishes where you stand. The examples need no permission. |
| `adult_confirmation_required` | The paw grants live wishes only to those who confirm they are 18 or older. |

A refusal reads no body, calls no model, reserves and spends nothing, and does not count against the IP. The country is used for that one decision. It is never stored, logged, or put in a body, a header or an error.

**Where the country comes from.** Set `COUNTRY_HEADER` only where the host overwrites that header on every request, and make sure the server cannot be reached around that host. Otherwise anyone can write the header and pick their country. After the deploy, test it with a faked header: send `GET /api/live` with the header set to an allowed code from a place where that answer is wrong, and also to the service's own address if it is reachable. Anything but `{ "live": false }` where it should be false means the header is not overwritten. Unset `COUNTRY_HEADER` then.

Railway's documented request headers include no country. On plain Railway leave `COUNTRY_HEADER` unset: every live wish is refused and the examples still work. Live wishes need a host in front of the service that supplies a country header, with the service reachable only through it.

This is not legal advice. The 18+ confirmation is not proof of age. The eval CLI (`pnpm -C apps/api eval`) is the operator's tool, calls the model with the operator's key and has no gate.

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

The whole chain is reserved because a 503, 429 or 404 moves on to the next model and it cannot be known beforehand which attempts are billed. Reserving one attempt only would let parallel calls overspend. After the call the reservation is released and the real cost is charged, so a call that succeeds on the first model costs far less than its ceiling.

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

The [root quickstart](../../README.md#quickstart) gives the two terminals, with and without a key.

Alternative: keep the settings in a file. Copy `apps/api/.env.example` to `apps/api/.env` and edit it (`.env` is gitignored), then run `pnpm -C apps/api dev`. `dev` reads `.env` if it exists, and variables set in the shell win over it. Without a key the server starts in examples-only mode and logs `"mode":"examples-only"`.

A browser needs more for a live wish: start the API with `COUNTRY_HEADER=x-paw-dev-country`, and start the web dev server with `PAW_DEV_COUNTRY` set to your country code.

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

1. Optional: replace `apps/api/examples-cache.json` with real grants using `pnpm -C apps/api eval --all` (real model calls, about 2 per wish) and commit the new file. The committed cache already holds the three ready rounds of the web app, built by `pnpm -C apps/api examples:ready` with no model call, so `/api/examples` answers 200 without this step.
2. Create the Gemini key as described in "Running on the free tier": in a Google AI Studio project with no billing account. Leave `GEMINI_TIER` unset (free).
3. Create a Railway project from the GitHub repository. Set the root directory to `/`.
4. Set these service variables:
   - `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`
   - `GEMINI_API_KEY` (the key from step 2)
   - `CORS_ORIGIN` (the web app's exact origin, for example `https://paw.example`)
   - `PER_IP_LIMIT`, `RATE_WINDOW_MS`, `DAILY_BUDGET_CENTS`, `TRUSTED_PROXY_HOPS` (1 for Railway's single proxy, to be checked after the deploy)
   - `COUNTRY_HEADER`: leave it unset on plain Railway. Every live wish is then refused and the examples work. Set it only behind a host that overwrites that header and is the only way to the service (see "Who may make live wishes").
5. In the service settings, set the health check path to `/api/health`. Railway sets `PORT`.
6. Deploy. Open `/api/health` and check that it answers. If you set `COUNTRY_HEADER`, send a faked header as described in "Who may make live wishes" and check that it does not change the answer of `/api/live`.
7. Point the web app at the Railway URL, and set `PAW_API_URL` to the same URL for the MCP server.

Railway's "Config as Code" (`railway.json`) is deprecated, so the repo uses the Dockerfile only.

## CI eval gate

`.github/workflows/prompt-eval.yml` runs the eval on pull requests that change `packages/paw-core/src/prompts.ts`, `.kiro/steering/curse-taxonomy.md` or `apps/api/src/client/gemini.ts`. It caps the run at `DAILY_BUDGET_CENTS=579`: `ceil(5 x 115.65)`, the worst case of the default 5-wish eval (5 grants at 115.65245 cents each, 578.26225 in all, no binds; see "Cost guard and worst case"). A run that stays inside its worst case is never refused. If the guard still refuses a call, the eval fails loudly with "budget exhausted" and writes nothing. To turn it on:

1. Add the repository secret `GEMINI_API_KEY`.
2. Make "Prompt eval" a required check on the main branch.

Without the secret (a fork, for example) the eval is skipped and the check passes.

## Privacy and logging

- A wish is never stored. Only short-lived rate-limit counters and the daily spend live in memory.
- The request log is one JSON line from our own logger: `event`, `timestamp`, `method`, `path`, `status`, `duration` and `modelCall`. The method is an allow-listed name or `OTHER`. The path is a known route or `other`, and the query string is never logged. It never holds wish text, curse text, a prompt, a model answer, an IP address or a key.
- Nothing that came from a caller, a model or an upstream is logged or sent back in an error: not a body, URL, header, upstream message, or the message, stack or cause of a thrown value. An error is one line, `{"event":"error","code":<fixed code>,"error":<class>}`, where the class comes from `instanceof` checks on a short list, else `Error` or `NonError`. A body that cannot be read gets a 400 with the route's usual message.
- The Gemini line (`model_call`) holds the model name from our settings, the status (100 to 599, else 0), the duration, token counts only when they are integers from 0 to 1,000,000, and a finish reason only from Gemini's list (else `OTHER`).
- The key is read from the environment on the server and never sent to a client.
- The server sets no cookies.
- The visitor's country is read from one header for one decision and is never stored, logged or echoed. The age confirmation is a header that is checked and dropped.
- On the free tier the wish text goes to Google, which may use and read it (see "Who may make live wishes").
