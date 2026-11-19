// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOUND_STORAGE_KEY, readSoundPreference, writeSoundPreference } from './sound-preference';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sound preference', () => {
  it('is off when nothing is stored, and reads back "1" and "0"', () => {
    expect(readSoundPreference()).toBe(false);
    writeSoundPreference(true);
    expect(localStorage.getItem('pawSoundEnabled')).toBe('1');
    expect(readSoundPreference()).toBe(true);
    writeSoundPreference(false);
    expect(localStorage.getItem('pawSoundEnabled')).toBe('0');
    expect(readSoundPreference()).toBe(false);
  });

  it('treats any other stored value as off', () => {
    for (const junk of ['true', '2', '', 'yes']) {
      localStorage.setItem(SOUND_STORAGE_KEY, junk);
      expect(readSoundPreference()).toBe(false);
    }
  });

  it('writes only the key pawSoundEnabled, whatever the value', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    writeSoundPreference(true);
    writeSoundPreference(false);
    expect(setItem.mock.calls.map(([key]) => key)).toEqual(['pawSoundEnabled', 'pawSoundEnabled']);
    expect(Object.keys(localStorage)).toEqual(['pawSoundEnabled']);
  });

  it('does not throw when storage throws, and then reads as off', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => writeSoundPreference(true)).not.toThrow();
    expect(readSoundPreference()).toBe(false);
  });
});
