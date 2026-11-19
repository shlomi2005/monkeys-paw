---
inclusion: always
---
# Repository Structure

A pnpm-workspace monorepo. Each app and package is independently buildable. Tests live next to the code they test.

## Layout

```
MonkeysPaw/
├── .kiro/
│   ├── steering/          # product, tech, structure, curse-taxonomy, tone, iron-rules
│   ├── specs/             # one folder per feature (e.g. wish-engine/)
│   └── agents/            # custom agent configs (paw, genie, judge, qa, legal)
├── apps/
│   ├── web/               # Vite + React + r3f — the UI (separate spec)
│   └── api/               # Hono server — the only model caller
├── packages/
│   ├── paw-core/          # pure logic shared by web, api, paw-mcp
│   └── paw-mcp/           # MCP server (stdio): paw_curse, paw_bind
├── powers/
│   └── monkeys-paw/       # Kiro power: manifest, skills, committed bundle (server/paw-mcp.mjs)
├── docs/                  # product brief, art, write-up
├── .gitignore
├── LICENSE                # MIT
├── pnpm-workspace.yaml
└── package.json
```

## Packages

### `packages/paw-core` — the pure engine

Framework-agnostic. No DOM, no Node-specific imports. Importable from the browser, the server, and `paw-mcp`.

```
packages/paw-core/
├── src/
│   ├── types.ts          # Wish, Curse, CurseType, Grant, Binding, Verdict, SpecExport
│   ├── schemas.ts        # zod schemas (validate model output, API boundaries)
│   ├── prompts.ts        # prompt builders for the Paw, Genie, Judge roles
│   ├── grant.ts          # grantWish(wish, model) → Grant
│   ├── bind.ts           # proposeBinding(curse) → Binding
│   ├── judge.ts          # judgeBinding(curse, binding) → Verdict
│   ├── integrity.ts      # computeIntegrity(grant) → 0-5
│   ├── export.ts         # exportSpec(grant) → SpecExport (requirements.md + properties.md)
│   ├── budget.ts         # rate-limit + daily-budget guards
│   └── index.ts          # public API
├── tests/
│   ├── schemas.test.ts
│   ├── grant.test.ts
│   ├── export.test.ts
│   └── properties.test.ts   # fast-check property tests
└── package.json
```

### `packages/paw-mcp` — the MCP server

Depends on `paw-core`, `@modelcontextprotocol/sdk` and `zod`. Exposes the tools `paw_curse` and `paw_bind` over stdio and calls `apps/api`. `pnpm bundle` builds it with esbuild into `powers/monkeys-paw/server/paw-mcp.mjs`, which is committed. Separate spec (`paw-power`).

### `powers/monkeys-paw` — the Kiro power

The folder the Powers panel installs: `plugin.json`, `mcp.json`, `README.md`, three skills, and the committed bundle with its `NOTICE.md`. No source code lives here. The hook that comments on saved `requirements.md` files is in `.kiro/hooks/`, with a copy in the `spec-loophole-hook` skill.

### `apps/web` — the UI

Vite + React + r3f. Calls `apps/api` for model work; imports pure logic from `paw-core`. Separate spec.

### `apps/api` — the server

Hono on Railway. Holds the Gemini key in env. Implements the `ModelClient` interface that `paw-core` expects. Enforces rate limit and budget before every model call (iron-rules.md §5).

## Naming Rules

- **Files:** `kebab-case.ts` for modules (e.g. `wish-engine.ts`), `PascalCase.tsx` for React components (e.g. `CurseCard.tsx`).
- **Tests:** sit next to source as `*.test.ts` / `*.test.tsx`, or under a `tests/` folder for a package.
- **Functions:** `camelCase`. Async functions that hit the model end in `Async` or return a Promise typed explicitly.
- **Types / Interfaces / Zod schemas:** `PascalCase` (e.g. `GrantSchema`, `type Grant`).
- **Constants:** `SCREAMING_SNAKE_CASE`.
- **Curse types:** lowercase kebab-case tags exactly as in `curse-taxonomy.md` (`permissions`, `time`, `money`, `scale`, `abuse`, `privacy`, `accessibility`, `data-loss`, `concurrency`, `edge-input`). Never abbreviate or invent new tags.
- **Spec folders:** `kebab-case`, one per feature (e.g. `wish-engine`, `paw-scene`, `export`, `power`, `rate-limit-budget`).
- **One export per file** for `paw-core` public API; barrel through `index.ts`.

## Import Rules

- `paw-core` may import only from its own `src/` and from `zod` / `fast-check` (dev). No Node or DOM APIs.
- `apps/api` imports `paw-core` and Hono/Node APIs. Never imports from `apps/web`.
- `apps/web` imports `paw-core` for pure logic and calls the API via fetch. Never imports `apps/api` directly.
- `packages/paw-mcp` imports `paw-core`, `@modelcontextprotocol/sdk`, `zod` and Node APIs. Never imports from `apps/web` or `apps/api`.
