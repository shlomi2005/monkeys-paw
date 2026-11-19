import { useSyncExternalStore } from 'react';
import type { SoundController } from '../audio/sound-controller';
import styles from './SoundToggle.module.css';

export interface SoundToggleProps {
  readonly sound: SoundController;
}

/**
 * The sound toggle (Req 7.1): a button with an engraved speaker, off by default, remembered across reloads.
 * `aria-pressed` carries the state. The click is the user gesture that lets the controller create the AudioContext.
 */
export function SoundToggle({ sound }: SoundToggleProps) {
  const on = useSyncExternalStore(sound.subscribe, sound.getSnapshot, sound.getSnapshot);
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-label="Sound"
      aria-pressed={on}
      onClick={() => sound.setEnabled(!sound.getSnapshot())}
    >
      <svg className={styles.icon} width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path
          d="M3 7.5h3l4.5-3.5v12L6 12.5H3z"
          fill="currentColor"
          fillOpacity="0.18"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        {on ? (
          <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <path d="M13.2 7.2a3.6 3.6 0 0 1 0 5.6" />
            <path d="M15.4 5a6.6 6.6 0 0 1 0 10" />
          </g>
        ) : (
          <path d="M3.5 17 17 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}
