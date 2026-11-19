import styles from './PawPoster.module.css';

/** The poster is a square render, so its natural size is 1080 x 1080 (the same numbers as the static shell). */
export const POSTER_SIZE = 1080;

export interface PawPosterProps {
  /** Set once the canvas has faded in over the poster. The box keeps its size, so nothing moves. */
  readonly hidden?: boolean;
}

/** Path of the poster under the Vite base URL (`BASE_URL` always ends in a slash). */
export function posterSrc(baseUrl: string = import.meta.env.BASE_URL): string {
  return `${baseUrl}paw/paw-poster.jpg`;
}

/** The static paw picture: holds the box while the canvas loads, and stays when WebGL is missing. Decoration only. */
export function PawPoster({ hidden = false }: PawPosterProps) {
  return (
    <img
      className={hidden ? `${styles.poster} ${styles.hidden}` : styles.poster}
      src={posterSrc()}
      width={POSTER_SIZE}
      height={POSTER_SIZE}
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable={false}
      data-poster
    />
  );
}
