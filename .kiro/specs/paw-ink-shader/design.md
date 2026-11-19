# Paw Ink Shader — Design

## Overview

The ink shader makes the 3D paw look like a copperplate engraving printed in the plate's own ink. It replaces the body
of `usePawMaterial` (paw-web task 41, design.md "Material seam") and touches no other existing file.

Three choices shape everything else:

1. **Patch three's standard material, do not replace it.** The ink material is a clone of the GLB's
   `MeshStandardMaterial`, patched with `onBeforeCompile`. Skinning, the normal map and the lights
   come from three's own shader. The patch changes three things: the metalness (to 0, so the diffuse term exists), the
   albedo (stashed, then set to white, so the lighting term is pure light), and the final colour (replaced by the ink
   colour).
2. **Screen-space lines, directions from the geometry.** Lines are laid out in CSS pixels on the screen, so they look the
   same on every display. Their direction comes from the smooth geometric normal, so they follow the fingers. The
   noisy normal map only changes the lighting, hence the density.
3. **The cord is a colour mask.** One material, one mesh. The red cord is found by hue and saturation in the base-colour
   texture (paw-web task 29 deviation).

Everything below is procedural. There is no new texture, pass, dependency or time uniform.

### Decisions and assumptions to confirm

| # | Decision | Why |
|---|----------|-----|
| D1 | Lines run along the finger (parallel to the silhouette tangent) for family A, and cross at ±55° for B and C. | Lines that follow the length of a curled finger bend with it. True cross-contour rings would need object-space coordinates, which cannot give constant CSS-pixel spacing (Req 4). |
| D2 | Direction is blended in double-angle form, with a follow weight capped at 0.9. | Lines have no sign. Blending plain vectors pops where the sign flips. Double-angle blending has no pop and no singularity below 1.0. |
| D3 | Line phase is anchored to the projected wrist origin. | Root motion (sink, tilt, twitch) then moves the lines with the paw. Finger curls still slide the lines a little for 500 ms. This is accepted. |
| D4 | The ink material turns tone mapping off. | The canvas applies tone mapping to standard materials. It would shift the ink and parchment colours. |
| D5 | If any anchor is missing at creation time, the hook falls back to the placeholder. | A three upgrade can never produce a half-patched shader. |
| D6 | All numeric defaults below are starting values, tuned by the reviewer in the browser (task 5), as paw-web did for the lights in task 31. The agent records the returned values in `INK_DEFAULTS` and in this file. | The lighting term depends on `PawLights.tsx` intensities, which are not designed here. |
| D7 | Family A's angle is quantised into 8 bins of 22.5°. Each family is drawn at the two nearest bin angles (B and C at the same two angles ± the cross angle) and the two are crossfaded over a narrow smoothstep. The antialias width is analytic, not `fwidth`. | With a per-pixel direction, the phase `u = dot(q, dir) / spacing` gains a term `|q| · dθ/dpx / spacing` (q is up to 150 to 250 CSS px from the wrist). At 150 px, 0.02 rad/px and 3.5 spacing that is 0.86 cycles per pixel, so `fwidth(u)` passed 0.7, coverage fell back to the flat mean density (grey), and nearby values broke lines into dashes. A constant direction per bin keeps `u` linear in `q`. The bin index can differ inside a 2x2 quad, so `fwidth` of the blended phase is unusable; for a constant unit `d`, `du/dpx` is known exactly. |

---

## Architecture

New files, all in `apps/web/src/scene/`. Pure modules import no DOM and no GL, and are testable in Vitest.

| File | Role | Imports |
|------|------|---------|
| `ink-math.ts` | Pure maths and defaults: `INK_PALETTE`, `INK_DEFAULTS`, `hexToLinear`, `lightness`, `darkness`, `familyWeights`, `lineWidthPx`, `cordMask`, `albedoLuma` | nothing |
| `ink-shader.ts` | GLSL strings, `INK_ANCHORS`, `canInject()`, `injectInkShader(shader, uniforms)` | `three` (`ShaderLib`), `ink-math` |
| `ink-material.ts` | `createInkUniforms()`, `createInkMaterial(scene)`, `selectPawMaterial(style, scene, placeholder)` | `three`, `ink-shader`, `ink-math` |
| `use-paw-material.ts` | Edited: `PawMaterialStyle`, `PAW_MATERIAL_STYLE`, body of `usePawMaterial` (the only existing file that changes) | `ink-material` |
| `ink-math.test.ts`, `ink-shader.test.ts`, `ink-material.test.ts`, `use-paw-material.test.ts` (extended) | Tests | |

The GLSL strings are template literals that interpolate the constants from `ink-math.ts` (fade width, thresholds),
so the TypeScript reference and the GLSL cannot drift.

The hook calls `selectPawMaterial(PAW_MATERIAL_STYLE, ...)`, which returns `createInkMaterial` (a clone of the GLB
material plus `onBeforeCompile`, six injections into three's physical shader) or `createPawMaterial` (placeholder).

`PawModel` already assigns the hook's result to every mesh in a layout effect. No change is needed there.

---

## The material

### Creation (`createInkMaterial(scene)`)

1. Return the cached result for `scene` if there is one (`WeakMap<Object3D, Material | null>`, same pattern as
   `tintedByScene`).
2. Find the first mesh material. If it is not a standard material, cache and return `null`.
3. If it already carries `userData.pawInk === true`, it is our copy (the mesh was assigned it earlier). Cache and return it.
4. If `canInject()` is false (an anchor is missing in this three version), log one `console.warn` and return
   `createPawMaterial(scene)` (D5).
5. Otherwise `source.clone()`. Then on the copy:
   - `color.set(0xffffff)` and `userData.pawInk = true`. The maps (base colour, normal, metallic-roughness) are kept.
   - `toneMapped = false` (D4). `metalness` and `roughness` are left alone; the patch overrides metalness in the shader.
   - `customProgramCacheKey = () => 'paw-ink-v2'`. Bump the suffix whenever the GLSL changes.
   - `onBeforeCompile = (shader) => injectInkShader(shader, uniforms)`. The `uniforms` object is created by
     `createInkUniforms()` and shared with the material, so later updates reach the program.
   - `onBeforeRender = (renderer) => { uniforms.uPixelRatio.value = renderer.getPixelRatio();
     renderer.getDrawingBufferSize(uniforms.uViewport.value); }`. three calls this before each draw of the object
     (`WebGLRenderer.renderObject`), so a resize or a pixel-ratio change is picked up on the next frame, with no listener.
6. Cache and return the copy. The GLB's own material is never written to.

The copy is never disposed by the hook, like the placeholder. It lives as long as the cached scene.

### Injection (`injectInkShader`)

Six string replacements on `ShaderLib.physical` source (two shaders), each of an anchor that occurs exactly once in that shader
(checked by `canInject()` and by a test, Req 11.4):

| # | Shader | Anchor | Replaced by |
|---|--------|--------|-------------|
| 1 | vertex | `#include <common>` | anchor + `uniform vec2 uViewport; varying vec2 vInkOrigin;` |
| 2 | vertex | `#include <project_vertex>` | anchor + `vec4 inkO = projectionMatrix * modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ); vInkOrigin = ( inkO.xy / inkO.w * 0.5 + 0.5 ) * uViewport;` |
| 3 | fragment | `#include <common>` | anchor + uniform and varying declarations + helper functions (below) |
| 4 | fragment | `#include <color_fragment>` | anchor + `vec3 inkAlbedo = diffuseColor.rgb; diffuseColor.rgb = vec3( 1.0 );` |
| 5 | fragment | `#include <metalnessmap_fragment>` | `float metalnessFactor = 0.0;` |
| 6 | fragment | `#include <opaque_fragment>` | the ink colour block (below) + anchor |

Why this works:

- Skinning stays: the vertex shader's skin chunks are untouched. Only a varying is added after `project_vertex`.
  `vInkOrigin` is the same at every vertex, so interpolation leaves it constant.
- The normal map stays: `normal_fragment_maps` runs as normal and perturbs `normal`. `nonPerturbedNormal` keeps the
  interpolated geometric normal (both declared in `normal_fragment_begin`, with the face flip for the double-sided material).
- With `metalnessFactor = 0` and `diffuseColor.rgb = 1`, three's own lights fill `reflectedLight.directDiffuse` and
  `.indirectDiffuse` with pure light: key, rim and ambient. Metalness 1 would have made both zero.
- The ink block assigns `outgoingLight`, then three's `opaque_fragment` writes `gl_FragColor`. The specular and
  environment terms are computed and ignored (no gloss, Req 2.4).

### The maths (`ink-math.ts` is the reference; GLSL mirrors it)

All colours are linear. Palette hex values go through `hexToLinear(hex)` (sRGB to linear, the same transfer three's
`Color.setHex` uses with colour management on).

**1. Light.** After `lights_fragment_end`:

```
L         = luma( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse )   // white albedo
lightness = clamp( ( L - uLightLo ) / ( uLightHi - uLightLo ), 0, 1 )
```

`luma(c) = dot(c, vec3(0.2126, 0.7152, 0.0722))`. Because the albedo is white, `L` includes the full normal map and the
key light. (three's diffuse BRDF is Lambert/π with a `1 - F` factor; the `uLightLo/Hi` window absorbs it.)

**2. Albedo.** `a = luma( pow( inkAlbedo, vec3(1/2.2) ) )` (an sRGB-like luma), then `a01 = clamp( a / uAlbedoWhite, 0, 1 )`.
On the cord, `a01` is replaced by 0.5 (`mix(a01, 0.5, mask)`), so the cord's tone comes from light alone and red does not
read as black.

**3. Darkness.**

```
D = clamp( uLightWeight * ( 1 - lightness ) + ( 1 - uLightWeight ) * ( 1 - a01 ), 0, 1 )
```

Dark nails get more lines than fur under the same light. `darkness(lightness, a01, w)` in `ink-math.ts`.

**4. Base tone.** Flat, no lighting:

```
paper = mix( uParchment, uSepia, ( 1 - a01 ) * uToneStrength )
paper = mix( paper, uParchment, uBaseLight * lightness )          // small fixed share of light, never lighter than parchment
base  = mix( paper, uBlood, mask )
```

The lines carry the form; `uBaseLight` (0.15) only keeps the form readable where the lines are thin.

**5. Hatch families.** With thresholds `T = (0.10, 0.38, 0.62)` and `FADE = 0.2`:

```
weight_k = smoothstep( T_k, T_k + FADE, D )          // k = A, B, C   (familyWeights)
widthPx  = mix( uWidthMin, uWidthMax, D )            // CSS px        (lineWidthPx)
width_k  = widthPx * weight_k
```

So D below 0.10 gives bare paper; each family grows in at its threshold, and lines thicken with D.

**6. Direction** (view space, x right, y up, same as screen):

```
n        = normalize( mix( nonPerturbedNormal, normal, uNormalBend ) )   // uNormalBend = 0.25: only partly bent
len      = length( n.xy )
tangent  = vec2( -n.y, n.x ) / max( len, 1e-4 )                           // along the silhouette, i.e. along the finger
base     = vec2( cos( 2*uBaseAngle ), sin( 2*uBaseAngle ) )               // double-angle form
t2       = vec2( tangent.x² - tangent.y², 2 * tangent.x * tangent.y )     // double-angle form
wFollow  = uFollow * smoothstep( 0.10, 0.45, len )                        // 0 where the surface faces the viewer
m        = normalize( mix( base, t2, wFollow ) )                          // |mix| >= 1 - 0.9 > 0, never zero
dirA     = vec2( sqrt( 0.5 * ( 1 + m.x ) ), sign( m.y ) * sqrt( 0.5 * ( 1 - m.x ) ) )   // half-angle, no trig
dirB     = rotate( dirA, +uCross )          dirC = rotate( dirA, -uCross )   // uCross as ( cos, sin ) uniform
```

Where the surface faces the viewer, `len` is small, `wFollow` falls to 0 and the lines settle at the fixed base angle,
with no pop. `sign(0)` is 0 in GLSL; use `m.y < 0.0 ? -1.0 : 1.0`. The line sign flip at `m.y = 0` does not matter: a
line pattern is symmetric under a sign change of its direction.

**7. Lines.** `uSpacing` is in CSS px (default 3.5). Family A's angle is quantised (D7):

```
theta   = atan( dirA.y, dirA.x ), folded into [0, π)                 // lines have no sign
pos     = theta / (π/8);  i = min( floor( pos ), 7 );  f = pos - i
w       = smoothstep( 0.3, 0.7, f )                                  // INK_BIN_BLEND = 0.4 of a bin, centred
bins    = ( i, i + 1 )   →   directions d0, d1 = ( cos, sin ) of i·π/8 and (i+1)·π/8      // bin 8 is bin 0 again (wraps at 180°)
q       = ( gl_FragCoord.xy - vInkOrigin ) / uPixelRatio             // CSS px from the projected wrist (D3)
line(d) :
  u   = dot( q, d ) / uSpacing                                       // linear in q: d is constant
  hw  = 0.5 * width_k / uSpacing                                     // half width, in cycles
  fw  = ( |d.x| + |d.y| ) / ( uSpacing * uPixelRatio )               // analytic du/dpx, cycles per device px (lineFwidth)
  dist = abs( fract( u ) - 0.5 )                                     // distance to the line centre, in cycles
  aa  = max( 0.5 * fw, 1e-4 )
  cov = 1 - smoothstep( hw - aa, hw + aa, dist )
  cov *= clamp( hw / aa, 0, 1 )
  line = mix( cov, 2 * hw, smoothstep( 0.4, 0.7, fw ) )              // too fine to resolve: mean ink density
cov_A = mix( line( d0 ),             line( d1 ),             w )
cov_B = mix( line( rot(d0, +cross) ), line( rot(d1, +cross) ), w )
cov_C = mix( line( rot(d0, -cross) ), line( rot(d1, -cross) ), w )
ink   = 1 - ( 1 - cov_A ) * ( 1 - cov_B ) * ( 1 - cov_C )
```

Three families, each sampled at two bin angles: six line evaluations per fragment (Req 7.3). All six are always
evaluated (no branch). The lines use no derivative; `fwidth` is left only in the contour (8), which has no branch around it.
A line can sit up to 0.3 of a bin (6.75°) off the true direction before the crossfade starts; that is the price of a
constant direction per bin. `binBlend(angle)` and `lineFwidth(dx, dy, spacing, pixelRatio)` in `ink-math.ts` are the
reference.

**8. Contour.** `nv = abs( dot( nonPerturbedNormal, normalize( vViewPosition ) ) )`, `g = fwidth( nv )`,
`px = nv / max( g, 1e-4 ) / uPixelRatio` (about CSS px from the silhouette):

```
contour = 1 - smoothstep( uContourPx, uContourPx + 1.0, px )
ink     = max( ink, contour )
```

On a rounded form `nv` grows roughly with the square root of the distance, so the band is a little wider than
`uContourPx` on gentle curves. Accepted; tune `uContourPx`.

**9. Cord mask.** Computed on `s = pow( inkAlbedo, vec3(1/2.2) )` (sRGB-like), hue `h` in 0..1 and saturation `sat`,
value `v` from the usual RGB to HSV:

```
dh   = min( h, 1 - h )                                           // hue distance to red
mask = ( 1 - smoothstep( uCordHue.x, uCordHue.y, dh ) )
     * smoothstep( uCordSat.x, uCordSat.y, sat )
     * smoothstep( 0.08, 0.15, v )
```

In colour terms (defaults): hue within 10° of pure red, zero at 13.5° or more; saturation 0.50 to 0.65 (full at 0.65);
value at least 0.08 (full at 0.15). `cordMask(r, g, b)` in `ink-math.ts` takes sRGB 0..1.

**Calibration (measured on the base-colour texture of `paw-web.glb`, 2048 px, sRGB texels):**

| Region | Hue | Saturation | Value | Samples |
|--------|-----|------------|-------|---------|
| Cord (about 10% of texels) | distance to red: median 6.9°, p90 10.0°, p99 12.6° (some texels sit just below 360°, hence the folded distance) | median 0.80 | median 0.37 | `#6d0b18`, `#591e22`, `#7b212b`, `#690d12`, `#52131e` |
| Fur and skin | 20° to 35° | mostly 0.15 to 0.35 | n/a | `#52483e`, `#42352d`, `#655347` |
| Dark brown patches (probably nail beds), the near-miss | 15° to 24° | high, 0.5 to 0.7 | 0.11 to 0.25 | `#2a1911`, `#1c0e08`, `#2d1b15` |

Value cannot separate the dark browns from the cord; only hue can. So the hue gate is full at 10° or less and zero at
13.5° or more. The earlier default (full to 14°, soft to about 25°) would have painted these patches red.

`cordMask` tests: the five cord reds at 0.9 or more; the fur and skin browns, the three dark browns, `#2a1d14` and
parchment `#e9d8b4` at 0.05 or less. Task 5 calibration is a visual check only: no red specks on the fur (Req 5.5).
If specks remain, narrow `uCordHue` or raise `uCordSat.x`.

**10. Output.**

```
rgb           = mix( base, uInk, ink )
outgoingLight = rgb          // then three's opaque_fragment writes gl_FragColor = vec4( outgoingLight, diffuseColor.a )
```

Tone mapping is off for this material (D4), so `rgb` is what the colour-space chunk converts to sRGB.

---

## Uniforms and defaults

`createInkUniforms()` returns this object. Colours are `Color` (linear) built from the palette hex through `hexToLinear`.

| Uniform | Type | Default | Note |
|---------|------|---------|------|
| `uInk` | Color | `#2b1d12` | line colour |
| `uSepia` | Color | `#7a5a3a` | dark end of the base tone |
| `uParchment` | Color | `#e9d8b4` | light end of the base tone |
| `uBlood` | Color | `#8f1d14` | cord |
| `uPixelRatio` | float | 1 | set in `onBeforeRender` from `renderer.getPixelRatio()` |
| `uViewport` | Vector2 | (1, 1) | drawing-buffer size in device px, set in `onBeforeRender` |
| `uSpacing` | float | 3.5 | CSS px between lines |
| `uWidthMin`, `uWidthMax` | float | 0.6, 1.7 | CSS px, at D = 0 and D = 1 |
| `uThresholds` | vec3 | 0.10, 0.38, 0.62 | family on-thresholds on D |
| `uCross` | vec2 | (cos 55°, sin 55°) | angle of B and C to A |
| `uBaseAngle` | float | 0.44 (25°) | fallback line angle in radians |
| `uFollow` | float | 0.85 | 0 gives straight lines; must stay ≤ 0.9 |
| `uNormalBend` | float | 0.25 | share of the normal map in the direction |
| `uLightLo`, `uLightHi` | float | 0.45, 1.8 | light window; ambient alone maps to 0, full key (N·L = 1) to 1 |
| `uLightWeight` | float | 0.8 | light against albedo in D |
| `uAlbedoWhite` | float | 0.9 | albedo luma that counts as bare paper |
| `uToneStrength` | float | 1.0 | how far the base tone goes toward sepia |
| `uBaseLight` | float | 0.15 | share of the light that lifts the base tone toward parchment |
| `uContourPx` | float | 1.4 | CSS px |
| `uCordHue` | vec2 | 0.0278, 0.0375 | hue distance to red as fractions of a turn: full at 10°, zero at 13.5° |
| `uCordSat` | vec2 | 0.50, 0.65 | saturation ramp |

No uniform changes with time. `uPixelRatio` and `uViewport` change only with the renderer, and only matter when a frame
is drawn anyway, so the idle budget of 0 rendered frames is kept.

Also: the spacing stays 3.5 CSS px (fine at 2x; at 1x it is close to the resolve limit, so the mean-density fade stays), and
`INK_FADE` is 0.2, a wider ramp, so the noisy normal-map light changes the line width more and switches lines on and off less.

### Tuned in the browser check (first pass)

The reviewer saw (Vite, Chromium with WebGL, 1440x900 at 1x and 2x, 3 fingers curled): the shader compiled, the shadow
was gone, the contour and the red cord read well, but the paw looked like grey plaster with an outline. Palm pixels were
flat sRGB (171,153,125), (157,138,110), (198,179,146); the art direction is a mid-sepia paw, about (150,115,80) on
average, with dense dark line work, and bare paper only on the brightest highlights.

1. **Almost no lines.** Cause: the per-pixel direction in the phase (D7). Fixed with 8 direction bins and an analytic
   antialias width.
2. **Too light.** The key light (4.8, direction about (-0.48, 0.57, 0.67)) gives the front-facing palm N·L ≈ 0.67, so
   `L` ≈ 0.43 + 1.37 · 0.67 ≈ 1.35. In the old window (0.40 to 1.45) that is lightness 0.9, and with the light palm
   albedo `D` landed at about 0.16, on the first threshold (0.15): a bare palm. The new window is 0.45 to 1.8 (the top is
   the full key, `L` = 0.43 + 1.37), `uLightWeight` is 0.8, and the thresholds are (0.10, 0.38, 0.62). The estimate, with
   albedo luma 0.35 to 0.5 and `uAlbedoWhite` 0.9:

   | N·L | 1 | 0.8 | 0.67 | 0.5 | 0.3 | 0 |
   |-----|---|-----|------|-----|-----|---|
   | `D` | 0.09 to 0.12 | 0.25 to 0.28 | 0.36 to 0.39 | 0.49 to 0.53 | 0.66 to 0.69 | 0.89 to 0.92 |
   | families on (sum of weights) | 0 | 0.9 to 1.0 | 1.0 | 1.6 to 1.8 | 2.1 to 2.3 | 3.0 |

   The brightest highlights (N·L above about 0.9) stay bare, the lit palm gets one family, mid-tones two, and the turned
   sides and finger gaps three. The suggested starting point (`uLightHi` 1.9, thresholds 0.06, 0.40, 0.64, `uLightWeight`
   0.75) left about half a family on the brightest spots, so the top of the window was set to the real maximum and
   `uLightWeight` raised. These are estimates; the reviewer checks again.
3. **Grey, pale base.** `uToneStrength` 0.85 to 1.0, `uAlbedoWhite` 0.75 to 0.9 (the fur's sRGB luma is 0.3 to 0.4, so
   it sits at 0.55 to 0.65 of the way to sepia, nails near sepia), plus the 15% `uBaseLight` share.
4. **Line weight.** `uWidthMin` 0.4 to 0.6 CSS px so the lightest family shows at 1x.

Light window estimate, for tuning: ambient `#f0dcb8` at 1.8 gives about 0.42 through Lambert/π; the key at 4.8 adds up
to about 1.2 times the cosine. So `L` runs from about 0.4 (ambient and shadow) to about 1.6 (full key).

---

## Seam change in `use-paw-material.ts`

```ts
type PawMaterialStyle = 'ink' | 'placeholder';
export const PAW_MATERIAL_STYLE: PawMaterialStyle = 'ink';

export function usePawMaterial(scene: Object3D): Material | null {
  return useMemo(
    () => selectPawMaterial(PAW_MATERIAL_STYLE, scene, createPawMaterial),
    [scene],
  );
}
```

`selectPawMaterial` (in `ink-material.ts`) returns `placeholder(scene)` for `'placeholder'` and `createInkMaterial(scene)`
for `'ink'`. Taking the placeholder factory as a parameter avoids an import cycle with `use-paw-material.ts` and lets
the switch be tested without mocking a module constant. `createPawMaterial`, `PAW_SEPIA_TINT` and the placeholder tests stay. The doc comment on the hook is updated.

---

## Error handling

| Situation | Behaviour |
|-----------|-----------|
| Scene has no standard material | `null`, the model keeps its own material (as today) |
| An anchor is missing (three upgrade) | `canInject()` is false at creation; one `console.warn`; the placeholder is returned (D5). The anchor test fails in CI first |
| GLSL fails to compile on a device | three logs the error and does not draw the mesh. Not detectable in jsdom. Covered by the reviewer's browser check (task 5). Revert with `PAW_MATERIAL_STYLE = 'placeholder'` |
| Pixel ratio or viewport change | Next draw's `onBeforeRender` updates the uniforms |

## Testing strategy

Vitest, node environment, as for the other scene modules. **No GLSL compile is possible in Vitest**, so shader
correctness is checked in two other ways: the pure TypeScript reference in `ink-math.ts` (which the GLSL mirrors through
shared constants), and a visual check in the browser.

| Layer | Covers |
|-------|--------|
| `ink-math.test.ts` | `hexToLinear` on `#000000`, `#ffffff`, `#8f1d14`; `familyWeights` at D = 0, below, between and above each threshold (monotone, 0..1); `lineWidthPx` at 0 and 1; `binBlend` (bin pair, weight, continuity at bin edges, wrap at 180°) and `lineFwidth` (axis, 45°, pixel ratio, finite difference); `darkness` and `lightness` bounds; `cordMask` on the sample colours above. A small fast-check property: `familyWeights` and `cordMask` stay in 0..1 and are monotone in D and in saturation |
| `ink-shader.test.ts` | Each anchor occurs exactly once in `ShaderLib.physical.vertexShader` or `.fragmentShader`; `ShaderChunk.normal_fragment_begin` still declares `nonPerturbedNormal`; `ShaderChunk.metalnessmap_fragment` still declares `float metalnessFactor`; `injectInkShader` on a copy of the source leaves no anchor unreplaced and adds the uniforms; a second run on a fresh copy gives the same text |
| `ink-material.test.ts` | Uniform names and default colours (linear values of the four palette hex); `onBeforeRender` with a fake renderer sets pixel ratio 2 and the viewport; the copy has `toneMapped === false`, white `color`, the same maps as the source, a distinct `customProgramCacheKey`; the source material is unchanged (colour, `userData`, `onBeforeCompile`); the same scene returns the same instance, also when the mesh already holds the copy; a scene with no standard material gives `null` |
| `ink-material.test.ts` (switch) | `selectPawMaterial('placeholder', scene, createPawMaterial)` returns exactly `createPawMaterial(scene)`'s instance; `'ink'` returns `createInkMaterial(scene)`'s and never calls the placeholder (fake factory). |
| `use-paw-material.test.ts` (extended) | The hook returns what `selectPawMaterial(PAW_MATERIAL_STYLE, scene, createPawMaterial)` returns for a GLB-like scene. The test does not assert the value of `PAW_MATERIAL_STYLE`, so flipping that line to revert needs no test change (the shipped value is fixed by Req 9.1). The existing placeholder tests stay unchanged |
| Browser (reviewer, task 5) | The reviewer compares `'ink'` and `'placeholder'` on desktop (1x and 2x) and a 390 px phone viewport. Look for: continuous lines on the fingers, no red specks on the fur, a contour on the silhouette, the cord red with lines, no swimming of lines while the paw sinks, 60 fps during a curl |

## Bundle and performance notes

- New code is about 4 KB (roughly 1.5 KB gz). The 3D chunk is 278.95 KB gz after the bin pass (275.2 KB before) against a 330 KB budget; the reviewer's check
  (task 5) confirms it.
- Per fragment, on top of three's standard shader: one HSV conversion, one normal blend, one `atan`, six `fract` line
  evaluations and a few `smoothstep` calls. No texture fetch, extra pass or time uniform. Idle budget stays 0 frames.
