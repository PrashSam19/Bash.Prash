// Conversation rules and the reply backend for Ask Prash.
//
// The page talks to a Backend that streams reply events. Milestone 1 ships
// cannedBackend, which picks from a few fixed lines and never leaves the
// browser. Milestone 2 swaps in a backend that calls the Netlify Function,
// which enforces these same limits again on the server.

export const LIMITS = {
  // Characters per message.
  maxChars: 500,
  // Questions per conversation. After this the visitor starts a new chat.
  maxTurns: 6,
};

export type Role = 'user' | 'assistant';

export interface Turn {
  role: Role;
  text: string;
}

// A reply arrives as a stream of text pieces, plus the site pages it drew on.
export type ReplyEvent = { type: 'text'; text: string } | { type: 'source'; href: string; title: string };

export interface Backend {
  reply(history: Turn[], signal?: AbortSignal): AsyncIterable<ReplyEvent>;
}

export type MessageCheck =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'turn-limit' };

export function questionsAsked(history: Turn[]): number {
  return history.filter((t) => t.role === 'user').length;
}

// Validates a new message against the history it would join.
export function checkMessage(raw: string, history: Turn[]): MessageCheck {
  const text = raw.trim();
  if (questionsAsked(history) >= LIMITS.maxTurns) return { ok: false, reason: 'turn-limit' };
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > LIMITS.maxChars) return { ok: false, reason: 'too-long' };
  return { ok: true, text };
}

// Only links back into this site are rendered, so a reply can never point
// a visitor somewhere else.
export function isSafeHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

// The refusal lines for requests that want free labor instead of a chat.
// More get added as real conversations come in.
export const SNARK = [
  'G do I look like your analyst to ya?',
  'Hahahaha get a job.',
  "Yeah I'm gonna stop you right there... Just text Prash.",
];

interface Canned {
  match: RegExp;
  text: string | ((pick: () => number) => string);
  sources?: { href: string; title: string }[];
}

// First match wins, so the free-labor check runs before the topic matches.
const CANNED: Canned[] = [
  {
    match:
      /\b(write|draft|make|build|do|fix) (me|my)\b|\b(essay|homework|assignment|spreadsheet|cover letter|analy[sz]e|summari[sz]e|translate|debug)\b/,
    text: (pick) => SNARK[Math.floor(pick() * SNARK.length) % SNARK.length],
  },
  {
    match: /^(hi|hey|hello|yo|sup|what'?s up|howdy)\b/,
    text: "Hey. Fair warning, I'm the preview build: no brain yet, just a handful of canned lines. Ask me about the games, the tools, or who Prash is.",
  },
  {
    match: /\b(games?|motherload|sudoku|prash ?boy|game ?boy|emulator|pac-?man)\b/,
    text: 'The games are the classics I grew up on, rebuilt by hand. Motherload, Sudoku, and a Game Boy Advance you can load your own games into. Go lose an hour.',
    sources: [{ href: '/games/', title: 'Games' }],
  },
  {
    match: /\b(tools?|ai|bot|chatbot|llm|claude|model|you)\b/,
    text: "I'm Ask Prash, and right now I'm a shell. Real answers, grounded in this site, land in the next milestone. Until then you're talking to about six sentences.",
    sources: [{ href: '/tools/', title: 'Tools' }],
  },
  {
    match: /\b(who|about|work|job|resume|background|hire|experience|prash)\b/,
    text: "Short version: web developer and AI engineer who rebuilds old games for fun. Long version's on the About page, and it's more accurate than I am.",
    sources: [{ href: '/about/', title: 'About' }],
  },
];

const FALLBACK =
  'Preview build, so my vocabulary is about six sentences. Try asking about the games, the tools, or who Prash is.';

export function cannedReply(question: string, pick: () => number = Math.random): { text: string; sources: Canned['sources'] } {
  const q = question.toLowerCase().trim();
  const hit = CANNED.find((c) => c.match.test(q));
  if (!hit) return { text: FALLBACK, sources: [] };
  const text = typeof hit.text === 'function' ? hit.text(pick) : hit.text;
  return { text, sources: hit.sources ?? [] };
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });

// Streams a canned line word by word so the page behaves the way it will
// once a real model is streaming tokens.
export function cannedBackend(delayMs = 35, pick: () => number = Math.random): Backend {
  return {
    async *reply(history, signal) {
      const last = [...history].reverse().find((t) => t.role === 'user');
      const { text, sources } = cannedReply(last?.text ?? '', pick);
      await wait(delayMs * 8, signal);
      for (const word of text.split(/(?<= )/)) {
        await wait(delayMs, signal);
        yield { type: 'text', text: word };
      }
      for (const source of sources ?? []) yield { type: 'source', ...source };
    },
  };
}
