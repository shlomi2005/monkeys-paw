# Paw Ink Shader — Tasks

Ordered checklist for the ink shader in `apps/web/src/scene/`. Requirements are cited as `Req N.M` (see
`requirements.md`), design decisions as `D1`–`D6` (design.md, "Decisions and assumptions to confirm"). Each task is sized
for one agent run. Tests are in the task that adds the code, run with `pnpm vitest run` in `apps/web`. No GLSL compile
is possible in Vitest; the visual check is task 5 (the reviewer's). Only task 4 edits an existing file.

- [x] 1. `scene/ink-math.ts` and `ink-math.test.ts`: `INK_PALETTE`, `INK_DEFAULTS` (every default in design.md "Uniforms
  and defaults"), `hexToLinear`, `lightness`, `albedoLuma`, `darkness`, `familyWeights`, `lineWidthPx`, `cordMask`. Pure,
  no imports. Tests: hex to linear on black, white and `#8f1d14`; family weights at and around each threshold; line width
  at D = 0 and 1; `cordMask` on the sample colours (the five cord reds at 0.9 or more; the three fur/skin browns, the three dark browns, `#2a1d14` and `#e9d8b4` at 0.05 or less; samples in design.md); a fast-check
  property that weights and mask stay in 0..1 and are monotone. (Req 2.1–2.3, 3, 4.1, 5.1, 5.3, 5.4, 11.1)
- [x] 2. `scene/ink-shader.ts` and `ink-shader.test.ts`: the GLSL strings (built from the `ink-math` constants),
  `INK_ANCHORS`, `canInject()`, `injectInkShader(shader, uniforms)` with the six replacements and the maths of design.md
  (light, albedo, darkness, base tone, three families, double-angle direction, `fwidth` lines, contour, cord mask,
  output). Tests: each anchor occurs exactly once in `ShaderLib.physical` for the installed three; the chunk names the
  GLSL relies on (`nonPerturbedNormal`, `float metalnessFactor`) still exist; injection leaves no anchor unreplaced,
  declares every uniform, and is repeatable on a fresh copy. State in the test file that GLSL is not compiled there.
  (Req 1.4, 2, 3, 4.3, 4.4, 5, 7.2, 7.3, 7.4, 11.4, 11.5)
- [x] 3. `scene/ink-material.ts` and `ink-material.test.ts`: `createInkUniforms()`, `createInkMaterial(scene)` (clone of
  the GLB material, white colour, `toneMapped = false`, `customProgramCacheKey`, `onBeforeCompile`, `onBeforeRender`
  that sets pixel ratio and viewport, cached per scene, idempotent, placeholder fallback when `canInject()` is false)
  and `selectPawMaterial(style, scene, placeholder)`. Tests: uniform names and default colours; pixel ratio and viewport
  from a fake renderer; the copy keeps the maps; the source material is untouched; same scene gives the same instance,
  also when the mesh holds the copy; no standard material gives `null`; `'placeholder'` returns exactly the placeholder
  factory's result and `'ink'` the ink material. (Req 1.4, 4.2, 6, 7.4, 9.2, 9.3, 10, 11.2, 11.3)
- [x] 4. `scene/use-paw-material.ts`: add `type PawMaterialStyle = 'ink' | 'placeholder'` and, on one line,
  `export const PAW_MATERIAL_STYLE: PawMaterialStyle = 'ink';`. Replace only the body of `usePawMaterial` with
  `useMemo(() => selectPawMaterial(PAW_MATERIAL_STYLE, scene, createPawMaterial), [scene])`. Keep the signature,
  `createPawMaterial` and `PAW_SEPIA_TINT`. Extend `use-paw-material.test.ts` (the hook returns what `selectPawMaterial(PAW_MATERIAL_STYLE, scene, createPawMaterial)` returns for a GLB-like scene;
  do not assert the value of `PAW_MATERIAL_STYLE`, so a revert needs no test change; the placeholder tests are unchanged and pass). Run the whole `apps/web` suite, the type
  check and lint. No other existing file changes. (Req 1, 8, 9, 10)
- [ ] 5. Browser check and tuning. **Reviewer task, not an agent task:** agents here cannot run a browser or a dev server.
  The reviewer runs the app on a dev server with a stubbed API, compares `'ink'` and `'placeholder'` through the
  `PAW_MATERIAL_STYLE` switch at 1x, 2x and a 390 px phone width, tunes the light window, spacing and widths against
  `docs/art/concept-victorian.png`, and sends the tuned values back. Checklist: continuous lines on the fingers, no red
  specks on the fur (the cord-mask calibration is this visual check only), the contour, no swimming while the paw sinks,
  60 fps during a curl, unchanged reduced-motion and no-WebGL behaviour, and the 3D chunk (gz) under 330 KB. The agent then
  writes the returned values into `INK_DEFAULTS` and the design.md defaults table, and records the chunk size. (Req 4, 5.5, 7, 8)
- [ ] 6. Tick paw-web task 41 in `.kiro/specs/paw-web/tasks.md` with a one-line note: "Shipped by
  `.kiro/specs/paw-ink-shader/`; `PAW_MATERIAL_STYLE` in `use-paw-material.ts` switches back to the placeholder." Do this
  only after tasks 1–5 pass. (Req 12.3, paw-web task 41)
