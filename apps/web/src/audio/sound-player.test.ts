// The sound player and its four recipes, against a recording fake of AudioContext. No real audio is made.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext, FakeNode } from './fake-audio-context';
import type { FakeParam } from './fake-audio-context';
import { CUE_SECONDS, FADE_SECONDS, MASTER_GAIN, RECIPES, createSoundPlayer } from './sound-player';
import type { SoundCue } from './sound-types';

const CUES: SoundCue[] = ['creak', 'stamp', 'sigh', 'crack'];
const AT = 2;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Plays one recipe on a fresh fake, into a plain output gain. */
function schedule(name: SoundCue, at = AT) {
  const ctx = new FakeAudioContext();
  const out = ctx.createGain();
  const end = RECIPES[name](ctx.asContext(), out as unknown as AudioNode, at);
  return { ctx, out, end };
}

/** Value of an AudioParam at time `t`, from its recorded automation. Before the first event it is 0. */
function valueAt(param: FakeParam, t: number): number {
  let prev = { time: 0, value: 0 };
  for (const call of param.calls) {
    if (call.method === 'set' || call.method === 'cancelScheduledValues') continue;
    if (t < call.time) {
      if (call.method === 'setValueAtTime') return prev.value;
      const span = call.time - prev.time;
      const frac = span <= 0 ? 1 : (t - prev.time) / span;
      if (call.method === 'linearRampToValueAtTime') return prev.value + (call.value - prev.value) * frac;
      return prev.value > 0 && call.value > 0 ? prev.value * (call.value / prev.value) ** frac : prev.value;
    }
    prev = { time: call.time, value: call.value };
  }
  return prev.value;
}

function reaches(from: FakeNode, to: FakeNode, seen = new Set<FakeNode>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return from.outputs.some((next) => reaches(next, to, seen));
}

/** Total level arriving at `out` at time `t`: each layer's gain envelope, only while its source is sounding. */
function levelAt(ctx: FakeAudioContext, out: FakeNode, t: number): number {
  let sum = 0;
  for (const layer of ctx.of('gain').filter((g) => g.outputs.includes(out))) {
    const source = ctx.sources().find((s) => reaches(s, layer));
    if (source === undefined) continue;
    const start = source.starts[0] as number;
    const stop = source.stops[0] as number;
    if (t >= start && t <= stop) sum += valueAt(layer.gain, t);
  }
  return sum;
}

describe.each(CUES)('%s recipe', (name) => {
  it('lasts exactly its nominal duration', () => {
    const { ctx, end } = schedule(name);
    const nominal = { creak: 0.5, stamp: 0.3, sigh: 0.8, crack: 0.2 }[name];
    expect(CUE_SECONDS[name]).toBe(nominal);
    expect(end - AT).toBeCloseTo(nominal, 9);
    const sources = ctx.sources();
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.starts).toHaveLength(1);
      expect(source.stops).toHaveLength(1);
      expect(source.starts[0]).toBeGreaterThanOrEqual(AT);
      expect(source.stops[0] as number).toBeGreaterThan(source.starts[0] as number);
      expect(source.stops[0] as number).toBeLessThanOrEqual(end + 1e-9);
    }
    expect(Math.max(...sources.map((s) => s.stops[0] as number)) - AT).toBeCloseTo(nominal, 9);
  });

  it('never goes above 1 before the master gain, and is audible', () => {
    const { ctx, out } = schedule(name);
    for (const gain of ctx.of('gain')) expect(gain.gain.peak()).toBeLessThanOrEqual(1);
    let peak = 0;
    for (let t = AT; t <= AT + CUE_SECONDS[name]; t += 0.001) {
      const level = levelAt(ctx, out, t);
      expect(level).toBeLessThanOrEqual(1 + 1e-9);
      peak = Math.max(peak, level);
    }
    expect(peak).toBeGreaterThan(0.2);
    expect(peak * MASTER_GAIN).toBeLessThanOrEqual(0.25);
  });

  it('is made only of generated sources: noise buffers are filled with samples in [-1, 1]', () => {
    const { ctx } = schedule(name);
    for (const source of ctx.of('buffer-source')) {
      const data = (source.buffer as NonNullable<FakeNode['buffer']>).data;
      expect(data.some((v) => v !== 0)).toBe(true);
      expect(data.every((v) => v >= -1 && v <= 1)).toBe(true);
    }
  });
});

describe('recipe character', () => {
  it('creak: a sawtooth with jittered pitch through a bandpass', () => {
    const { ctx } = schedule('creak');
    const osc = ctx.of('oscillator')[0] as FakeNode;
    expect(osc.type).toBe('sawtooth');
    const pitches = new Set(osc.frequency.calls.map((c) => c.value));
    expect(pitches.size).toBeGreaterThan(10);
    expect(ctx.of('biquad').some((f) => f.type === 'bandpass')).toBe(true);
  });

  it('stamp: a low sine thump whose pitch drops fast', () => {
    const osc = schedule('stamp').ctx.of('oscillator')[0] as FakeNode;
    expect(osc.type).toBe('sine');
    const [from, to] = [osc.frequency.calls[0], osc.frequency.calls[1]];
    expect(from?.value).toBeLessThan(200);
    expect((to?.value as number) < (from?.value as number) / 2).toBe(true);
    expect((to?.time as number) - AT).toBeLessThanOrEqual(0.15);
  });

  it('sigh: slow attack and release, centre frequency falling', () => {
    const { ctx } = schedule('sigh');
    const band = ctx.of('biquad')[0] as FakeNode;
    expect(band.type).toBe('bandpass');
    const [start, end] = [band.frequency.calls[0], band.frequency.calls[1]];
    expect((end?.value as number) < (start?.value as number)).toBe(true);
    const gain = ctx.of('gain').find((g) => g.gain.calls.length > 0) as FakeNode;
    const peakAt = gain.gain.calls.find((c) => c.value === gain.gain.peak())?.time as number;
    expect(peakAt - AT).toBeGreaterThanOrEqual(0.2);
    expect(AT + 0.8 - peakAt).toBeGreaterThanOrEqual(0.3);
  });

  it('crack: 3 to 6 very short high-passed noise bursts', () => {
    const { ctx } = schedule('crack');
    const bursts = ctx.of('buffer-source');
    expect(bursts.length).toBeGreaterThanOrEqual(3);
    expect(bursts.length).toBeLessThanOrEqual(6);
    for (const burst of bursts) expect((burst.stops[0] as number) - (burst.starts[0] as number)).toBeLessThanOrEqual(0.02);
    expect(ctx.of('biquad').every((f) => f.type === 'highpass')).toBe(true);
  });
});

describe('the player mix', () => {
  function gainsInto(ctx: FakeAudioContext, target: FakeNode): FakeNode[] {
    return ctx.of('gain').filter((g) => g.outputs.includes(target));
  }

  it('puts a master gain of at most 0.25 (about -12 dB) between the cues and the destination', () => {
    const ctx = new FakeAudioContext();
    const player = createSoundPlayer(ctx.asContext());
    for (const name of CUES) player.cue(name);
    const [master] = gainsInto(ctx, ctx.destination);
    expect(master).toBeDefined();
    expect(master?.gain.value).toBeLessThanOrEqual(0.25);
    expect(20 * Math.log10(master?.gain.value as number)).toBeLessThanOrEqual(-12);
    const cueGains = gainsInto(ctx, master as FakeNode);
    expect(cueGains).toHaveLength(CUES.length);
    for (const g of cueGains) expect(g.gain.peak()).toBeLessThanOrEqual(1);
  });

  it('a new cue ramps the previous cue gain to 0 over 100 ms', () => {
    const ctx = new FakeAudioContext();
    const player = createSoundPlayer(ctx.asContext());
    ctx.currentTime = 1;
    player.cue('sigh');
    ctx.currentTime = 1.3;
    player.cue('stamp');
    const master = gainsInto(ctx, ctx.destination)[0] as FakeNode;
    const [sigh, stamp] = gainsInto(ctx, master);
    expect(FADE_SECONDS).toBe(0.1);
    expect(sigh?.gain.calls).toEqual([
      { method: 'setValueAtTime', value: 1, time: 1.3 },
      { method: 'linearRampToValueAtTime', value: 0, time: 1.3 + 0.1 },
    ]);
    expect(stamp?.gain.calls).toEqual([]);

    ctx.currentTime = 1.35; // the stamp is still sounding; the sigh is already fading and is left alone
    player.cue('crack');
    expect(sigh?.gain.calls).toHaveLength(2);
    expect(stamp?.gain.calls).toEqual([
      { method: 'setValueAtTime', value: 1, time: 1.35 },
      { method: 'linearRampToValueAtTime', value: 0, time: 1.35 + 0.1 },
    ]);
  });

  it('does not fade a cue that has already finished', () => {
    const ctx = new FakeAudioContext();
    const player = createSoundPlayer(ctx.asContext());
    player.cue('crack');
    ctx.currentTime = 5;
    player.cue('creak');
    const master = gainsInto(ctx, ctx.destination)[0] as FakeNode;
    expect(gainsInto(ctx, master)[0]?.gain.calls).toEqual([]);
  });

  it('resumes a suspended context, and closes it on dispose', () => {
    const ctx = new FakeAudioContext();
    const player = createSoundPlayer(ctx.asContext());
    player.cue('creak');
    expect(ctx.resumeCalls).toBe(1);
    player.dispose();
    expect(ctx.closeCalls).toBe(1);
  });

  it('a failing context stays silent and never throws', () => {
    const ctx = new FakeAudioContext();
    const player = createSoundPlayer(ctx.asContext());
    ctx.createOscillator = () => {
      throw new Error('boom');
    };
    expect(() => player.cue('creak')).not.toThrow();
  });
});

describe('no network and no audio files', () => {
  it('playing every cue never calls fetch or XMLHttpRequest', () => {
    const fetchSpy = vi.fn();
    const xhrSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    const player = createSoundPlayer(new FakeAudioContext().asContext());
    for (const name of CUES) player.cue(name);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
  });

  const here = fileURLToPath(new URL('.', import.meta.url));

  it('the audio sources do not mention fetch, decoding, media elements or embedded audio', () => {
    const forbidden = new RegExp(
      ['fetch\\(', 'XMLHttpRequest', 'decodeAudioData', 'new Audio\\(', 'createMediaElementSource', `${'data'}:${'audio'}`].join('|'),
    );
    for (const file of ['sound-player.ts', 'sound-controller.ts', 'cue-triggers.ts']) {
      expect(readFileSync(join(here, file), 'utf8'), file).not.toMatch(forbidden);
    }
  });

  it('no audio file exists under src or public', () => {
    const root = join(here, '..', '..');
    const audioFile = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|aiff?|mid)$/i;
    const found: string[] = [];
    for (const dir of ['src', 'public']) {
      for (const entry of readdirSync(join(root, dir), { recursive: true })) {
        if (audioFile.test(String(entry))) found.push(`${dir}/${String(entry)}`);
      }
    }
    expect(found).toEqual([]);
  });
});
