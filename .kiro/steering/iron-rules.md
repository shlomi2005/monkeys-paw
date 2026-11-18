---
inclusion: always
---
# Iron rules (never violate, in any task)

1. No secrets in the repository or in client code. API keys live only in server environment variables.
   `.env` is gitignored; `.env.example` lists names only. `/.kiro` is never gitignored.
2. Minimal data. Wishes are never stored with any identity. Only short-lived rate-limit counters are kept.
3. PG-13 content. No gore, no real people, no hate. Refuse wishes about harming people, with a short in-character line.
4. Only original or properly licensed assets: our own 3D models, CC0 audio, OFL fonts. "The Monkey's Paw" (1902) is
   public domain; never use film, game or brand IP.
5. Hard cost cap. The server enforces a per-IP limit and a daily budget. Over budget, the app serves the cached
   example wishes only. It must never call the model without a budget check.
6. The model output is untrusted: always validate it against the zod schema; on failure, retry once, then fall back.
7. Accessibility: every animation has a reduced-motion alternative; all controls are keyboard reachable; contrast AA.
