// Types shared by the sound controller (in the entry chunk) and the lazy sound player. Type-only: nothing here is
// emitted, so importing it never pulls the player into the initial bundle.

/** The four cues (Req 7.2): creak = a finger curls, stamp = "Granted.", sigh = a finger opens, crack = seals crack. */
export type SoundCue = 'creak' | 'stamp' | 'sigh' | 'crack';

/** What the lazy player offers once it has been given an `AudioContext`. */
export interface SoundPlayer {
  /** Starts a cue. The previous cue, if still sounding, fades out over 100 ms. Never throws. */
  cue(name: SoundCue): void;
  /** Stops everything and closes the context. */
  dispose(): void;
}
