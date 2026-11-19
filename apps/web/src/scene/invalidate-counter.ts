// The only module-level state the scene keeps: how many times the scene asked for a frame. Tests and the later
// Playwright idle-cost check read it (an idle paw must not count up). It is never shown, sent or stored.

let count = 0;

/** Number of `invalidate()` calls the scene has made since the last reset. */
export function invalidateCount(): number {
  return count;
}

export function resetInvalidateCount(): void {
  count = 0;
}

/** Wraps r3f's `invalidate` so every call the scene makes is counted. All scene code invalidates through this. */
export function countedInvalidate(invalidate: () => void): () => void {
  return () => {
    count += 1;
    invalidate();
  };
}
