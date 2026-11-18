import { exportSpec } from './dist/index.js';

const wish = {
  id: 'w1',
  text: 'Only the owner can delete a project.',
  context: 'a project management app',
  createdAt: Date.now(),
};

const grant = {
  wishId: 'w1',
  narration: 'The wish is granted literally.',
  curses: [
    {
      id: 'c0',
      type: 'permissions',
      story: 'A bad thing happens.',
      loophole: 'the exact words in the wish',
      status: 'closed',
      binding: {
        curseId: 'c0',
        kind: 'ears-clause',
        clause: 'WHEN the owner leaves THEN an admin takes over',
        proposedAt: 1700000000000,
      },
      verdict: {
        curseId: 'c0',
        closed: true,
        reason: 'The binding prevents the loophole.',
        judgedAt: 1700000001000,
      },
    },
  ],
};

const spec = exportSpec(wish, grant);
console.log('requirementsMd:');
console.log(spec.requirementsMd);
console.log('\npropertiesMd:');
console.log(spec.propertiesMd);
