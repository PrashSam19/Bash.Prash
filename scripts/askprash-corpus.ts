// Builds the Ask Prash corpus from the built site: one document per page,
// holding the readable text inside <main>. Runs after `astro build`, so the
// bot only ever knows what the public site actually says.
//
// Usage: node scripts/askprash-corpus.ts [distDir] [outFile]

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pageText, type CorpusDoc } from '../src/tools/askprash/corpus.ts';

const distDir = process.argv[2] ?? 'dist';
const outFile = process.argv[3] ?? 'src/tools/askprash/corpus.generated.json';

// Pages that would only add noise: the bot's own page, the 404, and the
// full-screen emulator, which has no prose.
const SKIP = new Set(['/404/', '/tools/ask-prash/', '/prashboy/']);

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '_astro' ? [] : htmlFiles(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

function hrefFor(file: string): string {
  const rel = relative(distDir, file).split(sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel === '404.html') return '/404/';
  return '/' + rel.replace(/index\.html$/, '');
}

const docs: CorpusDoc[] = [];
for (const file of htmlFiles(distDir)) {
  const href = hrefFor(file);
  if (SKIP.has(href)) continue;
  const doc = pageText(readFileSync(file, 'utf8'), href);
  if (doc) docs.push(doc);
}
docs.sort((a, b) => a.href.localeCompare(b.href));

writeFileSync(outFile, JSON.stringify(docs, null, 1) + '\n');
const chars = docs.reduce((n, d) => n + d.text.length, 0);
console.log(`ask prash corpus: ${docs.length} pages, ${chars} chars -> ${outFile}`);
