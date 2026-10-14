// @ts-check
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';

// Pages that host Prash Boy need cross-origin isolation for its threaded
// emulator core. Netlify sets these headers in production (netlify.toml);
// this sets them for `astro dev`.
const isolatedPaths = ['/prashboy', '/games/prash-boy'];

/** @type {import('vite').Plugin} */
const crossOriginIsolation = {
  name: 'prashboy-cross-origin-isolation',
  configureServer(server) {
    server.middlewares.use(isolate);
  },
};

/** @type {import('vite').Connect.NextHandleFunction} */
function isolate(req, res, next) {
  const referer = req.headers.referer ? new URL(req.headers.referer).pathname : '';
  const url = req.url ?? '';
  // Dev serves page scripts from other paths, so isolated pages' subresources
  // also need CORP to load under require-corp.
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (isolatedPaths.some((p) => url.startsWith(p) || referer.startsWith(p))) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  next();
}

// In production Netlify serves /api/ask-prash from netlify/functions. This
// serves the same handler under `astro dev`, reading keys from .env and the
// corpus built by `npm run build`.
/** @type {import('vite').Plugin} */
const askPrashApi = {
  name: 'ask-prash-api',
  configureServer(server) {
    const env = loadEnv('development', process.cwd(), '');
    server.middlewares.use('/api/ask-prash', async (req, res) => {
      try {
        const { handle } = await server.ssrLoadModule('/src/tools/askprash/handler.ts');
        let corpus;
        try {
          corpus = JSON.parse(readFileSync('src/tools/askprash/corpus.generated.json', 'utf8'));
        } catch {
          res.statusCode = 503;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'No corpus yet. Run npm run build once, then reload.' }));
          return;
        }
        const controller = new AbortController();
        res.on('close', () => controller.abort());
        const request = new Request(`http://localhost${req.originalUrl ?? req.url}`, {
          method: req.method,
          headers: /** @type {Record<string, string>} */ (req.headers),
          body: req.method === 'POST' ? /** @type {any} */ (Readable.toWeb(req)) : undefined,
          // @ts-ignore Node needs this for a streamed request body.
          duplex: 'half',
          signal: controller.signal,
        });
        const response = await handle(request, { env, corpus });
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        if (!response.body) return res.end();
        Readable.fromWeb(/** @type {any} */ (response.body)).pipe(res);
      } catch (err) {
        server.config.logger.error(`[ask-prash] ${err}`);
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      }
    });
  },
};

// https://astro.build/config
export default defineConfig({
  site: 'https://prashcache.com',
  vite: { plugins: [crossOriginIsolation, askPrashApi] },
});
