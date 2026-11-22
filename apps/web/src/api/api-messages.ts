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

/**
 * The note under the wish line (paw-web Req 3.9). The website runs on Gemini's free tier, where Google may use
 * what it receives, so the page says where a wish and a clause go. Shown unless live wishes are outside.
 */
export const WISH_SENT_TO_GEMINI_MESSAGE =
  "Wishes and clauses go to Google's Gemini. Google may use them to improve its products, and people there may read them. Keep personal details out.";

/** The note that replaces the privacy note when live wishes are outside (Req 13.6). It is also announced once. */
export const OUTSIDE_NOTE_MESSAGE =
  'The paw grants no live wishes where you stand. Its examples still play the full round.';

/** The server's refusal for a region carried no usable line (Req 13.1, design section 6). */
export const OUTSIDE_REFUSAL_MESSAGE = 'The paw grants no live wishes where you stand.';

/** A typed or edited wish while live wishes are outside (Req 13.6). Nothing is sent. */
export const NO_LIVE_WISH_MESSAGE = 'No live wishes here. Choose an example.';

/** The alert when a live wish is made without the 18+ tick, and the line for a server 403 `adult_confirmation_required`. */
export const ADULT_REQUIRED_MESSAGE = 'The paw waits for one more word. Confirm you are 18 or older.';

/** The label of the 18+ checkbox (Req 13.2). Not legal advice and not proof of age. */
export const ADULT_LABEL = 'I am 18 or older';

/** The visible reason for the inert seal from the Grant until Rewrite (Req 13.11). */
export const SEAL_USED_MESSAGE = 'Granted already. Rewrite to wish again.';

/** Accept with an edited clause in a ready round (Req 13.9). The card stays open. */
export const CLAUSE_AS_WRITTEN_MESSAGE = 'The Judge has an answer only for the clause as written.';

/** Accept in a replayed round that has no ready verdict (Req 13.9). */
export const JUDGE_LIVE_ONLY_MESSAGE = 'The Judge weighs only live wishes.';

/** Status text on the wish line while a Grant is on its way. */
export const PAW_STIRS_MESSAGE = 'The Paw stirs…';

/** The fixed note shown and announced while a ready round plays (paw-web Req 13.12). */
export const EXAMPLE_NOTE_MESSAGE =
  'The paw recites an example. Its curses and verdicts were written in advance. No live model is judging.';

/** Status line in the binding card while the Judge weighs a clause (paw-web Req 4.3). */
export const JUDGE_STIRS_MESSAGE = 'The Judge stirs…';

/** Under the story in the binding card after a "not closed" verdict (paw-web Req 4.3). */
export const PAW_REMEMBERS_MESSAGE = 'The paw remembers.';

/** "Accept this clause" with a blank clause. No request is made. */
export const EMPTY_CLAUSE_MESSAGE = 'The Judge cannot weigh a blank clause. Write one first.';

/** The scroll was built but the browser would not save it (the download itself threw). */
export const SCROLL_LOST_MESSAGE = 'The scroll slipped away. Try again.';

/** Status after "Take the scroll" saved the zip. */
export const SCROLL_SAVED_MESSAGE = 'Scroll saved!';
