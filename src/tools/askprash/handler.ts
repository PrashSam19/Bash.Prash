// The /api/ask-prash endpoint, shared by the Netlify Function and the local
// dev server. Replies stream back as newline-delimited JSON reply events.
//
// The bot is off unless ASK_PRASH_ENABLED is "true". That is the kill switch:
// unset it in Netlify and every request gets a polite 503 without touching
// the API.
//
// Checks run cheapest first, and nothing reaches the model until all pass:
// kill switch, request shape, Turnstile or a signed session, the signature
// on earlier replies, per-visitor limits, then the daily and monthly caps.

import Anthropic from '@anthropic-ai/sdk';
import type { CorpusDoc } from './corpus.ts';
import {
  admit,
  checkSession,
  checkTurns,
  hashIp,
  issueSession,
  recordSpend,
  signTurns,
  turnstileVerifier,
  type Budget,
  type Counters,
  type TurnstileVerifier,
} from './guard.ts';
import { writeLog, type Geo, type LogSink } from './logbook.ts';
import { buildRequest, costUsd, parseHistory, replyEvents, type StreamResult } from './server.ts';

export interface HandlerDeps {
  env: Record<string, string | undefined>;
  corpus: CorpusDoc[];
  counters: Counters;
  // The visitor's IP address. Only a keyed hash of it is ever stored.
  ip: string;
  // Approximate location for the encrypted log only.
  geo?: Geo;
  // Injected by tests and evals; built from the environment otherwise.
  client?: Pick<Anthropic, 'messages'>;
  verifyTurnstile?: TurnstileVerifier;
  // Where encrypted chat logs go. Logging is on only when this is set and
  // ASK_PRASH_LOG_PUBLIC_KEY is too.
  logs?: LogSink;
  now?: () => Date;
  fetch?: typeof fetch;
}

// Requests bigger than this are not a chat.
const MAX_BODY_BYTES = 32_000;

const OFF = "Ask Prash is off right now. Come back later, or just text Prash.";

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function budgetFrom(env: HandlerDeps['env']): Budget {
  const num = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return value && Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return { dailyUsd: num(env.ASK_PRASH_DAILY_CAP_USD, 0.83), monthlyUsd: num(env.ASK_PRASH_MONTHLY_CAP_USD, 25) };
}

export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  const { env } = deps;
  if (env.ASK_PRASH_ENABLED !== 'true') return json(503, { error: OFF, code: 'off' });
  if (req.method !== 'POST') return json(405, { error: 'POST only.', code: 'bad' });
  const secret = env.ASK_PRASH_SECRET ?? '';
  const missing = [
    !deps.client && !env.ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY',
    secret.length < 32 && 'ASK_PRASH_SECRET (32+ characters)',
    !deps.verifyTurnstile && !env.TURNSTILE_SECRET_KEY && 'TURNSTILE_SECRET_KEY',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`[ask-prash] not configured, missing: ${missing.join(', ')}`);
    return json(503, { error: OFF, code: 'off' });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'Too much text.', code: 'bad' });
  let body: { session?: unknown; turnstile?: unknown; sig?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Malformed request.', code: 'bad' });
  }
  const parsed = parseHistory(body);
  if (!parsed.ok) return json(400, { error: parsed.error, code: 'bad' });
  const history = parsed.history;

  const now = (deps.now ?? (() => new Date()))();
  const ipHash = await hashIp(secret, deps.ip);

  // Who: a valid session, or a fresh Turnstile pass that earns one.
  let session = typeof body.session === 'string' ? body.session : '';
  let newSession = false;
  if (!(await checkSession(secret, session, ipHash, now))) {
    const verify = deps.verifyTurnstile ?? turnstileVerifier(env.TURNSTILE_SECRET_KEY!, deps.fetch);
    if (typeof body.turnstile !== 'string' || !body.turnstile || !(await verify(body.turnstile, deps.ip))) {
      return json(401, { error: 'Quick robot check first. Give it a second and try again.', code: 'verify' });
    }
    session = await issueSession(secret, ipHash, now);
    newSession = true;
  }
  if (!(await checkTurns(secret, ipHash, history, body.sig))) {
    return json(400, { error: "That conversation doesn't add up. Hit New chat to start over.", code: 'bad' });
  }

  // How often, and how much.
  const budget = budgetFrom(env);
  let admission;
  try {
    admission = await admit(deps.counters, ipHash, now, budget);
  } catch (err) {
    // If the counters can't be read, nothing gets through: limits that
    // can't be checked are treated as hit.
    console.error('[ask-prash] counters unavailable', String(err));
    return json(503, { error: "I'm swamped right now. Try again in a minute.", code: 'busy' });
  }
  if (!admission.ok) return json(admission.status, { error: admission.error, code: admission.code });

  const client = deps.client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  const params = buildRequest(history, deps.corpus);
  const started = Date.now();
  const result: StreamResult = { usage: {}, stopReason: null };
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      if (newSession) send({ type: 'session', token: session });
      let reply = '';
      const sources: string[] = [];
      let failed = false;
      try {
        const upstream = client.messages.stream(params, { signal: req.signal });
        for await (const event of replyEvents(upstream, deps.corpus, result)) {
          if (event.type === 'text') reply += event.text;
          else if (event.type === 'source') sources.push(event.href);
          send(event);
        }
        if (!reply.trim()) {
          failed = true;
          send({ type: 'error', message: 'I blanked on that one. Try asking another way.' });
        }
      } catch (err) {
        failed = true;
        if (!req.signal.aborted) {
          console.error('[ask-prash] upstream error', err instanceof Anthropic.APIError ? err.status : '', String(err));
          send({ type: 'error', message: 'Something broke on my end. Try again in a bit.' });
        }
      }
      try {
        if (!failed) {
          // Signed in the same trimmed form parseHistory gives the next request.
          const sig = await signTurns(secret, ipHash, [...history, { role: 'assistant', text: reply.trim() }]);
          send({ type: 'turn', sig });
        }
        const cost = costUsd(result.usage);
        const totals = await recordSpend(deps.counters, now, cost, budget);
        // Plain logs carry usage and cost only; the conversation itself goes
        // only into the encrypted log below.
        console.log(
          `[ask-prash] turns=${history.length} stop=${result.stopReason} ` +
            `in=${result.usage.input_tokens ?? 0} out=${result.usage.output_tokens ?? 0} ` +
            `cache_w=${result.usage.cache_creation_input_tokens ?? 0} cache_r=${result.usage.cache_read_input_tokens ?? 0} ` +
            `cost=$${cost.toFixed(5)} day=$${totals.dayUsd.toFixed(4)} month=$${totals.monthUsd.toFixed(4)} ms=${Date.now() - started}`,
        );
        for (const cap of totals.crossed) await alert(deps, cap, cap === 'daily' ? budget.dailyUsd : budget.monthlyUsd);
      } catch (err) {
        console.error('[ask-prash] bookkeeping error', String(err));
      }
      try {
        const publicKey = env.ASK_PRASH_LOG_PUBLIC_KEY;
        if (deps.logs && publicKey && !req.signal.aborted) {
          await writeLog(
            deps.logs,
            publicKey,
            {
              at: now.toISOString(),
              visitor: ipHash,
              history: [...history, { role: 'assistant', text: reply.trim() }],
              sources,
              outcome: failed ? 'failed' : result.stopReason === 'refusal' ? 'refused' : 'answered',
              stopReason: result.stopReason,
              costUsd: costUsd(result.usage),
              geo: deps.geo,
              userAgent: req.headers.get('user-agent')?.slice(0, 300) || undefined,
            },
            now,
          );
        }
      } catch (err) {
        // A lost log entry never costs the visitor their reply.
        console.error('[ask-prash] log write failed', String(err));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// Posts a plain-text heads-up to ASK_PRASH_ALERT_URL (an ntfy.sh topic works
// as is) when spending crosses a cap. Failures are logged, never raised.
async function alert(deps: HandlerDeps, cap: 'daily' | 'monthly', usd: number) {
  const message =
    cap === 'daily'
      ? `Ask Prash hit today's $${usd.toFixed(2)} cap and is resting until midnight UTC.`
      : `Ask Prash hit this month's $${usd.toFixed(2)} cap and is resting until next month.`;
  console.warn(`[ask-prash] ${message}`);
  const url = deps.env.ASK_PRASH_ALERT_URL;
  if (!url) return;
  try {
    await (deps.fetch ?? fetch)(url, { method: 'POST', body: message });
  } catch (err) {
    console.error('[ask-prash] alert failed', String(err));
  }
}
