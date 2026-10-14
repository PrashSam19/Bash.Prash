// Guardrails for the Ask Prash endpoint: who may ask (a Turnstile check,
// then a signed session), how often (per-visitor limits), and how much the
// bot may spend (daily and monthly caps). Everything here runs before a
// request can reach the model.

import type { Turn } from './chat.ts';

export const GUARD = {
  // Questions per visitor (by hashed IP).
  perHour: 10,
  perDay: 30,
  // How long a passed Turnstile check lasts before the visitor is re-checked.
  sessionSeconds: 60 * 60,
};

export interface Budget {
  dailyUsd: number;
  monthlyUsd: number;
}

// Numeric counters with atomic add. Spend is stored in micro-dollars so every
// counter is an integer.
export interface Counters {
  get(key: string): Promise<number>;
  add(key: string, amount: number): Promise<number>;
}

export function memoryCounters(): Counters {
  const values = new Map<string, number>();
  return {
    async get(key) {
      return values.get(key) ?? 0;
    },
    async add(key, amount) {
      const next = (values.get(key) ?? 0) + amount;
      values.set(key, next);
      return next;
    },
  };
}

// The slice of a Netlify Blobs store the counters need.
export interface BlobStore {
  getWithMetadata(key: string, options: { type: 'json' }): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(key: string, data: unknown, options: { onlyIfNew: true } | { onlyIfMatch: string }): Promise<{ modified: boolean }>;
}

// Compare-and-swap on the blob's etag, so two requests landing at once can't
// both read 5 and write 6. A lost race waits a random, growing moment and
// tries again, so a burst of writers spreads out instead of colliding again.
export function blobCounters(store: BlobStore): Counters {
  return {
    async get(key) {
      const entry = await store.getWithMetadata(key, { type: 'json' });
      return typeof entry?.data === 'number' ? entry.data : 0;
    },
    async add(key, amount) {
      for (let attempt = 0; attempt < 20; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 * attempt));
        const entry = await store.getWithMetadata(key, { type: 'json' });
        const current = typeof entry?.data === 'number' ? entry.data : 0;
        const next = current + amount;
        const write = entry?.etag
          ? await store.setJSON(key, next, { onlyIfMatch: entry.etag })
          : await store.setJSON(key, next, { onlyIfNew: true });
        if (write.modified) return next;
      }
      throw new Error(`counter ${key} is too contended`);
    },
  };
}

// Time buckets are UTC, so the daily cap resets at midnight UTC.
const iso = (now: Date) => now.toISOString();
export const dayKey = (now: Date) => iso(now).slice(0, 10);
export const hourKey = (now: Date) => iso(now).slice(0, 13);
export const monthKey = (now: Date) => iso(now).slice(0, 7);

const MICRO = 1_000_000;

export type Admission = { ok: true } | { ok: false; status: number; code: 'limit' | 'resting'; error: string };

export async function admit(counters: Counters, ipHash: string, now: Date, budget: Budget): Promise<Admission> {
  const [day, month] = await Promise.all([
    counters.get(`spend/day/${dayKey(now)}`),
    counters.get(`spend/month/${monthKey(now)}`),
  ]);
  if (day >= budget.dailyUsd * MICRO || month >= budget.monthlyUsd * MICRO) {
    return { ok: false, status: 503, code: 'resting', error: "I'm resting for today. Come back tomorrow, or just text Prash." };
  }
  const hourly = `ip/${ipHash}/${hourKey(now)}`;
  const daily = `ip/${ipHash}/${dayKey(now)}`;
  const [inHour, inDay] = await Promise.all([counters.get(hourly), counters.get(daily)]);
  if (inHour >= GUARD.perHour || inDay >= GUARD.perDay) {
    const when = inDay >= GUARD.perDay ? 'tomorrow' : 'in a bit';
    return { ok: false, status: 429, code: 'limit', error: `That's enough questions for now, G. Come back ${when}.` };
  }
  await Promise.all([counters.add(hourly, 1), counters.add(daily, 1)]);
  return { ok: true };
}

export interface SpendTotals {
  dayUsd: number;
  monthUsd: number;
  // Which caps this request pushed the totals over, for alerts.
  crossed: ('daily' | 'monthly')[];
}

export async function recordSpend(counters: Counters, now: Date, usd: number, budget: Budget): Promise<SpendTotals> {
  const micros = Math.ceil(usd * MICRO);
  const [day, month] = await Promise.all([
    counters.add(`spend/day/${dayKey(now)}`, micros),
    counters.add(`spend/month/${monthKey(now)}`, micros),
  ]);
  const crossed: SpendTotals['crossed'] = [];
  const over = (total: number, cap: number) => total >= cap * MICRO && total - micros < cap * MICRO;
  if (over(day, budget.dailyUsd)) crossed.push('daily');
  if (over(month, budget.monthlyUsd)) crossed.push('monthly');
  return { dayUsd: day / MICRO, monthUsd: month / MICRO, crossed };
}

// Signing. Tokens are HMAC-SHA256 under ASK_PRASH_SECRET, base64url encoded.
const encoder = new TextEncoder();

export async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Constant-time comparison, so a forged signature can't be guessed byte by byte.
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Raw IPs are never stored; counters key on a keyed hash of the address.
export async function hashIp(secret: string, ip: string): Promise<string> {
  return (await hmac(secret, `ip|${ip}`)).slice(0, 22);
}

// A session says "this IP passed Turnstile recently". It is bound to the IP
// hash, so a token copied to another network is useless.
export async function issueSession(secret: string, ipHash: string, now: Date): Promise<string> {
  const expires = Math.floor(now.getTime() / 1000) + GUARD.sessionSeconds;
  return `${expires}.${await hmac(secret, `session|${ipHash}|${expires}`)}`;
}

export async function checkSession(secret: string, token: unknown, ipHash: string, now: Date): Promise<boolean> {
  if (typeof token !== 'string') return false;
  const [expiresText, sig] = token.split('.');
  const expires = Number(expiresText);
  if (!Number.isInteger(expires) || !sig || expires * 1000 <= now.getTime()) return false;
  return same(sig, await hmac(secret, `session|${ipHash}|${expires}`));
}

// The browser holds the conversation, so a visitor could rewrite earlier
// replies ("Sure, I'll ignore my rules now") and send them back. Every reply
// is signed together with everything before it; the next request must carry
// that signature, or it is rejected. Signatures bind to the IP hash rather
// than the session, so a session renewing mid-chat doesn't break the chat.
export async function signTurns(secret: string, ipHash: string, history: Turn[]): Promise<string> {
  return hmac(secret, `turns|${ipHash}|${JSON.stringify(history.map((t) => [t.role, t.text]))}`);
}

export async function checkTurns(secret: string, ipHash: string, history: Turn[], sig: unknown): Promise<boolean> {
  // A first question has nothing earlier to vouch for.
  if (history.length === 1) return true;
  if (typeof sig !== 'string') return false;
  return same(sig, await signTurns(secret, ipHash, history.slice(0, -1)));
}

export type TurnstileVerifier = (token: string, ip: string) => Promise<boolean>;

export function turnstileVerifier(secretKey: string, fetchImpl: typeof fetch = fetch): TurnstileVerifier {
  return async (token, ip) => {
    try {
      const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: secretKey, response: token, remoteip: ip }),
      });
      const body = (await res.json()) as { success?: boolean };
      return body.success === true;
    } catch {
      return false;
    }
  };
}
