import { ShaderLib } from 'three';
import type { IUniform } from 'three';
import { INK_BIN_BLEND, INK_BIN_COUNT, INK_BIN_STEP, INK_CORD_VALUE, INK_FADE, INK_GAMMA, INK_LUMA } from './ink-math';

/**
 * The ink shader's patch of three's physical shader (paw-ink-shader design.md, "Injection").
 * GLSL is WebGL2 / GLSL ES 3.0 as three emits it. Bump the suffix of `customProgramCacheKey` in ink-material.ts
 * whenever a string in this file changes.
 */

/** Every uniform the patch declares, with its GLSL type. `uViewport` is read in the vertex stage, the rest in the fragment stage. */
export const INK_UNIFORM_TYPES = {
  uInk: 'vec3',
  uSepia: 'vec3',
  uParchment: 'vec3',
  uBlood: 'vec3',
  uPixelRatio: 'float',
  uViewport: 'vec2',
  uSpacing: 'float',
  uWidthMin: 'float',
  uWidthMax: 'float',
  uThresholds: 'vec3',
  uCross: 'vec2',
  uBaseAngle: 'float',
  uFollow: 'float',
  uNormalBend: 'float',
  uLightLo: 'float',
  uLightHi: 'float',
  uLightWeight: 'float',
  uAlbedoWhite: 'float',
  uToneStrength: 'float',
  uBaseLight: 'float',
  uContourPx: 'float',
  uCordHue: 'vec2',
  uCordSat: 'vec2',
} as const;

export type InkUniformName = keyof typeof INK_UNIFORM_TYPES;

type Stage = 'vertex' | 'fragment';

/** The six anchors of the six replacements. Each occurs exactly once in its shader of `ShaderLib.physical`. */
export const INK_ANCHORS: readonly { readonly stage: Stage; readonly anchor: string }[] = [
  { stage: 'vertex', anchor: '#include <common>' },
  { stage: 'vertex', anchor: '#include <project_vertex>' },
  { stage: 'fragment', anchor: '#include <common>' },
  { stage: 'fragment', anchor: '#include <color_fragment>' },
  { stage: 'fragment', anchor: '#include <metalnessmap_fragment>' },
  { stage: 'fragment', anchor: '#include <opaque_fragment>' },
];

/** A GLSL float literal: always has a decimal point or an exponent. */
function glf(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function declarations(stage: Stage): string {
  return (Object.keys(INK_UNIFORM_TYPES) as InkUniformName[])
    .filter((name) => (name === 'uViewport') === (stage === 'vertex'))
    .map((name) => `uniform ${INK_UNIFORM_TYPES[name]} ${name};`)
    .join('\n');
}

const VERTEX_PARS = `
${declarations('vertex')}
varying vec2 vInkOrigin;
`;

// vInkOrigin: the projected object origin in device px. The same at every vertex, so interpolation keeps it constant.
const VERTEX_ORIGIN = `
vec4 inkO = projectionMatrix * modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
vInkOrigin = ( inkO.xy / inkO.w * 0.5 + 0.5 ) * uViewport;
`;

const FRAGMENT_PARS = `
${declarations('fragment')}
varying vec2 vInkOrigin;

float inkLuma( vec3 c ) {
  return dot( c, vec3( ${INK_LUMA.map(glf).join(', ')} ) );
}

// RGB (sRGB-like, 0..1) to ( hue 0..1, saturation, value ).
vec3 inkHsv( vec3 c ) {
  float mx = max( c.r, max( c.g, c.b ) );
  float mn = min( c.r, min( c.g, c.b ) );
  float d = mx - mn;
  float h = 0.0;
  if ( d > 0.00001 ) {
    if ( mx == c.r ) {
      h = mod( ( c.g - c.b ) / d, 6.0 );
    } else if ( mx == c.g ) {
      h = ( c.b - c.r ) / d + 2.0;
    } else {
      h = ( c.r - c.g ) / d + 4.0;
    }
    h = h / 6.0;
  }
  float s = mx > 0.00001 ? d / mx : 0.0;
  return vec3( h, s, mx );
}

float inkCordMask( vec3 srgb ) {
  vec3 hsv = inkHsv( srgb );
  float dh = min( hsv.x, 1.0 - hsv.x );
  return ( 1.0 - smoothstep( uCordHue.x, uCordHue.y, dh ) )
    * smoothstep( uCordSat.x, uCordSat.y, hsv.y )
    * smoothstep( ${glf(INK_CORD_VALUE[0])}, ${glf(INK_CORD_VALUE[1])}, hsv.z );
}

// Line direction A (unit vector, view space) from the smooth normal. Double-angle blend, half-angle result, no trig.
vec2 inkDirection( vec3 nGeometric, vec3 nMapped ) {
  vec3 n = normalize( mix( nGeometric, nMapped, uNormalBend ) );
  float len = length( n.xy );
  vec2 tangent = vec2( -n.y, n.x ) / max( len, 0.0001 );
  vec2 base2 = vec2( cos( 2.0 * uBaseAngle ), sin( 2.0 * uBaseAngle ) );
  vec2 tan2 = vec2( tangent.x * tangent.x - tangent.y * tangent.y, 2.0 * tangent.x * tangent.y );
  float wFollow = uFollow * smoothstep( 0.10, 0.45, len );
  vec2 m = normalize( mix( base2, tan2, wFollow ) );
  float sy = m.y < 0.0 ? -1.0 : 1.0;
  return vec2( sqrt( max( 0.5 * ( 1.0 + m.x ), 0.0 ) ), sy * sqrt( max( 0.5 * ( 1.0 - m.x ), 0.0 ) ) );
}

vec2 inkRotate( vec2 v, vec2 cs ) {
  return vec2( v.x * cs.x - v.y * cs.y, v.x * cs.y + v.y * cs.x );
}

// Position of a unit line direction among the bins, as ( index of the lower bin, crossfade weight of the upper bin ).
vec2 inkBin( vec2 dir ) {
  float theta = atan( dir.y, dir.x );
  theta = theta < 0.0 ? theta + ${glf(Math.PI)} : theta;
  float pos = theta / ${glf(INK_BIN_STEP)};
  float index = min( floor( pos ), ${glf(INK_BIN_COUNT - 1)} );
  float weight = smoothstep( ${glf(0.5 - 0.5 * INK_BIN_BLEND)}, ${glf(0.5 + 0.5 * INK_BIN_BLEND)}, pos - index );
  return vec2( index, weight );
}

vec2 inkBinDir( float index ) {
  float a = index * ${glf(INK_BIN_STEP)};
  return vec2( cos( a ), sin( a ) );
}

// Coverage 0..1 of one line pattern with a constant unit direction. The antialias width is analytic (no fwidth):
// the bin can differ inside a 2x2 quad, and a constant direction makes u linear in q.
float inkLine( vec2 q, vec2 dir, float widthPx ) {
  float u = dot( q, dir ) / uSpacing;
  float hw = 0.5 * widthPx / uSpacing;
  float fw = ( abs( dir.x ) + abs( dir.y ) ) / ( uSpacing * uPixelRatio );
  float d = abs( fract( u ) - 0.5 );
  float aa = max( 0.5 * fw, 0.0001 );
  float cov = 1.0 - smoothstep( hw - aa, hw + aa, d );
  cov *= clamp( hw / aa, 0.0, 1.0 );
  return mix( cov, 2.0 * hw, smoothstep( 0.4, 0.7, fw ) );
}

// One hatch family: the line pattern at the two bin directions, crossfaded.
float inkCoverage( vec2 q, vec2 dir0, vec2 dir1, float weight, float widthPx ) {
  return mix( inkLine( q, dir0, widthPx ), inkLine( q, dir1, widthPx ), weight );
}
`;

const FRAGMENT_ALBEDO = `
vec3 inkAlbedo = diffuseColor.rgb;
diffuseColor.rgb = vec3( 1.0 );
`;

const FRAGMENT_METALNESS = `
float metalnessFactor = 0.0;
`;

// Runs just before three's opaque_fragment, which writes gl_FragColor from outgoingLight.
const FRAGMENT_INK = `
{
  // 1. Light: white albedo, so the diffuse terms are pure light (key, rim, ambient, normal map).
  float inkL = inkLuma( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse );
  float inkLightness = clamp( ( inkL - uLightLo ) / ( uLightHi - uLightLo ), 0.0, 1.0 );

  // 2. Albedo and cord mask, on an sRGB-like colour.
  vec3 inkS = pow( max( inkAlbedo, vec3( 0.0 ) ), vec3( ${glf(1 / INK_GAMMA)} ) );
  float inkMask = inkCordMask( inkS );
  float inkA01 = clamp( inkLuma( inkS ) / uAlbedoWhite, 0.0, 1.0 );
  inkA01 = mix( inkA01, 0.5, inkMask );

  // 3. Darkness.
  float inkD = clamp( uLightWeight * ( 1.0 - inkLightness ) + ( 1.0 - uLightWeight ) * ( 1.0 - inkA01 ), 0.0, 1.0 );

  // 4. Base tone, flat.
  vec3 inkPaper = mix( uParchment, uSepia, ( 1.0 - inkA01 ) * uToneStrength );
  inkPaper = mix( inkPaper, uParchment, uBaseLight * inkLightness );
  vec3 inkBase = mix( inkPaper, uBlood, inkMask );

  // 5. Hatch families: each grows in at its threshold, lines thicken with D.
  float inkWidthPx = mix( uWidthMin, uWidthMax, inkD );
  float inkWA = inkWidthPx * smoothstep( uThresholds.x, uThresholds.x + ${glf(INK_FADE)}, inkD );
  float inkWB = inkWidthPx * smoothstep( uThresholds.y, uThresholds.y + ${glf(INK_FADE)}, inkD );
  float inkWC = inkWidthPx * smoothstep( uThresholds.z, uThresholds.z + ${glf(INK_FADE)}, inkD );

  // 6. Directions: family A's angle is quantised to bins; each family is evaluated at the two nearest bin angles.
  vec2 inkDirA = inkDirection( nonPerturbedNormal, normal );
  vec2 inkBinPos = inkBin( inkDirA );
  vec2 inkA0 = inkBinDir( inkBinPos.x );
  vec2 inkA1 = inkBinDir( inkBinPos.x + 1.0 );
  vec2 inkCrossC = vec2( uCross.x, -uCross.y );

  // 7. Lines, in CSS px from the projected origin: six line evaluations, three families at two bin angles.
  vec2 inkQ = ( gl_FragCoord.xy - vInkOrigin ) / uPixelRatio;
  float inkCovA = inkCoverage( inkQ, inkA0, inkA1, inkBinPos.y, inkWA );
  float inkCovB = inkCoverage( inkQ, inkRotate( inkA0, uCross ), inkRotate( inkA1, uCross ), inkBinPos.y, inkWB );
  float inkCovC = inkCoverage( inkQ, inkRotate( inkA0, inkCrossC ), inkRotate( inkA1, inkCrossC ), inkBinPos.y, inkWC );
  float inkAmount = 1.0 - ( 1.0 - inkCovA ) * ( 1.0 - inkCovB ) * ( 1.0 - inkCovC );

  // 8. Contour.
  float inkNv = abs( dot( nonPerturbedNormal, normalize( vViewPosition ) ) );
  float inkG = fwidth( inkNv );
  float inkPx = inkNv / max( inkG, 0.0001 ) / uPixelRatio;
  float inkContour = 1.0 - smoothstep( uContourPx, uContourPx + 1.0, inkPx );
  inkAmount = max( inkAmount, inkContour );

  // 10. Output.
  outgoingLight = mix( inkBase, uInk, inkAmount );
}
`;

/** The six replacements, in the order of `INK_ANCHORS`. */
const REPLACEMENTS: readonly ((anchor: string) => string)[] = [
  (a) => `${a}${VERTEX_PARS}`,
  (a) => `${a}${VERTEX_ORIGIN}`,
  (a) => `${a}${FRAGMENT_PARS}`,
  (a) => `${a}${FRAGMENT_ALBEDO}`,
  () => FRAGMENT_METALNESS,
  (a) => `${FRAGMENT_INK}${a}`,
];

function count(source: string, anchor: string): number {
  return source.split(anchor).length - 1;
}

/** True when every anchor occurs exactly once in this three version's physical shader. */
export function canInject(): boolean {
  const sources: Record<Stage, string> = {
    vertex: ShaderLib.physical.vertexShader,
    fragment: ShaderLib.physical.fragmentShader,
  };
  return INK_ANCHORS.every(({ stage, anchor }) => count(sources[stage], anchor) === 1);
}

/** The part of three's compile parameters the patch touches. */
export interface InkShaderSource {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, IUniform>;
}

/**
 * Patches `shader` in place: six string replacements, and the shared uniform objects are put on `shader.uniforms`
 * (the same objects, not copies, so later updates reach the program). Throws if an anchor is not found exactly once.
 */
export function injectInkShader(shader: InkShaderSource, uniforms: Record<string, IUniform>): void {
  let vertex = shader.vertexShader;
  let fragment = shader.fragmentShader;
  INK_ANCHORS.forEach(({ stage, anchor }, index) => {
    const source = stage === 'vertex' ? vertex : fragment;
    if (count(source, anchor) !== 1) throw new Error(`ink shader: anchor ${anchor} not found exactly once`);
    const replace = REPLACEMENTS[index];
    if (replace === undefined) throw new Error('ink shader: missing replacement');
    const patched = source.replace(anchor, () => replace(anchor));
    if (stage === 'vertex') vertex = patched;
    else fragment = patched;
  });
  shader.vertexShader = vertex;
  shader.fragmentShader = fragment;
  for (const name of Object.keys(uniforms)) shader.uniforms[name] = uniforms[name] as IUniform;
}
