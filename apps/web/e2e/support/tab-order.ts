// Tab order against visual order (paw-web design.md A12, "Focus order"). The walk uses real Tab presses and reads what
// has focus after each one. It never moves focus by script, apart from the very first step: a click in the top-left
// corner of the plate, which is how a browser sets the starting point of sequential focus navigation to the start of the
// page (the corner holds only decoration).

import type { Page } from '@playwright/test';

export interface TabStop {
  /** `tag:name`, where the name is the aria-label, or else the text. */
  readonly name: string;
  /** Position on the page, in CSS pixels, read after the whole walk (the scroll position does not matter). */
  readonly top: number;
  readonly left: number;
}

const MARK = 'data-tab-walk';

/**
 * Presses Tab until focus leaves the page or comes back to a stop already seen, and returns the stops in the order they
 * were reached. At most `limit` presses. The marks it puts on the elements are removed at the end.
 */
export async function walkTabStops(page: Page, limit = 40): Promise<TabStop[]> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.click(2, 2);
  const names: string[] = [];
  for (let press = 0; press < limit; press += 1) {
    await page.keyboard.press('Tab');
    const reached = await page.evaluate(
      ([mark, index]) => {
        const element = document.activeElement;
        if (element === null || element === document.body || element === document.documentElement) return 'left';
        if (element.hasAttribute(mark!)) return 'again';
        element.setAttribute(mark!, String(index));
        const label = element.getAttribute('aria-label');
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        return `${element.tagName.toLowerCase()}:${label ?? text}`;
      },
      [MARK, press] as const,
    );
    if (reached === 'left' || reached === 'again') break;
    names.push(reached);
  }
  const positions = await page.evaluate((mark) => {
    const found: { index: number; top: number; left: number }[] = [];
    for (const element of document.querySelectorAll(`[${mark}]`)) {
      const rect = element.getBoundingClientRect();
      found.push({ index: Number(element.getAttribute(mark)), top: rect.top + window.scrollY, left: rect.left + window.scrollX });
      element.removeAttribute(mark);
    }
    return found;
  }, MARK);
  return names.map((name, index) => {
    const at = positions.find((position) => position.index === index);
    if (at === undefined) throw new Error(`tab stop ${index} (${name}) has no position`);
    return { name, top: at.top, left: at.left };
  });
}

/** The same stops sorted the way a reader sees them: top to bottom (to the pixel), then left to right. */
export function inVisualOrder(stops: readonly TabStop[]): TabStop[] {
  return [...stops].sort((a, b) => Math.round(a.top) - Math.round(b.top) || a.left - b.left);
}

export const namesOf = (stops: readonly TabStop[]): string[] => stops.map((stop) => stop.name);
