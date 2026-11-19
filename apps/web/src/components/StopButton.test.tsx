// @vitest-environment jsdom
// StopButton: the visibility rules go through real PawContext fixtures and selectView, so the selector and the
// component are tested together. Plus the stylesheet rules.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../state/paw-machine';
import type { PawContext } from '../state/paw-machine-types';
import { selectView } from '../state/paw-selectors';
import { declarationsFor, parseCss, readText } from '../styles/css-test-support';
import { closeCurse, curling, drain, granting, ready, send } from './round-end-test-support';
import { StopButton } from './StopButton';

afterEach(cleanup);

function renderFor(ctx: PawContext, onStop = vi.fn()) {
  const view = render(<StopButton show={selectView(ctx).showStop} onStop={onStop} />);
  return { onStop, ...view };
}

const stop = (): HTMLElement | null => screen.queryByRole('button', { name: 'Stop and take the scroll' });

describe('StopButton visibility', () => {
  it('is hidden with no Grant', () => {
    const { container } = renderFor(initialState(false));
    expect(stop()).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('is hidden while the Grant is still being requested', () => {
    renderFor(granting());
    expect(stop()).toBeNull();
  });

  it('is shown with a Grant and open curses, while the curls run', () => {
    renderFor(curling(3));
    expect(stop()).not.toBeNull();
  });

  it('is shown with a Grant and an open curse, once the round is ready', () => {
    renderFor(ready(3));
    expect(stop()).not.toBeNull();
  });

  it('stays shown while one curse is open and the others are closed', () => {
    let ctx = ready(3);
    ctx = drain(closeCurse(ctx, 0));
    ctx = drain(closeCurse(ctx, 1));
    expect(ctx.phase).toBe('ready');
    renderFor(ctx);
    expect(stop()).not.toBeNull();
  });

  it('is shown while the binding card is open and while the Judge weighs a clause', () => {
    const binding = send(ready(3), { type: 'circle_activated', index: 0 });
    expect(binding.phase).toBe('binding');
    renderFor(binding);
    expect(stop()).not.toBeNull();
    cleanup();

    const judging = send(binding, { type: 'bind_submitted', kind: 'ears-clause', clause: 'The system shall.' });
    expect(judging.phase).toBe('judging');
    renderFor(judging);
    expect(stop()).not.toBeNull();
  });

  it('is hidden when every curse is closed, also while the paw is still lying down', () => {
    let ctx = ready(3);
    for (const index of [0, 1, 2]) ctx = closeCurse(ctx, index);
    expect(ctx.phase).toBe('ended');
    expect(ctx.anim.active).not.toBeNull();
    renderFor(ctx);
    expect(stop()).toBeNull();
    cleanup();

    renderFor(drain(ctx));
    expect(stop()).toBeNull();
  });

  it('is hidden after the end by a stop', () => {
    const stopped = send(ready(4), { type: 'stop' });
    expect(stopped.phase).toBe('ended');
    expect(stopped.endReason).toBe('stopped');
    renderFor(stopped);
    expect(stop()).toBeNull();
  });

  it('is hidden again after a rewrite', () => {
    renderFor(send(ready(3), { type: 'rewrite' }));
    expect(stop()).toBeNull();
  });
});

describe('StopButton control', () => {
  it('is a real button of type "button" with the label as its name', () => {
    renderFor(ready(3));
    const button = stop() as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Stop and take the scroll');
    expect(button.textContent).toBe('Stop and take the scroll');
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('tabindex')).toBeNull();
  });

  it('calls onStop once per click', () => {
    const { onStop } = renderFor(ready(3));
    fireEvent.click(stop() as HTMLElement);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('hides when the show prop turns false', () => {
    const onStop = vi.fn();
    const { rerender } = render(<StopButton show onStop={onStop} />);
    expect(stop()).not.toBeNull();
    rerender(<StopButton show={false} onStop={onStop} />);
    expect(stop()).toBeNull();
  });
});

describe('StopButton stylesheet', () => {
  const raw = readText('./StopButton.module.css', import.meta.url);
  const css = parseCss(raw);

  it('keeps a 48 px hit area and an ink control border', () => {
    const rule = declarationsFor(css, '.stop', null);
    expect(rule['min-height']).toBe('3rem');
    expect(rule['min-width']).toBe('48px');
    expect(rule['border']).toBe('var(--control-border-width) solid var(--control-border-color)');
  });

  it('uses the focus ring token', () => {
    const rule = declarationsFor(css, '.stop:focus-visible', null);
    expect(rule['outline']).toBe('var(--focus-ring-width) solid var(--focus-ring-color)');
    expect(rule['outline-offset']).toBe('var(--focus-ring-offset)');
  });

  it('puts every :hover rule inside (hover: hover)', () => {
    const hover = css.filter((rule) => rule.selector.includes(':hover'));
    expect(hover.length).toBeGreaterThan(0);
    for (const rule of hover) expect(rule.media).toBe('(hover: hover)');
  });

  it('never sets text below 1rem', () => {
    const sizes = raw.match(/font-size:\s*[^;]+/g) ?? [];
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size).toMatch(/rem\s*$/);
      expect(Number.parseFloat(size.replace(/font-size:\s*/, ''))).toBeGreaterThanOrEqual(1);
    }
  });

  it('times its transition with a duration token', () => {
    expect(raw).not.toMatch(/transition:[^;]*\d+m?s/);
  });
});
