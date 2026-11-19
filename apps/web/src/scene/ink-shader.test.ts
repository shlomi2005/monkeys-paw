import { ShaderChunk, ShaderLib, Uniform } from 'three';
import { describe, expect, it } from 'vitest';
import { canInject, injectInkShader, INK_ANCHORS, INK_UNIFORM_TYPES } from './ink-shader';
import type { InkShaderSource } from './ink-shader';

/**
 * GLSL is NOT compiled here: Vitest has no GL context. These tests check the anchors in the installed three, the
 * chunk names the GLSL relies on, and the text of the patch. Shader correctness is checked by reading, by the pure
 * reference in ink-math.ts, and by the reviewer in the browser (paw-ink-shader task 5).
 */

function occurrences(source: string, anchor: string): number {
  return source.split(anchor).length - 1;
}

function freshSource(): InkShaderSource {
  return {
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
    uniforms: {},
  };
}

function sharedUniforms() {
  return Object.fromEntries(Object.keys(INK_UNIFORM_TYPES).map((name) => [name, new Uniform(0)]));
}

describe('anchors in the installed three', () => {
  it.each(INK_ANCHORS.map((a) => [a.stage, a.anchor] as const))('%s shader has %s exactly once', (stage, anchor) => {
    const source = stage === 'vertex' ? ShaderLib.physical.vertexShader : ShaderLib.physical.fragmentShader;
    expect(occurrences(source, anchor)).toBe(1);
  });

  it('canInject() is true', () => {
    expect(canInject()).toBe(true);
  });

  it('shares its shader source between the standard and physical materials', () => {
    expect(ShaderLib.standard.vertexShader).toBe(ShaderLib.physical.vertexShader);
    expect(ShaderLib.standard.fragmentShader).toBe(ShaderLib.physical.fragmentShader);
  });

  it('still declares the identifiers the GLSL relies on', () => {
    expect(ShaderChunk.normal_fragment_begin).toContain('nonPerturbedNormal');
    expect(ShaderChunk.metalnessmap_fragment).toContain('float metalnessFactor');
    expect(ShaderLib.physical.fragmentShader).toContain('varying vec3 vViewPosition');
    expect(ShaderLib.physical.fragmentShader).toContain('vec3 outgoingLight');
    expect(ShaderLib.physical.fragmentShader).toContain('ReflectedLight reflectedLight');
    expect(ShaderChunk.opaque_fragment).toContain('gl_FragColor = vec4( outgoingLight');
  });
});

describe('injectInkShader', () => {
  it('replaces the metalness chunk and keeps every other anchor, with the patch next to it', () => {
    const shader = freshSource();
    injectInkShader(shader, sharedUniforms());
    expect(shader.fragmentShader).not.toContain('#include <metalnessmap_fragment>');
    expect(shader.fragmentShader).toContain('float metalnessFactor = 0.0;');
    for (const { stage, anchor } of INK_ANCHORS) {
      if (anchor === '#include <metalnessmap_fragment>') continue;
      const source = stage === 'vertex' ? shader.vertexShader : shader.fragmentShader;
      expect(occurrences(source, anchor)).toBe(1);
    }
    expect(shader.vertexShader).toContain('vInkOrigin = (');
    expect(shader.fragmentShader).toContain('vec3 inkAlbedo = diffuseColor.rgb;');
    expect(shader.fragmentShader).toContain('outgoingLight = mix( inkBase, uInk, inkAmount );');
    expect(shader.fragmentShader.indexOf('outgoingLight = mix(')).toBeLessThan(
      shader.fragmentShader.indexOf('#include <opaque_fragment>'),
    );
  });

  it('declares every uniform once, with its type, in the stage that reads it', () => {
    const shader = freshSource();
    injectInkShader(shader, sharedUniforms());
    for (const [name, type] of Object.entries(INK_UNIFORM_TYPES)) {
      const declaration = `uniform ${type} ${name};`;
      const inVertex = occurrences(shader.vertexShader, declaration);
      const inFragment = occurrences(shader.fragmentShader, declaration);
      expect([inVertex, inFragment]).toEqual(name === 'uViewport' ? [1, 0] : [0, 1]);
    }
    expect(occurrences(shader.vertexShader, 'varying vec2 vInkOrigin;')).toBe(1);
    expect(occurrences(shader.fragmentShader, 'varying vec2 vInkOrigin;')).toBe(1);
  });

  it('puts the same uniform objects (not copies) on the shader', () => {
    const shader = freshSource();
    const uniforms = sharedUniforms();
    injectInkShader(shader, uniforms);
    for (const name of Object.keys(INK_UNIFORM_TYPES)) expect(shader.uniforms[name]).toBe(uniforms[name]);
  });

  it('is repeatable: a fresh copy gives the same text', () => {
    const a = freshSource();
    const b = freshSource();
    injectInkShader(a, sharedUniforms());
    injectInkShader(b, sharedUniforms());
    expect(b.vertexShader).toBe(a.vertexShader);
    expect(b.fragmentShader).toBe(a.fragmentShader);
  });

  it('throws on a shader that lacks an anchor', () => {
    const shader = freshSource();
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '');
    expect(() => injectInkShader(shader, sharedUniforms())).toThrow(/color_fragment/);
  });

  it('writes no integer literal where a float is expected', () => {
    const shader = freshSource();
    injectInkShader(shader, sharedUniforms());
    const patch = shader.fragmentShader.slice(
      shader.fragmentShader.indexOf('float inkLuma'),
      shader.fragmentShader.indexOf('#include <opaque_fragment>'),
    );
    const code = patch.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/(?<![\w.])\d+(?![\w.])/);
  });

  it('does not use sign() on the half-angle and never branches around fwidth', () => {
    const shader = freshSource();
    injectInkShader(shader, sharedUniforms());
    expect(shader.fragmentShader).not.toMatch(/\bsign\s*\(/);
    const fwidthLines = shader.fragmentShader.split('\n').filter((line) => line.includes('fwidth('));
    expect(fwidthLines).toHaveLength(2);
    for (const line of fwidthLines) expect(line).not.toMatch(/\bif\b|\?/);
  });
});
