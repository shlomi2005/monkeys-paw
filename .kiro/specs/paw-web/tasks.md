# Paw Web — Tasks

Ordered checklist for `apps/web`. Requirements are cited as `Req N.M` (see `requirements.md`), design decisions as
`A1`–`A10` (design.md, "Decisions and assumptions"). Each task is sized for one agent run. Tasks marked **[PBT]** are
fast-check property tests. State machine and joint-pose property tests are written **before** their implementation
and are expected to fail until the matching implementation task lands. Property numbers `P1`–`P18` refer to design.md.

## Scaffold and assets

- [x] 1. Scaffold `apps/web`: `package.json` (name `@monkeyspaw/web`, type `module`, scripts `dev`, `build`, `preview`,
  `test`, `lint`, `e2e`), Vite + React 19 + TypeScript (strict, `noImplicitAny`), Vitest, `tsconfig.json`, workspace
  dependency on `paw-core`, `.env.example` listing only `VITE_API_BASE_URL`, and `.gitignore` entries for
  `apps/web/public/paw/`, `dist/` and `.env`. Use CSS Modules for all styling. Render an empty `App`. (Req 10.4, 11.1;
  tech.md, structure.md, iron-rules §1)
- [x] 2. Prerequisite in `paw-core` and `apps/api`: move `WishSchema` and the envelope schemas
  (`GrantResponseSchema`, `BindResponseSchema`, `ExamplesResponseSchema`) into `paw-core/src/schemas.ts`, export them
  from `index.ts`, and re-point `apps/api/src/schemas.ts` to import them. Confirm `paw-core/package.json` has
  `"sideEffects": false`. Run both packages' test suites. (A7, Req 3.3, 4.3, 10.4)
- [x] 3. `scripts/copy-paw-assets.mjs`: copy `docs/art/paw/*.glb` and `docs/art/paw/*.jpg` to `apps/web/public/paw/`,
  then verify byte length and SHA-256 of each copy against its source. Exit non-zero when a source file is missing
  or a copy differs. Wire it as `predev` and `prebuild`. Add a Vitest test that runs the script against a temporary
  directory. Do not copy `runtime-controls.json` (it is imported through a Vite alias, see task 11). (Req 2.2, 12.1)

## State machine (tests first)

- [x] 4. Create `state/paw-machine-types.ts` (`Digit`, `Phase`, `EndReason`, `AnimCommand`, `PawContext`, `PawEvent`,
  `PawEffect`, `Transition`) exactly as in design section 5, and `state/arbitraries.ts` with `arbGrant`, `arbIntent`,
  `arbSession`, the intent interpreter, `drain` and the reference model described in "Event-sequence generator".
  Export a stub `reduce` that throws `not implemented` so the property tests compile and fail. Add one unit test that
  the generator produces grants with 3–5 curses and that shrinking returns a shorter intent list.
  (Req 5.1, 5.2, 6.7, 6.9; design Correctness Properties)
- [x] 5. **[PBT]** `state/paw-machine.properties.test.ts`, written before the reducer:
  - [x] 5.1 **[PBT]** P1 curl order, P2 LIFO (including "thumb opens last whichever circle is bound"), P3 finger-count
    invariant after `drain`. (Req 5.1, 5.2, 5.3, 5.6, 6.1)
  - [x] 5.2 **[PBT]** P4 idempotent close, P5 failed verdict changes nothing, P7 circles equal the closed set and are
    independent of the stack. (Req 5.5, 5.7, 5.8, 4.3)
  - [x] 5.3 **[PBT]** P6 never more than one active animation (state and effect-stream form), P11 reduced motion never
    queues. (Req 5.4, 2.7, 2.9, 6.1)
  - [x] 5.4 **[PBT]** P8 lock after the end (no `request-bind` between `ended` and `rewrite`), P9 rewrite equals
    `initialState`, P10 stop (including stop during queued curls and during an open animation). (Req 6.7, 6.9, 6.10,
    4.4, 6.1)
- [x] 6. Implement `state/paw-machine.ts` until all of task 5 passes. No React, three, DOM, timers or `Date` imports.
  - [x] 6.1 `initialState`, `enqueue`, `complete` (id and kind match, single active command, `play` effects). (Req 5.4)
  - [x] 6.2 `grant_requested`, `grant_received` (push `[0..k-1]`, queue k curls, all curses start open), `grant_failed`,
    `curl_done`, move to `ready` when quiescent. Reduced motion uses one `snap`. (Req 5.1, 5.2, 2.7, 2.9)
  - [x] 6.3 `circle_activated`, `card_closed`, `bind_submitted`, `bind_failed`, and the verdict rules (not closed,
    idempotent close, LIFO pop, all-closed ending with `open` then `rest`). (Req 4.3, 5.3, 5.5, 5.7, 5.8, 6.1)
  - [x] 6.4 `stop` (one `snap` of the logical pose, queue cleared, `abort-requests` when judging), `rewrite`,
    the lock after the end, `motion_preference_changed`. (Req 6.7, 6.9, 6.10, 4.4, 2.9)
- [x] 7. `state/paw-machine.test.ts`: one example-based test per row of the design's transition table, plus the three
  worked scenarios: a 4-curse grant closed in the order 2, 0, 3, 1 (digits open 3, 2, 1, 0), a stop during curl 3 of 5 (the `snap` shows all five digits curled, one per open curse), and a late `*_done` after a `snap` that is ignored.
  (Req 5.2, 5.3, 6.7, 6.10)
- [x] 8. `state/paw-selectors.ts`: `projectGrant`, `curseTypeLabel`, `CircleView` (status and `aria-label` strings),
  `fingerText`, `medal`, `showStop`, `showExport`, `card`, and `isQuiescent`. Write **[PBT]** P15 (medal equals
  `computeIntegrity(projectGrant(ctx))` and the `Integrity N/5: M closed, O open` text) and P16 (digit and circle
  mapping) first, then implement. Add example tests for the labels in design section 7. (Req 6.8, 5.8, 8.4, 6.6)
- [x] 9. `state/paw-announcer.ts`: pure `describe(prev, next, event)` returning the live-region text from the design's
  table. Unit-test each row, including the reduced-motion single message. (Req 8.4, 2.9, 6.8)

## Joint pose

- [x] 10. **[PBT]** `scene/joint-pose.properties.test.ts`, written before the module: P12 (pose depends only on
  `(bind, ops, amount)`, interleaved calls, unit length, matches a three `Quaternion` reference built in the test;
  add `three` as a dev dependency used only by this test) and P13 (clamps outside [0, 1], NaN and ±Infinity,
  `amount ≤ 0` returns `bind` exactly). Add a stub `poseJoint` that throws. (Req 2.7)
- [x] 11. Implement `scene/joint-pose.ts` (pure tuples, no three, no DOM), `scene/digit-joints.ts` and
  `scene/paw-controls.ts` (zod schema for `runtime-controls.json`, imported through a Vite alias to `docs/art/paw/`
  with `server.fs.allow`). Contract test: 16 joints present, the 15 driven joints map to digits exactly as in
  Req 2.7, `wrist` has no operations, bind quaternions are unit length. (Req 2.7)
- [x] 12. **[PBT]** `scene/easing.ts`, `scene/anim-sampler.ts`, `scene/rest-pose.ts`: write P14 first, then implement
  `cubicOut`, `smoothstep`, curl 500 ms, open 1208 ms, rest 2000 ms sink and tilt (constants `REST_SINK`,
  `REST_TILT_DEG`). (Req 2.7, 2.8, 6.1)
- [x] 13. `scene/camera-fit.ts` (`fitDistance`, test that a 1-unit paw at fov 30° and 1:1 aspect fits with margin, camera
  on +Z looking at `(0, 0.5, 0)`), `scene/glb-choice.ts` (`chooseGlb` with a fake `matchMedia`, 768 px edge cases), and
  `scene/webgl-support.ts` (fake canvas; never throws). (Req 2.1, 2.2, 2.10, 10.5)

## API client and export

- [x] 14. `api/api-errors.ts`, `api/api-messages.ts` (all in-character lines, one file) and `api/api-schemas.ts`
  (`normalizeGrant`, bind consistency check, examples entry type). Unit tests for `normalizeGrant` and the consistency
  check. (Req 3.3, 3.7, 4.3, 11.1)
- [x] 15. **[PBT]** `api/api-client.properties.test.ts` for P18 with a fake `fetch` (any status 100–599, invalid JSON,
  wrong shapes, thrown errors, timeout, abort), plus example tests for the status mapping table: 400, 404, 429, 503,
  500, network, timeout. Written before the client. (Req 3.3, 3.7, 4.3, 11.4, 11.6)
- [x] 16. Implement `api/api-client.ts`: `getExamples`, `postGrant`, `postBind`, `postExport`, base URL from
  `import.meta.env.VITE_API_BASE_URL`, `credentials: 'omit'`, `AbortController` timeouts (60 s, 60 s, 15 s, 10 s),
  body-only wish data, zod validation with `paw-core` schemas. Make task 15 pass. (Req 3.3, 3.7, 4.3, 6.2, 11.4, 11.6)
- [x] 17. **[PBT]** `export/zip.ts`, `export/slug.ts`, `export/download.ts`: write P17 first (round trip against `fflate`
  as a test-only dependency, valid CRC-32, `slugify` and `safeId` shapes), then implement the store-only zip writer
  with an injected clock. (Req 6.2)

## Session hook

- [x] 18. `state/scene-bridge.ts` and `state/use-paw-session.ts`: wrap `reduce` in a ref-held context, run effects in
  order (`request-grant`, `request-bind`, `abort-requests`, `play`, `snap`), abort on stop and rewrite, discard aborted
  responses, and complete `play` effects on a microtask when no scene is ready. Add examples-only replay (A9). Test with
  a fake API and fake timers: grant flow, bind flow, stop while judging discards the late response, no scene means no
  stalled queue. (Req 3.3, 4.3, 5.4, 6.9, 6.10, 2.10; A9)

## Layout and components

- [x] 19. Styles and shell: `styles/tokens.css` (palette, contrast tokens, 16/18 px base, `line-height: 1.5`, duration
  tokens, `prefers-reduced-motion` block), `styles/fonts.css` (self-hosted OFL IM Fell English and Crimson Text, Latin
  WOFF2 subsets, `size-adjust` fallbacks, licence files kept), and `index.html` static shell with inline critical CSS
  and the poster in its reserved box. `styles/contrast.test.ts` recomputes every ratio in design section 7. (Req 1.1,
  8.3, 8.5, 10.1, 10.3, 12.2)
- [x] 20. `PlateFrame`, `Brazier`, `Curtain`, `RayDisc`: original SVG ornate border (simplified under 768 px), brazier
  smoke loop 2–3 s, curtain breathing about 500 ms, red ray disc with a one-off pulse. All decorative parts
  `aria-hidden`, all loops off under reduced motion. Component test for `aria-hidden` and the reduced-motion class.
  (Req 1.1, 1.2, 8.2, 8.4, 12.3, 9.1, 9.2)
- [x] 21. `PawStage` and `PawPoster`: 1:1 box sized with `clamp()` (300–400 px desktop, 150–200 px mobile) from the same
  custom properties as the shell, poster image with explicit dimensions, no canvas yet. `PawStateText` caption.
  (Req 1.3, 2.3, 9.1, 9.2, 10.3)
- [x] 22. `components/circle-layout.ts` (pure `circlePosition(index, rx, ry)` for the pentagon table in design section 1),
  `CircleRing` and `CurseCircle`: five circles, index 0 upper-left through index 4 lower-left clockwise (three above
  the paw's centre line, two below), tuned against `docs/art/concept-victorian.png` and `docs/ui-brief.md`, mobile
  vertical list under 768 px, fill transition, vignette, type label, seal and laurel, caption with the story, labels
  from `CircleView`. Test the position table (index to angle and quadrant) and the mobile order. (Req 1.4, 1.5, 4.1,
  5.8, 6.7, 6.9, 8.4, 9.1, 9.2)
- [x] 23. `WishLine`: "I wish that…" input, collapsible "for…" field, "Make the wish" seal button, form submit on
  Enter, blank-wish message, disabled while granting, "The Paw stirs…" loading state. Component tests. (Req 3.1, 3.2,
  3.3, 8.1, 8.4)
- [x] 24. `ExampleCards` and `ExampleCard`: load from `GET /api/examples`, snippets with ellipsis, "Example" label,
  select on click or Enter, highlight clears when the text is edited, dim while typing, placeholder when examples are
  unavailable, horizontal row (desktop) and strip (mobile). Component tests for each state. (Req 3.2, 3.4, 3.5, 3.6,
  3.7, 3.8, 9.1)
- [x] 25. `BindingCard`: native `<dialog>` opened with `showModal()`, curse story and loophole, editable clause
  pre-filled with the suggested EARS clause, "Accept this clause", "Rewrite the whole wish", "Cancel", "The Judge
  stirs…", "The paw remembers." line, bottom-sheet variant under 768 px, `aria-labelledby` and `aria-describedby`.
  Wire to `bind_submitted`, `card_closed`, `rewrite`. (Req 4.2, 4.3, 4.4, 4.5, 4.6, 8.4, 9.1)
- [x] 26. `StopButton`, `IntegrityMedal` (five laurels, `role="status"`, `Integrity N/5: M closed, O open`),
  `GrantedStamp` (red "Granted." plus narration caption) and `LiveRegion` fed by the announcer. Component tests for
  visibility rules: Stop only with a Grant and an open curse, medal only when ended and quiescent. (Req 3.3, 6.1, 6.6,
  6.8, 8.4)
- [x] 27. Wire `App` and `SessionProvider` in the required DOM order (wish input, context, Make, examples, circles,
  card, Stop, export buttons, sound toggle) with CSS grid for the visual layout. The whole app must work end to end in
  poster mode with no 3D. Add an integration test with a fake API: wish, grant, bind closed, bind not closed, stop.
  (Req 1.6, 3.3, 4.3, 5.2, 5.3, 6.1, 6.7, 8.1)

## r3f scene

- [x] 28. Add `three`, `@react-three/fiber` and `@react-three/drei` (used for `useGLTF` only). Create the lazy
  `scene/PawScene.tsx` entry, `PawCanvas.tsx` (`frameloop="demand"`, `dpr` caps, transparent background, soft
  shadows, `aria-hidden`, `pointer-events: none`), `PawLights.tsx` (sepia ambient, warm key with soft shadow, faint red
  rim, `ShadowMaterial` receiver) and the camera from `camera-fit.ts`. In `PawStage`, import the scene with `React.lazy`
  after first paint (`requestIdleCallback` with a timeout fallback) and only when `webgl-support` passes. Add the error
  boundary around the scene. (Req 2.1, 2.10, 10.5)
- [x] 29. `scene/PawModel.tsx` and `use-paw-material.ts`: load the GLB chosen by `chooseGlb` (one request only), inspect
  `extensionsUsed` and serve Draco or meshopt decoders locally if present (no third-party CDN), keep the cord on its
  own material, and return the placeholder sepia-tinted material from the single `usePawMaterial` hook. Fire `onReady`
  after the first rendered frame, fade the canvas in over 300 ms, then hide the poster; fire `onFailure` on load
  error or `webglcontextlost`. (Req 2.2, 2.3, 2.5, 2.6, 2.10, 10.5, 10.6)
- [x] 30. `scene/use-joint-driver.ts` and `RestGroup.tsx`: the `useFrame` driver builds every pose from bind through
  `poseJoint` for all 15 digit joints, applies sink and tilt on the model root group, calls `invalidate()` only while a
  command runs, calls `onDone` at the end, and applies `snap` effects in one frame. Add `releaseJoints(mixer, names)`
  and test it with a fake mixer. Connect the component to `SceneBridge` and give the scene `initialCurled`. Test the
  driver logic with a fake bone set (no WebGL): bind at amount 0, no accumulation across frames, one digit at a time.
  (Req 2.7, 2.8, 6.1, 5.4, 10.6)
- [x] 31. Granting twitch (250 ms, ui-brief moment 1) on the model root (wrist-only, off under reduced motion), plus an `invalidate`
  counter for the idle-cost check. Verify by hand in the browser that curls, opens and the rest moment look right and
  tune `REST_SINK`, `REST_TILT_DEG` and the light intensities. (Req 2.6, 2.7, 2.8, 6.1, 9.4)
  **Note:** the code, tests and the camera centring (on the GLB bounding-box centre, `centredPawCamera`) are done. The
  hand check and the tuning were done in the browser (Chromium with WebGL, stubbed API): a 3-curse grant, three closes
  (LIFO opens: middle, index, thumb) and the rest moment. Tuned values: `AMBIENT_INTENSITY` 1.8, `KEY_INTENSITY` 4.8,
  `RIM_INTENSITY` 1.0, `REST_SINK` 0.1, `REST_TILT_DEG` −30 (negative: the fingertips lean back, away from the camera).
  The intensities are high because the GLB material has metalness 1, there is no environment map, and the sepia tint is
  applied in linear space.

## Accessibility

- [x] 32. `hooks/use-dialog-focus.ts` (store opener, restore focus on close), Escape handling through `cancel`, ignore
  Escape while judging, and the same behaviour in `OpenInKiroDialog` (task 38). Document that the focus trap is
  verified in Playwright. (Req 4.6, 8.1, 8.4)
  The `OpenInKiroDialog` half of this task is done in task 38, which reuses `useDialogFocus` unchanged: Escape (through
  `cancel`) and Close both restore focus to "Open in Kiro" (`ExportButtons.test.tsx`). Done in task 32:
  the hook, `BindingCard` on it, and the Chrome close-watcher guard (a `close` event while the card is still open
  calls `onCancel`, or reopens the dialog while judging).
- [x] 33. `hooks/use-reduced-motion.ts` (media query listener dispatching `motion_preference_changed`), the CSS
  reduced-motion block applied to every animated component, and text cues "Finger curled" and "Finger open" in
  `PawStateText`. Component tests with a mocked `matchMedia`. (Req 2.9, 8.2, 6.1)
  Done: `SessionProvider` sends `motion_preference_changed` once per real change after mount (never on mount, never for
  an unchanged value); `reduced-motion-css.test.ts` reads every `*.module.css` and `tokens.css` and fails on an
  animation or transition that survives reduced motion; `PawStateText` adds "Finger curled." and "Finger open." (the
  preference is `ctx.reducedMotion`), and `App.module.css` reserves the line's room (`--cue-h`).
- [x] 34. Add `vitest-axe` or equivalent for component checks and fix findings: labels on all inputs and buttons,
  dialog names, `aria-hidden` on decoration, live region content, 48 px minimum hit areas, focus ring token on every
  focusable control. (Req 8.1, 8.3, 8.4, 9.3)
  Done: `App.a11y.test.tsx` runs axe on the whole page in four states (only `color-contrast` is off, because jsdom
  cannot compute it; `contrast.test.ts` covers it) plus a structure sweep; `hit-areas.test.ts` and `focus-ring.test.ts`
  read the source and the stylesheets as text. Finding fixed: the example card name did not contain its visible text
  (`label-content-name-mismatch`).

## Sound

- [x] 35. `audio/sound-preference.ts` (only `localStorage['pawSoundEnabled']`, try/catch, value `"1"` or `"0"`) and
  `SoundToggle` (`aria-pressed`, off by default, restored on reload). Unit test that no other key is ever written and
  that blocked storage does not throw. (Req 7.1, 7.4, 11.1)
  Done: the toggle is a 48 px `<button aria-pressed aria-label="Sound">` in App's `data-slot="sound"`. The state lives in
  `audio/sound-controller.ts` (entry chunk, tiny), which the session owns, so the toggle and the cue triggers share it.
- [x] 36. `audio/sound-player.ts`, loaded lazily on first enable: creak 500 ms, stamp 300 ms, sigh 800 ms, crack 200 ms,
  peak gain about −12 dB, previous cue fades out over 100 ms, cues triggered from the session on curl, "Granted.",
  open and crack. Add the four CC0 or original audio files under `public/audio/` (total under 500 KB) with a short
  `ASSETS.md` note recording source and licence for each file. Test the player with a fake `AudioContext`.
  (Req 7.2, 7.3, 7.5, 12.4)
  Deviation (design.md A11): the cues are original and synthesized in code with Web Audio, so there are no audio files,
  no `public/audio/` and no `ASSETS.md`. Only the "~128kbps MP3 or WAV" format clause of Req 7.3 does not apply.
  Done: `sound-player.ts` is its own lazy chunk (`entry-graph.test.ts` asserts it). The `AudioContext` is created inside
  the toggle click, or inside the first `pointerdown` or `keydown` after a restored-on reload. `cue-triggers.ts` maps the
  session's transitions to cues. Tests use `audio/fake-audio-context.ts`.

## End screen and export

- [x] 37. `ExportButtons`: "Take the scroll" (call `postExport`, build the zip with `requirements.md` and
  `properties.md`, download `monkeys-paw-<safeId(wishId)>.zip`, "Scroll saved!" or an error line), stacked with 48 px
  targets on mobile, shown only when the medal shows. Test the download with a mocked `postExport` and check the zip
  contents. (Req 6.2, 6.4, 6.8)
  Done: the session now exposes its `api`, and `ExportButtons` sits in App's `data-slot="export"` with `view.showExport`.
  Both buttons share one request guard (a ref) and are `aria-disabled` while it runs, so a second click does nothing.
  The status line is the component's own polite `role="status"` region, like the medal's and the binding card's, not
  the session's live region: that one only announces machine transitions, and the dialog (task 38) is modal, so its
  status has to live inside it anyway. Unmounting or hiding the buttons aborts the request. The file name uses the
  server's `wishId` from the `SpecExport`.
- [x] 38. `OpenInKiroDialog`: call `postExport`, show copy buttons for the folder name and `kiro open monkeys-paw-<slug>`,
  Clipboard API with select-and-copy fallback, and a download of the zip containing the `monkeys-paw-<slug>/` folder.
  (Req 6.2, 8.4)
  Done: the folder name and the command are in labelled read-only fields, each with a Copy button. When the clipboard
  is missing or rejects, the field is focused and selected and the status says "Press Ctrl+C (Cmd+C) to copy". The
  zip holds `monkeys-paw-<slug>/requirements.md` and `monkeys-paw-<slug>/properties.md`. Addition: the status says
  "Folder saved!" after that download, so the click is not silent. The slug is cut at 32 characters, as `slugify` does.
- [x] 39. Round-end polish and rewrite: show the final circles with cracked seals and "The paw remembers." after Stop,
  laurels on closed circles, medal and export after either ending, "Rewrite" returns the paw upright and clears the
  Grant, input and circles. Integration test for both endings and rewrite. (Req 4.4, 6.1, 6.5, 6.7, 6.8, 6.9)
  Done: the cracked seal, "The paw remembers." and the laurels were already in `CurseCircle`; the integration tests now
  check them after Stop. `RewriteButton` shows in phase `ended`, after the export buttons, and calls App's `rewrite()`.
  That sets a flag, and an effect after the commit focuses the wish input (after the commit, so a rewrite from the
  binding card does not try to focus outside a modal dialog). Circles stay focusable after the end and open no card.
  The axe test has the end screen and the export dialog open.
- [ ] 40. Optional: `ShareCard` (parchment plate image with all circles and one highlighted curse, "Copy image", "Tweet",
  "Copy link"). Draw to an offscreen canvas, no remote assets, no wish text in the shared link. Skip if time is short.
  (Req 6.3, 11.6)
  Skipped in this build: optional; no share card ships.

## Ink shader (separate spec)

- [x] 41. Placeholder, no work in this spec: the cross-hatching ink shader (Req 2.4) and the rope-textured cord detail
  (Req 2.5) belong to a separate spec, `.kiro/specs/paw-ink-shader/`, to be written later. The only integration point is
  `usePawMaterial` in `scene/use-paw-material.ts` (task 29). The shader spec must replace that hook's body and touch no
  other file listed here. Leave this task unchecked until that spec ships. (Req 2.4, 2.5)
  Shipped by `.kiro/specs/paw-ink-shader/`; `PAW_MATERIAL_STYLE` in `use-paw-material.ts` switches back to the placeholder.

## End-to-end, receipts and budgets

- [x] 42. Playwright setup in `apps/web` (desktop Chromium and a 390 px mobile project), a stubbed API through
  `page.route` with schema-valid fixtures built from `paw-core` types, helpers for `curl` and `open` timing, and a
  `webServer` that runs `vite preview`. (tech.md, Req 3, 4) Note: `scripts/ui-screenshot-receipt.mjs` of
  `.kiro/specs/paw-power/` stops skipping once `@playwright/test` is a dependency of `apps/web`.
  Note (done): `@playwright/test` 1.63.0 (exact), `playwright.config.ts` (projects `desktop` and `mobile`, the mobile one runs only
  `*.mobile.spec.ts`), `e2e/support/` (fixtures, stub API, timeline recorder, canvas pictures), `tsconfig.e2e.json`, and `e2e/webgl.spec.ts`.
  No product hook was added. The recorder is injected by the tests with `addInitScript`.
- [x] 43. e2e: full round on desktop. Wish, "Granted.", five curls one at a time, bind and close in a different order from
  the curls, LIFO opens with the thumb last, rest moment, medal 5/5, both export buttons, zip contents. Also a not-closed
  verdict ("The paw remembers.", card stays open). (Req 2.7, 2.8, 4.3, 5.1–5.4, 6.1, 6.2, 6.8)
  Note (done, `e2e/round.spec.ts`): the DOM shows when each curl starts and ends and when the rest moment ends, but not which digit
  moves or when an open ends. LIFO and "thumb last" are checked on pictures of the paw (digit strips move from the little finger
  towards the index, the digit left curled lies below every fingertip); the length of each open is checked through the medal time.
- [x] 44. e2e: Stop paths. Stop with open curses ends without sink or tilt, curled digits stay curled, medal and export
  show, circles are focusable but open no card and no `POST /api/bind` is sent; stop during queued curls shows one
  curled digit per open curse; "Rewrite" resets everything. (Req 6.6, 6.7, 6.9, 6.10, 4.4)
  Note (done, `e2e/stop.spec.ts`): "no sink or tilt" and "one curled digit per open curse" are checked on pictures of the paw (the
  picture after Stop equals the one before it, and equals the fully curled paw). The DOM alone cannot show the pose.
- [x] 45. e2e: keyboard and accessibility. Tab order matches Req 8.1, dialog traps and restores focus, Escape closes,
  Enter and Space work, `@axe-core/playwright` finds no serious or critical issues in each phase, 200% zoom (640 px
  wide) has no horizontal scroll. (Req 8.1, 8.3, 8.4, 8.5)
  Note (done, `e2e/a11y.spec.ts`): `@axe-core/playwright` 4.14.0 (exact). Axe finds no serious or critical issue in the seven phases, so no product
  change was needed and no rule is disabled. A native modal dialog does not wrap Tab by itself: after its last control focus goes to the
  browser (the body) and the next press returns to the dialog, so the trap is checked as "the page behind never takes focus".
- [x] 46. e2e: reduced motion (`emulateMedia`) gives instant state changes and text cues with the queue never used;
  no-WebGL launch flag keeps the poster, shows text state and leaves the UI usable; `GET /api/examples` 503 shows the
  placeholder; a 503 on grant shows the resting message and enables examples-only replay. (Req 2.9, 2.10, 3.7, 8.2; A9)
  Note (done, `e2e/fallbacks.spec.ts`): the no-WebGL test is tagged `@no-webgl` and runs only in the project `desktop-no-webgl`
  (`--disable-3d-apis`; `desktop` skips that tag). Reduced motion is observed through the timeline log: no `arriving` circle, the five circles
  land in one commit, the medal comes with the last close. That the scene snaps its joints is not read from the canvas here.
- [x] 47. e2e: privacy. After a full round assert `localStorage` keys are at most `pawSoundEnabled`, `sessionStorage`
  and `document.cookie` are empty, the URL never changed, no request URL contains the wish text, all requests go to the
  app origin or the API origin, every API request has no credentials. (Req 7.4, 11.1–11.6)
  Note (done, `e2e/privacy.spec.ts`): two tests, a full round with both exports (sound off) and one with the sound toggled on and off.
- [x] 48. e2e: mobile project. Circles form a vertical list under a small paw, the card is a bottom sheet, 48 px targets,
  rotation reflows without remounting the canvas, `paw-mobile.glb` is the only GLB requested (and `paw-web.glb` on
  desktop). (Req 2.2, 9.1, 9.2, 9.3, 9.4, 10.5)
  Note (done, `e2e/layout.mobile.spec.ts`, plus a desktop `paw-web.glb` test in `e2e/webgl.spec.ts`): no product change was needed.
- [x] 49. Screenshot receipts: desktop and mobile in the phases listed in design "Testing Strategy" (idle, curses landed,
  card open, closed, not closed, rested with medal, stopped with medal, reduced motion, no WebGL), saved to
  `apps/web/e2e/receipts/`. (tech.md, Req 1, 4, 6) Note: tag every receipt test `@receipt`; the hook
  `ui-screenshot-receipt` (`.kiro/specs/paw-power/`) runs `playwright test --grep @receipt`.
  Note (done, `e2e/receipts.spec.ts`, `e2e/receipts.mobile.spec.ts`, `e2e/support/receipts.ts`): PNGs are generated locally and gitignored; mobile has no no-WebGL shot.
- [x] 50. `scripts/check-bundle-budget.mjs` and `build.manifest`: gzip the initial set and the 3D chunk from the manifest,
  fail above 200 KB gz initial JS, 30 KB gz CSS, 330 KB gz 3D chunk, 140 KB fonts, 500 KB audio. Add
  `rollup-plugin-visualizer`, confirm `paw-core` tree-shakes to schemas and `computeIntegrity`. Add a Playwright check
  that the 3D chunk is requested only after the load event. (Req 10.4, 10.5)
  Note (done): `build.manifest` is on, `pnpm budget` runs `scripts/check-bundle-budget.mjs` (pure parts tested in
  `scripts/check-bundle-budget.test.ts`), and `rollup-plugin-visualizer` 7.1.3 (exact) runs only with `PAW_VISUALIZE=1` and writes
  `dist/stats.html` and `dist/stats.json`. The report shows `paw-core` reduced to `schemas.js` and `integrity.js` in the entry chunk;
  `prompts`, `grant`, `bind`, `judge`, `export`, `budget` and `ears` render 0 bytes. The load-event check is in `e2e/webgl.spec.ts`.
  Measured (gzip): initial JS 103.2 KB, CSS 8.2 KB, 3D chunk 278.0 KB; fonts 137.1 KB raw; audio 0. 1 KB is 1000 bytes.
- [ ] 51. Performance runs: Lighthouse CI with fast-3G throttling (FCP ≤ 1.5 s, LCP ≤ 3.0 s, CLS < 0.1), Playwright
  metrics for CLS over a full round, first-frame marks, `requestAnimationFrame` frame-time p95 during a curl and an
  open, reflow under 100 ms on resize, and zero rendered frames after 2 s idle. Record results in
  `apps/web/e2e/receipts/perf.md`. (Req 10.1, 10.2, 10.3, 10.6, 10.7, 9.4)
  Note (skipped in this build): Lighthouse is not installed here, and the brief allows it only if it runs fully locally with
  no download. Not done, so this stays unticked, and the Playwright metrics in it are not done either. An owner needs a Lighthouse
  install (CLI or `@lhci/cli`) and a local Chrome, run against `vite preview` with no upload to any service.
- [x] 52. Write `apps/web/README.md`: scripts, the `VITE_API_BASE_URL` variable (name only), the asset copy step, how to
  run unit, property and e2e tests, and the single storage item. (Req 11.1, 12.6)
- [x] 53. Wish privacy line. Add `WISH_SENT_TO_GEMINI_MESSAGE` to `apps/web/src/api/api-messages.ts` (the proposed text of
  design "Wish privacy line", in the page's voice). In `WishLine.tsx` render it as a `<p>` in its own grid row under the wish
  row (`WishLine.module.css`: a new area, body size, at least 1rem, ink colour, no other layout change), and set the wish
  input's `aria-describedby` to the note's id, or to `"<messageId> <noteId>"` when a message shows. Update
  `WishLine.test.tsx` (the two `aria-describedby` expectations now include the note's id; new tests: the note is rendered,
  its text is the constant, the input is described by it alone and by the message and it, and it is not focusable) and the
  contrast test only if it lists the band. Search `apps/web/e2e` for the old `aria-describedby` value or the band's text;
  change an e2e test or a receipt only if this line changes it. Do not run Playwright in an agent run (the owner runs the
  e2e suite). Run `pnpm -C apps/web exec vitest run` (one process) and `pnpm -C apps/web typecheck`. (Req 3.9, 8.3, 8.5)
  Done: `WISH_SENT_TO_GEMINI_MESSAGE` in `api-messages.ts`: "Your wish travels to Google's Gemini, which writes the curses. Keep personal details out of it." (two short sentences, no exclamation mark, none of the words tone.md avoids). `WishLine.tsx` renders it as `<p id={noteId}>` right after the wish input, in a new `note` grid row under the wish row (mobile and from 768 px; `.note` sets only the grid area, ink colour and no margin, so it keeps the band's 1rem). The wish input's `aria-describedby` is the note's id, or `"<messageId> <noteId>"` when a message shows. `WishLine.test.tsx` has the two updated expectations and new tests (the note is a `<p>` with the constant's text, described by it alone and by message then note, ids exist, not focusable, tab order unchanged, DOM position, grid areas and `.note` rule); `api-messages.test.ts` checks the text and tone. `contrast.test.ts` does not list the band, so it is unchanged. `apps/web/e2e` holds no `aria-describedby` and no check of the band's text or height: the tab-order, 48 px, no-sideways-scroll (390 px and 640 px) and `form`-scoped `RESTING_MESSAGE` checks are unaffected by one more non-focusable paragraph, so no e2e test or receipt was changed (receipt PNGs are gitignored; the wish band is one line taller in them). Playwright not run. `pnpm -C apps/web exec vitest run`: 1247 passed (82 files); typecheck, lint and build pass.
- [x] 54. Phone: the result comes first. On a viewport under 768 px with a Grant active (`ctx.grant` not null), order the page
  paw, stamp, narration, circles, medal, actions, wish line, examples, sound toggle, on screen and in the DOM (design A12,
  "Mobile" A–C, "Focus order"). Add `hooks/use-media-query.ts` (`useSyncExternalStore`, `(max-width: 767.98px)`, a missing or
  throwing `matchMedia` means desktop), `hooks/use-result-first.ts` (moves the wish slot and the examples slot by ref in a
  `useLayoutEffect`, keeps focus, caret and selection, never moves the ring, dialogs, actions or canvas) and
  `hooks/use-phone-focus.ts` (the scroll-to-top and focus rules, temporary `tabindex="-1"`, focus ring on `:focus-visible`).
  In `App.tsx` keep one JSX order and set `data-result-first`; in `App.module.css` add the result-first grid areas inside
  `@media (max-width: 767.98px)` and the bottom room for the sound toggle. Jsdom tests for the three hooks. e2e in
  `e2e/layout.mobile.spec.ts` at 390×844: the first curse's top is within the first 844 px after the Grant (page and viewport
  coordinates, also with the longest narration and when the page was scrolled before submitting); Tab order equals visual
  order before the Grant, after it and at the end; the focus rules; rotation across 768 px. Playwright in an agent run: only
  `layout.mobile` in the `mobile` project, one run at a time, not the receipts, the desktop projects or the full suite
  (the owner runs those). Never an `apps/api` test or a root or recursive test. (Req 1.4, 8.1, 9.1, 9.4, 8.5)
  Done: `use-media-query.ts`, `use-result-first.ts` and `use-phone-focus.ts` in `hooks/`, wired in `App.tsx` (one JSX order,
  `data-result-first` set only when true, so desktop gains no attribute); `App.module.css` has the result-first areas (paw,
  stamp, ring, medal, actions, wish, examples) and the room for the sound toggle only inside `@media (max-width: 767.98px)`;
  the comments in `App.tsx`, `App.module.css` and `CircleRing.tsx` are updated. Jsdom tests: `use-media-query.test.tsx`,
  `use-result-first.test.tsx`, `use-phone-focus.test.tsx`, `App.phone.test.tsx` (phone, rotation and desktop with a stubbed
  `matchMedia`); `app-layout.test.ts` covers both phone orders; `App.reduced-motion.test.tsx` now answers only the
  reduced-motion query with a match. `e2e/layout.mobile.spec.ts` (+ `support/tab-order.ts`) at 390x844: three
  `@result-first` tests (normal, longest narration, scrolled to the bottom then Enter), the wish line before any Grant, Tab
  order equals visual order at three moments, focus never on the body (granting, after the Grant, failed Grant, Stop,
  Rewrite from the end screen and from the card), rotation with the input focused and with a card open, and the sound toggle
  at the bottom; the old "wish line did not move when the paw rested" check now asserts the first curse does not move.
  Ran: `pnpm -C apps/web exec vitest run` 86 files, 1312 passed; `pnpm -C apps/web typecheck` and `lint` clean;
  `playwright test layout.mobile --project=mobile --workers=2` twice: the first run had 16 of 17 passed (my caret test pressed
  Home, which does not move the caret on macOS; fixed in the test), the second 17 of 17. Not run: the desktop projects, the
  receipts, any `apps/api` or root test.

## Where live wishes are offered (owner's decision, 22.11)

Design: A13, A14, "Live gate and ready rounds", "Seal after the Grant"; Requirement 13. Agents run no Playwright test and no `apps/api` test; the reviewer runs the e2e once and the api tests in a clean copy without `.env`. Run `pnpm -C apps/web exec vitest run` (one process) and `pnpm -C apps/web typecheck`.

- [x] 55. API client, session and ready rounds (`api-client.ts`, `api-errors.ts`, `api-messages.ts`, `use-paw-session.ts`, `state/ready-rounds.ts` and tests): `getLive`; the `X-Paw-Adult-Confirmed: yes` header on live grant and bind only; the 403 mapping; the new message constants (the privacy note, the outside note and the lines of Req 13); `live` and `adultConfirmed` in the session; three ready rounds with their tests; the replay rules and the no-bind replay with the ready verdict. (Req 13.1, 13.4–13.9, 3.3, 3.4, 3.9)
  Done: ran apps/web `vitest run` (91 files, 1400 tests), `typecheck` and `lint`, all clean; the new e2e specs are written, not run.
- [x] 56. Components, CSS and the bug (`WishLine.tsx` and CSS module, example row, binding card): the checkbox and its alert, the outside note, the inert seal after the Grant with "Granted already. Rewrite to wish again.", `readOnly` inputs, `aria-disabled` checkbox and cards, Accept lines in the card, tab order (Req 8.1), layout at 390×844, 360×740 and desktop, contrast and 48 px targets. (Req 13.2, 13.3, 13.6, 13.9–13.11, 8.1)
  Done: ran apps/web `vitest run` (91 files, 1400 tests), `typecheck` and `lint`, all clean; the new e2e specs are written, not run.
- [x] 57. End to end (`apps/web/e2e`, API stubbed with `page.route`): the open screen (confirmation, header sent, no header on examples and export, the inert seal after the Grant and Rewrite) and the outside screen (no checkbox, ready round played through verdicts, medal and export with no grant or bind request). Write the specs; the reviewer runs them once. (Req 13)
  Done: ran apps/web `vitest run` (91 files, 1400 tests), `typecheck` and `lint`, all clean; the new e2e specs are written, not run.