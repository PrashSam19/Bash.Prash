// Deletes encrypted Ask Prash logs once they are older than the 90 days the
// page promises. Runs once a day on Netlify's scheduler.
import { getStore } from '@netlify/blobs';
import { expiredKeys } from '../../src/tools/askprash/logbook.ts';

export default async () => {
  const store = getStore('ask-prash-logs');
  const { blobs } = await store.list();
  const old = expiredKeys(
    blobs.map((b) => b.key),
    new Date(),
  );
  for (const key of old) await store.delete(key);
  console.log(`[ask-prash] pruned ${old.length} log entries past retention`);
};

export const config = { schedule: '@daily' };
