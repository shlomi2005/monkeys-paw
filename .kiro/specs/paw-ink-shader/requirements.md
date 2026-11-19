# Paw Ink Shader — Requirements

## Introduction

The page is a Victorian engraving plate: ink `#2b1d12` and sepia `#7a5a3a` on parchment `#e9d8b4`, with one blood-red
accent `#8f1d14`. The 3D paw today wears a plain sepia-tinted PBR material (the placeholder from paw-web task 29), so it
looks like a 3D toy pasted onto a printed page. paw-web Req 2.4 asks for a cross-hatched ink shader so the paw reads as
part of the printed engraving. paw-web task 41 reserves this spec and one integration point: the body of `usePawMaterial`
in `apps/web/src/scene/use-paw-material.ts`.

**The look (art direction):** a copperplate engraving of the paw, printed in the plate's own ink. The form is built from
fine parallel ink lines that follow the curve of each finger and the wrist. Light areas are bare toned paper. Mid-tones
get one family of lines, shadows a second crossing family, the deepest shadows a third. Lines grow thicker as the tone
darkens. Under the lines sits a flat warm tone taken from the model's base colour, mapped from parchment to sepia. There
is no gloss and no specular shine. A thin ink contour marks the silhouette. The wrist cord is the only colour: blood red,
with the same ink lines over it. `docs/art/concept-victorian.png` is the reference.

**Scope:** one new material for the paw, made by extending three's standard material; its pure maths, its GLSL
injection, its uniforms, and the one-line switch back to the placeholder.

**Out of scope:** the lights (`PawLights.tsx`); the drop shadow is removed (paw-web design, Deviation batch 6); the poster image;
Playwright end-to-end tests and receipts (paw-web tasks 42 onward); any change to the GLB, the joint driver, the state
machine or the layout.

---

## Glossary

- **Seam**: `usePawMaterial(scene)` in `use-paw-material.ts`. Its signature is `(scene: Object3D) => Material | null`.
- **Placeholder**: today's material from `createPawMaterial`: a clone of the GLB material with the base colour multiplied
  by `#c9a97a`.
- **Ink material**: the new material this spec adds, a `MeshStandardMaterial` clone patched through `onBeforeCompile`.
- **Hatch family**: one set of parallel ink lines at one angle. There are at most three per fragment (A, B, C).
- **Darkness (D)**: a value in 0..1 per fragment. 0 is bare paper, 1 is the deepest shadow. It drives which families show
  and how thick their lines are.
- **Cord mask**: a value in 0..1 per fragment that is 1 on the red cord and 0 elsewhere, computed from the base-colour
  texture by hue and saturation.
- **CSS pixel**: one unit of layout size. A device pixel is one CSS pixel divided by the renderer's pixel ratio.
- **Anchor**: an `#include <...>` line in three's `MeshStandardMaterial` GLSL that the injection replaces.
- **Material seam note**: paw-web design.md, "Material seam (placeholder only)", and the task 29 deviation: each GLB has
  one skinned mesh and one material, and the cord is painted into the same base-colour texture.

---

## Requirements

### Requirement 1: The seam

**User story:** As a maintainer, I want the shader to plug in at one place, so that nothing else in the scene can break.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** change only the body of `usePawMaterial` among existing code (plus the style type and constant of
   Req 9, added beside it), and keep its signature
   `(scene: Object3D) => Material | null` (paw-web task 41, design.md "Material seam").
2. **THE SYSTEM SHALL** put all new code in new files next to the hook in `apps/web/src/scene/` (the ink material, its
   GLSL strings, its pure maths and their tests).
3. **THE SYSTEM SHALL NOT** change `PawModel.tsx`, `PawLights.tsx`, `PawScene.tsx`, `PawCanvas.tsx`, the joint driver,
   the state machine or the layout. Existing exports of `use-paw-material.ts` (`createPawMaterial`, `PAW_SEPIA_TINT`)
   stay, and their tests stay green.
4. **THE SYSTEM SHALL** keep skinning, the normal map and the existing lights working, by building the ink material as a
   `MeshStandardMaterial` clone patched through `onBeforeCompile` with a distinct `customProgramCacheKey`.
5. **IF** a from-scratch `ShaderMaterial` were used instead, **THEN** the design SHALL show how skinning, the normal map
   and the lights keep working. This spec does not use one.

### Requirement 2: Engraving look

**User story:** As a spec author, I want the paw to look printed in the plate's ink, so that it belongs to the page
(paw-web Req 2.4).

**Acceptance criteria:**

1. **WHEN** a fragment is shaded, **THE SYSTEM SHALL** output a toned base from the base-colour texture, mapped onto the
   plate palette from parchment `#e9d8b4` to sepia `#7a5a3a`, with ink `#2b1d12` lines drawn over it.
2. **THE SYSTEM SHALL** show bare toned paper with few or no lines in lit areas, one hatch family in mid-tones, two
   crossing families in shadow, and three in the deepest shadow.
3. **THE SYSTEM SHALL** make line width grow with darkness.
4. **THE SYSTEM SHALL NOT** draw any specular highlight, environment reflection or glossy shading.
5. **WHERE** the surface turns away from the viewer, **THE SYSTEM SHALL** draw a thin ink contour.
6. **THE SYSTEM SHALL** write colours in linear space and turn tone mapping off for the ink material (`toneMapped =
   false`), so the printed colours equal the palette.

### Requirement 3: Hatch direction and density

**User story:** As a viewer, I want clean, continuous lines on the fur, so that the paw reads as an engraving and not as
noise.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** take the line direction from the smooth geometric normal, bent only partly by the normal map, so
   that the lines stay continuous although the normal texture is high-frequency.
2. **THE SYSTEM SHALL** let the full normal map act only through the lighting term that drives darkness (density and
   width).
3. **THE SYSTEM SHALL** compute the lighting term as a diffuse term that treats the surface as non-metal, although the
   GLB's metalness is 1, using three's own lights, so the existing lights keep working.
4. **WHEN** the surface faces the viewer and the projected normal has no stable direction, **THE SYSTEM SHALL** fall back
   to a fixed base angle, with no visible pop.
5. **THE SYSTEM SHALL** draw families B and C at fixed angles to family A, so they cross it.

### Requirement 4: Line scale

**User story:** As a viewer on any screen, I want the lines to look the same size, so that a phone and a 2x laptop show
the same engraving.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** set line spacing, line width and contour width in CSS pixels, by dividing device pixels by the
   renderer's pixel ratio.
2. **WHEN** the renderer's pixel ratio changes or the canvas resizes, **THE SYSTEM SHALL** update the pixel-ratio and
   viewport uniforms before the next draw.
3. **THE SYSTEM SHALL** antialias lines and the contour with `fwidth`.
4. **IF** the line spacing falls below about two device pixels, **THEN THE SYSTEM SHALL** fade the family out to its mean
   ink density, so no moiré appears.
5. **THE SYSTEM SHALL** anchor the line phase to the projected wrist origin, so root motion (sink, tilt, twitch) does not
   make the lines swim across the paw.

### Requirement 5: Red accent

**User story:** As a viewer, I want the cord to be the only colour, so that the eye lands on it.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** find the cord with a colour mask on the base-colour texture: hue near red and saturation high,
   stated in colour terms in design.md.
2. **THE SYSTEM SHALL** paint masked fragments in blood red `#8f1d14`, with the same ink lines over them.
3. **THE SYSTEM SHALL NOT** paint red specks on the fur, skin or nails. The mask rejects the brown fur and skin colours.
4. **THE SYSTEM SHALL** implement the mask once as a pure TypeScript function, mirrored by the GLSL, and test the
   function on sample colours (cord reds, fur browns, nail darks, skin, parchment).
5. **IF** the mesh does not allow a clean mask (red specks remain after calibration), **THEN** the mask threshold is
   tightened and the residual is recorded in design.md. The cord stays masked by colour only, never by a second material.

### Requirement 6: One material for the whole paw

**User story:** As a maintainer, I want to respect the task 29 deviation, so that the asset and the scene graph stay as
they are.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** use one material for the whole paw, with the cord found by the colour mask (Req 5).
2. **THE SYSTEM SHALL NOT** add a second material, split the mesh or change the GLB (paw-web design.md "Material seam
   note").

### Requirement 7: Performance

**User story:** As a viewer on a mid-range laptop, I want smooth curls, so that the shader never costs frames.

**Acceptance criteria:**

1. **WHILE** a finger curls, at 1440x900 with a device pixel ratio of 2 on an integrated GPU, **THE SYSTEM SHALL** hold
   60 fps.
2. **THE SYSTEM SHALL NOT** add a render pass, post-processing, a texture download or an npm dependency. The lines are
   procedural.
3. **THE SYSTEM SHALL** evaluate at most three hatch families per fragment, with no branch that makes `fwidth` undefined.
4. **THE SYSTEM SHALL NOT** use a time-based uniform, so the idle budget of 0 rendered frames stays (paw-web design.md
   section 8).
5. **THE SYSTEM SHALL** keep the 3D chunk under its 330 KB gz budget (275.2 KB gz today), checked with
   the same gzip measure that produced that figure (paw-web design.md section 8 and A2).

### Requirement 8: Unchanged paths

**User story:** As a user with reduced motion or without WebGL, I want exactly today's behaviour.

**Acceptance criteria:**

1. **WHILE** reduced motion is on, **THE SYSTEM SHALL** behave exactly as today. The material plays no part in it.
2. **WHEN** WebGL is unavailable, **THE SYSTEM SHALL** behave exactly as today (poster, no scene).
3. **THE SYSTEM SHALL** leave the poster, the reduced-data path and the snap behaviour untouched.

### Requirement 9: The switch

**User story:** As a developer, I want one constant to compare the two looks and to revert fast.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** export, on one line in `use-paw-material.ts`, exactly:
   `export const PAW_MATERIAL_STYLE: PawMaterialStyle = 'ink';`, with `type PawMaterialStyle = 'ink' | 'placeholder'`.
2. **WHERE** `PAW_MATERIAL_STYLE` is `'placeholder'`, **THE SYSTEM SHALL** return exactly the result of
   `createPawMaterial(scene)`, which gives today's look.
3. **WHERE** `PAW_MATERIAL_STYLE` is `'ink'`, **THE SYSTEM SHALL** return the ink material.
4. **THE SYSTEM SHALL** keep `createPawMaterial` and its tests in the repo.

### Requirement 10: Same guarantees as today

**User story:** As a maintainer, I want the hook's old guarantees to hold for the ink material.

**Acceptance criteria:**

1. **THE SYSTEM SHALL NOT** change the GLB's own material, which `useGLTF` shares and caches.
2. **THE SYSTEM SHALL** create the result once per scene and return the same instance on every call for that scene, so a
   StrictMode re-run changes nothing, including after `PawModel` has assigned the result to the mesh.
3. **IF** the scene has no standard material, **THEN** the hook SHALL return `null`.

### Requirement 11: Tests

**User story:** As a maintainer, I want tests that catch a silent skip of the shader.

**Acceptance criteria:**

1. **THE SYSTEM SHALL** unit-test the pure functions: palette hex to linear colour, tone to hatch-family weights and line
   width, darkness from light and albedo, and the cord mask on sample colours.
2. **THE SYSTEM SHALL** unit-test the uniforms: names, default colours and the pixel-ratio update from a fake renderer.
3. **THE SYSTEM SHALL** unit-test the switch: `'placeholder'` returns exactly `createPawMaterial`'s result, `'ink'` the
   ink material.
4. **THE SYSTEM SHALL** test that every anchor the injection replaces exists exactly once in three's own shader source for
   the installed version (`ShaderLib.physical`), so a three upgrade cannot silently skip the replacement.
5. **THE SYSTEM SHALL** state that no GLSL compile is possible in the Vitest environment, and leave the visual check to
   the browser.

### Requirement 12: Out of scope

**User story:** As a planner, I want the boundary stated, so that no one designs the neighbours here.

**Acceptance criteria:**

1. **THE SYSTEM SHALL NOT** design the drop shadow behind the paw or the lights in `PawLights.tsx`.
2. **THE SYSTEM SHALL NOT** cover the poster image, Playwright end-to-end tests or receipts (paw-web tasks 42 onward).
3. **WHEN** the shader ships, **THE SYSTEM SHALL** tick paw-web task 41 with a one-line note.
