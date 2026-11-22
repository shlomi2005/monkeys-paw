/** `{ kind: 'local' }` is the default. Remote needs a usable `PAW_API_URL` (paw-power D14). */
export type Mode = { kind: 'local' } | { kind: 'remote'; baseUrl: string };

export interface ResolvedMode {
  mode: Mode;
  /** True when the value was set but unusable (unparseable, not http(s), or with credentials). */
  ignored: boolean;
}

const LOCAL: ResolvedMode = { mode: { kind: 'local' }, ignored: false };
const LOCAL_IGNORED: ResolvedMode = { mode: { kind: 'local' }, ignored: true };

/**
 * Choose the mode from the raw `PAW_API_URL` value, once, at start-up.
 *  - unset, blank, or an unexpanded `${...}` placeholder: local, nothing to report;
 *  - set but unusable: local, and `ignored` so the caller writes one line (never the value);
 *  - a usable http(s) URL without credentials: remote, trailing slashes stripped.
 */
export function resolveMode(raw: string | undefined): ResolvedMode {
  if (raw === undefined) return LOCAL;
  const text = raw.trim();
  if (text === '' || text.includes('${')) return LOCAL;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return LOCAL_IGNORED;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return LOCAL_IGNORED;
  if (url.username !== '' || url.password !== '') return LOCAL_IGNORED;
  return { mode: { kind: 'remote', baseUrl: text.replace(/\/+$/, '') }, ignored: false };
}

/** Scheme, host and port only: no path, no credentials. Garbage gives a fixed word, never the input. */
export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'an unusable URL';
  }
}

/** `paw-mcp <version> mode=local` or `paw-mcp <version> mode=remote api=<origin>`. */
export function startupLine(version: string, mode: Mode): string {
  return mode.kind === 'local'
    ? `paw-mcp ${version} mode=local`
    : `paw-mcp ${version} mode=remote api=${originOf(mode.baseUrl)}`;
}

/** Fixed text. It never contains the value of `PAW_API_URL`. */
export function ignoredLine(version: string): string {
  return `paw-mcp ${version} ignored PAW_API_URL: not a usable http(s) URL without credentials; using local mode`;
}

/** `PAW_I_AM_18_OR_OLDER` counts only when it is exactly `yes`: no case folding, no trimming. */
export function adultConfirmedOf(raw: string | undefined): boolean {
  return raw === 'yes';
}
