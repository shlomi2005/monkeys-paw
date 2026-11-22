# apps/web

The Monkey's Paw web app: Vite, React 19 and react-three-fiber. It calls `apps/api` over HTTP and imports only the
schemas and `computeIntegrity` from `paw-core`. Design and tasks are in `.kiro/specs/paw-web/`.

## Setup

```sh
pnpm install
pnpm -C packages/paw-core build   # the web app imports the built paw-core
```

## Scripts

Run them from the repo root with `pnpm -C apps/web <script>`.

| Script      | What it does                                                                                       |
|-------------|----------------------------------------------------------------------------------------------------|
| `dev`       | Vite dev server. Runs the asset copy first (`predev`).                                             |
| `build`     | Asset copy (`prebuild`), type check, then `vite build` into `dist/`. Also writes `dist/.vite/manifest.json`. |
| `preview`   | Serves `dist/` with `vite preview`.                                                                |
| `test`      | `vitest run`: unit, property and component tests.                                                  |
| `typecheck` | `tsc` for the app and for the end-to-end tests.                                                    |
| `lint`      | ESLint.                                                                                            |
| `e2e`       | `playwright test`: all end-to-end projects.                                                        |
| `budget`    | `scripts/check-bundle-budget.mjs`. Run it after `build`.                                           |

## Configuration

`VITE_API_BASE_URL` is the base URL of the API. Leave it empty to call the app's own origin. See `.env.example`, which
lists the name only. It is read at build time and ends up in the client bundle, so never put a secret in it. The model
key lives in `apps/api`, never here.

## The asset copy step

The paw models and the poster live in `docs/art/paw/`. `scripts/copy-paw-assets.mjs` copies `paw-web.glb`,
`paw-mobile.glb` and `paw-poster.jpg` to `public/paw/` and checks each copy by hash. `dev` and `build` run it first.
`public/paw/` is gitignored. The joint contract (`runtime-controls.json`) is imported from `docs/art/paw/` through the
`@paw-asset` alias, not copied.

## Tests

Unit, property (fast-check) and component tests sit next to the source in `src/` and run with Vitest:

```sh
pnpm -C apps/web exec vitest run
```

End-to-end tests are in `e2e/` and use Playwright:

- `@playwright/test` is pinned to 1.63.0. It needs its own Chromium: run `pnpm -C apps/web exec playwright install chromium` once.
- The API is stubbed with `page.route` (`e2e/support/stub-api.ts`). The tests never call a real API or model.
- `playwright.config.ts` starts its own server: it builds the app and serves it with `vite preview` on port 4173. Do not start one yourself.
- WebGL runs on SwiftShader (software GL), so the 3D scene works without a GPU.
- Three projects: `desktop` (1280 px, every spec except `*.mobile.spec.ts`), `mobile` (390 px, only `*.mobile.spec.ts`) and `desktop-no-webgl` (Chromium with `--disable-3d-apis`, only tests tagged `@no-webgl`).

```sh
pnpm -C apps/web exec playwright test                    # all projects
pnpm -C apps/web exec playwright test --project=mobile   # one project
```

## Screenshot receipts

`pnpm -C apps/web exec playwright test --grep @receipt` saves full-page screenshots to `e2e/receipts/` as
`<project>-<phase>.png`. The PNGs are gitignored. The `ui-screenshot-receipt` hook (`.kiro/hooks/`) runs the same
command when a `.tsx` or `.css` file under `src/` is saved. See `e2e/receipts/README.md`.

## Bundle budget

`pnpm -C apps/web build && pnpm -C apps/web budget` gzips each file listed in the manifest (level 9) and prints a table.
It exits 1 and prints one line per budget that is over:

| Budget                                  | Limit  |
|-----------------------------------------|--------|
| Initial JS (gzip)                       | 200 KB |
| Initial CSS (gzip)                      | 30 KB  |
| 3D chunk (gzip)                         | 330 KB |
| Fonts (raw)                             | 140 KB |
| Audio (raw)                             | 500 KB |

1 KB is 1000 bytes. For a report of what is inside the bundles, build with `PAW_VISUALIZE=1`. That writes
`dist/stats.html` and `dist/stats.json` (both gitignored) and never opens a browser. A normal build writes neither.
An end-to-end test checks that the 3D chunk is requested only after the window `load` event.

## Privacy

The app keeps one item in the browser: `localStorage["pawSoundEnabled"]`, the sound switch. There are no cookies, no
`sessionStorage`, and the URL never carries the wish. An end-to-end test (`e2e/privacy.spec.ts`) checks this.
## Live wishes and ready rounds

The page asks `GET /api/live` once. Where live wishes are offered, a live wish needs the unticked "I am 18 or older"
box, kept in memory only and sent as the `X-Paw-Adult-Confirmed` header. It is not proof of age. Where they are not,
the box is gone and the example row shows three ready rounds (`src/state/ready-rounds.ts`): written in advance, no model,
no `/api/grant` or `/api/bind`, each with its clauses and verdicts, ready to export.
