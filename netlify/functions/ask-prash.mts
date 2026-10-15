// Netlify Function for Ask Prash. All the logic lives in src/tools/askprash;
// this file only binds it to the route, Netlify's environment, and Blobs
// stores for the counters and the encrypted chat logs.
import { getStore } from '@netlify/blobs';
import corpus from '../../src/tools/askprash/corpus.generated.json' with { type: 'json' };
import { blobCounters } from '../../src/tools/askprash/guard.ts';
import { handle } from '../../src/tools/askprash/handler.ts';
import { blobLogSink } from '../../src/tools/askprash/logbook.ts';

// The parts of Netlify's Context.geo that the logs keep.
interface NetlifyGeo {
  city?: string;
  country?: { code?: string; name?: string };
  subdivision?: { code?: string; name?: string };
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

const toGeo = (g: NetlifyGeo | undefined) =>
  g && {
    city: g.city,
    region: g.subdivision?.name,
    country: g.country?.name ?? g.country?.code,
    postalCode: g.postalCode,
    latitude: g.latitude,
    longitude: g.longitude,
    timezone: g.timezone,
  };

export default (req: Request, context: { ip: string; geo?: NetlifyGeo }) =>
  handle(req, {
    env: process.env,
    corpus,
    ip: context.ip,
    geo: toGeo(context.geo),
    counters: blobCounters(getStore({ name: 'ask-prash', consistency: 'strong' })),
    logs: blobLogSink(getStore('ask-prash-logs')),
  });

export const config = { path: '/api/ask-prash' };
