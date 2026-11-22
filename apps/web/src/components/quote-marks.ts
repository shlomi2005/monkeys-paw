// Req 4.7: does the loophole already carry its own quote mark at an edge? Only the first and the last character of the
// trimmed text are looked at. A closing apostrophe (users') is not a quote.

const START_MARKS = '"\'\u201C\u201D\u2018\u2019\u201E\u201A\u201F\u00AB\u00BB\u2039\u203A\u300C\u300E';
const END_MARKS = '"\u201C\u201D\u201E\u201F\u00AB\u00BB\u300D\u300F';

export function hasOwnQuotes(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  const first = trimmed.charAt(0);
  const last = trimmed.charAt(trimmed.length - 1);
  return START_MARKS.includes(first) || END_MARKS.includes(last);
}
