// The loader is configured without Draco and meshopt decoders (use-paw-gltf.ts). That is only right while the GLBs
// do not use those extensions. If one ever does, the decoders must be served locally from public/ (no CDN).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DECODER_EXTENSIONS = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression'] as const;
const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"

interface GlbJson {
  readonly extensionsUsed?: readonly string[];
  readonly extensionsRequired?: readonly string[];
  readonly scene?: number;
  readonly scenes?: readonly unknown[];
}

/** Reads the JSON chunk of a binary glTF: a 12-byte header, then a chunk header (length, type) and the JSON text. */
function readGlbJson(buffer: Buffer): GlbJson {
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a GLB file');
  const chunkLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== JSON_CHUNK) throw new Error('first chunk is not JSON');
  return JSON.parse(buffer.toString('utf8', 20, 20 + chunkLength)) as GlbJson;
}

function fakeGlb(json: object): Buffer {
  const text = Buffer.from(JSON.stringify(json), 'utf8');
  const padded = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(JSON_CHUNK, 16);
  return Buffer.concat([header, padded]);
}

function decodersListed(json: GlbJson): string[] {
  const listed = [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])];
  return DECODER_EXTENSIONS.filter((name) => listed.includes(name));
}

const GLB_FILES = ['paw-web.glb', 'paw-mobile.glb'] as const;
const glbPath = (name: string): string => fileURLToPath(new URL(`../../../../docs/art/paw/${name}`, import.meta.url));

describe('the paw GLBs need no decoder', () => {
  for (const name of GLB_FILES) {
    it(`${name} lists neither KHR_draco_mesh_compression nor EXT_meshopt_compression`, () => {
      const json = readGlbJson(readFileSync(glbPath(name)));
      expect(decodersListed(json)).toEqual([]);
    });

    it(`${name} has a default scene index that three's GLTFLoader resolves (gltf.scene, not scenes[0])`, () => {
      const json = readGlbJson(readFileSync(glbPath(name)));
      expect(typeof json.scene).toBe('number');
      expect(json.scene).toBeLessThan(json.scenes?.length ?? 0);
    });
  }

  it('the check itself fails when a decoder extension is listed (self-test on a synthetic GLB)', () => {
    expect(decodersListed(readGlbJson(fakeGlb({ extensionsUsed: ['KHR_draco_mesh_compression'] })))).toEqual([
      'KHR_draco_mesh_compression',
    ]);
    expect(decodersListed(readGlbJson(fakeGlb({ extensionsRequired: ['EXT_meshopt_compression'] })))).toEqual([
      'EXT_meshopt_compression',
    ]);
    expect(decodersListed(readGlbJson(fakeGlb({ extensionsUsed: ['KHR_materials_unlit'] })))).toEqual([]);
    expect(decodersListed(readGlbJson(fakeGlb({})))).toEqual([]);
  });

  it('rejects a file that is not a GLB', () => {
    expect(() => readGlbJson(Buffer.from('not a glb file at all, just text'))).toThrow();
  });
});
