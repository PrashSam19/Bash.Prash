// Prash Boy library logic: reading a ROM's header, naming it on the shelf, and
// keeping its file name safe inside the emulator's file system.
// Pure logic with no DOM, so it runs under node for tests.

export type Platform = 'GBA' | 'GBC' | 'GB';

export interface GameEntry {
  file: string;
  title: string;
  platform: Platform;
  addedAt: string;
  lastPlayed?: string;
}

export interface Library {
  version: 1;
  games: Record<string, GameEntry>;
}

export const ROM_EXTENSIONS = ['gba', 'gbc', 'gb', 'zip', '7z'];

export function emptyLibrary(): Library {
  return { version: 1, games: {} };
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function baseOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? name : name.slice(0, dot);
}

export function isRomName(name: string): boolean {
  return ROM_EXTENSIONS.includes(extensionOf(name));
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = start; i < start + length && i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0) break;
    out += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ' ';
  }
  return out.trim().replace(/\s+/g, ' ');
}

// GBA carts keep a complement checksum over 0xA0..0xBC at 0xBD.
function isGba(rom: Uint8Array): boolean {
  if (rom.length < 0xc0 || rom[0xb2] !== 0x96) return false;
  let sum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) sum += rom[i];
  return ((-(sum + 0x19)) & 0xff) === rom[0xbd];
}

// Game Boy carts keep a header checksum over 0x134..0x14C at 0x14D.
function isGb(rom: Uint8Array): boolean {
  if (rom.length < 0x150) return false;
  let x = 0;
  for (let i = 0x134; i <= 0x14c; i++) x = (x - rom[i] - 1) & 0xff;
  return x === rom[0x14d];
}

export interface RomHeader {
  platform: Platform;
  title: string;
}

// Reads the platform and internal title, or null when the bytes aren't a
// recognizable cart (zipped ROMs, for one).
export function readHeader(rom: Uint8Array): RomHeader | null {
  if (isGba(rom)) return { platform: 'GBA', title: ascii(rom, 0xa0, 12) };
  if (isGb(rom)) {
    const cgb = rom[0x143] === 0x80 || rom[0x143] === 0xc0;
    // Color-era carts gave the title's last bytes to a manufacturer code.
    return { platform: cgb ? 'GBC' : 'GB', title: ascii(rom, 0x134, cgb ? 11 : 16) };
  }
  return null;
}

function platformFromExtension(name: string): Platform {
  const ext = extensionOf(name);
  return ext === 'gb' ? 'GB' : ext === 'gbc' ? 'GBC' : 'GBA';
}

// "Pokemon - Emerald Version (USA, Europe) [!].gba" -> "Pokemon - Emerald Version"
export function titleFromFileName(name: string): string {
  return baseOf(name)
    .replace(/[_]+/g, ' ')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function describeRom(name: string, rom: Uint8Array): { title: string; platform: Platform } {
  const header = readHeader(rom);
  const fromName = titleFromFileName(name);
  const title = /[a-z]/i.test(fromName)
    ? fromName
    : header?.title
      ? titleCase(header.title)
      : 'Untitled game';
  return { title, platform: header?.platform ?? platformFromExtension(name) };
}

// The emulator names a game's save after the ROM with its extension dropped, so
// two ROMs must never share a base name or they would share a save.
export function safeFileName(name: string, existing: string[]): string {
  const ext = extensionOf(name);
  const cleaned =
    baseOf(name)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'game';
  const taken = new Set(existing.map((f) => baseOf(f).toLowerCase()));
  let base = cleaned;
  for (let n = 2; taken.has(base.toLowerCase()); n++) base = `${cleaned} (${n})`;
  return `${base}.${ext}`;
}

// Shelf order: most recently played first, then newest added.
export function shelfOrder(library: Library): GameEntry[] {
  const stamp = (g: GameEntry) => g.lastPlayed ?? g.addedAt;
  return Object.values(library.games).sort((a, b) => stamp(b).localeCompare(stamp(a)));
}

// Accepts whatever was on disk and keeps only well-formed entries for ROMs
// that still exist; ROMs without an entry get one from their header.
export function reconcile(
  stored: unknown,
  files: string[],
  describe: (file: string) => { title: string; platform: Platform },
  now: string,
): Library {
  const library = emptyLibrary();
  const games =
    stored && typeof stored === 'object' && (stored as Library).version === 1
      ? (stored as Library).games ?? {}
      : {};
  for (const file of files.filter(isRomName)) {
    const g = games[file];
    if (g && typeof g.title === 'string' && ['GBA', 'GBC', 'GB'].includes(g.platform)) {
      library.games[file] = {
        file,
        title: g.title,
        platform: g.platform,
        addedAt: typeof g.addedAt === 'string' ? g.addedAt : now,
        ...(typeof g.lastPlayed === 'string' ? { lastPlayed: g.lastPlayed } : {}),
      };
    } else {
      library.games[file] = { file, ...describe(file), addedAt: now };
    }
  }
  return library;
}

// A stable hue per title so each cartridge on the shelf gets its own color.
export function labelHue(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return h % 360;
}
