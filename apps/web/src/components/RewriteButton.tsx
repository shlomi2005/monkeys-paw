import styles from './RewriteButton.module.css';

export const REWRITE_LABEL = 'Rewrite';

export interface RewriteButtonProps {
  /** The round has ended (`ctx.phase === 'ended'`). Renders nothing otherwise. */
  readonly show: boolean;
  /** App's `rewrite()`: dispatches `rewrite`, clears the wish line and moves focus to it. */
  readonly onRewrite: () => void;
}

/** The last button of the end screen: unmake the wish and start again. */
export function RewriteButton({ show, onRewrite }: RewriteButtonProps) {
  if (!show) return null;
  return (
    <button type="button" className={styles.rewrite} onClick={onRewrite}>
      {REWRITE_LABEL}
    </button>
  );
}
