// Store-only (method 0) ZIP writer with CRC-32 and UTF-8 names (design.md section 6).
// No dependency. Layout: for each file a local header and its data, then the central directory,
// then the end-of-central-directory record. No ZIP64, no extra fields, no archive comment.

export interface ZipEntry {
  readonly name: string;
  readonly content: string;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_RECORD_SIGNATURE = 0x06054b50;
const VERSION_NEEDED = 20;
/** General purpose bit 11: file name and comment are UTF-8. */
const UTF8_FLAG = 0x0800;
const METHOD_STORE = 0;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS time and date in the clock's local time, 2-second resolution, years 1980 to 2107. */
function dosDateTime(date: Date): { time: number; date: number } {
  if (Number.isNaN(date.getTime())) return { time: 0, date: (1 << 5) | 1 }; // 1980-01-01 00:00:00
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

interface PreparedEntry {
  readonly name: Uint8Array;
  readonly data: Uint8Array;
  readonly crc: number;
  readonly offset: number;
}

/**
 * Builds a ZIP archive. `clock` supplies the DOS timestamp so output is deterministic in tests.
 * Throws a `RangeError` when the archive would need ZIP64 (more than 65535 files, a name over
 * 65535 bytes, or any size over 4 GiB).
 */
export function buildZip(files: readonly ZipEntry[], clock: () => Date): Uint8Array {
  if (files.length > MAX_UINT16) throw new RangeError('Too many files for a ZIP archive without ZIP64.');
  const encoder = new TextEncoder();
  const stamp = dosDateTime(clock());

  const entries: PreparedEntry[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    if (name.length > MAX_UINT16) throw new RangeError('File name too long for a ZIP archive.');
    entries.push({ name, data, crc: crc32(data), offset });
    offset += LOCAL_HEADER_SIZE + name.length + data.length;
  }
  const centralSize = entries.reduce((sum, e) => sum + CENTRAL_HEADER_SIZE + e.name.length, 0);
  const total = offset + centralSize + END_RECORD_SIZE;
  if (total > MAX_UINT32) throw new RangeError('Archive too large for ZIP without ZIP64.');

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let pos = 0;
  const u16 = (value: number): void => {
    view.setUint16(pos, value, true);
    pos += 2;
  };
  const u32 = (value: number): void => {
    view.setUint32(pos, value, true);
    pos += 4;
  };
  const bytes = (value: Uint8Array): void => {
    out.set(value, pos);
    pos += value.length;
  };

  for (const e of entries) {
    u32(LOCAL_HEADER_SIGNATURE);
    u16(VERSION_NEEDED);
    u16(UTF8_FLAG);
    u16(METHOD_STORE);
    u16(stamp.time);
    u16(stamp.date);
    u32(e.crc);
    u32(e.data.length); // compressed size
    u32(e.data.length); // uncompressed size
    u16(e.name.length);
    u16(0); // extra field length
    bytes(e.name);
    bytes(e.data);
  }

  const centralOffset = pos;
  for (const e of entries) {
    u32(CENTRAL_HEADER_SIGNATURE);
    u16(VERSION_NEEDED); // version made by
    u16(VERSION_NEEDED); // version needed to extract
    u16(UTF8_FLAG);
    u16(METHOD_STORE);
    u16(stamp.time);
    u16(stamp.date);
    u32(e.crc);
    u32(e.data.length);
    u32(e.data.length);
    u16(e.name.length);
    u16(0); // extra field length
    u16(0); // comment length
    u16(0); // disk number start
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(e.offset);
    bytes(e.name);
  }

  u32(END_RECORD_SIGNATURE);
  u16(0); // this disk
  u16(0); // disk with the central directory
  u16(entries.length);
  u16(entries.length);
  u32(centralSize);
  u32(centralOffset);
  u16(0); // comment length
  return out;
}
