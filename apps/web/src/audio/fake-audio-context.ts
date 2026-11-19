// A recording fake of the parts of `AudioContext` that the sound player uses. Tests only.
// It keeps every node that was created, the `start` and `stop` times of sources, and every call made on an
// `AudioParam`, so a test can check durations, gain envelopes and the wiring without any real audio.

import type { PlayerContext } from './sound-player';

export interface ParamCall {
  readonly method:
    | 'set'
    | 'setValueAtTime'
    | 'linearRampToValueAtTime'
    | 'exponentialRampToValueAtTime'
    | 'cancelScheduledValues';
  readonly value: number;
  readonly time: number;
}

export class FakeParam {
  readonly calls: ParamCall[] = [];
  private current = 0;

  get value(): number {
    return this.current;
  }

  set value(next: number) {
    this.current = next;
    this.calls.push({ method: 'set', value: next, time: 0 });
  }

  setValueAtTime(value: number, time: number): this {
    this.calls.push({ method: 'setValueAtTime', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.calls.push({ method: 'linearRampToValueAtTime', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.calls.push({ method: 'exponentialRampToValueAtTime', value, time });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.calls.push({ method: 'cancelScheduledValues', value: 0, time });
    return this;
  }

  /** The largest value the param is ever set to. */
  peak(): number {
    return Math.max(0, ...this.calls.filter((c) => c.method !== 'cancelScheduledValues').map((c) => c.value));
  }
}

export type FakeKind = 'oscillator' | 'gain' | 'biquad' | 'buffer-source' | 'destination';

export class FakeNode {
  readonly outputs: FakeNode[] = [];
  readonly starts: number[] = [];
  readonly stops: number[] = [];
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  type = '';
  buffer: FakeBuffer | null = null;

  constructor(readonly kind: FakeKind) {}

  connect(target: FakeNode): FakeNode {
    this.outputs.push(target);
    return target;
  }

  disconnect(): void {
    this.outputs.length = 0;
  }

  start(when: number): void {
    this.starts.push(when);
  }

  stop(when: number): void {
    this.stops.push(when);
  }
}

export class FakeBuffer {
  readonly data: Float32Array;
  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.data;
  }
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 8000;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  readonly destination = new FakeNode('destination');
  readonly nodes: FakeNode[] = [];
  resumeCalls = 0;
  closeCalls = 0;

  private make(kind: FakeKind): FakeNode {
    const node = new FakeNode(kind);
    this.nodes.push(node);
    return node;
  }

  createOscillator(): FakeNode {
    return this.make('oscillator');
  }

  createGain(): FakeNode {
    return this.make('gain');
  }

  createBiquadFilter(): FakeNode {
    return this.make('biquad');
  }

  createBufferSource(): FakeNode {
    return this.make('buffer-source');
  }

  createBuffer(_channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(length, sampleRate);
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }

  /** The fake, typed as what the player takes. */
  asContext(): PlayerContext {
    return this as unknown as PlayerContext;
  }

  of(kind: FakeKind): FakeNode[] {
    return this.nodes.filter((n) => n.kind === kind);
  }

  /** Every source node (oscillators and noise) that was started. */
  sources(): FakeNode[] {
    return this.nodes.filter((n) => n.kind === 'oscillator' || n.kind === 'buffer-source');
  }
}
