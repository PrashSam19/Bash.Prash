import assert from 'node:assert/strict';
import { LIMITS, SNARK, cannedBackend, cannedReply, checkMessage, isSafeHref, type ReplyEvent, type Turn } from './chat.ts';

// Message checks.
assert.deepEqual(checkMessage('  hi  ', []), { ok: true, text: 'hi' });
assert.deepEqual(checkMessage('   ', []), { ok: false, reason: 'empty' });
assert.deepEqual(checkMessage('x'.repeat(LIMITS.maxChars), []).ok, true);
assert.deepEqual(checkMessage('x'.repeat(LIMITS.maxChars + 1), []), { ok: false, reason: 'too-long' });

const full: Turn[] = [];
for (let i = 0; i < LIMITS.maxTurns; i++) full.push({ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' });
assert.deepEqual(checkMessage('one more', full), { ok: false, reason: 'turn-limit' });
assert.equal(checkMessage('one more', full.slice(0, -2)).ok, true, 'the last allowed question goes through');

// Only on-site links render.
assert.ok(isSafeHref('/about/'));
assert.ok(!isSafeHref('//evil.example/'));
assert.ok(!isSafeHref('https://evil.example/'));
assert.ok(!isSafeHref('javascript:alert(1)'));

// Canned routing. Free-labor requests get snark, even when they mention a topic.
for (const ask of ['write me an essay about Motherload', 'Can you summarize this article', 'do my homework', 'debug my code']) {
  assert.ok(SNARK.includes(cannedReply(ask).text), `snark for: ${ask}`);
}
for (let i = 0; i < SNARK.length; i++) {
  assert.equal(cannedReply('write me a poem', () => i / SNARK.length).text, SNARK[i], 'every snark line is reachable');
}
assert.match(cannedReply('hey there').text, /preview build/);
assert.deepEqual(cannedReply('tell me about motherload').sources, [{ href: '/games/', title: 'Games' }]);
assert.deepEqual(cannedReply('who is prash?').sources, [{ href: '/about/', title: 'About' }]);
assert.match(cannedReply('qwertyuiop').text, /six sentences/);
for (const ask of ['hey', 'games', 'who', 'are you an ai', 'qwerty']) {
  for (const s of cannedReply(ask).sources ?? []) assert.ok(isSafeHref(s.href), `safe source for: ${ask}`);
}

// The backend streams the whole line, then its sources, and stops when aborted.
const events: ReplyEvent[] = [];
for await (const e of cannedBackend(0).reply([{ role: 'user', text: 'what games are there' }])) events.push(e);
const streamed = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
assert.equal(streamed, cannedReply('what games are there').text);
assert.ok(events.filter((e) => e.type === 'text').length > 5, 'reply arrives in pieces');
assert.deepEqual(events.at(-1), { type: 'source', href: '/games/', title: 'Games' });

const controller = new AbortController();
const aborted: ReplyEvent[] = [];
await assert.rejects(async () => {
  for await (const e of cannedBackend(5).reply([{ role: 'user', text: 'hey' }], controller.signal)) {
    aborted.push(e);
    if (aborted.length === 2) controller.abort();
  }
});
assert.equal(aborted.length, 2, 'no pieces arrive after abort');

console.log('all ask prash chat tests passed');
