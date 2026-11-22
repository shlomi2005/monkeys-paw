// What "Take the scroll" and "Open in Kiro" put in their zips, and the names around them (design.md section 6,
// "Export"). Pure: the caller passes the server's SpecExport and the wish text.

import type { SpecExport } from 'paw-core';
import { safeId, slugify } from './slug';
import { buildZip } from './zip';
import type { ZipEntry } from './zip';

const now = (): Date => new Date();

function filesOf(spec: SpecExport, prefix: string): ZipEntry[] {
  return [
    { name: `${prefix}requirements.md`, content: spec.requirementsMd },
    { name: `${prefix}properties.md`, content: spec.propertiesMd },
  ];
}

/** `monkeys-paw-<safeId(wishId)>.zip`, the file "Take the scroll" saves. */
export function scrollFileName(wishId: string): string {
  return `monkeys-paw-${safeId(wishId)}.zip`;
}

/** The zip "Take the scroll" saves: `requirements.md` and `properties.md` at the top level. */
export function buildScrollZip(spec: SpecExport, clock: () => Date = now): Uint8Array {
  return buildZip(filesOf(spec, ''), clock);
}

/** `monkeys-paw-<slug>`, the folder to drop into `.kiro/specs/`. The slug comes from the wish text. */
export function specFolderName(wishText: string): string {
  return `monkeys-paw-${slugify(wishText)}`;
}

/** The command that opens the folder in Kiro. */
export function kiroCommand(folder: string): string {
  return `kiro open ${folder}`;
}

/** The zip "Open in Kiro" offers: both files inside the folder `<folder>/`. */
export function buildFolderZip(folder: string, spec: SpecExport, clock: () => Date = now): Uint8Array {
  return buildZip(filesOf(spec, `${folder}/`), clock);
}

/** Puts the example note as a quoted paragraph right under each file's title (or at the top). Pure. */
export function withExampleNote(spec: SpecExport, note: string): SpecExport {
  const put = (md: string): string => {
    const lines = md.split('\n');
    const at = lines.findIndex((line) => line.startsWith('# '));
    if (at < 0) return `> ${note}\n\n${md}`;
    const after = lines[at + 1];
    lines.splice(at + 1, 0, '', `> ${note}`, ...(after === undefined || after === '' ? [] : ['']));
    return lines.join('\n');
  };
  return { ...spec, requirementsMd: put(spec.requirementsMd), propertiesMd: put(spec.propertiesMd) };
}
