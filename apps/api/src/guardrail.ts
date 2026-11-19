/**
 * Wish guardrail (iron-rules §3): refuse wishes about HARMING PEOPLE.
 *
 * Pure module. No I/O, no Node or framework imports.
 *
 * Rule, in short:
 *  - Text is split into whole word tokens (Unicode letters, digits, apostrophes).
 *    A keyword matches a whole token, never a substring ("skills" is not "kill").
 *  - A harm word counts only when it is aimed at a person or group: one of the
 *    first two words after it (determiners and possessives skipped) is a person
 *    word, or a named person/group (capitalised, not an acronym, not modifying
 *    a following lowercase content word).
 *  - Prevention or safety framing within the four words before the harm word
 *    cancels it ("Prevent abuse of the signup form").
 *  - A tiny list of words is refused without a target (ALWAYS_REFUSED_WORDS).
 *
 * Decision: "holocaust" is NOT on the no-target list. A history or archive
 * wish ("A searchable archive of Holocaust survivor testimonies") must pass.
 * Wishes that actually call for harm are caught by the harm-verb rule.
 */

/** Harm verbs with the inflections we accept. */
export const HARM_WORDS: readonly string[] = [
  'kill', 'kills', 'killed', 'killing',
  'murder', 'murders', 'murdered', 'murdering',
  'hurt', 'hurts', 'hurting',
  'harm', 'harms', 'harmed', 'harming',
  'injure', 'injures', 'injured', 'injuring',
  'attack', 'attacks', 'attacked', 'attacking',
  'assault', 'assaults', 'assaulted', 'assaulting',
  'torture', 'tortures', 'tortured', 'torturing',
  'stab', 'stabs', 'stabbed', 'stabbing',
  'shoot', 'shoots', 'shot', 'shooting',
  'poison', 'poisons', 'poisoned', 'poisoning',
  'harass', 'harasses', 'harassed', 'harassing',
  'bully', 'bullies', 'bullied', 'bullying',
  'threaten', 'threatens', 'threatened', 'threatening',
  'stalk', 'stalks', 'stalked', 'stalking',
  'abuse', 'abuses', 'abused', 'abusing',
  'hate', 'hates', 'hated', 'hating',
];

/** Refused even without a target, unless prevention framing applies. */
export const ALWAYS_REFUSED_WORDS: readonly string[] = [
  'genocide', 'genocides',
  'massacre', 'massacres', 'massacred', 'massacring',
  'rape', 'rapes', 'raped', 'raping', 'rapist', 'rapists',
  'gore',
];

/** Words skipped when looking for the target of a harm word. */
export const DETERMINERS: readonly string[] = [
  'the', 'a', 'an', 'all', 'every', 'each', 'any', 'some', 'my', 'your',
  'his', 'her', 'their', 'our', 'these', 'those', 'other', 'many', 'more',
];

/** Person and group words (lowercase). */
export const PERSON_WORDS: readonly string[] = [
  'people', 'person', 'persons', 'human', 'humans', 'folks', 'guys',
  'user', 'users', 'customer', 'customers', 'client', 'clients',
  'member', 'members', 'employee', 'employees', 'staff', 'worker', 'workers',
  'child', 'children', 'kid', 'kids', 'baby', 'babies', 'teen', 'teens',
  'teenager', 'teenagers', 'adult', 'adults', 'elderly',
  'woman', 'women', 'man', 'men', 'girl', 'girls', 'boy', 'boys',
  'student', 'students', 'patient', 'patients', 'teacher', 'teachers',
  'neighbour', 'neighbours', 'neighbor', 'neighbors',
  'family', 'families', 'parent', 'parents', 'mother', 'father', 'mom', 'mum',
  'dad', 'sister', 'brother', 'wife', 'husband', 'friend', 'friends',
  'girlfriend', 'boyfriend', 'boss', 'coworker', 'coworkers',
  'colleague', 'colleagues', 'manager', 'managers', 'admin', 'admins',
  'moderator', 'moderators', 'owner', 'owners', 'guest', 'guests',
  'visitor', 'visitors', 'tenant', 'tenants', 'passenger', 'passengers',
  'player', 'players', 'driver', 'drivers', 'stranger', 'strangers',
  'citizen', 'citizens', 'resident', 'residents', 'immigrants', 'refugees',
  'minorities', 'minority', 'individual', 'individuals',
  'everyone', 'everybody', 'someone', 'somebody', 'anyone', 'anybody',
  'him', 'her', 'them', 'us', 'you', 'me',
  'himself', 'herself', 'themselves', 'ourselves', 'myself', 'yourself',
];

/** Prevention or safety words. */
export const PREVENTION_WORDS: readonly string[] = [
  'prevent', 'prevents', 'preventing', 'prevented', 'prevention',
  'stop', 'stops', 'stopping', 'stopped',
  'block', 'blocks', 'blocking', 'blocked',
  'ban', 'bans', 'banning', 'banned',
  'forbid', 'forbids', 'forbidding', 'forbidden',
  'detect', 'detects', 'detecting', 'detection',
  'report', 'reports', 'reporting', 'reported',
  'flag', 'flags', 'flagging', 'flagged',
  'moderate', 'moderates', 'moderating', 'moderation', 'moderator', 'moderators',
  'filter', 'filters', 'filtering', 'filtered',
  'protect', 'protects', 'protecting', 'protected', 'protection',
  'guard', 'guards', 'guarding',
  'limit', 'limits', 'limiting',
  'reject', 'rejects', 'rejecting',
  'refuse', 'refuses', 'refusing',
  'remove', 'removes', 'removing',
  'avoid', 'avoids', 'avoiding',
  'against', 'anti', 'no', 'never', 'not', 'without', 'from',
  "don't", "doesn't", "can't", 'cannot', "won't", "shouldn't", "mustn't",
];

/** Singular nouns that often modify the next word ("user sessions"). */
const NOUN_ADJUNCTS = new Set([
  'user', 'customer', 'client', 'member', 'employee', 'student', 'patient',
  'admin', 'owner', 'manager', 'guest', 'visitor', 'tenant', 'player', 'driver',
]);

/** Lowercase words that do not count as a "content word" a name could modify. */
const FUNCTION_WORDS = new Set([
  'on', 'in', 'at', 'with', 'and', 'or', 'so', 'for', 'from', 'who', 'that',
  'when', 'if', 'by', 'to', 'until', 'because',
  'of', 'but', 'as', 'than', 'then', 'while', 'where', 'which', 'whose', 'whom',
  'after', 'before', 'during', 'once', 'unless', 'whether', 'into', 'onto',
  'over', 'under', 'about', 'around', 'near', 'through', 'within', 'up', 'out',
  'off', 'is', 'are', 'was', 'were', 'be', 'will', 'would', 'can', 'could',
  'should', 'must', 'may', 'might', 'has', 'have', 'had', 'do', 'does', 'did',
  'it', 'i', 'we', 'they', 'he', 'she', 'you', 'me', 'him', 'them', 'us',
  'again', 'too', 'also', 'now', 'today', 'tomorrow', 'tonight',
  ...DETERMINERS,
]);

const HARM = new Set(HARM_WORDS);
const ALWAYS_REFUSED = new Set(ALWAYS_REFUSED_WORDS);
const DETERMINER_SET = new Set(DETERMINERS);
const PERSON = new Set(PERSON_WORDS);
const PREVENTION = new Set(PREVENTION_WORDS);

interface Token {
  /** Original spelling, without surrounding apostrophes or a possessive ending. */
  raw: string;
  lower: string;
  /** True for "user's" and "users'". A possessive modifies the next noun. */
  possessive: boolean;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const normalised = input.replace(/\u2019/g, "'");
  for (const match of normalised.matchAll(/[\p{L}\p{N}']+/gu)) {
    let raw = match[0];
    const quoted = raw.startsWith("'");
    raw = raw.replace(/^'+/, '');
    let possessive = false;
    if (/'s$/i.test(raw)) {
      raw = raw.slice(0, -2);
      possessive = true;
    } else if (raw.endsWith("'")) {
      raw = raw.replace(/'+$/, '');
      possessive = !quoted;
    }
    if (raw === '') continue;
    tokens.push({ raw, lower: raw.toLowerCase(), possessive });
  }
  return tokens;
}

/** A lowercase content word that the previous word could be modifying. */
function isModifiedBy(next: Token | undefined): boolean {
  if (!next) return false;
  return (
    /^\p{Ll}/u.test(next.raw) &&
    !FUNCTION_WORDS.has(next.lower) &&
    !next.lower.endsWith('ly')
  );
}

/** Capitalised and not an all-caps acronym (API, CSV, URL). */
function isCapitalisedName(raw: string): boolean {
  return /^\p{Lu}/u.test(raw) && raw.length > 1 && raw !== raw.toUpperCase();
}

/**
 * The first two words after the harm word, skipping determiners.
 * "her" is both a determiner and a person word. It is skipped only when a
 * content word follows ("hurt her friend"), not at the end ("hurt her").
 */
function targetWindow(tokens: Token[], harmIndex: number): number[] {
  const picked: number[] = [];
  for (let j = harmIndex + 1; j < tokens.length && picked.length < 2; j++) {
    const t = tokens[j];
    if (DETERMINER_SET.has(t.lower)) {
      const next = tokens[j + 1];
      const herAlone = t.lower === 'her' && (!next || FUNCTION_WORDS.has(next.lower));
      if (!herAlone) continue;
    }
    picked.push(j);
  }
  return picked;
}

function isPersonTarget(tokens: Token[], j: number): boolean {
  const t = tokens[j];
  if (t.possessive) return false;
  if (PERSON.has(t.lower)) {
    // "user sessions": a singular noun modifying a content word is not a person.
    return !(NOUN_ADJUNCTS.has(t.lower) && isModifiedBy(tokens[j + 1]));
  }
  // A named person or group: "Hurt John Doe", but not "Kill Docker containers".
  return isCapitalisedName(t.raw) && !isModifiedBy(tokens[j + 1]);
}

function hasPreventionBefore(tokens: Token[], harmIndex: number): boolean {
  for (let j = Math.max(0, harmIndex - 4); j < harmIndex; j++) {
    if (PREVENTION.has(tokens[j].lower)) return true;
  }
  return false;
}

function checkOne(input: string): boolean {
  const tokens = tokenize(input);
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i].lower;
    const isHarm = HARM.has(word);
    const isAlways = ALWAYS_REFUSED.has(word);
    if (!isHarm && !isAlways) continue;
    if (hasPreventionBefore(tokens, i)) continue;
    if (isAlways) return true;
    if (targetWindow(tokens, i).some((j) => isPersonTarget(tokens, j))) return true;
  }
  return false;
}

/**
 * True when the wish (or its optional context) asks to harm people.
 * Text and context are checked separately.
 */
export function isHarmfulWish(text: string, context?: string): boolean {
  return checkOne(text) || (context !== undefined && checkOne(context));
}
