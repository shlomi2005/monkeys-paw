// P17, zip round trip (design.md "Correctness Properties"). Written before the writer (task 17).
//
// `fflate` is a test-only dependency: it reads what `zip.ts` writes. Its CRC-32 is taken from the
// gzip trailer it produces for the same bytes, so the checksum is verified independently of
// `zip.ts`. The central directory is parsed here to check method, flags, sizes and timestamps.

import * as fc from 'fast-check';
import { gzipSync, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { numRuns } from '../state/arbitraries';
import { safeId, slugify } from './slug';
import { buildZip } from './zip';
import type { ZipEntry } from './zip';

const ENCODER = new TextEncoder();
const FIXED_CLOCK = (): Date => new Date(2024, 4, 17, 13, 45, 30);

// ---------------------------------------------------------------------------
// ZIP reading helpers (test only)
// ---------------------------------------------------------------------------

interface CentralEntry {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly size: number;
}

function readCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.byteLength - 22; // no archive comment
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: CentralEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    entries.push({
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      dosTime: view.getUint16(offset + 12, true),
      dosDate: view.getUint16(offset + 14, true),
      crc32: view.getUint32(offset + 16, true),
      compressedSize: view.getUint32(offset + 20, true),
      size: view.getUint32(offset + 24, true),
      name: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** CRC-32 of `data`, read from the trailer fflate writes for gzip (CRC-32, then ISIZE, both little endian). */
function crc32Of(data: Uint8Array): number {
  const gz = gzipSync(data);
  return new DataView(gz.buffer, gz.byteOffset, gz.byteLength).getUint32(gz.byteLength - 8, true);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Non-empty Unicode names that do not end with `/` (fflate reads those as folders), are not
 * `__proto__` (fflate returns a plain object, where that key sets the prototype instead of an entry;
 * the writer is fine, see the `__proto__` example test below) and do not start with U+FEFF (fflate
 * decodes names with a `TextDecoder` that strips a leading byte order mark, so the oracle returns the
 * name without it; the writer is fine, see the BOM example test below).
 */
const arbName = fc
  .fullUnicodeString({ minLength: 1, maxLength: 40 })
  .filter((name) => !name.endsWith('/') && name !== '__proto__' && !name.startsWith('\uFEFF'));

const arbFiles: fc.Arbitrary<ZipEntry[]> = fc.uniqueArray(
  fc.record({ name: arbName, content: fc.fullUnicodeString({ maxLength: 300 }) }),
  { maxLength: 6, selector: (file) => file.name },
);

const arbText = fc.oneof(
  fc.fullUnicodeString({ maxLength: 120 }),
  fc.string16bits({ maxLength: 120 }), // includes lone surrogates
  fc.string({ maxLength: 120 }),
  fc.string({ minLength: 100, maxLength: 400 }),
);

// ---------------------------------------------------------------------------
// P17
// ---------------------------------------------------------------------------

/** The round trip of P17: fflate returns the same names and the same bytes. */
function unzipReturnsSameFiles(files: ZipEntry[]): void {
  const unzipped = unzipSync(buildZip(files, FIXED_CLOCK));
  expect(Object.keys(unzipped).sort()).toEqual(files.map((f) => f.name).sort());
  for (const file of files) {
    expect(unzipped[file.name]).toEqual(ENCODER.encode(file.content));
  }
}

describe('P17: zip round trip', () => {
  it('unzipping the output with fflate returns the same files', () => {
    fc.assert(fc.property(arbFiles, unzipReturnsSameFiles), { numRuns: numRuns() });
  });

  // Seed 1540874629 once failed on a name that started with U+FEFF (shrunk to "\uFEFF "). Kept as a fixed run.
  it('unzipping the output with fflate returns the same files (seed 1540874629)', () => {
    fc.assert(fc.property(arbFiles, unzipReturnsSameFiles), { seed: 1540874629, numRuns: 300 });
  });

  it('writes a valid CRC-32, stored sizes, method 0 and UTF-8 names for every file', () => {
    fc.assert(
      fc.property(arbFiles, (files) => {
        const entries = readCentralDirectory(buildZip(files, FIXED_CLOCK));
        expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
        entries.forEach((entry, i) => {
          const data = ENCODER.encode(files[i]?.content ?? '');
          expect(entry.crc32).toBe(crc32Of(data));
          expect(entry.method).toBe(0);
          expect(entry.size).toBe(data.byteLength);
          expect(entry.compressedSize).toBe(data.byteLength);
          expect(entry.flags & 0x0800).toBe(0x0800);
        });
      }),
      { numRuns: numRuns() },
    );
  });

  it('is deterministic for the same files and clock', () => {
    fc.assert(
      fc.property(arbFiles, (files) => {
        expect(buildZip(files, FIXED_CLOCK)).toEqual(buildZip(files, FIXED_CLOCK));
      }),
      { numRuns: numRuns() },
    );
  });
});

describe('P17: slugify', () => {
  it('always matches ^[a-z0-9-]{1,32}$', () => {
    fc.assert(
      fc.property(arbText, (text) => {
        expect(slugify(text)).toMatch(/^[a-z0-9-]{1,32}$/);
      }),
      { numRuns: numRuns() },
    );
  });
});

describe('P17: safeId', () => {
  it('always matches ^[A-Za-z0-9-]{1,64}$ (no slash, backslash, dot or whitespace)', () => {
    fc.assert(
      fc.property(arbText, (id) => {
        const result = safeId(id);
        expect(result).toMatch(/^[A-Za-z0-9-]{1,64}$/);
        expect(result).not.toMatch(/[/\\.\s]/);
      }),
      { numRuns: numRuns() },
    );
  });

  it('keeps the allowed characters in order when at least one exists, up to 64 of them', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9-]{0,80}$/), arbText, (id, noise) => {
        const allowed = `${noise}${id}`.replace(/[^A-Za-z0-9-]/g, '');
        const result = safeId(`${noise}${id}`);
        if (allowed === '') {
          expect(result).toBe('wish');
        } else {
          expect(result).toBe(allowed.slice(0, 64));
          expect(allowed.startsWith(result)).toBe(true);
        }
        // Ids that are already safe and short pass through unchanged.
        if (id.length >= 1 && id.length <= 64) expect(safeId(id)).toBe(id);
      }),
      { numRuns: numRuns() },
    );
  });

  it('returns "wish" when nothing survives the stripping', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[^A-Za-z0-9-]{0,40}$/), (id) => {
        expect(safeId(id)).toBe('wish');
      }),
      { numRuns: numRuns() },
    );
  });
});

// ---------------------------------------------------------------------------
// Example tests
// ---------------------------------------------------------------------------

describe('zip.ts examples', () => {
  const files: ZipEntry[] = [
    { name: 'requirements.md', content: '# Requirements\n' },
    { name: 'properties.md', content: '# Properties\n' },
  ];

  it('is byte-for-byte deterministic with an injected clock', () => {
    expect(buildZip(files, FIXED_CLOCK)).toEqual(buildZip(files, FIXED_CLOCK));
  });

  it('records the DOS timestamp from the clock (local time, 2-second resolution)', () => {
    const entries = readCentralDirectory(buildZip(files, () => new Date(2024, 4, 17, 13, 45, 31)));
    const expectedTime = (13 << 11) | (45 << 5) | (31 >> 1);
    const expectedDate = ((2024 - 1980) << 9) | (5 << 5) | 17;
    for (const entry of entries) {
      expect(entry.dosTime).toBe(expectedTime);
      expect(entry.dosDate).toBe(expectedDate);
    }
  });

  it('records a different timestamp for a different clock', () => {
    const early = readCentralDirectory(buildZip(files, () => new Date(2020, 0, 2, 3, 4, 6)));
    const late = readCentralDirectory(buildZip(files, () => new Date(2031, 11, 30, 23, 58, 58)));
    expect(early[0]?.dosDate).toBe(((2020 - 1980) << 9) | (1 << 5) | 2);
    expect(early[0]?.dosTime).toBe((3 << 11) | (4 << 5) | 3);
    expect(late[0]?.dosDate).toBe(((2031 - 1980) << 9) | (12 << 5) | 30);
    expect(late[0]?.dosTime).toBe((23 << 11) | (58 << 5) | 29);
  });

  it('stores the CRC-32 check value for "123456789"', () => {
    const [entry] = readCentralDirectory(buildZip([{ name: 'check.txt', content: '123456789' }], FIXED_CLOCK));
    expect(entry?.crc32).toBe(0xcbf43926);
  });

  it('writes an empty archive for no files', () => {
    const bytes = buildZip([], FIXED_CLOCK);
    expect(readCentralDirectory(bytes)).toEqual([]);
    expect(unzipSync(bytes)).toEqual({});
  });

  it('stores a file named __proto__ like any other (read back from the central directory)', () => {
    const bytes = buildZip([{ name: '__proto__', content: 'x' }], FIXED_CLOCK);
    expect(readCentralDirectory(bytes).map((e) => e.name)).toEqual(['__proto__']);
  });

  it('writes a name that starts with U+FEFF byte-exact, BOM included (the shrunk case of seed 1540874629)', () => {
    const name = '\uFEFF '; // the counterexample fast-check shrank to: a byte order mark, then a space
    const bytes = buildZip([{ name, content: '' }], FIXED_CLOCK);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const expected = [0xef, 0xbb, 0xbf, 0x20]; // UTF-8 of U+FEFF, then of the space
    // Local header: flag bit 11 at offset 6, name length at 26, name at 30.
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
    expect(view.getUint16(26, true)).toBe(expected.length);
    expect([...bytes.subarray(30, 30 + expected.length)]).toEqual(expected);
    // Central directory, read by the test's own reader (it keeps the BOM).
    const [entry] = readCentralDirectory(bytes);
    expect(entry?.name).toBe(name);
    expect(entry?.flags & 0x0800).toBe(0x0800);
    // The reader limit: fflate's TextDecoder drops the leading BOM, so its key differs from the name written.
    expect(Object.keys(unzipSync(bytes))).toEqual([' ']);
  });

  it('round-trips emoji and right-to-left names and content', () => {
    const unicode: ZipEntry[] = [
      { name: 'מסמך/שלום.md', content: 'שלום עולם 🐒' },
      { name: 'monkeys-paw-🐒/requirements.md', content: '\uFEFFbom first' },
    ];
    const unzipped = unzipSync(buildZip(unicode, FIXED_CLOCK));
    for (const file of unicode) expect(unzipped[file.name]).toEqual(ENCODER.encode(file.content));
  });
});

describe('slug.ts examples', () => {
  it('slugify of the empty string is "wish"', () => {
    expect(slugify('')).toBe('wish');
  });

  it('falls back to "wish" when no usable character remains', () => {
    expect(slugify('!!!')).toBe('wish');
    expect(slugify('🐒')).toBe('wish');
    expect(slugify('   ')).toBe('wish');
  });

  it('lowercases and joins words with single dashes', () => {
    expect(slugify('Hello, World')).toBe('hello-world');
    expect(slugify('Only the OWNER')).toBe('only-the-owner');
  });

  it('caps the length at 32 characters', () => {
    expect(slugify('a'.repeat(100)).length).toBeLessThanOrEqual(32);
  });

  it('safeId strips everything outside letters, digits and dashes', () => {
    expect(safeId('wish-123')).toBe('wish-123');
    expect(safeId('../etc/passwd')).toBe('etcpasswd');
    expect(safeId('a b\\c.d')).toBe('abcd');
  });

  it('safeId falls back to "wish" and caps the length at 64 characters', () => {
    expect(safeId('')).toBe('wish');
    expect(safeId('../ ..')).toBe('wish');
    expect(safeId('a'.repeat(100))).toBe('a'.repeat(64));
  });
});
