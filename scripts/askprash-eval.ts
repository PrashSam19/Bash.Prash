// Runs the Ask Prash eval set against the real model, through the same
// endpoint code visitors hit (guards included), and grades every reply.
// This spends real money: about $0.003 a run on Claude Haiku.
//
// Usage: npm run eval            all cases
//        npm run eval -- sql dan only cases whose names include a word

import { readFileSync } from 'node:fs';
import { httpBackend, type ReplyEvent, type Turn } from '../src/tools/askprash/chat.ts';
import type { CorpusDoc } from '../src/tools/askprash/corpus.ts';
import { ALWAYS, CASES, noSnark, snark, type EvalCase, type Reply } from '../src/tools/askprash/evals.ts';
import { memoryCounters } from '../src/tools/askprash/guard.ts';
import { handle } from '../src/tools/askprash/handler.ts';

process.loadEnvFile('.env');
const corpus: CorpusDoc[] = JSON.parse(readFileSync('src/tools/askprash/corpus.generated.json', 'utf8'));

const filters = process.argv.slice(2);
const cases = filters.length ? CASES.filter((c) => filters.some((f) => c.name.includes(f))) : CASES;

// The handler logs one cost line per reply; collect the dollars from it.
let spent = 0;
const log = console.log;
console.log = (...args: unknown[]) => {
  const line = args.join(' ');
  const cost = line.match(/^\[ask-prash\].* cost=\$([\d.]+)/);
  if (cost) spent += Number(cost[1]);
  else log(...args);
};

async function run(c: EvalCase, index: number): Promise<{ c: EvalCase; reply: Reply; failures: string[] }> {
  // Each case is its own visitor, so per-visitor limits never interfere.
  const deps = {
    env: { ...process.env, ASK_PRASH_ENABLED: 'true' },
    corpus,
    counters: memoryCounters(),
    ip: `198.18.0.${index + 1}`,
    verifyTurnstile: async () => true,
  };
  const backend = httpBackend('http://eval/api/ask-prash', {
    turnstile: async () => 'eval',
    fetch: (url, init) => handle(new Request(String(url), init), deps),
  });
  const history: Turn[] = [];
  let reply: Reply = { text: '', sources: [] };
  for (const question of c.questions) {
    history.push({ role: 'user', text: question });
    reply = { text: '', sources: [] };
    for await (const event of backend.reply(history) as AsyncIterable<ReplyEvent>) {
      if (event.type === 'text') reply.text += event.text;
      else if (event.type === 'source') reply.sources.push(event.href);
      else if (event.type === 'error') reply.text = `[error] ${event.message}`;
    }
    history.push({ role: 'assistant', text: reply.text });
  }
  const checks = [...ALWAYS, ...c.checks, ...(c.snarkOk || c.checks.includes(snark) ? [] : [noSnark])];
  const failures = checks.map((check) => check(reply)).filter((r): r is string => r !== null);
  return { c, reply, failures };
}

// A few at a time: quick, and gentle on rate limits.
const results: Awaited<ReturnType<typeof run>>[] = [];
for (let i = 0; i < cases.length; i += 4) {
  results.push(...(await Promise.all(cases.slice(i, i + 4).map((c, j) => run(c, i + j)))));
}

for (const { c, reply, failures } of results) {
  log(`${failures.length ? 'FAIL' : 'pass'}  ${c.name.padEnd(18)} ${reply.text.replace(/\s+/g, ' ').slice(0, 110)}`);
  for (const f of failures) log(`        - ${f}`);
}
const passed = results.filter((r) => r.failures.length === 0).length;
log(`\n${passed}/${results.length} passed · spent $${spent.toFixed(4)}`);
process.exitCode = passed === results.length ? 0 : 1;
