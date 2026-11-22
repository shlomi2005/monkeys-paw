/** `free` is the default. Only the exact value `paid` is the paid tier. */
export type GateTier = 'free' | 'paid';

export interface GateConfig {
  tier: GateTier;
  /**
   * The name of the one request header that carries the visitor's country, set by the host in front
   * of this server. No default. Unset, blank or invalid means no country is ever allowed.
   */
  countryHeader?: string;
}

/** The gate when `createApp` gets no config: free tier, no country header, so it fails closed. */
export const DEFAULT_GATE_CONFIG: GateConfig = { tier: 'free' };

/**
 * `GEMINI_TIER` and `COUNTRY_HEADER`, read from the given environment (pure: no I/O).
 * Unset, blank and every other `GEMINI_TIER` value is the free tier. `COUNTRY_HEADER` is kept as
 * written; the gate checks that it is a usable header name.
 * (paw-api Requirement 14.2, 14.4, 14.10)
 */
export function loadGateConfig(env: Readonly<Record<string, string | undefined>>): GateConfig {
  const tier: GateTier = env.GEMINI_TIER === 'paid' ? 'paid' : 'free';
  const countryHeader = env.COUNTRY_HEADER;
  return countryHeader === undefined ? { tier } : { tier, countryHeader };
}
