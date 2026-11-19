/** The slice of a canvas this probe uses. `HTMLCanvasElement` satisfies it. */
export interface ProbeCanvas {
  getContext(id: string): unknown;
}

interface LoseContextExtension {
  loseContext(): void;
}

interface ProbeContext {
  getExtension?(name: string): unknown;
}

function defaultCreateCanvas(): ProbeCanvas {
  return document.createElement('canvas');
}

/** True when a WebGL2 or WebGL1 context can be created. Never throws. */
export function hasWebGL(createCanvas: () => ProbeCanvas = defaultCreateCanvas): boolean {
  try {
    const canvas = createCanvas();
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as ProbeContext | null;
    if (!gl) return false;
    try {
      // Release the probe context so it does not count against the browser's context limit.
      const lose = gl.getExtension?.('WEBGL_lose_context') as LoseContextExtension | null | undefined;
      lose?.loseContext();
    } catch {
      // A context that exists but cannot be released is still a working context.
    }
    return true;
  } catch {
    return false;
  }
}
