// Result and error types for the API client (design.md section 6).
// The client never throws: every outcome is an `ApiResult`.

export type ApiErrorKind =
  | 'bad-request'
  | 'not-found'
  | 'resting'
  | 'server'
  | 'network'
  | 'timeout'
  | 'invalid-response'
  | 'aborted';

export interface ApiError {
  readonly kind: ApiErrorKind;
  /** HTTP status, when the error came from a response. */
  readonly status?: number;
  /** In-character line, safe to render as text. At most 200 characters. */
  readonly message: string;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };
