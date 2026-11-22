import { DAY_MS } from 'paw-core';

/**
 * In-memory budget state holder (iron-rules §2: minimal data, no persistence).
 * Holds per-IP rate-limit counters and daily spend tracking.
 */
export interface IpState {
  ipCalls: number;
  windowStart: number;
}

export interface GlobalState {
  /** Real cost charged today, in fractional cents. Reset by the day roll. */
  spentCents: number;
  /** Ceilings of the `generate` calls in flight, in fractional cents. Never reset by the day roll. */
  reservedCents: number;
  dayStart: number;
  ipStates: Map<string, IpState>;
}

export function createGlobalState(now: number = Date.now()): GlobalState {
  return {
    spentCents: 0,
    reservedCents: 0,
    dayStart: now,
    ipStates: new Map(),
  };
}

export function getOrCreateIpState(
  state: GlobalState,
  ip: string,
  now: number = Date.now(),
): IpState {
  let ipState = state.ipStates.get(ip);
  if (!ipState) {
    ipState = { ipCalls: 0, windowStart: now };
    state.ipStates.set(ip, ipState);
  }
  return ipState;
}

/**
 * Delete the IP entries whose window has ended. Entries are kept in the order of their window start,
 * so it stops at the first one that is still young.
 */
export function pruneExpiredIpStates(state: GlobalState, windowMs: number, now: number): void {
  for (const [ip, s] of state.ipStates) {
    if (!(now - s.windowStart >= windowMs)) break;
    state.ipStates.delete(ip);
  }
}

/** True when a full day has passed since `state.dayStart`. */
export function isDayElapsed(state: Pick<GlobalState, 'dayStart'>, now: number): boolean {
  return now - state.dayStart >= DAY_MS;
}

/**
 * Starts a new day with nothing spent when the current one has elapsed
 * (Req 8.5). Returns true when it rolled over. Reservations belong to calls
 * still in flight, so they are kept.
 */
export function rollDayIfElapsed(state: GlobalState, now: number): boolean {
  if (!isDayElapsed(state, now)) return false;
  state.spentCents = 0;
  state.dayStart = now;
  return true;
}
