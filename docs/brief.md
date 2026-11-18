# The Monkey's Paw — product brief

Public product brief for the Kiroween 2026 build. Iron rules live in `.kiro/steering/iron-rules.md`.

## 1. One line
"Make a wish. The Paw grants it — exactly." A web app that stress-tests a software requirement by granting it
literally and acting out the disaster. You close each loophole until the paw's fingers open, then export a
Kiro-ready spec (EARS requirements + correctness properties for property-based tests).

## 2. Problem and audience
- AI coding agents are literal genies: they build what you wrote, not what you meant. Vague requirements are the
  #1 cause of rework, and spec-driven development (Kiro's core idea) only works when the spec is precise.
- Users: PMs, founders, students, junior devs, and every Kiro user who writes specs. Teams use it before a sprint.
- Pitch line for judges: "Every coding agent is a monkey's paw. Make your wish airtight before you make it."

## 3. Category and prizes
- Primary: **Costume Contest** (haunting, polished UI that serves the function).
- Bonus: Best Startup (Shlomicom, founder + site), Best Demo, Blog post, Social Blitz. Kiro Crew app only if cheap.

## 4. Core loop (MVP)
1. **Wish.** User types a requirement + optional app context ("a clinic booking app"), or picks one of 25 examples.
2. **Grant.** The Paw says "Granted." and plays out up to 5 **curses**: short, concrete, plausible stories of literal
   compliance going wrong, each tagged with a curse type (permissions, time, money, scale, abuse, privacy,
   accessibility, data loss, concurrency, edge input). Each curse curls one finger.
3. **Counter-wish.** For each curse the user either rewrites the wish or clicks "Bind this loophole", which proposes an
   EARS clause ("WHEN the owner leaves THE SYSTEM SHALL transfer ownership to ..."). The Judge decides whether the
   change really closes the loophole. Closed = the finger opens (animation + sound). Not closed = "The paw remembers."
4. **Rest.** All fingers open (or user stops): show the "Wish Integrity" score 0–5 and export:
   - `requirements.md` in Kiro spec format (user story + EARS acceptance criteria),
   - `properties.md`: one correctness property per closed curse, ready for property-based tests,
   - "Open in Kiro": download a zip laid out as `.kiro/specs/<name>/requirements.md`.
5. **Share card.** Image of your paw + the funniest curse (virality, Social Blitz).

## 5. AI roles (prompted roles in the backend; also Kiro custom agents used to build/evaluate)
- **Paw** (adversary): finds loopholes. Must be specific to the wish, plausible, non-generic. No write tools.
- **Genie** (narrator): tells the literal grant in 1–2 sentences, dry comedy-horror voice.
- **Judge**: rejects generic curses; decides if an amendment closes a loophole; emits JSON only.
- Output is strict JSON (zod schema). Guardrails: curse taxonomy steering, PG-13, no real people, refuse wishes about
  hurting people. Model: Google Gemini Flash (server-side key). Cost cap: per-IP limit, cache for the 25 examples, hard daily
  budget; over budget = examples-only mode.

## 6. The Paw inside Kiro (the InteractionKit lesson: make Kiro shine)
- A **Kiro power** `monkeys-paw`: MCP server with `paw.curse(requirement)` and `paw.bind(curse, amendment)`,
  steering with the curse taxonomy, and a **hook**: on save of any `.kiro/specs/*/requirements.md`, the Paw comments
  the open loopholes. So Kiro users get the paw in their own specs.

## 7. How we use Kiro (Technological Implementation = 20%)
- All product code is written in Kiro (IDE and `kiro-cli chat --no-interactive` driven by our orchestration scripts). No code written
  outside Kiro. The repo keeps `/.kiro` (never gitignored).
- **Specs**: one per feature (wish engine, paw scene, export, power, rate-limit/budget).
- **Steering**: product.md, tech.md, structure.md, curse-taxonomy.md, tone.md, iron-rules.md.
- **Hooks**: on prompt/taxonomy save → run the golden-wish eval (25 wishes, Judge scores specificity); on UI save →
  Playwright screenshot receipt; on spec save → regenerate properties.
- **Custom agents**: paw, genie, judge, qa (veto), legal (veto) — read-only where possible.
- **Property-based tests** (fast-check): export is always valid EARS; every closed curse yields exactly one property;
  JSON schema round-trips; rate limiter never exceeds budget; finger count == open curses.
- **MCP**: Playwright (screenshots/e2e), docs MCP; our own paw MCP server (the power).
- Write-up tracks each of these with concrete examples (judges read it).

## 8. Design
- Dark velvet + candlelight palette, Victorian serif type, tarot-like curse cards around the paw.
- The paw: Blender model → reference video → rig with 5 finger bones → GLB in three.js (react-three-fiber);
  fingers curl/open live. Sound: bone creak on curl, sigh on open (CC0 or our own). Mobile responsive.
- Art direction: Victorian 1900s engraving on aged parchment, sepia + black ink, one blood-red accent; five wish circles around the paw.

## 9. Tech
Vite + React + TypeScript + three.js (r3f); Node API (Hono) on Railway; zod; fast-check; Playwright; MIT license.
Public GitHub repo. Secrets only in server env, never in repo or client.
