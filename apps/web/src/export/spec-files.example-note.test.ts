// The example note in both files and in both zips (paw-web Req 13.12).

import { describe, expect, it } from 'vitest';
import type { SpecExport } from 'paw-core';
import { buildFolderZip, buildScrollZip, withExampleNote } from './spec-files';

const NOTE = 'The paw recites an example.';
const spec = { wishId: 'w1', requirementsMd: '# Title\n\nBody\n', propertiesMd: 'No title here\n' } as unknown as SpecExport;
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('withExampleNote', () => {
  it('puts the note directly under the title, or at the top when there is none', () => {
    const out = withExampleNote(spec, NOTE);
    expect(out.requirementsMd).toBe(`# Title\n\n> ${NOTE}\n\nBody\n`);
    expect(out.propertiesMd).toBe(`> ${NOTE}\n\nNo title here\n`);
  });

  it('does not change its input', () => {
    withExampleNote(spec, NOTE);
    expect(spec.requirementsMd).toBe('# Title\n\nBody\n');
  });

  it('reaches both zips', () => {
    const noted = withExampleNote(spec, NOTE);
    for (const bytes of [buildScrollZip(noted), buildFolderZip('folder', noted)]) {
      expect(text(bytes).split(`> ${NOTE}`)).toHaveLength(3);
    }
  });
});
