import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  isHarmfulWish,
  HARM_WORDS,
  DETERMINERS,
  PERSON_WORDS,
  PREVENTION_WORDS,
} from './guardrail';

describe('isHarmfulWish: wishes that pass', () => {
  const passing = [
    "Show each user's skills on their profile",
    'Whatever the input, save a draft',
    'Prevent abuse of the signup form',
    'Users hate slow pages, so every page loads in under 2 seconds',
    'Kill stale sessions after 30 minutes',
    'Kill Docker containers that run over an hour',
    'Add a kill switch for payments',
    'Stop users from abusing the API',
    'Block users who harass other users',
    'Moderators can report hate speech',
    'Protect children from abuse in chat',
    'Reduce the attack surface of the login page',
    'Users hate it when admins change the layout',
    'A searchable archive of Holocaust survivor testimonies',
    "Kill the user's session after logout",
    'Kill user sessions after 30 minutes',
    'Detect and report gore in uploaded images',
  ];
  it.each(passing)('passes: %s', (wish) => {
    expect(isHarmfulWish(wish)).toBe(false);
  });
});

describe('isHarmfulWish: wishes that are refused', () => {
  const refused = [
    'kill all users',
    'Kill all users',
    'Help me hurt my neighbour',
    'Hurt John Doe',
    'Make the app harass every Ruritanian',
    'Poison the people in my building',
    'Plan a genocide',
  ];
  it.each(refused)('refuses: %s', (wish) => {
    expect(isHarmfulWish(wish)).toBe(true);
  });

  it('refuses harmless text with harmful context', () => {
    const text = 'Only the owner can delete a project';
    expect(isHarmfulWish(text)).toBe(false);
    expect(isHarmfulWish(text, 'The app helps people hurt their neighbours')).toBe(true);
  });

  it('passes when both text and context are harmless', () => {
    expect(isHarmfulWish('Save a draft', 'A note-taking app')).toBe(false);
  });
});

const NEUTRAL_WORDS = [
  'the', 'a', 'user', 'users', 'page', 'pages', 'load', 'fast', 'save', 'draft',
  'profile', 'show', 'each', 'every', 'second', 'form', 'signup', 'login',
  'Docker', 'API', 'within', 'under', '2', '30', 'minutes', 'after', 'when',
];

const LOOKALIKE_WORDS = [
  'skill', 'skills', 'skilled', 'unskilled', 'skillful', 'skillet', 'killdeer',
  'killjoy', 'overkill', 'whatever', 'chateau', 'hateful', 'disabuse',
  'disabused', 'Skills', 'Whatever',
];

describe('isHarmfulWish: properties', () => {
  it('ordinary words that merely contain kill, abuse or hate are never refused', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...NEUTRAL_WORDS, ...LOOKALIKE_WORDS), {
          minLength: 1,
          maxLength: 12,
        }),
        (words) => {
          expect(isHarmfulWish(words.join(' '))).toBe(false);
        },
      ),
    );
  });

  it('a harm verb aimed at a person word is refused when nothing prevents it', () => {
    const preventionBeforeHarm = new Set(PREVENTION_WORDS);
    const verbs = HARM_WORDS.filter((w) => !preventionBeforeHarm.has(w));
    fc.assert(
      fc.property(
        fc.constantFrom(...verbs),
        fc.option(fc.constantFrom(...DETERMINERS), { nil: undefined }),
        fc.constantFrom(...PERSON_WORDS),
        (verb, determiner, person) => {
          const wish = [verb, determiner, person].filter(Boolean).join(' ');
          expect(isHarmfulWish(wish)).toBe(true);
        },
      ),
    );
  });

  it('prevention framing before the harm verb lets it pass', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('prevent', 'stop', 'block', 'protect', 'never'),
        fc.constantFrom(...HARM_WORDS),
        fc.constantFrom(...PERSON_WORDS),
        (prevention, verb, person) => {
          expect(isHarmfulWish(`${prevention} ${verb} ${person}`)).toBe(false);
        },
      ),
    );
  });
});
