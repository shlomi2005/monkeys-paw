/** The flow both modes share. Each mode's text is "<mode name>. <flow> <what its tools call>". */
export const FLOW_INSTRUCTIONS =
  'To find loopholes: call paw_rules with kind curse, write 3 to 5 curses yourself, call paw_check_curses ' +
  'with the requirement and the curses, and fix what it reports once. To judge an amendment: call paw_rules with kind ' +
  'bind, judge it yourself and strictly, call paw_check_verdict, and fix what it reports once.';

const LOCAL_TOOLS_SENTENCE = 'paw_rules, paw_check_curses and paw_check_verdict call no model and no server.';

export const LOCAL_INSTRUCTIONS = `Local mode. ${FLOW_INSTRUCTIONS} These tools call no model and no server.`;

export const REMOTE_INSTRUCTIONS =
  `Remote mode. ${FLOW_INSTRUCTIONS} ${LOCAL_TOOLS_SENTENCE} ` +
  'paw_curse and paw_bind call the Paw API at the origin in PAW_API_URL.';
