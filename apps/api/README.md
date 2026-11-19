# The Monkey's Paw API

A small Hono server on Node 24. It is the only place in the project that calls the model (Google Gemini). The web app and the MCP server call it over HTTP. The key stays in this server's environment.

Spec: [`.kiro/specs/paw-api`](../../.kiro/specs/paw-api/).

## Endpoints

- `GET /api/health`: reports the mode (`normal` or `examples-only`) and the remaining daily budget.
- `POST /api/grant`: takes a wish and returns a grant with up to five curses. Calls the model.
- `POST /api/bind`: takes a curse and an amendment and returns the Judge's verdict. Calls the model.
- `POST /api/export`: turns a grant into `requirements.md` and `properties.md`. No model call.
- `GET /api/examples`: serves the cached example grants from `examples-cache.json`. No model call.

In examples-only mode (no key, or the daily budget is spent) `grant` and `bind` answer 503. The other three keep working.

## Environment variables

Names match [`.env.example`](.env.example). `pnpm start` loads no `.env` file. Set the variables in the shell or on the host.

| Variable                     | Default                                                        | Meaning                                                                        |
|------------------------------|----------------------------------------------------------------|--------------------------------------------------------------------------------|
| `GEMINI_API_KEY`             | empty                                                          | Model key. Empty means examples-only mode.                                     |
| `GEMINI_MODEL`               | `gemini-3.5-flash`                                             | Primary model name.                                                            |
| `GEMINI_MODEL_FALLBACKS`     | `gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite` | Comma-separated models to try on 503, 429 or 404.                              |
| `GEMINI_TIMEOUT_MS`          | `30000`                                                        | Timeout of one model request.                                                  |
| `PORT`                       | `8787`                                                         | Port to listen on. Railway sets it.                                            |
| `MODEL_CALL_COST_CENTS`      | `0.135`                                                        | Cents charged to the daily budget per model call.                              |
| `EXAMPLES_CACHE_PATH`        | `apps/api/examples-cache.json`, found from the package         | Path of the examples cache.                                                    |
| `CORS_ORIGIN`                | `*` when unset (`.env.example` uses `http://localhost:5173`)   | The origin allowed to call the API. Set it to the web app's exact origin.      |
| `PER_IP_LIMIT`               | `10`                                                           | Model calls per IP within one window.                                          |
| `RATE_WINDOW_MS`             | `60000`                                                        | Length of that window.                                                         |
| `DAILY_BUDGET_CENTS`         | `500`                                                          | Daily budget in cents. When it is spent the server serves examples only.       |
| `EVAL_SPECIFICITY_THRESHOLD` | `0.80`                                                         | Minimum specificity score the eval needs to pass.                              |

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

The eval calls the real model, about two calls per wish, and costs money. It needs `GEMINI_API_KEY` and exits non-zero when it fails or the key is missing. It writes the report to [`docs/eval/latest.md`](../../docs/eval/latest.md) and the grants it produced to `apps/api/examples-cache.json`. It stops when `DAILY_BUDGET_CENTS` is spent.

## Build and Docker

```sh
pnpm -C apps/api build
docker build -f apps/api/Dockerfile .   # from the repo root
```

`build` bundles `src/server.ts`, `paw-core` and every npm dependency into the one file `apps/api/dist/server.mjs`, so the runtime needs no `node_modules`. `pnpm -C apps/api start` runs it with `node dist/server.mjs`. The Docker image copies that file and `examples-cache.json`, runs as the `node` user and listens on 8787. The image holds no key and no `.env`.

## Deploy on Railway (steps for the owner, not done)

Nothing is deployed and no account exists yet.

1. Regenerate `apps/api/examples-cache.json` with `pnpm -C apps/api eval --all` (real model calls, about 2 per wish). The committed cache holds only fallback grants, so `/api/examples` answers 503 until then. Commit the new file.
2. Decide on a Gemini key and on billing, then create the key.
3. Create a Railway project from the GitHub repository. Set the root directory to `/`.
4. Set these service variables:
   - `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`
   - `GEMINI_API_KEY` (the key from step 2)
   - `CORS_ORIGIN` (the web app's exact origin, for example `https://paw.example`)
   - `PER_IP_LIMIT`, `RATE_WINDOW_MS`, `DAILY_BUDGET_CENTS`, `MODEL_CALL_COST_CENTS`
5. In the service settings, set the health check path to `/api/health`. Railway sets `PORT`.
6. Deploy. Open `/api/health` and check that it answers.
7. Point the web app at the Railway URL, and set `PAW_API_URL` to the same URL for the MCP server.

Railway's "Config as Code" (`railway.json`) is deprecated, so the repo uses the Dockerfile only.

## CI eval gate

`.github/workflows/prompt-eval.yml` runs the eval on pull requests that change `packages/paw-core/src/prompts.ts`, `.kiro/steering/curse-taxonomy.md` or `apps/api/src/client/gemini.ts`. It caps the run at `DAILY_BUDGET_CENTS=25`. To turn it on:

1. Add the repository secret `GEMINI_API_KEY`.
2. Make "Prompt eval" a required check on the main branch.

Without the secret (a fork, for example) the eval is skipped and the check passes.

## Privacy and logging

- A wish is never stored. Only short-lived rate-limit counters and the daily spend live in memory.
- The log line holds the method, the path, the status and the duration. It never holds wish text, curse text, a prompt, a model answer, an IP address or a key.
- The key is read from the environment on the server and never sent to a client.
- The server sets no cookies.
