// SessionProvider: owns the one `usePawSession` and shares it through context (design.md section 2).
// Tests pass a fake `api` (and a `scheduler`) here, so nothing touches the network.

import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { ApiClient } from '../api/api-client';
import { prefersReducedMotion } from '../hooks/use-reduced-motion';
import { usePawSession } from './use-paw-session';
import type { PawSession, Scheduler, UsePawSessionOptions } from './use-paw-session';

const SessionContext = createContext<PawSession | null>(null);

export interface SessionProviderProps {
  readonly children?: ReactNode;
  /** Defaults to the app's client. Tests inject a fake. */
  readonly api?: ApiClient;
  readonly scheduler?: Scheduler;
  /** Overrides the `matchMedia` reading at mount. Tests only. */
  readonly initialReducedMotion?: boolean;
}

export function SessionProvider({ children, api, scheduler, initialReducedMotion }: SessionProviderProps) {
  // Read once, on the first render. Later changes of the preference are the reducer's business (task 33).
  const [reduced] = useState(() => initialReducedMotion ?? prefersReducedMotion());
  const options: UsePawSessionOptions = {
    initialReducedMotion: reduced,
    ...(api === undefined ? {} : { api }),
    ...(scheduler === undefined ? {} : { scheduler }),
  };
  const session = usePawSession(options);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** The session shared by `SessionProvider`. Throws outside it. */
export function useSession(): PawSession {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error('useSession must be used inside a <SessionProvider>. Wrap the app in <SessionProvider>.');
  }
  return session;
}
