import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  isHarmfulWish,
  COMBAT_WORDS,
  GAME_ROLE_WORDS,
  HARM_WORDS,
  DETERMINERS,
  PERSON_WORDS,
  PREVENTION_WORDS,
  SOCIAL_HARM_WORDS,
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
    // Game roles are not real-person targets for combat verbs (task 112, Req 1.3).
    'Players can attack other players',
    'Players can kill enemies and loot their gear',
    'NPCs attack the player at night',
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
    // The game-role exemption stops at real people and at social-harm verbs (task 112).
    'Let players harass other players',
    'Bully the players who lose',
    'Attack the users',
    'Players can attack John Doe',
    'Make the game hurt real people',
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
          // The documented exemption: a combat verb at a game role is a game mechanic.
          fc.pre(!(COMBAT_WORDS.includes(verb) && GAME_ROLE_WORDS.includes(person)));
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

  it('a combat verb aimed at a game-role word always passes (task 112)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...COMBAT_WORDS),
        fc.option(fc.constantFrom(...DETERMINERS), { nil: undefined }),
        fc.constantFrom(...GAME_ROLE_WORDS),
        (verb, determiner, role) => {
          const wish = [verb, determiner, role].filter(Boolean).join(' ');
          expect(isHarmfulWish(wish)).toBe(false);
        },
      ),
    );
  });

  it('a social-harm verb aimed at player or players always refuses (task 112)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SOCIAL_HARM_WORDS),
        fc.option(fc.constantFrom(...DETERMINERS), { nil: undefined }),
        fc.constantFrom('player', 'players'),
        (verb, determiner, role) => {
          const wish = [verb, determiner, role].filter(Boolean).join(' ');
          expect(isHarmfulWish(wish)).toBe(true);
        },
      ),
    );
  });

  it('the combat and social-harm verbs are exactly the harm verbs', () => {
    expect([...COMBAT_WORDS, ...SOCIAL_HARM_WORDS].sort()).toEqual([...HARM_WORDS].sort());
    expect(COMBAT_WORDS.filter((word) => SOCIAL_HARM_WORDS.includes(word))).toEqual([]);
  });
});

describe('stripTrailingApostrophes', () => {
  const old = (t: string) => t.replace(/'+$/, '');
  it('equals the regex', async () => {
    const { stripTrailingApostrophes } = await import('./guardrail');
    let bad = 0;
    for (let u = 0; u < 65536; u++) {
      const c = String.fromCharCode(u);
      if (stripTrailingApostrophes(c) !== old(c)) bad++;
      if (stripTrailingApostrophes('a' + c + "'") !== old('a' + c + "'")) bad++;
    }
    expect(bad).toBe(0);
    fc.assert(fc.property(fc.string({ unit: 'binary', maxLength: 12 }), (t) => stripTrailingApostrophes(t + "''") === old(t + "''")));
  });
});
