---
inclusion: always
---
# Technology Stack

These choices are binding for every feature. Deviate only by amending this file.

## Frontend (apps/web)

| Concern         | Technology                                   |
|-----------------|----------------------------------------------|
| Build tool      | Vite                                          |
| UI framework    | React 19 + TypeScript (strict, `noImplicitAny`) |
| 3D scene        | react-three-fiber (r3f) on three.js — the paw and curse cards |
| State           | React hooks + lightweight stores; no heavy state library |
| Styling         | CSS Modules or Tailwind — pick one per feature, stay consistent |
| Fonts           | OFL-licensed fonts only (see iron-rules.md §4) |

## Backend (apps/api)

| Concern            | Technology                                  |
|--------------------|---------------------------------------------|
| Runtime            | Node.js 22 (LTS)                            |
| Framework          | Hono — lightweight, edge-ready HTTP          |
| Validation         | zod — every API boundary and every model output |
| Model               | Google Gemini Flash (server-side key only, never shipped to client) |
| Deployment         | Railway                                     |

The API is the **only** place that calls the model. The client never sees the API key (iron-rules.md §1).

## Shared packages

| Package           | Role                                                                 |
|-------------------|----------------------------------------------------------------------|
| `packages/paw-core` | Pure TypeScript: types, zod schemas, prompt builders, curse/binding/judge/export logic. Zero DOM or Node-framework imports. Consumed by web, api, and the Kiro power. |
| `packages/paw-power` | The Kiro power: MCP server (`paw.curse`, `paw.bind`) + hook logic. Depends on `paw-core`. |

## Testing

| Layer               | Tool        | What it checks                                    |
|---------------------|-------------|---------------------------------------------------|
| Unit                | Vitest      | Pure logic in `paw-core`, schemas, export         |
| Property-based      | fast-check  | Correctness properties (see each spec's design.md) |
| End-to-end          | Playwright  | User-facing flows, screenshots for receipts       |

Tests live **next to the code** they test (see structure.md). Property-based tests are first-class: every export produces verifiable properties.

## Tooling

- **Package manager:** pnpm (workspace mode). `pnpm-workspace.yaml` at root.
- **Monorepo:** pnpm workspaces. `packages/*` and `apps/*` are workspace members.
- **Lint / format:** ESLint flat config + Prettier. `pnpm lint` and `pnpm format`.
- **Git hooks:** via Kiro hooks (see brief §7), not Husky. The repo keeps `/.kiro` committed.

## License

MIT. All product code is MIT-licensed. Assets follow iron-rules.md §4 (original or properly licensed).

## Secrets

No secrets in the repo or in client code (iron-rules.md §1). `.env` is gitignored; `.env.example` lists variable names only. `/.kiro` is never gitignored.
