export const LOCAL_INSTRUCTIONS =
  'Local mode. To find loopholes: call paw_rules with kind curse, write 3 to 5 curses yourself, call paw_check_curses ' +
  'with the requirement and the curses, and fix what it reports once. To judge an amendment: call paw_rules with kind ' +
  'bind, judge it yourself and strictly, call paw_check_verdict, and fix what it reports once. These tools call no ' +
  'model and no server.';

export const REMOTE_INSTRUCTIONS = `${LOCAL_INSTRUCTIONS} paw_curse and paw_bind call the Paw API at the origin in PAW_API_URL.`;
