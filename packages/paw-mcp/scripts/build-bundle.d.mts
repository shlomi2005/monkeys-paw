import type { BuildOptions, Metafile } from 'esbuild';

export const BUNDLE_OUT: string;
export const MINIFY: boolean;
export function bundleOptions(): BuildOptions & { metafile: true; outfile: string };
export function packageNameOf(inputPath: string): string | null;
export function listPackages(
  metafile: Metafile,
): { name: string; version: string; license: string; author: string; copyright: string; dir: string }[];
export function readLicenseText(dir: string): string | null;
