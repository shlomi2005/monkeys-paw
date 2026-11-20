/** What a call reports: an HTTP status (remote mode, 0 when none) or `ok` / `invalid` (local mode). */
export type CallOutcome = number | 'ok' | 'invalid';

/**
 * Logs the tool name, the outcome and the duration. Nothing else can reach it, so a requirement,
 * a curse, an amendment or a verdict cannot be logged by mistake (paw-power D24, Req 7.3).
 */
export type CallLogger = (tool: string, outcome: CallOutcome, ms: number) => void;
