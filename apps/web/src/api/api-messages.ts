// Every in-character line the API client can produce, in one place so the tone stays
// consistent (design.md section 6, status mapping table).

/** 400 on grant, when the server sent no usable message. */
export const GRANT_UNREADABLE_MESSAGE = 'The Paw cannot read that wish. Try fewer words.';

/** 400 on bind or export. */
export const CLAUSE_UNREADABLE_MESSAGE = 'The Judge cannot read that clause.';

/** 404 on bind. */
export const CURSE_FORGOTTEN_MESSAGE = 'The paw has no memory of this curse.';

/** 429 or 503 on grant, bind or examples. */
export const RESTING_MESSAGE = 'The paw is resting. Browse the examples until it wakes.';

/** Any other 5xx, and statuses the table does not name. */
export const SERVER_STUMBLE_MESSAGE = 'The paw stumbles. Try again in a moment.';

/** The fetch call rejected (offline, DNS, CORS). */
export const NETWORK_MESSAGE = 'The line to the paw is cut.';

/** The call exceeded its timeout. */
export const TIMEOUT_MESSAGE = 'The paw is slow to wake.';

/** The response did not match the schema. The raw body is never shown. */
export const INVALID_RESPONSE_MESSAGE = 'The paw mumbles nonsense. Try again.';

/** The caller aborted the request. Never shown; `ApiError.message` still has to be a string. */
export const ABORTED_MESSAGE = 'The wish was withdrawn.';

/** Longest server-supplied message that may be rendered (design.md section 6). */
export const MAX_SERVER_MESSAGE_LENGTH = 200;

/**
 * Returns `body.message` when `body` is an object whose `message` is a non-blank string of at most
 * 200 characters. Anything else returns `undefined` and the caller uses its own line.
 */
export function serverMessageOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const message = (body as { message?: unknown }).message;
  if (typeof message !== 'string') return undefined;
  if (message.trim() === '' || message.length > MAX_SERVER_MESSAGE_LENGTH) return undefined;
  return message;
}

/** A bind attempt while the app is in examples-only play (design.md section 6, A9). The server is never asked. */
export const JUDGE_RESTING_MESSAGE = 'The Judge is resting too.';

/** "Make the wish" with a blank wish line. No request is made (paw-web Req 3.3). */
export const EMPTY_WISH_MESSAGE = 'The paw waits for a wish. Write one first.';

/** Status text on the wish line while a Grant is on its way. */
export const PAW_STIRS_MESSAGE = 'The Paw stirs…';

/** Placeholder card when `GET /api/examples` is not available (Req 3.7). Not an error. */
export const EXAMPLES_SLEEPING_MESSAGE = 'The examples are sleeping. Write your own wish.';
