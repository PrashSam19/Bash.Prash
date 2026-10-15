// Encrypted chat logs. After every model reply the handler writes one sealed
// entry holding the conversation so far; the last entry of a chat is the whole
// chat. Entries are keyed by UTC day, so old days can be listed and pruned.

import type { Turn } from './chat.ts';
import { seal, type Sealed } from './seal.ts';

export interface LogEntry {
  at: string;
  // Keyed hash of the visitor's IP, to tell visitors apart without knowing them.
  visitor: string;
  history: Turn[];
  sources: string[];
  outcome: 'answered' | 'refused' | 'failed';
  stopReason: string | null;
  costUsd: number;
  // Approximate location from the visitor's IP (Netlify's geo lookup), and
  // their browser's user agent. Only ever stored sealed; never sent to the model.
  geo?: Geo;
  userAgent?: string;
}

export interface Geo {
  city?: string;
  region?: string;
  country?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

export interface LogSink {
  put(key: string, sealed: Sealed): Promise<void>;
}

// The slice of a Netlify Blobs store the logs need.
export interface LogBlobStore {
  setJSON(key: string, data: unknown): Promise<unknown>;
}

export function blobLogSink(store: LogBlobStore): LogSink {
  return {
    async put(key, sealed) {
      await store.setJSON(key, sealed);
    },
  };
}

export function memoryLogSink(): LogSink & { entries: Map<string, Sealed> } {
  const entries = new Map<string, Sealed>();
  return {
    entries,
    async put(key, sealed) {
      entries.set(key, sealed);
    },
  };
}

// "2026-10-15/153012-k3x9q2": day first, so a day is one prefix to list or
// delete; time next, so a day's entries sort in order.
export function logKey(now: Date): string {
  const iso = now.toISOString();
  const time = iso.slice(11, 19).replace(/:/g, '');
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join('');
  return `${iso.slice(0, 10)}/${time}-${rand}`;
}

export async function writeLog(sink: LogSink, publicKey: string, entry: LogEntry, now: Date): Promise<void> {
  await sink.put(logKey(now), await seal(publicKey, entry));
}

// The page promises chats are deleted after this long. A daily scheduled
// function enforces it (netlify/functions/ask-prash-prune.mts).
export const RETENTION_DAYS = 90;

// Keys start with their UTC day, so expiry needs no decryption.
export function expiredKeys(keys: string[], now: Date, days = RETENTION_DAYS): string[] {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return keys.filter((key) => key.slice(0, 10) < cutoff);
}

// Each reply writes the whole conversation so far, so a chat leaves one entry
// per turn. Keep only the last: an entry whose history continues in a later
// entry from the same visitor is an earlier snapshot of the same chat.
export function wholeChats(entries: LogEntry[]): LogEntry[] {
  const sameStart = (short: LogEntry, long: LogEntry) =>
    short.visitor === long.visitor &&
    short.history.length < long.history.length &&
    short.history.every((t, i) => t.role === long.history[i].role && t.text === long.history[i].text);
  return entries.filter((e) => !entries.some((other) => sameStart(e, other)));
}
