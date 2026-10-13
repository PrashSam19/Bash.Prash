// Motherload saves, made at the save station. As in the original, a save keeps
// your cash, upgrades, items, hull, and fuel, but not your tunnels: loading a
// save drops you on the surface of a freshly generated underground.
// Pure logic with no DOM, so it runs under node for tests.

import {
  UPGRADES,
  UPGRADE_KINDS,
  ITEM_KINDS,
  newGame,
  oreFor,
  stats,
  type Game,
  type Tile,
  type UpgradeKind,
  type ItemKind,
} from './engine.ts';
import { TRANSMISSIONS } from './story.ts';

// Version 3 stopped saving the world, following the original.
export const SAVE_VERSION = 3;

export interface SaveData {
  version: typeof SAVE_VERSION;
  savedAt: string;
  cash: number;
  fuel: number;
  hull: number;
  cargo: number[];
  upgrades: Record<UpgradeKind, number>;
  items: Record<ItemKind, number>;
  story: string[];
  record: { deepest: number; earned: number };
}

export function serialize(game: Game): SaveData {
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    cash: game.cash,
    fuel: game.fuel,
    hull: game.hull,
    cargo: [...game.cargo],
    upgrades: { ...game.upgrades },
    items: { ...game.items },
    story: [...game.story],
    record: { ...game.record },
  };
}

const isNum = (v: unknown, min = -Infinity, max = Infinity): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/**
 * Rebuild a game from a save onto a new world generated from `seed`. Returns
 * null for anything malformed, from another version, or out of range, so bad
 * data can't break the game.
 */
export function deserialize(raw: unknown, seed: number): Game | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<SaveData>;
  if (d.version !== SAVE_VERSION) return null;

  const upgrades = d.upgrades;
  if (!upgrades || typeof upgrades !== 'object') return null;
  for (const kind of UPGRADE_KINDS) {
    const tier = upgrades[kind];
    if (!Number.isInteger(tier) || tier < 0 || tier >= UPGRADES[kind].tiers.length) return null;
  }
  const items = d.items;
  if (!items || typeof items !== 'object') return null;
  for (const kind of ITEM_KINDS) {
    if (!Number.isInteger(items[kind]) || items[kind] < 0 || items[kind] > 9999) return null;
  }

  const game = newGame(seed);
  game.upgrades = { ...upgrades };
  const max = stats(game);
  if (!isNum(d.cash, 0) || !isNum(d.fuel, 0, max.maxFuel) || !isNum(d.hull, 0, max.maxHull)) return null;
  if (!Array.isArray(d.cargo) || d.cargo.length > max.cargoCap) return null;
  if (!d.cargo.every((t) => oreFor(t as Tile))) return null;
  if (!Array.isArray(d.story) || !d.story.every((id) => TRANSMISSIONS.some((t) => t.id === id))) return null;
  const record = d.record;
  if (!record || !isNum(record.deepest, 0) || !isNum(record.earned, 0)) return null;

  game.items = { ...items };
  game.cash = d.cash;
  game.fuel = d.fuel;
  game.hull = d.hull;
  game.cargo = d.cargo as Tile[];
  game.story = [...d.story];
  game.record = { deepest: record.deepest, earned: record.earned };
  return game;
}
