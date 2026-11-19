import type { Curse, Grant } from 'paw-core';
import { parseHandle, toHandle } from './handle';

export const MAX_REMEMBERED_GRANTS = 20;

export interface ResolvedCurse {
  grant: Grant;
  curse: Curse;
  handle: string;
}

export interface GrantMemory {
  /** Store a grant and make it the newest. Evicts the oldest beyond the limit. */
  remember(grant: Grant): void;
  /** A full handle matches exactly (newest grant first); a bare curse id uses the newest grant only. */
  resolve(text: string): ResolvedCurse | null;
  size(): number;
}

/** Handles of the grant's curses that are still open. */
export function openHandles(grant: Grant): string[] {
  return grant.curses.filter((c) => c.status === 'open').map((c) => toHandle(grant.wishId, c.id));
}

/** Agents may copy a handle with its brackets or quotes. Strip one surrounding pair. */
function cleanReference(text: string): string {
  const trimmed = text.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const wrapped = (first === '[' && last === ']') || (first === '"' && last === '"') || (first === "'" && last === "'");
  return trimmed.length >= 2 && wrapped ? trimmed.slice(1, -1).trim() : trimmed;
}

/** In-process store only. Holds no timers and writes nothing. */
export function createGrantMemory(max: number = MAX_REMEMBERED_GRANTS): GrantMemory {
  const grants = new Map<string, Grant>();

  const newestFirst = (): Grant[] => Array.from(grants.values()).reverse();

  return {
    remember(grant) {
      grants.delete(grant.wishId);
      grants.set(grant.wishId, grant);
      while (grants.size > max) {
        const oldest = grants.keys().next();
        if (oldest.done) break;
        grants.delete(oldest.value);
      }
    },
    resolve(raw) {
      const text = cleanReference(raw);
      const parsed = parseHandle(text);
      if (parsed) {
        for (const grant of newestFirst()) {
          if (!grant.wishId.startsWith(parsed.prefix)) continue;
          const curse = grant.curses.find((c) => c.id === parsed.curseId);
          if (curse) return { grant, curse, handle: toHandle(grant.wishId, curse.id) };
        }
        return null;
      }
      const newest = newestFirst()[0];
      if (!newest) return null;
      const curse = newest.curses.find((c) => c.id === text);
      return curse ? { grant: newest, curse, handle: toHandle(newest.wishId, curse.id) } : null;
    },
    size: () => grants.size,
  };
}
