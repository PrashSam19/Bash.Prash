// Prash's side of the encrypted Ask Prash logs. Runs on the laptop that holds
// the private key; nothing here is deployed.
//
//   npm run logs -- keygen              make the key pair (once)
//   npm run logs -- pull                download, decrypt, summarize, and open
//                                       the dashboard (--no-open to skip)
//   npm run logs -- pull --local        same, from the dev server's logs
//   npm run logs -- prune --days 90     delete entries older than 90 days
//
// Production access needs NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN in .env.
// Decrypted chats are written outside the repo, to ~/.ask-prash/logs/.

import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getStore } from '@netlify/blobs';
import { RETENTION_DAYS, expiredKeys, wholeChats, type LogEntry } from '../src/tools/askprash/logbook.ts';
import { dirLogStore } from '../src/tools/askprash/logbook-fs.ts';
import { generateLogKeys, unseal, type Sealed } from '../src/tools/askprash/seal.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env is fine for keygen.
}

const HOME = join(homedir(), '.ask-prash');
const KEY_FILE = process.env.ASK_PRASH_LOG_PRIVATE_KEY_FILE ?? join(HOME, 'log-key.private.jwk');
const OUT_DIR = join(HOME, 'logs');
const LOCAL_LOG_DIR = '.askprash-logs';

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const option = (name: string, fallback: number) => {
  const i = rest.indexOf(`--${name}`);
  const n = Number(rest[i + 1]);
  return i >= 0 && Number.isFinite(n) ? n : fallback;
};

interface Store {
  keys(): Promise<string[]>;
  get(key: string): Promise<Sealed>;
  delete(key: string): Promise<void>;
}

function remoteStore(): Store {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) {
    console.error('Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN in .env, or use --local.');
    process.exit(1);
  }
  const store = getStore({ name: 'ask-prash-logs', siteID, token });
  return {
    async keys() {
      const { blobs } = await store.list();
      return blobs.map((b) => b.key).sort();
    },
    async get(key) {
      return (await store.get(key, { type: 'json' })) as Sealed;
    },
    delete: (key) => store.delete(key),
  };
}

const source = (): Store => (flag('local') ? dirLogStore(LOCAL_LOG_DIR) : remoteStore());

async function keygen() {
  if (await access(KEY_FILE).then(() => true, () => false)) {
    console.error(`${KEY_FILE} already exists. Delete it first if you really mean to replace it;`);
    console.error('logs sealed with the old key become unreadable without it.');
    process.exit(1);
  }
  const { publicKey, privateJwk } = await generateLogKeys();
  await mkdir(HOME, { recursive: true, mode: 0o700 });
  await writeFile(KEY_FILE, JSON.stringify(privateJwk, null, 1) + '\n', { mode: 0o600 });
  await chmod(KEY_FILE, 0o600);
  console.log(`Private key saved to ${KEY_FILE} (readable only by you).`);
  console.log('Back it up somewhere safe, like your password manager: without it the logs can never be read.\n');
  console.log('Public key (safe to share; goes in .env and Netlify as ASK_PRASH_LOG_PUBLIC_KEY):');
  console.log(publicKey);
}

async function pull() {
  const privateJwk = JSON.parse(await readFile(KEY_FILE, 'utf8'));
  const store = source();
  const keys = await store.keys();
  const entries: LogEntry[] = [];
  let unreadable = 0;
  for (const key of keys) {
    try {
      entries.push(await unseal<LogEntry>(privateJwk, await store.get(key)));
    } catch {
      unreadable++;
    }
  }
  entries.sort((a, b) => a.at.localeCompare(b.at));
  const chats = wholeChats(entries);

  await mkdir(OUT_DIR, { recursive: true, mode: 0o700 });
  const outFile = join(OUT_DIR, `chats${flag('local') ? '-local' : ''}.jsonl`);
  await writeFile(outFile, chats.map((c) => JSON.stringify(c)).join('\n') + (chats.length ? '\n' : ''), { mode: 0o600 });

  const questions = entries.length;
  const cost = entries.reduce((n, e) => n + e.costUsd, 0);
  const count = (outcome: LogEntry['outcome']) => entries.filter((e) => e.outcome === outcome).length;
  console.log(`${keys.length} entries · ${chats.length} chats · ${questions} questions · ${new Set(entries.map((e) => e.visitor)).size} visitors`);
  console.log(`answered ${count('answered')} · refused ${count('refused')} · failed ${count('failed')} · cost $${cost.toFixed(4)}`);
  if (unreadable) console.log(`${unreadable} entries could not be decrypted with ${KEY_FILE}`);
  console.log(`Decrypted chats: ${outFile}`);

  const dashFile = join(OUT_DIR, `dashboard${flag('local') ? '-local' : ''}.html`);
  await writeFile(dashFile, dashboard(entries, chats), { mode: 0o600 });
  console.log(`Dashboard: ${dashFile}`);
  if (!flag('no-open')) spawn('open', [dashFile], { stdio: 'ignore', detached: true }).unref();
}

// A single self-contained page, written next to the decrypted chats and opened
// from disk. It holds real conversations, so it is never published anywhere.
// "Chennai, Tamil Nadu, India 600001 (13.08, 80.27) · Asia/Kolkata"
function where({ geo }: LogEntry): string {
  if (!geo) return '';
  const place = [geo.city, geo.region, geo.country].filter(Boolean).join(', ');
  const coords = geo.latitude != null && geo.longitude != null ? `(${geo.latitude}, ${geo.longitude})` : '';
  return [[place, geo.postalCode, coords].filter(Boolean).join(' '), geo.timezone].filter(Boolean).join(' · ');
}

function dashboard(entries: LogEntry[], chats: LogEntry[]): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const days = new Map<string, { questions: number; cost: number; visitors: Set<string> }>();
  for (const e of entries) {
    const day = days.get(e.at.slice(0, 10)) ?? { questions: 0, cost: 0, visitors: new Set() };
    day.questions++;
    day.cost += e.costUsd;
    day.visitors.add(e.visitor);
    days.set(e.at.slice(0, 10), day);
  }
  const peak = Math.max(1, ...[...days.values()].map((d) => d.questions));
  const count = (outcome: LogEntry['outcome']) => entries.filter((e) => e.outcome === outcome).length;
  const cost = entries.reduce((n, e) => n + e.costUsd, 0);
  const openers = new Map<string, number>();
  for (const c of chats) {
    const first = c.history[0]?.text.trim().toLowerCase() ?? '';
    openers.set(first, (openers.get(first) ?? 0) + 1);
  }
  const card = (label: string, value: string) => `<div class="card"><b>${value}</b><span>${label}</span></div>`;
  const dayRows = [...days]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(
      ([day, d]) =>
        `<tr><td>${day}</td><td><div class="bar" style="width:${(d.questions / peak) * 100}%"></div>${d.questions}</td><td>${d.visitors.size}</td><td>$${d.cost.toFixed(4)}</td></tr>`,
    )
    .join('');
  const openerRows = [...openers]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([q, n]) => `<tr><td>${esc(q)}</td><td>${n}</td></tr>`)
    .join('');
  const chatList = [...chats]
    .reverse()
    .map(
      (c) =>
        `<details><summary><span class="tag ${c.outcome}">${c.outcome}</span> ${esc(c.at.slice(0, 16).replace('T', ' '))} UTC · visitor ${esc(c.visitor.slice(0, 6))} · ${c.history.length / 2} questions · ${esc(c.history[0]?.text.slice(0, 80) ?? '')}</summary>` +
        c.history.map((t) => `<p class="${t.role}">${esc(t.text)}</p>`).join('') +
        (c.sources.length ? `<p class="meta">sources: ${c.sources.map(esc).join(' ')}</p>` : '') +
        (where(c) ? `<p class="meta">from: ${esc(where(c))}</p>` : '') +
        (c.userAgent ? `<p class="meta">browser: ${esc(c.userAgent)}</p>` : '') +
        `</details>`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ask Prash dashboard</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--accent:#2563eb;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--line:#44403c;--accent:#60a5fa;--card:#292524}}
body{margin:0 auto;max-width:960px;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
h1{margin:0 0 4px}h2{margin:32px 0 8px;font-size:17px}.sub{color:var(--muted);margin:0 0 20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.card b{display:block;font-size:22px}.card span{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500;font-size:13px}
.bar{display:inline-block;height:10px;background:var(--accent);border-radius:3px;margin-right:8px;min-width:2px;max-width:70%}
details{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0}summary{cursor:pointer}
p.user{font-weight:600;margin:10px 0 2px}p.assistant{margin:2px 0 8px;color:var(--muted)}p.meta{font-size:12px;color:var(--muted)}
.tag{font-size:12px;padding:1px 6px;border-radius:6px;background:var(--line)}.tag.refused{background:#fde68a;color:#78350f}.tag.failed{background:#fecaca;color:#7f1d1d}
</style>
<h1>Ask Prash</h1><p class="sub">Decrypted ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC · private, on this laptop only</p>
<div class="cards">${card('chats', String(chats.length))}${card('questions', String(entries.length))}${card('visitors', String(new Set(entries.map((e) => e.visitor)).size))}${card('answered', String(count('answered')))}${card('refused', String(count('refused')))}${card('failed', String(count('failed')))}${card('spent', `$${cost.toFixed(4)}`)}</div>
<h2>By day</h2><table><tr><th>Day (UTC)</th><th>Questions</th><th>Visitors</th><th>Cost</th></tr>${dayRows || '<tr><td colspan="4">No chats yet.</td></tr>'}</table>
<h2>Most common opening questions</h2><table><tr><th>Question</th><th>Chats</th></tr>${openerRows || '<tr><td colspan="2">None yet.</td></tr>'}</table>
<h2>Chats, newest first</h2>${chatList || '<p class="sub">None yet.</p>'}`;
}

// Production prunes itself daily; this is for sooner cleanups or the dev logs.
async function prune() {
  const days = option('days', RETENTION_DAYS);
  const store = source();
  const old = expiredKeys(await store.keys(), new Date(), days);
  for (const key of old) await store.delete(key);
  console.log(`Deleted ${old.length} entries older than ${days} days.`);
}

const commands: Record<string, () => Promise<void>> = { keygen, pull, prune };
if (!commands[command]) {
  console.error('Usage: npm run logs -- keygen | pull [--local] | prune [--days 90] [--local]');
  process.exit(1);
}
await commands[command]();
