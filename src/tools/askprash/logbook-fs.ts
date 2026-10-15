// A file-backed log sink for `astro dev` and the logs script, so the whole
// encrypted logging path can be exercised locally. Node only; the Netlify
// Function uses blobLogSink instead.

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import type { LogSink } from './logbook.ts';
import type { Sealed } from './seal.ts';

export function dirLogSink(dir: string): LogSink {
  return {
    async put(key, sealed) {
      const file = join(dir, `${key}.json`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(sealed));
    },
  };
}

// The same three operations the logs script uses on Netlify Blobs.
export function dirLogStore(dir: string) {
  return {
    async keys(): Promise<string[]> {
      const files = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.split(sep).join('/').replace(/\.json$/, ''))
        .sort();
    },
    async get(key: string): Promise<Sealed> {
      return JSON.parse(await readFile(join(dir, `${key}.json`), 'utf8'));
    },
    async delete(key: string): Promise<void> {
      await rm(join(dir, `${key}.json`));
    },
  };
}
