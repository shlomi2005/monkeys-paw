// The sound player (design.md "Sound (Req 7)"). Loaded only by a dynamic import, the first time sound is on.
//
// Every cue is original and made in code: oscillators, noise buffers filled by our own seeded generator, filters and
// gain envelopes. There is no audio file, no decoder, no library and no network request.
//
// Each cue is a small pure "recipe": it schedules nodes on a given context, wired to a given output node, starting at a
// given time, and returns the time its last node stops. The envelopes of one recipe never sum to more than 1 before
// they reach the output, and the master gain is 0.25 (about -12 dB), so nothing clips (Req 7.5).

import type { SoundCue, SoundPlayer } from './sound-types';

/** What a recipe needs from a context. A real `AudioContext` fits; the tests pass a recording fake. */
export type CueContext = Pick<
  BaseAudioContext,
  | 'currentTime'
  | 'sampleRate'
  | 'destination'
  | 'createOscillator'
  | 'createGain'
  | 'createBiquadFilter'
  | 'createBuffer'
  | 'createBufferSource'
>;

/** What the player needs: the above, plus the lifecycle calls. */
export type PlayerContext = CueContext & Pick<AudioContext, 'state' | 'resume' | 'close'>;

/** Schedules one cue on `out` from time `at` (seconds). Returns the time the last node stops. */
export type CueRecipe = (ctx: CueContext, out: AudioNode, at: number) => number;

/** Cue lengths in seconds (Req 7.2). */
export const CUE_SECONDS: Readonly<Record<SoundCue, number>> = {
  creak: 0.5,
  stamp: 0.3,
  sigh: 0.8,
  crack: 0.2,
};

/** About -12 dB (Req 7.5). */
export const MASTER_GAIN = 0.25;

/** A new cue fades the previous one out over this long (Req 7.5). */
export const FADE_SECONDS = 0.1;

/** Small seeded generator, so the same cue always sounds the same and tests are repeatable. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** White noise, filled here, in a one-channel buffer of `seconds`. */
function noiseSource(ctx: CueContext, seed: number, seconds: number): AudioBufferSourceNode {
  const length = Math.max(1, Math.round(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seeded(seed);
  for (let i = 0; i < length; i += 1) data[i] = random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

/** A filter whose centre or corner frequency is `frequency` from time `at`, so a later ramp starts there. */
function filter(ctx: CueContext, type: BiquadFilterType, frequency: number, q: number, at: number): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.setValueAtTime(frequency, at);
  node.Q.setValueAtTime(q, at);
  return node;
}

/** Wood: a low sawtooth with stick-slip pitch jitter through a bandpass, plus a little filtered noise. 500 ms. */
export const scheduleCreak: CueRecipe = (ctx, out, at) => {
  const end = at + CUE_SECONDS.creak;
  const random = seeded(0xc4ea);
  const STEPS = 20;
  const STEP = CUE_SECONDS.creak / STEPS;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const body = ctx.createGain();
  body.gain.setValueAtTime(0, at);
  body.gain.linearRampToValueAtTime(0.6, at + 0.06);
  for (let i = 0; i < STEPS; i += 1) {
    const t = at + i * STEP;
    osc.frequency.setValueAtTime((88 + 42 * Math.sin((Math.PI * i) / STEPS)) * (0.85 + 0.3 * random()), t);
    if (i >= 3) body.gain.setValueAtTime(0.6 * (0.55 + 0.45 * random()), t);
  }
  body.gain.linearRampToValueAtTime(0, end);
  osc.connect(filter(ctx, 'bandpass', 520, 5, at)).connect(body).connect(out);
  osc.start(at);
  osc.stop(end);

  const grain = noiseSource(ctx, 0xc4eb, CUE_SECONDS.creak);
  const grainGain = ctx.createGain();
  grainGain.gain.setValueAtTime(0, at);
  grainGain.gain.linearRampToValueAtTime(0.3, at + 0.08);
  grainGain.gain.linearRampToValueAtTime(0, end);
  grain.connect(filter(ctx, 'bandpass', 2200, 1.5, at)).connect(grainGain).connect(out);
  grain.start(at);
  grain.stop(end);
  return end;
};

/** A seal pressed into wax: a short low sine thump with a fast pitch drop, and a short noise click. 300 ms. */
export const scheduleStamp: CueRecipe = (ctx, out, at) => {
  const end = at + CUE_SECONDS.stamp;

  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(150, at);
  thump.frequency.exponentialRampToValueAtTime(48, at + 0.12);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0, at);
  thumpGain.gain.linearRampToValueAtTime(0.8, at + 0.004);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, end);
  thumpGain.gain.setValueAtTime(0, end);
  thump.connect(thumpGain).connect(out);
  thump.start(at);
  thump.stop(end);

  const click = noiseSource(ctx, 0x57a4, 0.03);
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(0.2, at);
  clickGain.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
  click.connect(filter(ctx, 'lowpass', 1800, 0.7, at)).connect(clickGain).connect(out);
  click.start(at);
  click.stop(at + 0.03);
  return end;
};

/** Relief: bandpass-filtered noise, slow attack and release, the centre frequency falling. 800 ms. */
export const scheduleSigh: CueRecipe = (ctx, out, at) => {
  const end = at + CUE_SECONDS.sigh;
  const breath = noiseSource(ctx, 0x5167, CUE_SECONDS.sigh);
  const band = filter(ctx, 'bandpass', 1100, 1.4, at);
  band.frequency.exponentialRampToValueAtTime(320, end);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(1, at + 0.28);
  gain.gain.linearRampToValueAtTime(0, end);
  breath.connect(band).connect(gain).connect(out);
  breath.start(at);
  breath.stop(end);
  return end;
};

/** Offsets and lengths of the crack bursts in seconds, and their level. The last burst ends at 200 ms. */
const CRACK_BURSTS: ReadonlyArray<{ readonly t: number; readonly len: number; readonly level: number }> = [
  { t: 0, len: 0.012, level: 0.5 },
  { t: 0.04, len: 0.008, level: 0.4 },
  { t: 0.075, len: 0.01, level: 0.45 },
  { t: 0.12, len: 0.006, level: 0.3 },
  { t: 0.185, len: 0.015, level: 0.25 },
];

/** Brittle: five very short high-passed noise bursts. They never overlap. 200 ms. */
export const scheduleCrack: CueRecipe = (ctx, out, at) => {
  CRACK_BURSTS.forEach((burst, index) => {
    const start = at + burst.t;
    const stop = start + burst.len;
    const source = noiseSource(ctx, 0xc7ac + index, burst.len);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(burst.level, start);
    gain.gain.exponentialRampToValueAtTime(0.001, stop);
    source.connect(filter(ctx, 'highpass', 2500, 0.7, start)).connect(gain).connect(out);
    source.start(start);
    source.stop(stop);
  });
  return at + CUE_SECONDS.crack;
};

export const RECIPES: Readonly<Record<SoundCue, CueRecipe>> = {
  creak: scheduleCreak,
  stamp: scheduleStamp,
  sigh: scheduleSigh,
  crack: scheduleCrack,
};

/** Wires the master gain and plays cues on `ctx`. The caller creates `ctx` inside a user gesture. */
export function createSoundPlayer(ctx: PlayerContext): SoundPlayer {
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(ctx.destination);

  let previous: { gain: GainNode; endsAt: number; fading: boolean } | null = null;

  return {
    cue(name) {
      try {
        if (ctx.state === 'suspended') Promise.resolve(ctx.resume()).catch(() => undefined);
        const now = ctx.currentTime;
        if (previous !== null && !previous.fading && now < previous.endsAt) {
          previous.gain.gain.setValueAtTime(1, now);
          previous.gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
          previous.fading = true;
        }
        const gain = ctx.createGain();
        gain.connect(master);
        previous = { gain, endsAt: RECIPES[name](ctx, gain, now), fading: false };
      } catch {
        // A failing cue stays silent. It must never break the page.
      }
    },
    dispose() {
      previous = null;
      try {
        Promise.resolve(ctx.close()).catch(() => undefined);
      } catch {
        // Already closed.
      }
    },
  };
}
