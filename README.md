# The Monkey's Paw

Make a wish. The Paw grants it, exactly.

You write a software requirement. The Paw follows it to the letter and acts out up to five ways it goes wrong. You close each loophole with a rewrite or an EARS clause, and a Judge decides whether it is really closed. When the paw rests, you export `requirements.md` and `properties.md` for Kiro.

## Repo map

| Path                     | What it holds                                                              |
|--------------------------|----------------------------------------------------------------------------|
| `apps/web`               | The UI: Vite, React and react-three-fiber.                                 |
| `apps/api`               | The Hono server. The only place that calls the model.                      |
| `packages/paw-core`      | Pure TypeScript logic shared by web, api and the MCP server.               |
| `packages/paw-mcp`       | The MCP server with the tools `paw_curse` and `paw_bind`.                  |
| `powers/monkeys-paw`     | The Kiro power: manifest, skills and the committed MCP bundle.             |
| `.kiro`                  | Steering files, specs, hooks and agents.                                   |

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

## Work on it

```sh
pnpm install
pnpm -C packages/paw-core build
pnpm test
```

## Licence

MIT. See [LICENSE](LICENSE).
