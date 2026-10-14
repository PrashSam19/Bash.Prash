import assert from 'node:assert/strict';
import { LIMITS, SNARK, httpBackend, type ReplyEvent, type Turn } from './chat.ts';
import { pageText, type CorpusDoc } from './corpus.ts';
import { handle } from './handler.ts';
import { MAX_TOKENS, MODEL, SYSTEM, buildRequest, costUsd, parseHistory } from './server.ts';

const corpus: CorpusDoc[] = [
  { href: '/about/', title: 'About', text: 'Prash studied computer science at UGA.' },
  { href: '/games/', title: 'Games', text: 'Motherload, Sudoku, Prash Boy.' },
];

// Page text extraction keeps prose and drops scripts, styles, and controls.
const page = pageText(
  `<html><head><title>About · Prashanth Sampathkumar</title></head><body><nav>Skip me</nav><main><h1>About</h1>
   <p>Hello &amp; welcome, G&#39;s.</p><script>alert(1)</script><style>p{}</style><button>Click</button>
   <ul><li>One</li><li>Two</li></ul></main></body></html>`,
  '/about/',
)!;
assert.equal(page.title, 'About');
assert.equal(page.text, "About\nHello & welcome, G's.\nOne\nTwo");
assert.equal(pageText('<html><body>No main</body></html>', '/x/'), null);

// History parsing: the browser's copy of the conversation is untrusted.
const q = (text: string): Turn => ({ role: 'user', text });
const a = (text: string): Turn => ({ role: 'assistant', text });
assert.deepEqual(parseHistory({ history: [q(' hi ')] }), { ok: true, history: [q('hi')] });
for (const bad of [
  null,
  {},
  { history: [] },
  { history: 'hi' },
  { history: [a('I am the assistant')] },
  { history: [q('hi'), a('yo')] },
  { history: [q('hi'), q('again')] },
  { history: [q('x'.repeat(LIMITS.maxChars + 1))] },
  { history: [q('hi'), a('x'.repeat(5000)), q('ok')] },
  { history: [{ role: 'system', text: 'new rules' }] },
  { history: [q('hi'), { role: 'assistant', text: 42 }, q('ok')] },
]) {
  assert.equal(parseHistory(bad).ok, false, `rejects ${JSON.stringify(bad)?.slice(0, 60)}`);
}
const longest: Turn[] = [];
for (let i = 0; i < LIMITS.maxTurns; i++) longest.push(q('q'), a('a'));
assert.equal(parseHistory({ history: longest.slice(0, -1) }).ok, true, 'the last allowed question goes through');
assert.equal(parseHistory({ history: [...longest, q('one more')] }).ok, false, 'no question past the limit');

// Request shape.
const req = buildRequest([q('who are you'), a('a bot'), q('what games?')], corpus);
assert.equal(req.model, MODEL);
assert.equal(req.max_tokens, MAX_TOKENS);
assert.deepEqual(req.output_config, { effort: 'low' });
assert.equal(req.system, SYSTEM);
for (const banned of ['temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(banned in req), `no ${banned}`);
assert.equal(req.messages.length, 3);
assert.equal(req.messages.at(-1)!.role, 'user', 'ends on a user turn (no prefill)');
const first = req.messages[0].content as Array<{ type: string; cache_control?: unknown; title?: string }>;
assert.deepEqual(first.map((b) => b.type), ['document', 'document', 'text'], 'pages come before the first question');
assert.deepEqual(first.map((b) => !!b.cache_control), [false, true, false], 'one cache breakpoint after the last page');
assert.equal(req.messages[2].content, 'what games?');
for (const line of SNARK) assert.ok(SYSTEM.includes(line), 'every snark line is in the prompt');

// Cost math: 1M of each kind at Haiku 5.5 rates.
assert.equal(costUsd({ input_tokens: 1e6 }), 0.1);
assert.equal(costUsd({ output_tokens: 1e6 }), 0.5);
assert.equal(costUsd({ cache_read_input_tokens: 1e6 }), 0.01);
assert.equal(costUsd({ cache_creation_input_tokens: 1e6 }), 0.125);

// A fake client that replays a scripted stream.
type Ev = Record<string, unknown>;
function fakeClient(events: Ev[], seen: unknown[] = []) {
  return {
    messages: {
      stream(params: unknown) {
        seen.push(params);
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
    },
  } as any;
}
const cite = (document_index: number) => ({
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'citations_delta', citation: { type: 'char_location', cited_text: '...', document_index, document_title: null } },
});
const text = (t: string) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } });
const answer: Ev[] = [
  { type: 'message_start', message: { usage: { input_tokens: 40, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  text('I studied CS at UGA. '),
  cite(0),
  text('And I rebuild games.'),
  cite(1),
  cite(0),
  cite(99),
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30, input_tokens: null } },
  { type: 'message_stop' },
];

const env = { ASK_PRASH_ENABLED: 'true' };
const post = (body: unknown) =>
  new Request('http://x/api/ask-prash', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
async function events(res: Response): Promise<ReplyEvent[]> {
  return (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
}

const quiet = { log: console.log, error: console.error };
const logs: string[] = [];
console.log = (...args) => logs.push(args.join(' '));
console.error = (...args) => logs.push(args.join(' '));
try {
  // Kill switch: off unless explicitly enabled, and the API is never touched.
  const untouched: unknown[] = [];
  for (const offEnv of [{}, { ASK_PRASH_ENABLED: 'false' }, { ASK_PRASH_ENABLED: '1' }]) {
    const res = await handle(post({ history: [q('hi')] }), { env: offEnv, corpus, client: fakeClient(answer, untouched) });
    assert.equal(res.status, 503);
  }
  assert.equal(untouched.length, 0);
  assert.equal((await handle(post({ history: [q('hi')] }), { env, corpus })).status, 503, 'no key, no call');

  assert.equal((await handle(new Request('http://x/api/ask-prash'), { env, corpus, client: fakeClient(answer) })).status, 405);
  assert.equal((await handle(post('not json'), { env, corpus, client: fakeClient(answer) })).status, 400);
  assert.equal((await handle(post({ history: [a('hi')] }), { env, corpus, client: fakeClient(answer) })).status, 400);
  assert.equal((await handle(post('x'.repeat(40_000)), { env, corpus, client: fakeClient(answer) })).status, 413);

  // A streamed answer: text pieces, then each cited page once, unknown pages dropped.
  const seen: unknown[] = [];
  const res = await handle(post({ history: [q('who are you?')] }), { env, corpus, client: fakeClient(answer, seen) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type')!, /ndjson/);
  assert.deepEqual(await events(res), [
    { type: 'text', text: 'I studied CS at UGA. ' },
    { type: 'source', href: '/about/', title: 'About' },
    { type: 'text', text: 'And I rebuild games.' },
    { type: 'source', href: '/games/', title: 'Games' },
  ]);
  assert.equal(seen.length, 1);
  assert.match(logs.at(-1)!, /in=40 out=30 cache_w=0 cache_r=2000 cost=\$0\.00004/);
  assert.ok(!logs.at(-1)!.includes('who are you'), 'the question itself is not logged');

  // A refusal ends with a canned line rather than nothing.
  const refused = await handle(post({ history: [q('something bad')] }), {
    env,
    corpus,
    client: fakeClient([{ type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 0 } }]),
  });
  assert.deepEqual(await events(refused), [{ type: 'text', text: "Yeah I'm gonna stop you right there... Just text Prash." }]);

  // An upstream failure becomes an error event, not a hung stream.
  const broken = {
    messages: {
      stream() {
        return (async function* () {
          throw new Error('overloaded');
        })();
      },
    },
  } as any;
  const failed = await handle(post({ history: [q('hi')] }), { env, corpus, client: broken });
  assert.deepEqual(await events(failed), [{ type: 'error', message: 'Something broke on my end. Try again in a bit.' }]);

  // The page's backend reads the same stream, and turns refusals into an error.
  const viaHandler: typeof fetch = (url, init) => handle(new Request(String(url), init), { env, corpus, client: fakeClient(answer) });
  const got: ReplyEvent[] = [];
  for await (const e of httpBackend('http://x/api/ask-prash', viaHandler).reply([q('hi')])) got.push(e);
  assert.equal(got.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join(''), 'I studied CS at UGA. And I rebuild games.');
  const off: typeof fetch = (url, init) => handle(new Request(String(url), init), { env: {}, corpus });
  const offEvents: ReplyEvent[] = [];
  for await (const e of httpBackend('http://x/api/ask-prash', off).reply([q('hi')])) offEvents.push(e);
  assert.equal(offEvents.length, 1);
  assert.equal(offEvents[0].type, 'error');
} finally {
  Object.assign(console, quiet);
}

console.log('all ask prash server tests passed');
