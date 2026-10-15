// Prash's side of the encrypted Ask Prash logs. Runs on the laptop that holds
// the private key; nothing here is deployed.
//
//   npm run logs -- keygen              make the key pair (once)
//   npm run logs -- pull                download, decrypt, and summarize
//   npm run logs -- pull --local        same, from the dev server's logs
//   npm run logs -- prune --days 90     delete entries older than 90 days
//
// Production access needs NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN in .env.
// Decrypted chats are written outside the repo, to ~/.ask-prash/logs/.

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
