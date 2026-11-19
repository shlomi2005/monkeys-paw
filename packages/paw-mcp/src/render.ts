import type { Grant, Verdict } from 'paw-core';
import { openHandles } from './grant-memory';
import { toHandle } from './handle';

export interface CurseView {
  handle: string;
  id: string;
  type: string;
  status: 'open' | 'closed';
  story: string;
  loophole: string;
}

export function curseViews(grant: Grant): CurseView[] {
  return grant.curses.map((c) => ({
    handle: toHandle(grant.wishId, c.id),
    id: c.id,
    type: c.type,
    status: c.status,
    story: c.story,
    loophole: c.loophole,
  }));
}

/** Plain text for `paw_curse`. Ends with one line that shows how to call `paw_bind`. */
export function renderCurses(grant: Grant): string {
  const views = curseViews(grant);
  const lines = [`The paw grants it. ${views.length} loopholes:`];
  for (const v of views) {
    lines.push(`[${v.handle}] ${v.type}: ${v.story}`);
    lines.push(`  Loophole: ${v.loophole}`);
  }
  const first = views[0];
  if (first) {
    lines.push(
      `Close one: paw_bind(curse="${first.handle}", amendment="WHEN ... THE SYSTEM SHALL ...")`,
    );
  }
  return lines.join('\n');
}

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Plain text for `paw_bind`. `grant` is the updated grant returned by the API. */
export function renderVerdict(verdict: Verdict, grant: Grant): string {
  if (!verdict.closed) {
    return `OPEN: ${sentence(verdict.reason)} The loophole remains. Rewrite the amendment and call paw_bind again.`;
  }
  const lines = [`CLOSED: ${verdict.reason.trim()}`];
  if (verdict.property) lines.push(`Property: ${verdict.property}`);
  const open = openHandles(grant);
  lines.push(`Still open: ${open.length > 0 ? open.map((h) => `[${h}]`).join(', ') : 'none'}`);
  return lines.join('\n');
}

export interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function textResult(text: string, structuredContent?: Record<string, unknown>): ToolResult {
  return structuredContent
    ? { content: [{ type: 'text', text }], structuredContent }
    : { content: [{ type: 'text', text }] };
}

/** Every failure is a result with `isError: true` and one plain sentence. */
export function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
