// @vitest-environment jsdom
// The error boundary around the lazy scene: a scene that throws leaves nothing behind, calls onFailure once,
// and the rest of the page keeps working.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PawSceneBoundary } from './PawSceneBoundary';

beforeEach(() => {
  // React logs the caught error; the test provokes it on purpose.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Boom(): never {
  throw new Error('scene boom');
}

describe('PawSceneBoundary', () => {
  it('renders its children while nothing throws, and does not call onFailure', () => {
    const onFailure = vi.fn();
    render(
      <PawSceneBoundary onFailure={onFailure}>
        <p>the scene</p>
      </PawSceneBoundary>,
    );
    expect(screen.getByText('the scene')).not.toBeNull();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('renders nothing and calls onFailure once when a child throws', () => {
    const onFailure = vi.fn();
    const { container } = render(
      <PawSceneBoundary onFailure={onFailure}>
        <Boom />
      </PawSceneBoundary>,
    );
    expect(container.innerHTML).toBe('');
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('keeps the rest of the app working next to a failed scene', () => {
    function App() {
      const [count, setCount] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setCount((n) => n + 1)}>
            wishes {count}
          </button>
          <PawSceneBoundary onFailure={() => undefined}>
            <Boom />
          </PawSceneBoundary>
        </>
      );
    }
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'wishes 0' }));
    expect(screen.getByRole('button', { name: 'wishes 1' })).not.toBeNull();
  });
});
