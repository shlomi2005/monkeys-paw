/** Joins the class names that are set. Keeps the decoration components free of string juggling. */
export function cx(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}
