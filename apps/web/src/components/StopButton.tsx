import { cx } from './class-names';
import styles from './StopButton.module.css';

export const STOP_LABEL = 'Stop and take the scroll';

export interface StopButtonProps {
  /** `view.showStop`: a Grant is active, the round is running and at least one curse is open (Req 6.6). */
  readonly show: boolean;
  readonly onStop: () => void;
  readonly className?: string;
}

/** Ends the round early, leaving the open curses curled. Renders nothing while `show` is false. */
export function StopButton({ show, onStop, className }: StopButtonProps) {
  if (!show) return null;
  return (
    <button type="button" className={cx(styles.stop, className)} aria-label={STOP_LABEL} onClick={onStop}>
      {STOP_LABEL}
    </button>
  );
}
