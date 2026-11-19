// @vitest-environment jsdom
// useDialogFocus: opener restore, the Chrome close-watcher guard and "our own close dispatches nothing". jsdom has no
// showModal and no inert page, so both are stubbed here. The real focus trap is verified in Playwright (tasks 42-43).

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDialogFocus } from './use-dialog-focus';

interface HarnessProps {
  readonly open: boolean;
  readonly locked?: boolean;
  readonly onCancel: () => void;
}

function Harness({ open, locked = false, onCancel }: HarnessProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useDialogFocus(ref, { open, locked, onCancel });
  return (
    <dialog ref={ref} aria-label="Test dialog">
      {open && <input aria-label="First" />}
      {open && <button type="button">Second</button>}
    </dialog>
  );
}

const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});
// Like the browser, `close` ends with a `close` event (here at once; the browser queues it).
const close = vi.fn(function (this: HTMLDialogElement) {
  if (!this.hasAttribute('open')) return;
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
});

const dialogNode = (container: HTMLElement): HTMLDialogElement =>
  container.querySelector('dialog') as HTMLDialogElement;

function pressEscape(target: HTMLElement): Event {
  const event = new Event('cancel', { cancelable: true });
  fireEvent(target, event);
  return event;
}

beforeEach(() => {
  showModal.mockClear();
  close.mockClear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  document.body.innerHTML = '';
});

/** An opener button outside the dialog, focused, as a clicked circle would be. */
function addOpener(): HTMLButtonElement {
  const opener = document.createElement('button');
  opener.textContent = 'Opener';
  document.body.append(opener);
  opener.focus();
  return opener;
}

describe('useDialogFocus: opening', () => {
  it('opens with showModal and puts focus on the first control', () => {
    const { container } = render(<Harness open onCancel={() => {}} />);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialogNode(container).hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('First'));
  });

  it('falls back to the open attribute where showModal is missing', () => {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    const { container, rerender } = render(<Harness open onCancel={() => {}} />);
    expect(dialogNode(container).hasAttribute('open')).toBe(true);
    rerender(<Harness open={false} onCancel={() => {}} />);
    expect(dialogNode(container).hasAttribute('open')).toBe(false);
  });

  it('does not open a dialog that is closed by the parent', () => {
    const { container } = render(<Harness open={false} onCancel={() => {}} />);
    expect(showModal).not.toHaveBeenCalled();
    expect(dialogNode(container).hasAttribute('open')).toBe(false);
  });
});

describe('useDialogFocus: the opener', () => {
  it('focuses the opener again when the parent closes the dialog', () => {
    const opener = addOpener();
    const { rerender } = render(<Harness open={false} onCancel={() => {}} />);
    rerender(<Harness open onCancel={() => {}} />);
    expect(document.activeElement).not.toBe(opener);
    rerender(<Harness open={false} onCancel={() => {}} />);
    expect(document.activeElement).toBe(opener);
  });

  it('skips an opener that left the document', () => {
    const opener = addOpener();
    const focus = vi.spyOn(opener, 'focus');
    const { rerender } = render(<Harness open={false} onCancel={() => {}} />);
    rerender(<Harness open onCancel={() => {}} />);
    opener.remove();
    rerender(<Harness open={false} onCancel={() => {}} />);
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(opener);
  });

  it('restores the opener on a StrictMode double effect run and on the real close', () => {
    const opener = addOpener();
    const { rerender } = render(
      <StrictMode>
        <Harness open={false} onCancel={() => {}} />
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Harness open onCancel={() => {}} />
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Harness open={false} onCancel={() => {}} />
      </StrictMode>,
    );
    expect(document.activeElement).toBe(opener);
  });
});

describe('useDialogFocus: Escape', () => {
  it('routes cancel to onCancel and stops the browser closing the dialog', () => {
    const onCancel = vi.fn();
    const { container } = render(<Harness open onCancel={onCancel} />);
    const event = pressEscape(dialogNode(container));
    expect(event.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while locked, and still prevents the browser close', () => {
    const onCancel = vi.fn();
    const { container } = render(<Harness open locked onCancel={onCancel} />);
    const event = pressEscape(dialogNode(container));
    expect(event.defaultPrevented).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('useDialogFocus: a browser-initiated close (Chrome close watcher)', () => {
  it('calls onCancel once when the dialog closed by itself and the parent still has it open', () => {
    const onCancel = vi.fn();
    const { container } = render(<Harness open onCancel={onCancel} />);
    dialogNode(container).close();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  it('reopens the dialog and puts focus back inside while locked, dispatching nothing', () => {
    const onCancel = vi.fn();
    const { container } = render(<Harness open locked onCancel={onCancel} />);
    const node = dialogNode(container);
    (document.activeElement as HTMLElement | null)?.blur();
    node.close();
    expect(onCancel).not.toHaveBeenCalled();
    expect(showModal).toHaveBeenCalledTimes(2);
    expect(node.hasAttribute('open')).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('First'));
  });

  it('follows the lock as it changes: reopens while locked, then cancels once the Judge is done', () => {
    const onCancel = vi.fn();
    const { container, rerender } = render(<Harness open locked onCancel={onCancel} />);
    const node = dialogNode(container);
    node.close();
    expect(onCancel).not.toHaveBeenCalled();
    rerender(<Harness open locked={false} onCancel={onCancel} />);
    node.close();
    expect(onCancel).toHaveBeenCalledTimes(1);
    // The dialog was never closed and reopened by a change of the lock itself.
    expect(showModal).toHaveBeenCalledTimes(2);
  });

  it('dispatches nothing when our own close happens (card becomes null)', () => {
    const onCancel = vi.fn();
    const { container, rerender } = render(<Harness open onCancel={onCancel} />);
    rerender(<Harness open={false} onCancel={onCancel} />);
    expect(close).toHaveBeenCalledTimes(1);
    expect(dialogNode(container).hasAttribute('open')).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('ignores a late close event of our own close when the dialog was reopened at once (StrictMode)', async () => {
    const onCancel = vi.fn();
    // A browser queues the `close` event, so it arrives after the effect has run again.
    const lateClose = vi.fn(function (this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return;
      this.removeAttribute('open');
      queueMicrotask(() => this.dispatchEvent(new Event('close')));
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: lateClose });
    const { container } = render(
      <StrictMode>
        <Harness open onCancel={onCancel} />
      </StrictMode>,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(lateClose).toHaveBeenCalled();
    expect(dialogNode(container).hasAttribute('open')).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
