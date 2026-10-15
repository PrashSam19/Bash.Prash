// Netlify Function for Ask Prash. All the logic lives in src/tools/askprash;
// this file only binds it to the route, Netlify's environment, and Blobs
// stores for the counters and the encrypted chat logs.
import { getStore } from '@netlify/blobs';
import corpus from '../../src/tools/askprash/corpus.generated.json' with { type: 'json' };
import { blobCounters } from '../../src/tools/askprash/guard.ts';
import { handle } from '../../src/tools/askprash/handler.ts';
import { blobLogSink } from '../../src/tools/askprash/logbook.ts';

export default (req: Request, context: { ip: string }) =>
  handle(req, {
    env: process.env,
    corpus,
    ip: context.ip,
    counters: blobCounters(getStore({ name: 'ask-prash', consistency: 'strong' })),
    logs: blobLogSink(getStore('ask-prash-logs')),
  });

export const config = { path: '/api/ask-prash' };
