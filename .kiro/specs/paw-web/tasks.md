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
- [ ] 13. `scene/camera-fit.ts` (`fitDistance`, test that a 1-unit paw at fov 30° and 1:1 aspect fits with margin, camera
  on +Z looking at `(0, 0.5, 0)`), `scene/glb-choice.ts` (`chooseGlb` with a fake `matchMedia`, 768 px edge cases), and
  `scene/webgl-support.ts` (fake canvas; never throws). (Req 2.1, 2.2, 2.10, 10.5)

## API client and export

- [ ] 14. `api/api-errors.ts`, `api/api-messages.ts` (all in-character lines, one file) and `api/api-schemas.ts`
  (`normalizeGrant`, bind consistency check, examples entry type). Unit tests for `normalizeGrant` and the consistency
  check. (Req 3.3, 3.7, 4.3, 11.1)
- [ ] 15. **[PBT]** `api/api-client.properties.test.ts` for P18 with a fake `fetch` (any status 100–599, invalid JSON,
  wrong shapes, thrown errors, timeout, abort), plus example tests for the status mapping table: 400, 404, 429, 503,
  500, network, timeout. Written before the client. (Req 3.3, 3.7, 4.3, 11.4, 11.6)
- [ ] 16. Implement `api/api-client.ts`: `getExamples`, `postGrant`, `postBind`, `postExport`, base URL from
  `import.meta.env.VITE_API_BASE_URL`, `credentials: 'omit'`, `AbortController` timeouts (60 s, 60 s, 15 s, 10 s),
  body-only wish data, zod validation with `paw-core` schemas. Make task 15 pass. (Req 3.3, 3.7, 4.3, 6.2, 11.4, 11.6)
- [ ] 17. **[PBT]** `export/zip.ts`, `export/slug.ts`, `export/download.ts`: write P17 first (round trip against `fflate`
  as a test-only dependency, valid CRC-32, `slugify` and `safeId` shapes), then implement the store-only zip writer
  with an injected clock. (Req 6.2)

## Session hook

- [ ] 18. `state/scene-bridge.ts` and `state/use-paw-session.ts`: wrap `reduce` in a ref-held context, run effects in
  order (`request-grant`, `request-bind`, `abort-requests`, `play`, `snap`), abort on stop and rewrite, discard aborted
  responses, and complete `play` effects on a microtask when no scene is ready. Add examples-only replay (A9). Test with
  a fake API and fake timers: grant flow, bind flow, stop while judging discards the late response, no scene means no
  stalled queue. (Req 3.3, 4.3, 5.4, 6.9, 6.10, 2.10; A9)

## Layout and components

- [ ] 19. Styles and shell: `styles/tokens.css` (palette, contrast tokens, 16/18 px base, `line-height: 1.5`, duration
  tokens, `prefers-reduced-motion` block), `styles/fonts.css` (self-hosted OFL IM Fell English and Crimson Text, Latin
  WOFF2 subsets, `size-adjust` fallbacks, licence files kept), and `index.html` static shell with inline critical CSS
  and the poster in its reserved box. `styles/contrast.test.ts` recomputes every ratio in design section 7. (Req 1.1,
  8.3, 8.5, 10.1, 10.3, 12.2)
- [ ] 20. `PlateFrame`, `Brazier`, `Curtain`, `RayDisc`: original SVG ornate border (simplified under 768 px), brazier
  smoke loop 2–3 s, curtain breathing about 500 ms, red ray disc with a one-off pulse. All decorative parts
  `aria-hidden`, all loops off under reduced motion. Component test for `aria-hidden` and the reduced-motion class.
  (Req 1.1, 1.2, 8.2, 8.4, 12.3, 9.1, 9.2)
- [ ] 21. `PawStage` and `PawPoster`: 1:1 box sized with `clamp()` (300–400 px desktop, 150–200 px mobile) from the same
  custom properties as the shell, poster image with explicit dimensions, no canvas yet. `PawStateText` caption.
  (Req 1.3, 2.3, 9.1, 9.2, 10.3)
- [ ] 22. `components/circle-layout.ts` (pure `circlePosition(index, rx, ry)` for the pentagon table in design section 1),
  `CircleRing` and `CurseCircle`: five circles, index 0 upper-left through index 4 lower-left clockwise (three above
  the paw's centre line, two below), tuned against `docs/art/concept-victorian.png` and `docs/ui-brief.md`, mobile
  vertical list under 768 px, fill transition, vignette, type label, seal and laurel, caption with the story, labels
  from `CircleView`. Test the position table (index to angle and quadrant) and the mobile order. (Req 1.4, 1.5, 4.1,
  5.8, 6.7, 6.9, 8.4, 9.1, 9.2)
- [ ] 23. `WishLine`: "I wish that…" input, collapsible "for…" field, "Make the wish" seal button, form submit on
  Enter, blank-wish message, disabled while granting, "The Paw stirs…" loading state. Component tests. (Req 3.1, 3.2,
  3.3, 8.1, 8.4)
- [ ] 24. `ExampleCards` and `ExampleCard`: load from `GET /api/examples`, snippets with ellipsis, "Example" label,
  select on click or Enter, highlight clears when the text is edited, dim while typing, placeholder when examples are
  unavailable, horizontal row (desktop) and strip (mobile). Component tests for each state. (Req 3.2, 3.4, 3.5, 3.6,
  3.7, 3.8, 9.1)
- [ ] 25. `BindingCard`: native `<dialog>` opened with `showModal()`, curse story and loophole, editable clause
  pre-filled with the suggested EARS clause, "Accept this clause", "Rewrite the whole wish", "Cancel", "The Judge
  stirs…", "The paw remembers." line, bottom-sheet variant under 768 px, `aria-labelledby` and `aria-describedby`.
  Wire to `bind_submitted`, `card_closed`, `rewrite`. (Req 4.2, 4.3, 4.4, 4.5, 4.6, 8.4, 9.1)
- [ ] 26. `StopButton`, `IntegrityMedal` (five laurels, `role="status"`, `Integrity N/5: M closed, O open`),
  `GrantedStamp` (red "Granted." plus narration caption) and `LiveRegion` fed by the announcer. Component tests for
  visibility rules: Stop only with a Grant and an open curse, medal only when ended and quiescent. (Req 3.3, 6.1, 6.6,
  6.8, 8.4)
- [ ] 27. Wire `App` and `SessionProvider` in the required DOM order (wish input, context, Make, examples, circles,
  card, Stop, export buttons, sound toggle) with CSS grid for the visual layout. The whole app must work end to end in
  poster mode with no 3D. Add an integration test with a fake API: wish, grant, bind closed, bind not closed, stop.
  (Req 1.6, 3.3, 4.3, 5.2, 5.3, 6.1, 6.7, 8.1)

## r3f scene

- [ ] 28. Add `three`, `@react-three/fiber` and `@react-three/drei` (used for `useGLTF` only). Create the lazy
  `scene/PawScene.tsx` entry, `PawCanvas.tsx` (`frameloop="demand"`, `dpr` caps, transparent background, soft
  shadows, `aria-hidden`, `pointer-events: none`), `PawLights.tsx` (sepia ambient, warm key with soft shadow, faint red
  rim, `ShadowMaterial` receiver) and the camera from `camera-fit.ts`. In `PawStage`, import the scene with `React.lazy`
  after first paint (`requestIdleCallback` with a timeout fallback) and only when `webgl-support` passes. Add the error
  boundary around the scene. (Req 2.1, 2.10, 10.5)
- [ ] 29. `scene/PawModel.tsx` and `use-paw-material.ts`: load the GLB chosen by `chooseGlb` (one request only), inspect
  `extensionsUsed` and serve Draco or meshopt decoders locally if present (no third-party CDN), keep the cord on its
  own material, and return the placeholder sepia-tinted material from the single `usePawMaterial` hook. Fire `onReady`
  after the first rendered frame, fade the canvas in over 300 ms, then hide the poster; fire `onFailure` on load
  error or `webglcontextlost`. (Req 2.2, 2.3, 2.5, 2.6, 2.10, 10.5, 10.6)
- [ ] 30. `scene/use-joint-driver.ts` and `RestGroup.tsx`: the `useFrame` driver builds every pose from bind through
  `poseJoint` for all 15 digit joints, applies sink and tilt on the model root group, calls `invalidate()` only while a
  command runs, calls `onDone` at the end, and applies `snap` effects in one frame. Add `releaseJoints(mixer, names)`
  and test it with a fake mixer. Connect the component to `SceneBridge` and give the scene `initialCurled`. Test the
  driver logic with a fake bone set (no WebGL): bind at amount 0, no accumulation across frames, one digit at a time.
  (Req 2.7, 2.8, 6.1, 5.4, 10.6)
- [ ] 31. Granting twitch (250 ms, ui-brief moment 1) on the model root (wrist-only, off under reduced motion), plus an `invalidate`
  counter for the idle-cost check. Verify by hand in the browser that curls, opens and the rest moment look right and
  tune `REST_SINK`, `REST_TILT_DEG` and the light intensities. (Req 2.6, 2.7, 2.8, 6.1, 9.4)

## Accessibility

- [ ] 32. `hooks/use-dialog-focus.ts` (store opener, restore focus on close), Escape handling through `cancel`, ignore
  Escape while judging, and the same behaviour in `OpenInKiroDialog` (task 38). Document that the focus trap is
  verified in Playwright. (Req 4.6, 8.1, 8.4)
- [ ] 33. `hooks/use-reduced-motion.ts` (media query listener dispatching `motion_preference_changed`), the CSS
  reduced-motion block applied to every animated component, and text cues "Finger curled" and "Finger open" in
  `PawStateText`. Component tests with a mocked `matchMedia`. (Req 2.9, 8.2, 6.1)
- [ ] 34. Add `vitest-axe` or equivalent for component checks and fix findings: labels on all inputs and buttons,
  dialog names, `aria-hidden` on decoration, live region content, 48 px minimum hit areas, focus ring token on every
  focusable control. (Req 8.1, 8.3, 8.4, 9.3)

## Sound

- [ ] 35. `audio/sound-preference.ts` (only `localStorage['pawSoundEnabled']`, try/catch, value `"1"` or `"0"`) and
  `SoundToggle` (`aria-pressed`, off by default, restored on reload). Unit test that no other key is ever written and
  that blocked storage does not throw. (Req 7.1, 7.4, 11.1)
- [ ] 36. `audio/sound-player.ts`, loaded lazily on first enable: creak 500 ms, stamp 300 ms, sigh 800 ms, crack 200 ms,
  peak gain about −12 dB, previous cue fades out over 100 ms, cues triggered from the session on curl, "Granted.",
  open and crack. Add the four CC0 or original audio files under `public/audio/` (total under 500 KB) with a short
  `ASSETS.md` note recording source and licence for each file. Test the player with a fake `AudioContext`.
  (Req 7.2, 7.3, 7.5, 12.4)

## End screen and export

- [ ] 37. `ExportButtons`: "Take the scroll" (call `postExport`, build the zip with `requirements.md` and
  `properties.md`, download `monkeys-paw-<safeId(wishId)>.zip`, "Scroll saved!" or an error line), stacked with 48 px
  targets on mobile, shown only when the medal shows. Test the download with a mocked `postExport` and check the zip
  contents. (Req 6.2, 6.4, 6.8)
- [ ] 38. `OpenInKiroDialog`: call `postExport`, show copy buttons for the folder name and `kiro open monkeys-paw-<slug>`,
  Clipboard API with select-and-copy fallback, and a download of the zip containing the `monkeys-paw-<slug>/` folder.
  (Req 6.2, 8.4)
- [ ] 39. Round-end polish and rewrite: show the final circles with cracked seals and "The paw remembers." after Stop,
  laurels on closed circles, medal and export after either ending, "Rewrite" returns the paw upright and clears the
  Grant, input and circles. Integration test for both endings and rewrite. (Req 4.4, 6.1, 6.5, 6.7, 6.8, 6.9)
- [ ] 40. Optional: `ShareCard` (parchment plate image with all circles and one highlighted curse, "Copy image", "Tweet",
  "Copy link"). Draw to an offscreen canvas, no remote assets, no wish text in the shared link. Skip if time is short.
  (Req 6.3, 11.6)

## Ink shader (separate spec)

- [ ] 41. Placeholder, no work in this spec: the cross-hatching ink shader (Req 2.4) and the rope-textured cord detail
  (Req 2.5) belong to a separate spec, `.kiro/specs/paw-ink-shader/`, to be written later. The only integration point is
  `usePawMaterial` in `scene/use-paw-material.ts` (task 29). The shader spec must replace that hook's body and touch no
  other file listed here. Leave this task unchecked until that spec ships. (Req 2.4, 2.5)

## End-to-end, receipts and budgets

- [ ] 42. Playwright setup in `apps/web` (desktop Chromium and a 390 px mobile project), a stubbed API through
  `page.route` with schema-valid fixtures built from `paw-core` types, helpers for `curl` and `open` timing, and a
  `webServer` that runs `vite preview`. (tech.md, Req 3, 4)
- [ ] 43. e2e: full round on desktop. Wish, "Granted.", five curls one at a time, bind and close in a different order from
  the curls, LIFO opens with the thumb last, rest moment, medal 5/5, both export buttons, zip contents. Also a not-closed
  verdict ("The paw remembers.", card stays open). (Req 2.7, 2.8, 4.3, 5.1–5.4, 6.1, 6.2, 6.8)
- [ ] 44. e2e: Stop paths. Stop with open curses ends without sink or tilt, curled digits stay curled, medal and export
  show, circles are focusable but open no card and no `POST /api/bind` is sent; stop during queued curls shows one
  curled digit per open curse; "Rewrite" resets everything. (Req 6.6, 6.7, 6.9, 6.10, 4.4)
- [ ] 45. e2e: keyboard and accessibility. Tab order matches Req 8.1, dialog traps and restores focus, Escape closes,
  Enter and Space work, `@axe-core/playwright` finds no serious or critical issues in each phase, 200% zoom (640 px
  wide) has no horizontal scroll. (Req 8.1, 8.3, 8.4, 8.5)
- [ ] 46. e2e: reduced motion (`emulateMedia`) gives instant state changes and text cues with the queue never used;
  no-WebGL launch flag keeps the poster, shows text state and leaves the UI usable; `GET /api/examples` 503 shows the
  placeholder; a 503 on grant shows the resting message and enables examples-only replay. (Req 2.9, 2.10, 3.7, 8.2; A9)
- [ ] 47. e2e: privacy. After a full round assert `localStorage` keys are at most `pawSoundEnabled`, `sessionStorage`
  and `document.cookie` are empty, the URL never changed, no request URL contains the wish text, all requests go to the
  app origin or the API origin, every API request has no credentials. (Req 7.4, 11.1–11.6)
- [ ] 48. e2e: mobile project. Circles form a vertical list under a small paw, the card is a bottom sheet, 48 px targets,
  rotation reflows without remounting the canvas, `paw-mobile.glb` is the only GLB requested (and `paw-web.glb` on
  desktop). (Req 2.2, 9.1, 9.2, 9.3, 9.4, 10.5)
- [ ] 49. Screenshot receipts: desktop and mobile in the phases listed in design "Testing Strategy" (idle, curses landed,
  card open, closed, not closed, rested with medal, stopped with medal, reduced motion, no WebGL), saved to
  `apps/web/e2e/receipts/`. (tech.md, Req 1, 4, 6)
- [ ] 50. `scripts/check-bundle-budget.mjs` and `build.manifest`: gzip the initial set and the 3D chunk from the manifest,
  fail above 200 KB gz initial JS, 30 KB gz CSS, 330 KB gz 3D chunk, 140 KB fonts, 500 KB audio. Add
  `rollup-plugin-visualizer`, confirm `paw-core` tree-shakes to schemas and `computeIntegrity`. Add a Playwright check
  that the 3D chunk is requested only after the load event. (Req 10.4, 10.5)
- [ ] 51. Performance runs: Lighthouse CI with fast-3G throttling (FCP ≤ 1.5 s, LCP ≤ 3.0 s, CLS < 0.1), Playwright
  metrics for CLS over a full round, first-frame marks, `requestAnimationFrame` frame-time p95 during a curl and an
  open, reflow under 100 ms on resize, and zero rendered frames after 2 s idle. Record results in
  `apps/web/e2e/receipts/perf.md`. (Req 10.1, 10.2, 10.3, 10.6, 10.7, 9.4)
- [ ] 52. Write `apps/web/README.md`: scripts, the `VITE_API_BASE_URL` variable (name only), the asset copy step, how to
  run unit, property and e2e tests, and the single storage item. (Req 11.1, 12.6)
