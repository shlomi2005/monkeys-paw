import { describe, it, expect } from 'vitest';
import {
  GrantRequestSchema,
  BindRequestSchema,
  ExportRequestSchema,
  WishSchema,
} from './schemas';

describe('API Schemas', () => {
  describe('GrantRequestSchema', () => {
    it('accepts valid grant request (Task 18)', () => {
      const valid = {
        wish: {
          text: 'Only admins can delete projects',
          context: 'a project management app',
        },
      };
      expect(GrantRequestSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects empty wish text (Task 19, Req 1.2)', () => {
      const invalid = {
        wish: {
          text: '   ',
          context: 'some app',
        },
      };
      expect(GrantRequestSchema.safeParse(invalid).success).toBe(false);
    });

    it('rejects missing wish text (Task 19)', () => {
      const invalid = {
        wish: {
          context: 'some app',
        },
      };
      expect(GrantRequestSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('BindRequestSchema', () => {
    it('accepts valid bind request (Task 18)', () => {
      const valid = {
        grant: {
          wishId: 'w1',
          narration: 'Granted.',
          curses: [
            {
              id: 'c1',
              type: 'permissions' as const,
              story: 'Story',
              loophole: 'loophole words',
              status: 'open' as const,
            },
            {
              id: 'c2',
              type: 'time' as const,
              story: 'Story 2',
              loophole: 'loophole 2',
              status: 'open' as const,
            },
            {
              id: 'c3',
              type: 'money' as const,
              story: 'Story 3',
              loophole: 'loophole 3',
              status: 'open' as const,
            },
          ],
        },
        curseId: 'c1',
        kind: 'rewrite' as const,
        clause: 'Only the owner can delete, or a super-admin with explicit approval.',
      };
      expect(BindRequestSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects empty clause (Task 28, Req 2.2)', () => {
      const invalid = {
        grant: {
          wishId: 'w1',
          narration: 'Granted.',
          curses: [
            {
              id: 'c1',
              type: 'permissions' as const,
              story: 'Story',
              loophole: 'loophole words',
              status: 'open' as const,
            },
            {
              id: 'c2',
              type: 'time' as const,
              story: 'Story 2',
              loophole: 'loophole 2',
              status: 'open' as const,
            },
            {
              id: 'c3',
              type: 'money' as const,
              story: 'Story 3',
              loophole: 'loophole 3',
              status: 'open' as const,
            },
          ],
        },
        curseId: 'c1',
        kind: 'rewrite' as const,
        clause: '   ',
      };
      expect(BindRequestSchema.safeParse(invalid).success).toBe(false);
    });

    it('rejects missing curseId (Task 29, Req 2.3)', () => {
      const invalid = {
        grant: {
          wishId: 'w1',
          narration: 'Granted.',
          curses: [
            {
              id: 'c1',
              type: 'permissions' as const,
              story: 'Story',
              loophole: 'loophole words',
              status: 'open' as const,
            },
            {
              id: 'c2',
              type: 'time' as const,
              story: 'Story 2',
              loophole: 'loophole 2',
              status: 'open' as const,
            },
            {
              id: 'c3',
              type: 'money' as const,
              story: 'Story 3',
              loophole: 'loophole 3',
              status: 'open' as const,
            },
          ],
        },
        kind: 'rewrite' as const,
        clause: 'Some clause',
      };
      expect(BindRequestSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('ExportRequestSchema', () => {
    it('accepts valid export request (Task 18)', () => {
      const valid = {
        wish: {
          id: 'w1',
          text: 'Only admins can delete projects',
          createdAt: Date.now(),
        },
        grant: {
          wishId: 'w1',
          narration: 'Granted.',
          curses: [
            {
              id: 'c1',
              type: 'permissions' as const,
              story: 'Story',
              loophole: 'loophole words',
              status: 'open' as const,
            },
            {
              id: 'c2',
              type: 'time' as const,
              story: 'Story 2',
              loophole: 'loophole 2',
              status: 'open' as const,
            },
            {
              id: 'c3',
              type: 'money' as const,
              story: 'Story 3',
              loophole: 'loophole 3',
              status: 'open' as const,
            },
          ],
        },
      };
      expect(ExportRequestSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects malformed grant (Task 33, Req 3.3)', () => {
      const invalid = {
        wish: {
          id: 'w1',
          text: 'Only admins can delete projects',
          createdAt: Date.now(),
        },
        grant: {
          // Missing narration
          wishId: 'w1',
          curses: [],
        },
      };
      expect(ExportRequestSchema.safeParse(invalid).success).toBe(false);
    });
  });
});
