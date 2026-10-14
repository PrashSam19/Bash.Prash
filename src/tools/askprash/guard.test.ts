import assert from 'node:assert/strict';
import { blobCounters, dayKey, hourKey, monthKey, type BlobStore } from './guard.ts';

// A Blobs-like store with etags and conditional writes. Every read and write
// yields first, so concurrent adds really do interleave.
function fakeStore(): BlobStore & { data: Map<string, { value: unknown; etag: string }> } {
  const data = new Map<string, { value: unknown; etag: string }>();
  let version = 0;
  const tick = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 3));
  return {
    data,
    async getWithMetadata(key) {
      await tick();
      const entry = data.get(key);
      return entry ? { data: entry.value, etag: entry.etag } : null;
    },
    async setJSON(key, value, options) {
      await tick();
      const entry = data.get(key);
      if ('onlyIfNew' in options && entry) return { modified: false };
      if ('onlyIfMatch' in options && entry?.etag !== options.onlyIfMatch) return { modified: false };
      data.set(key, { value, etag: `v${++version}` });
      return { modified: true };
    },
  };
}

// Twenty requests adding at once still count to exactly twenty.
const store = fakeStore();
const counters = blobCounters(store);
await Promise.all(Array.from({ length: 20 }, () => counters.add('ip/abc/2026-10-14', 1)));
assert.equal(await counters.get('ip/abc/2026-10-14'), 20);
assert.equal(await counters.get('missing'), 0);

// Buckets are UTC.
const t = new Date('2026-10-14T23:59:59-04:00');
assert.equal(dayKey(t), '2026-10-15');
assert.equal(hourKey(t), '2026-10-15T03');
assert.equal(monthKey(t), '2026-10');

console.log('all ask prash guard tests passed');
