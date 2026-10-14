// The /api/ask-prash endpoint, shared by the Netlify Function and the local
// dev server. Replies stream back as newline-delimited JSON reply events.
//
// The bot is off unless ASK_PRASH_ENABLED is "true". That is the kill switch:
// unset it in Netlify and every request gets a polite 503 without touching
// the API.

import Anthropic from '@anthropic-ai/sdk';
import type { CorpusDoc } from './corpus.ts';
import { buildRequest, costUsd, parseHistory, replyEvents, type StreamResult } from './server.ts';

export interface HandlerDeps {
  env: Record<string, string | undefined>;
  corpus: CorpusDoc[];
  // Injected by tests; built from ANTHROPIC_API_KEY otherwise.
  client?: Pick<Anthropic, 'messages'>;
}

// Requests bigger than this are not a chat.
const MAX_BODY_BYTES = 32_000;

const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  if (deps.env.ASK_PRASH_ENABLED !== 'true') {
    return json(503, { error: "Ask Prash is off right now. Come back later, or just text Prash." });
  }
  if (req.method !== 'POST') return json(405, { error: 'POST only.' });
  if (!deps.client && !deps.env.ANTHROPIC_API_KEY) {
    console.error('[ask-prash] ANTHROPIC_API_KEY is not set');
    return json(503, { error: "Ask Prash is off right now. Come back later, or just text Prash." });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'Too much text.' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Malformed request.' });
  }
  const parsed = parseHistory(body);
  if (!parsed.ok) return json(400, { error: parsed.error });

  const client = deps.client ?? new Anthropic({ apiKey: deps.env.ANTHROPIC_API_KEY, maxRetries: 1 });
  const params = buildRequest(parsed.history, deps.corpus);
  const started = Date.now();
  const result: StreamResult = { usage: {}, stopReason: null };
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      try {
        const upstream = client.messages.stream(params, { signal: req.signal });
        for await (const event of replyEvents(upstream, deps.corpus, result)) send(event);
      } catch (err) {
        if (!req.signal.aborted) {
          console.error('[ask-prash] upstream error', err instanceof Anthropic.APIError ? err.status : '', String(err));
          send({ type: 'error', message: 'Something broke on my end. Try again in a bit.' });
        }
      } finally {
        // Usage and cost only. The conversation itself is not logged here;
        // encrypted logging arrives in a later milestone.
        console.log(
          `[ask-prash] turns=${parsed.history.length} stop=${result.stopReason} ` +
            `in=${result.usage.input_tokens ?? 0} out=${result.usage.output_tokens ?? 0} ` +
            `cache_w=${result.usage.cache_creation_input_tokens ?? 0} cache_r=${result.usage.cache_read_input_tokens ?? 0} ` +
            `cost=$${costUsd(result.usage).toFixed(5)} ms=${Date.now() - started}`,
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}
