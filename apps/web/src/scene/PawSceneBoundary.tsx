import { Component } from 'react';
import type { ReactNode } from 'react';

export interface PawSceneBoundaryProps {
  /** Called once when anything below throws: a render error, a GLB load error or a failed chunk import. */
  readonly onFailure: () => void;
  readonly children?: ReactNode;
}

interface PawSceneBoundaryState {
  readonly failed: boolean;
}

/**
 * Keeps a broken scene from taking the page down. On failure it renders nothing, so the poster stays the only
 * paw picture, and the rest of the app keeps working. No three import: it lives in the entry chunk.
 */
export class PawSceneBoundary extends Component<PawSceneBoundaryProps, PawSceneBoundaryState> {
  override state: PawSceneBoundaryState = { failed: false };

  static getDerivedStateFromError(): PawSceneBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.onFailure();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
