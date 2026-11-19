import { useEffect } from 'react';
import styles from './App.module.css';
import { removeStaticShell } from './static-shell';

export function App() {
  // The static shell from index.html has done its job once React has committed.
  useEffect(() => {
    removeStaticShell();
  }, []);

  return <main className={styles.shell} />;
}
