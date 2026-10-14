import assert from 'node:assert/strict';
import {
  readHeader,
  describeRom,
  titleFromFileName,
  safeFileName,
  reconcile,
  shelfOrder,
  isRomName,
} from './rom.ts';

function writeAscii(rom: Uint8Array, at: number, text: string) {
  for (let i = 0; i < text.length; i++) rom[at + i] = text.charCodeAt(i);
}

function fakeGba(title: string): Uint8Array {
  const rom = new Uint8Array(0x200);
  writeAscii(rom, 0xa0, title);
  writeAscii(rom, 0xac, 'ABCE');
  rom[0xb2] = 0x96;
  let sum = 0;
  for (let i = 0xa0; i <= 0xbc; i++) sum += rom[i];
  rom[0xbd] = -(sum + 0x19) & 0xff;
  return rom;
}

function fakeGb(title: string, cgbFlag = 0): Uint8Array {
  const rom = new Uint8Array(0x200);
  writeAscii(rom, 0x134, title);
  if (cgbFlag) rom[0x143] = cgbFlag;
  let x = 0;
  for (let i = 0x134; i <= 0x14c; i++) x = (x - rom[i] - 1) & 0xff;
  rom[0x14d] = x;
  return rom;
}

// Headers identify the platform and internal title.
{
  assert.deepEqual(readHeader(fakeGba('PRASH QUEST')), { platform: 'GBA', title: 'PRASH QUEST' });
  assert.deepEqual(readHeader(fakeGb('TETRIS')), { platform: 'GB', title: 'TETRIS' });
  assert.deepEqual(readHeader(fakeGb('COLORGAME', 0x80)), { platform: 'GBC', title: 'COLORGAME' });
  assert.deepEqual(readHeader(fakeGb('ONLYCOLOR', 0xc0)), { platform: 'GBC', title: 'ONLYCOLOR' });
}

// A bad checksum or a zip is not a recognizable cart.
{
  const broken = fakeGba('BROKEN');
  broken[0xbd] ^= 0xff;
  assert.equal(readHeader(broken), null);
  assert.equal(readHeader(new Uint8Array([0x50, 0x4b, 3, 4])), null);
}

// File names make the friendliest titles; header titles are the fallback.
{
  assert.equal(titleFromFileName('Pokemon - Emerald Version (USA, Europe) [!].gba'), 'Pokemon - Emerald Version');
  assert.equal(titleFromFileName('mario_kart_super_circuit.gba'), 'mario kart super circuit');
  assert.deepEqual(describeRom('Some Game (U).gba', fakeGba('SOMEGAME')), { title: 'Some Game', platform: 'GBA' });
  assert.deepEqual(describeRom('1234.gb', fakeGb('SUPER RUN')), { title: 'Super Run', platform: 'GB' });
  assert.deepEqual(describeRom('Zipped.zip', new Uint8Array(4)), { title: 'Zipped', platform: 'GBA' });
  assert.deepEqual(describeRom('Old.gbc', new Uint8Array(4)), { title: 'Old', platform: 'GBC' });
}

// Safe names strip path characters and never share a base name, since the
// emulator names saves after the base name.
{
  assert.equal(safeFileName('a/b:c.gba', []), 'abc.gba');
  assert.equal(safeFileName('Game.gba', ['Game.gb']), 'Game (2).gba');
  assert.equal(safeFileName('game.GBA', ['Game.gba', 'Game (2).gbc']), 'game (3).gba');
  assert.equal(safeFileName('.gba', []), 'game.gba');
  assert.ok(isRomName('x.GBA') && isRomName('x.zip') && !isRomName('x.sav'));
}

// Reconcile keeps good entries, describes unknown ROMs, and drops missing ones.
{
  const stored = {
    version: 1,
    games: {
      'A.gba': { file: 'A.gba', title: 'Alpha', platform: 'GBA', addedAt: '2026-01-01', lastPlayed: '2026-03-01' },
      'Gone.gb': { file: 'Gone.gb', title: 'Gone', platform: 'GB', addedAt: '2026-01-01' },
      'Bad.gbc': { file: 'Bad.gbc', title: 7, platform: 'N64' },
    },
  };
  const lib = reconcile(stored, ['A.gba', 'Bad.gbc', 'New.gb', 'notes.txt'], () => ({ title: 'Fresh', platform: 'GB' }), '2026-02-01');
  assert.deepEqual(Object.keys(lib.games).sort(), ['A.gba', 'Bad.gbc', 'New.gb']);
  assert.equal(lib.games['A.gba'].lastPlayed, '2026-03-01');
  assert.equal(lib.games['Bad.gbc'].title, 'Fresh');
  assert.deepEqual(shelfOrder(lib).map((g) => g.file), ['A.gba', 'Bad.gbc', 'New.gb']);
  assert.deepEqual(Object.keys(reconcile('garbage', ['X.gba'], () => ({ title: 'X', platform: 'GBA' }), 'now').games), ['X.gba']);
}

console.log('prashboy rom tests passed');
