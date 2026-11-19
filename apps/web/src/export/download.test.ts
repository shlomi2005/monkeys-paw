// download.ts with fake `document` and `URL` objects (no jsdom): the Blob, the temporary anchor,
// the click, the removal and the revoke.

import { describe, expect, it } from 'vitest';
import { REVOKE_DELAY_MS, downloadZip } from './download';
import type { DownloadEnvironment } from './download';

function fakeEnvironment(clickThrows = false) {
  const log: string[] = [];
  const deferred: Array<{ callback: () => void; delayMs: number }> = [];
  const blobs: Blob[] = [];
  const anchor = {
    href: '',
    download: '',
    rel: '',
    style: { display: '' },
    click: () => {
      log.push('click');
      if (clickThrows) throw new Error('click failed');
    },
    remove: () => log.push('remove'),
  };
  const env = {
    document: {
      createElement: (tag: string) => {
        log.push(`create:${tag}`);
        return anchor;
      },
      body: { appendChild: () => log.push('append') },
    },
    url: {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        log.push('createObjectURL');
        return 'blob:fake-1';
      },
      revokeObjectURL: (value: string) => log.push(`revoke:${value}`),
    },
    defer: (callback: () => void, delayMs: number) => deferred.push({ callback, delayMs }),
  } as unknown as DownloadEnvironment;
  return { env, log, deferred, blobs, anchor };
}

describe('downloadZip', () => {
  it('clicks a temporary anchor with the file name, then removes it and revokes the URL', async () => {
    const { env, log, deferred, blobs, anchor } = fakeEnvironment();
    const bytes = new Uint8Array([80, 75, 3, 4]);
    downloadZip(bytes, 'monkeys-paw-wish-1.zip', env);

    expect(log).toEqual(['createObjectURL', 'create:a', 'append', 'click', 'remove']);
    expect(anchor.href).toBe('blob:fake-1');
    expect(anchor.download).toBe('monkeys-paw-wish-1.zip');
    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.type).toBe('application/zip');
    expect(new Uint8Array(await blobs[0]!.arrayBuffer())).toEqual(bytes);

    // The revoke is scheduled, then runs once.
    expect(deferred).toHaveLength(1);
    expect(deferred[0]?.delayMs).toBe(REVOKE_DELAY_MS);
    deferred[0]?.callback();
    expect(log.at(-1)).toBe('revoke:blob:fake-1');
  });

  it('still removes the anchor and revokes the URL when the click throws', () => {
    const { env, log, deferred } = fakeEnvironment(true);
    expect(() => downloadZip(new Uint8Array(), 'x.zip', env)).toThrow('click failed');
    expect(log).toContain('remove');
    deferred[0]?.callback();
    expect(log.at(-1)).toBe('revoke:blob:fake-1');
  });
});
