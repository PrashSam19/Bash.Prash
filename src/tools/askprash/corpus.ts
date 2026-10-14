// Turns a built HTML page into a plain-text document for the Ask Prash corpus.

export interface CorpusDoc {
  href: string;
  title: string;
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

// Returns null for pages with no <main> or no readable text.
export function pageText(html: string, href: string): CorpusDoc | null {
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (!main) return null;
  const rawTitle = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? href;
  // Page titles read "Motherload · Prashanth Sampathkumar"; keep the first part.
  const title = decode(rawTitle).split(' · ')[0].trim() || href;

  const text = decode(
    main
      .replace(/<(script|style|svg|noscript|canvas|template)\b[\s\S]*?<\/\1>/gi, ' ')
      // Buttons and form controls are game UI, not content.
      .replace(/<(button|select|textarea)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-6]|li|div|section|ol|ul|blockquote|pre|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  return text ? { href, title, text } : null;
}
