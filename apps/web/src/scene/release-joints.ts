// The "no competing animation" guard (Req 2.7). The app never creates an AnimationMixer, so in production there is
// nothing to stop. The guard exists for the contract: if a mixer ever appears, direct joint control wins.

export interface ClipTrackLike {
  /** `<node>.<property>`, optionally with a path in front (`rig/thumb_cmc.quaternion`). */
  readonly name: string;
}

export interface ActionLike {
  getClip(): { readonly tracks: readonly ClipTrackLike[] };
  stop(): unknown;
}

/**
 * The part of three's `AnimationMixer` this guard needs. three offers no public way to list the actions of a mixer,
 * so this reads its `_actions` array, the list the mixer itself keeps.
 */
export interface MixerLike {
  readonly _actions: readonly ActionLike[];
}

/** `rig/thumb_cmc.quaternion` gives `thumb_cmc`. */
function trackNode(trackName: string): string {
  const afterPath = trackName.slice(trackName.lastIndexOf('/') + 1);
  const dot = afterPath.indexOf('.');
  return dot === -1 ? afterPath : afterPath.slice(0, dot);
}

/**
 * Stops every action whose clip has a track that targets one of `names`. Actions that only touch other nodes (the
 * wrist, say) keep playing. Returns how many actions were stopped. A missing mixer stops nothing.
 */
export function releaseJoints(mixer: MixerLike | null | undefined, names: readonly string[]): number {
  if (mixer === null || mixer === undefined) return 0;
  const driven = new Set(names);
  let stopped = 0;
  // Stopping an action reshuffles the mixer's own list, so walk a copy.
  for (const action of [...mixer._actions]) {
    if (action.getClip().tracks.some((track) => driven.has(trackNode(track.name)))) {
      action.stop();
      stopped += 1;
    }
  }
  return stopped;
}
