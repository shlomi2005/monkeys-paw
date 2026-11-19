import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { countedInvalidate } from './invalidate-counter';
import { createTwitch } from './granting-twitch';
import type { Twitch, TwitchRoot } from './granting-twitch';

export interface UseGrantingTwitchOptions {
  readonly root: RefObject<TwitchRoot | null>;
  /** True while the session's phase is `granting`. The twitch starts when it turns true after mount. */
  readonly granting: boolean;
  readonly reducedMotion: boolean;
}

/** The 250 ms twitch on the model root group. Off under reduced motion; no frames are requested while it is idle. */
export function useGrantingTwitch({ root, granting, reducedMotion }: UseGrantingTwitchOptions): void {
  const invalidate = useThree((state) => state.invalidate);
  const counted = useMemo(() => countedInvalidate(invalidate), [invalidate]);
  const reduced = useRef(reducedMotion);
  reduced.current = reducedMotion;
  const twitchRef = useRef<Twitch | null>(null);
  // A grant that is already running when the model appears does not twitch: only the change to `granting` does.
  const wasGranting = useRef(granting);

  useLayoutEffect(() => {
    const rootObject = root.current;
    if (rootObject === null) return;
    const twitch = createTwitch({ root: rootObject, invalidate: counted, isReducedMotion: () => reduced.current });
    twitchRef.current = twitch;
    return () => {
      twitch.cancel();
      twitchRef.current = null;
    };
  }, [root, counted]);

  useEffect(() => {
    const was = wasGranting.current;
    wasGranting.current = granting;
    if (granting && !was) twitchRef.current?.start();
  }, [granting]);

  useEffect(() => {
    if (reducedMotion) twitchRef.current?.cancel();
  }, [reducedMotion]);

  useFrame(() => twitchRef.current?.frame());
}
