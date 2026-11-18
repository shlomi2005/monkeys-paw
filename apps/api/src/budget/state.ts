/**
 * In-memory budget state holder (iron-rules §2: minimal data, no persistence).
 * Holds per-IP rate-limit counters and daily spend tracking.
 */
export interface IpState {
  ipCalls: number;
  windowStart: number;
}

export interface GlobalState {
  spentCents: number;
  dayStart: number;
  ipStates: Map<string, IpState>;
}

export function createGlobalState(): GlobalState {
  return {
    spentCents: 0,
    dayStart: Date.now(),
    ipStates: new Map(),
  };
}

export function getOrCreateIpState(state: GlobalState, ip: string): IpState {
  let ipState = state.ipStates.get(ip);
  if (!ipState) {
    ipState = { ipCalls: 0, windowStart: Date.now() };
    state.ipStates.set(ip, ipState);
  }
  return ipState;
}
