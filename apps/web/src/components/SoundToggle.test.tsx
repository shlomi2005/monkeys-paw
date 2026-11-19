// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSoundController } from '../audio/sound-controller';
import type { SoundControllerDeps } from '../audio/sound-controller';
import { FakeAudioContext } from '../audio/fake-audio-context';
import { SoundToggle } from './SoundToggle';

function controller(extra: SoundControllerDeps = {}) {
  return createSoundController({
    makeContext: () => new FakeAudioContext().asContext(),
    loadPlayer: () => Promise.resolve({ createSoundPlayer: () => ({ cue: () => undefined, dispose: () => undefined }) }),
    ...extra,
  });
}

const button = () => screen.getByRole('button', { name: 'Sound' });

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SoundToggle', () => {
  it('is a button labelled Sound, off by default, with a hidden icon', () => {
    render(<SoundToggle sound={controller()} />);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    const icon = button().querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.getAttribute('width')).toBe('20');
  });

  it('aria-pressed follows the state, and the icon shows the struck-through variant only when off', () => {
    render(<SoundToggle sound={controller()} />);
    const strike = () => button().querySelectorAll('path[d="M3.5 17 17 3"]').length;
    expect(strike()).toBe(1);
    fireEvent.click(button());
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(strike()).toBe(0);
    fireEvent.click(button());
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(strike()).toBe(1);
  });

  it('is restored on reload', () => {
    const first = render(<SoundToggle sound={controller()} />);
    fireEvent.click(button());
    first.unmount();
    render(<SoundToggle sound={controller()} />); // a new controller reads storage, as a reload does
    expect(button().getAttribute('aria-pressed')).toBe('true');
  });

  it('is restored as off after being turned off', () => {
    const first = render(<SoundToggle sound={controller()} />);
    fireEvent.click(button());
    fireEvent.click(button());
    first.unmount();
    render(<SoundToggle sound={controller()} />);
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('writes only the key pawSoundEnabled, with "1" or "0"', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<SoundToggle sound={controller()} />);
    fireEvent.click(button());
    fireEvent.click(button());
    expect(setItem.mock.calls).toEqual([
      ['pawSoundEnabled', '1'],
      ['pawSoundEnabled', '0'],
    ]);
  });

  it('with blocked storage, nothing throws and the toggle still flips for the session', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<SoundToggle sound={controller()} />);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(() => fireEvent.click(button())).not.toThrow();
    expect(button().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button());
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('goes back to off, quietly, when the AudioContext throws', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <SoundToggle
        sound={controller({
          makeContext: () => {
            throw new Error('no audio');
          },
        })}
      />,
    );
    fireEvent.click(button());
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(quiet).not.toHaveBeenCalled();
  });
});
