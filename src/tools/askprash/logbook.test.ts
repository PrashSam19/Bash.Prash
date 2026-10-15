import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CorpusDoc } from './corpus.ts';
import { memoryCounters } from './guard.ts';
import { handle, type HandlerDeps } from './handler.ts';
import { dirLogSink, dirLogStore } from './logbook-fs.ts';
import { RETENTION_DAYS, expiredKeys, logKey, memoryLogSink, wholeChats, writeLog, type LogEntry, type LogSink } from './logbook.ts';
import { generateLogKeys, seal, unseal } from './seal.ts';

// Sealing: only the matching private key opens an entry, and any change to
// the sealed bytes is caught.
const mine = await generateLogKeys();
const theirs = await generateLogKeys();
const secret = { question: 'where do you live?', note: 'ünïcödé ✓' };
const sealed = await seal(mine.publicKey, secret);
assert.deepEqual(await unseal(mine.privateJwk, sealed), secret);
assert.ok(!JSON.stringify(sealed).includes('where do you live'), 'the sealed form hides the text');
assert.notEqual((await seal(mine.publicKey, secret)).ct, sealed.ct, 'sealing the same thing twice looks different');
await assert.rejects(unseal(theirs.privateJwk, sealed), 'a different private key cannot open it');
const flipped = sealed.ct[5] === 'A' ? 'B' : 'A';
await assert.rejects(unseal(mine.privateJwk, { ...sealed, ct: sealed.ct.slice(0, 5) + flipped + sealed.ct.slice(6) }), 'tampering is detected');
await assert.rejects(unseal(mine.privateJwk, { ...sealed, v: 2 } as any), 'unknown versions are refused');
assert.ok(!('d' in (await seal(mine.publicKey, 1))), 'nothing private rides along');

// Keys sort by day, then time.
assert.match(logKey(new Date('2026-10-15T15:30:12Z')), /^2026-10-15\/153012-[0-9a-z]{6}$/);

// Retention: entries from more than 90 days ago expire; day 90 itself stays.
const now = new Date('2026-10-15T12:00:00Z');
assert.deepEqual(
  expiredKeys(['2026-07-16/000000-aaaaaa', '2026-07-17/000000-bbbbbb', '2026-10-15/115959-cccccc', 'stray'], now),
  ['2026-07-16/000000-aaaaaa'],
);
assert.equal(RETENTION_DAYS, 90, 'the page tells visitors 90 days');

// A chat leaves one entry per turn; only the last one per chat is kept.
const turn = (role: 'user' | 'assistant', text: string) => ({ role, text });
const entry = (visitor: string, ...texts: string[]): LogEntry => ({
  at: '2026-10-15T00:00:00Z',
  visitor,
  history: texts.map((t, i) => turn(i % 2 ? 'assistant' : 'user', t)),
  sources: [],
  outcome: 'answered',
  stopReason: 'end_turn',
  costUsd: 0.0001,
});
const chats = wholeChats([
  entry('a', 'hi', 'yo'),
  entry('a', 'hi', 'yo', 'games?', 'Motherload'),
  entry('a', 'hi', 'yo', 'games?', 'Motherload', 'best one?', 'Sudoku'),
  entry('b', 'hi', 'yo'),
  entry('a', 'new chat', 'sure'),
]);
assert.deepEqual(chats.map((c) => `${c.visitor}:${c.history.length}`), ['a:6', 'b:2', 'a:2']);

// The file sink and store round-trip, as the dev server and logs script use them.
const dir = await mkdtemp(join(tmpdir(), 'askprash-logs-'));
try {
  await writeLog(dirLogSink(dir), mine.publicKey, entry('a', 'hi', 'yo'), new Date('2026-10-15T01:02:03Z'));
  const store = dirLogStore(dir);
  const keys = await store.keys();
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^2026-10-15\/010203-/);
  assert.deepEqual((await unseal<LogEntry>(mine.privateJwk, await store.get(keys[0]))).history[0], turn('user', 'hi'));
  await store.delete(keys[0]);
  assert.deepEqual(await store.keys(), []);
  assert.deepEqual(await dirLogStore(join(dir, 'missing')).keys(), []);
} finally {
  await rm(dir, { recursive: true, force: true });
}

// The endpoint: one sealed entry per reply, only when a public key is set,
// and a broken log store never costs the visitor their reply.
const corpus: CorpusDoc[] = [{ href: '/about/', title: 'About', text: 'Prash studied at UGA.' }];
const text = (t: string) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } });
const client = {
  messages: {
    stream: () =>
      (async function* () {
        yield { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } };
        yield text('I went to UGA.\n[[sources: /about/]]');
        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } };
      })(),
  },
} as any;
const env = { ASK_PRASH_ENABLED: 'true', ASK_PRASH_SECRET: 'test-secret-that-is-at-least-32-characters' };
const deps = (over: Partial<HandlerDeps>): HandlerDeps => ({
  env,
  corpus,
  ip: '203.0.113.7',
  counters: memoryCounters(),
  client,
  verifyTurnstile: async () => true,
  now: () => new Date('2026-10-15T12:00:00Z'),
  ...over,
});
const ask = async (d: HandlerDeps) => {
  const res = await handle(new Request('http://x/api/ask-prash', { method: 'POST', body: JSON.stringify({ history: [turn('user', 'where did you go to school?')], turnstile: 'ok' }) }), d);
  return (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
};

const quiet = { log: console.log, error: console.error };
const errors: string[] = [];
console.log = () => {};
console.error = (...args: unknown[]) => void errors.push(args.join(' '));
try {
  const sink = memoryLogSink();
  await ask(deps({ logs: sink, env: { ...env, ASK_PRASH_LOG_PUBLIC_KEY: mine.publicKey } }));
  assert.equal(sink.entries.size, 1);
  const [key, stored] = [...sink.entries][0];
  assert.match(key, /^2026-10-15\/120000-/);
  assert.ok(!JSON.stringify(stored).includes('school'), 'the stored entry is sealed');
  const opened = await unseal<LogEntry>(mine.privateJwk, stored);
  assert.deepEqual(opened.history, [turn('user', 'where did you go to school?'), turn('assistant', 'I went to UGA.')]);
  assert.deepEqual(opened.sources, ['/about/']);
  assert.equal(opened.outcome, 'answered');
  assert.equal(opened.at, '2026-10-15T12:00:00.000Z');
  assert.ok(!JSON.stringify(opened).includes('203.0.113.7'), 'not even the sealed entry holds the raw IP');

  const unkeyed = memoryLogSink();
  await ask(deps({ logs: unkeyed }));
  assert.equal(unkeyed.entries.size, 0, 'no public key, no logging');

  const broken: LogSink = { put: async () => { throw new Error('blobs down'); } };
  const events = await ask(deps({ logs: broken, env: { ...env, ASK_PRASH_LOG_PUBLIC_KEY: mine.publicKey } }));
  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.text).join(''), 'I went to UGA.');
  assert.ok(events.some((e) => e.type === 'turn'), 'the reply is still signed and usable');
  assert.ok(errors.some((e) => e.includes('log write failed')));
} finally {
  Object.assign(console, quiet);
}

console.log('all ask prash logbook tests passed');
