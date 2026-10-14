// @ts-check
import { defineConfig } from 'astro/config';

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

// https://astro.build/config
export default defineConfig({
  site: 'https://prashcache.com',
  vite: { plugins: [crossOriginIsolation] },
});
