// A polite status line's text. A screen reader announces a change of the DOM text, so when the same line is said twice
// ("Copied." for two fields) a zero-width mark is toggled to make the text differ, as `LiveRegion` does.

import { useCallback, useState } from 'react';
import { LIVE_REPEAT_MARK } from '../components/LiveRegion';

export function useStatusLine(): readonly [text: string, say: (line: string) => void] {
  // `marked` starts true so the first line is shown without the mark.
  const [state, setState] = useState({ text: '', marked: true });
  const say = useCallback((line: string): void => {
    // Clearing does not flip the mark: the next line then starts from the state the last one left.
    setState((previous) => ({ text: line, marked: line === '' ? previous.marked : !previous.marked }));
  }, []);
  const shown = state.text !== '' && state.marked ? `${state.text}${LIVE_REPEAT_MARK}` : state.text;
  return [shown, say];
}
