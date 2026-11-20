// Timing helpers (paw-web task 42). The product exposes nothing on `window`, so the tests inject a recorder of their
// own with `page.addInitScript`. It watches the DOM with a MutationObserver and logs every change of the nodes the
// tests care about, with `performance.now()` taken when the change was committed. Nothing in the product is changed.
//
// What the log can see is what a user can see: the circles (`data-status` and the button's `aria-label`), the finger
// text (`[data-paw-state-text]`), the live region, the stamp, the medal, the Stop and export controls, the binding
// card and whether the poster is hidden (the 3D canvas has taken over).

import type { Page } from '@playwright/test';

export interface TimelineEvent {
  /** `performance.now()` in the page when the change was observed (the commit, not the next paint). */
  readonly t: number;
  /** The watched node, for example `circle.2`, `medal`, `live`. `mark` is a label the test wrote. */
  readonly key: string;
  readonly value: string;
  readonly prev: string;
}

interface TimelineWindow {
  __pawTimeline?: TimelineEvent[];
}

/** Runs in the page, before the app. Self-contained: it must not use anything from this module. */
function installRecorder(): void {
  const host = window as unknown as TimelineWindow;
  if (host.__pawTimeline !== undefined) return;
  const log: TimelineEvent[] = [];
  host.__pawTimeline = log;
  const last = new Map<string, string>();

  const clean = (text: string | null | undefined): string =>
    (text ?? '').replace(/\u200B/g, '').replace(/\s+/g, ' ').trim();

  function snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < 5; i += 1) {
      const slot = document.querySelector(`li[data-index="${i}"]`);
      const label = slot?.querySelector('button')?.getAttribute('aria-label') ?? '';
      out[`circle.${i}`] = slot === null ? 'absent' : `${slot.getAttribute('data-status') ?? ''}|${label}`;
      out[`circle.${i}.remembers`] =
        slot !== null && clean(slot.textContent).includes('The paw remembers.') ? 'yes' : '';
    }
    out['stateText'] = clean(document.querySelector('[data-paw-state-text]')?.textContent);
    out['fingerCue'] = clean(document.querySelector('[data-paw-finger-cue]')?.textContent);
    // Raw text: a repeated announcement toggles a zero-width space, and that is a new announcement.
    out['live'] = (document.querySelector('[data-live-region]')?.textContent ?? '').replace(/\u200B/g, '<zwsp>');
    const stamp = document.querySelector('[data-stamp]');
    out['stamp'] = stamp === null ? '' : `${clean(stamp.textContent)}#${stamp.getAttribute('data-stamp-seq') ?? ''}`;
    out['narration'] = clean(document.querySelector('[data-narration]')?.textContent);
    const medal = document.querySelector('[data-medal]');
    out['medal'] =
      medal === null ? '' : `${medal.getAttribute('data-score') ?? ''}|${clean(medal.querySelector('p')?.textContent)}`;
    out['stop'] = document.querySelector('button[aria-label="Stop and take the scroll"]') === null ? '' : 'shown';
    out['export'] = Array.from(document.querySelectorAll('[data-slot="export"] button'))
      .map((button) => clean(button.textContent))
      .join(',');
    out['exportStatus'] = clean(document.querySelector('[data-slot="export"] [role="status"]')?.textContent);
    out['rewrite'] = Array.from(document.querySelectorAll('main button')).some(
      (button) => clean(button.textContent) === 'Rewrite' && button.closest('dialog') === null,
    )
      ? 'shown'
      : '';
    const dialog = document.querySelector('dialog[open]');
    out['dialog'] = dialog === null ? '' : clean(dialog.querySelector('h2')?.textContent) || 'open';
    out['dialog.remembers'] = dialog !== null && clean(dialog.textContent).includes('The paw remembers.') ? 'yes' : '';
    out['dialog.judging'] = dialog !== null && clean(dialog.textContent).includes('The Judge stirs') ? 'yes' : '';
    const poster = document.querySelector('[data-poster]');
    out['poster'] = poster === null ? 'absent' : getComputedStyle(poster).visibility;
    out['canvas'] = document.querySelector('[data-canvas-slot] canvas') === null ? '' : 'mounted';
    return out;
  }

  function record(): void {
    const t = performance.now();
    const now = snapshot();
    for (const key of Object.keys(now)) {
      const value = now[key] ?? '';
      const prev = last.get(key);
      if (prev === value) continue;
      last.set(key, value);
      // The first sight of a key that is still empty is not a change.
      if (prev === undefined && (value === '' || value === 'absent')) continue;
      log.push({ t, key, value, prev: prev ?? '' });
    }
  }

  new MutationObserver(record).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  document.addEventListener('DOMContentLoaded', record);
  window.addEventListener('load', record);
}

/** Installs the recorder. Call it before the first `goto`. */
export async function installTimeline(page: Page): Promise<void> {
  await page.addInitScript(installRecorder);
}

/** A copy of the whole log so far. */
export async function readTimeline(page: Page): Promise<TimelineEvent[]> {
  return page.evaluate(() => [...((window as unknown as TimelineWindow).__pawTimeline ?? [])]);
}

/** Writes a label into the log at the current time, so a test can measure from its own action. Returns the time. */
export async function markTimeline(page: Page, label: string): Promise<number> {
  return page.evaluate((text) => {
    const host = window as unknown as TimelineWindow;
    const log = (host.__pawTimeline ??= []);
    const t = performance.now();
    log.push({ t, key: 'mark', value: text, prev: '' });
    return t;
  }, label);
}

/** The events of one key, in order. */
export function eventsOf(events: readonly TimelineEvent[], key: string): TimelineEvent[] {
  return events.filter((event) => event.key === key);
}

/** The first event of `key` at or after index `from` of `events` whose value satisfies `test`. */
export function firstEvent(
  events: readonly TimelineEvent[],
  key: string,
  test: (value: string) => boolean = () => true,
  from = 0,
): TimelineEvent | undefined {
  return events.slice(from).find((event) => event.key === key && test(event.value));
}

/** Like `firstEvent`, but throws a readable error: a missing event is a failed test. */
export function requireEvent(
  events: readonly TimelineEvent[],
  key: string,
  test: (value: string) => boolean = () => true,
  from = 0,
): TimelineEvent {
  const found = firstEvent(events, key, test, from);
  if (found === undefined) {
    const seen = eventsOf(events, key).map((event) => `${event.t.toFixed(0)}:${event.value}`);
    throw new Error(`No timeline event for "${key}". Seen: ${seen.join(' | ') || '(none)'}`);
  }
  return found;
}

/** The status part of a `circle.N` value (`arriving`, `open`, `closed`, `open-final`, `empty`, `absent`). */
export function statusOf(value: string): string {
  return value.split('|')[0] ?? '';
}
