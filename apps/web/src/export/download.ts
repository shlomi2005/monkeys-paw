// Browser download of a built archive (design.md section 6). Builds a Blob (`application/zip`), an
// object URL and a temporary `<a download>`, clicks it, removes it and revokes the URL.
// Nothing is persisted.

/** The few browser objects the download needs. Tests pass fakes; the app uses the globals. */
export interface DownloadEnvironment {
  readonly document: Pick<Document, 'createElement' | 'body'>;
  readonly url: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  /** Schedules the revoke. Defaults to `setTimeout`. */
  readonly defer?: (callback: () => void, delayMs: number) => void;
}

/** Delay before the object URL is revoked, so the browser has started reading the Blob. */
export const REVOKE_DELAY_MS = 1000;

export function downloadZip(bytes: Uint8Array, fileName: string, env?: DownloadEnvironment): void {
  const { document: doc, url, defer } = env ?? { document, url: URL };
  const schedule = defer ?? ((callback: () => void, delayMs: number): void => void setTimeout(callback, delayMs));

  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
  const objectUrl = url.createObjectURL(blob);
  const anchor = doc.createElement('a');
  try {
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    doc.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    schedule(() => url.revokeObjectURL(objectUrl), REVOKE_DELAY_MS);
  }
}
