// The one stored item in the whole app (design.md section 6, Req 7.4, 11.1): localStorage['pawSoundEnabled'], "1" or "0".
// It remembers the sound toggle and nothing else. Storage can be blocked or can throw, so every access is in a
// try/catch: failure means the toggle works for the session and is simply not remembered.

export const SOUND_STORAGE_KEY = 'pawSoundEnabled';

/** True only when the stored value is exactly "1". Anything else, or a blocked storage, is off. */
export function readSoundPreference(): boolean {
  try {
    return globalThis.localStorage.getItem(SOUND_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSoundPreference(enabled: boolean): void {
  try {
    globalThis.localStorage.setItem(SOUND_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Blocked storage: the choice lasts for this session only.
  }
}
