// Netlify Function for Ask Prash. All the logic lives in src/tools/askprash;
// this file only binds it to the route and to Netlify's environment.
import corpus from '../../src/tools/askprash/corpus.generated.json' with { type: 'json' };
import { handle } from '../../src/tools/askprash/handler.ts';

export default (req: Request) => handle(req, { env: process.env, corpus });

export const config = { path: '/api/ask-prash' };
