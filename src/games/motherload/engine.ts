// Motherload engine: world generation, tile queries, the pod's movement and
// digging, shops, items, and story triggers. Pure logic with no DOM, so it
// runs under node for tests. Numbers follow the original game as documented
// on the Motherload wiki (motherload.fandom.com); where the wiki is silent the
// value is an estimate and says so.
//
// Positions are in world pixels; the world is a grid of TILE-sized tiles,
// and one tile is 12.5 ft, as in the original.

import { TRANSMISSIONS } from './story.ts';

export const TILE = 32;
export const FEET_PER_TILE = 12.5;
export const PX_PER_FT = TILE / FEET_PER_TILE;
export const WORLD_W = 32; // the original map is 32 squares (400 ft) across
export const SKY_ROWS = 6; // open air above the surface
// Diggable rows: the original bottoms out around -7,287 ft. The boss arena
// below it arrives in a later milestone; for now the floor is bedrock.
export const GROUND_ROWS = 583;
export const WORLD_H = SKY_ROWS + GROUND_ROWS + 1;
// Below this depth the altimeter scrambles into "?XXXXX ft.".
export const SCRAMBLE_FT = 5813;

export const T = {
  AIR: 0,
  DIRT: 1,
  ROCK: 2,
  BEDROCK: 3,
  IRONIUM: 4,
  BRONZIUM: 5,
  SILVERIUM: 6,
  GOLDIUM: 7,
  PLATINIUM: 8,
  EINSTEINIUM: 9,
  EMERALD: 10,
  RUBY: 11,
  DIAMOND: 12,
  AMAZONITE: 13,
  // Ground under the shops: can't be dug or blasted.
  CONCRETE: 14,
  // Lava is visible; gas looks exactly like dirt.
  LAVA: 15,
  GAS: 16,
  // Artifacts pay cash the moment they're dug up.
  BONES: 17,
  TREASURE: 18,
  SKELETON: 19,
  RELIC: 20,
} as const;

export type Tile = (typeof T)[keyof typeof T];

export interface Ore {
  tile: Tile;
  name: string;
  value: number;
  weight: number; // kg
  // Rows below the surface where the ore first appears, and where it is common.
  minRow: number;
  commonRow: number;
  // Chance per tile once common.
  chance: number;
  color: string;
}

const row = (ft: number) => Math.round(ft / FEET_PER_TILE);

// Values, weights, and depths from the wiki's mineral table. Chances are tuned.
export const ORES: Ore[] = [
  { tile: T.IRONIUM, name: 'Ironium', value: 30, weight: 10, minRow: row(25), commonRow: row(25), chance: 0.05, color: '#6b6a74' },
  { tile: T.BRONZIUM, name: 'Bronzium', value: 60, weight: 10, minRow: row(25), commonRow: row(25), chance: 0.04, color: '#cf7128' },
  { tile: T.SILVERIUM, name: 'Silverium', value: 100, weight: 10, minRow: row(25), commonRow: row(25), chance: 0.03, color: '#c9ced6' },
  { tile: T.GOLDIUM, name: 'Goldium', value: 250, weight: 20, minRow: row(25), commonRow: row(250), chance: 0.022, color: '#e8b51f' },
  { tile: T.PLATINIUM, name: 'Platinium', value: 750, weight: 30, minRow: row(800), commonRow: row(1700), chance: 0.02, color: '#8e6bc4' },
  { tile: T.EINSTEINIUM, name: 'Einsteinium', value: 2000, weight: 40, minRow: row(1600), commonRow: row(2600), chance: 0.018, color: '#5fd14e' },
  { tile: T.EMERALD, name: 'Emerald', value: 5000, weight: 60, minRow: row(2400), commonRow: row(4000), chance: 0.016, color: '#1f9d5a' },
  { tile: T.RUBY, name: 'Ruby', value: 20000, weight: 80, minRow: row(4000), commonRow: row(4800), chance: 0.014, color: '#c81f3a' },
  { tile: T.DIAMOND, name: 'Diamond', value: 100000, weight: 100, minRow: row(4400), commonRow: row(5700), chance: 0.012, color: '#dff6ff' },
  { tile: T.AMAZONITE, name: 'Amazonite', value: 500000, weight: 120, minRow: row(5500), commonRow: row(6200), chance: 0.01, color: '#38d6c4' },
];

export interface Artifact {
  tile: Tile;
  name: string;
  value: number;
  // Relative odds among artifacts.
  odds: number;
}

export const ARTIFACTS: Artifact[] = [
  { tile: T.BONES, name: 'Dinosaur Bones', value: 1000, odds: 50 },
  { tile: T.TREASURE, name: 'Treasure', value: 5000, odds: 30 },
  { tile: T.SKELETON, name: 'Martian Skeleton', value: 10000, odds: 15 },
  { tile: T.RELIC, name: 'Religious Artifact', value: 50000, odds: 5 },
];

const ORE_BY_TILE = new Map<Tile, Ore>(ORES.map((o) => [o.tile, o]));
const ARTIFACT_BY_TILE = new Map<Tile, Artifact>(ARTIFACTS.map((a) => [a.tile, a]));

export const oreFor = (tile: Tile) => ORE_BY_TILE.get(tile);
export const artifactFor = (tile: Tile) => ARTIFACT_BY_TILE.get(tile);

/** Small, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BuildingId = 'fuel' | 'processing' | 'junk' | 'repair';

export interface Building {
  id: BuildingId;
  name: string;
  // First and last tile column of the footprint, inclusive.
  x0: number;
  x1: number;
}

// Left to right, as on the original surface.
export const BUILDINGS: Building[] = [
  { id: 'fuel', name: 'Propellant Vendor 12000', x0: 1, x1: 4 },
  { id: 'processing', name: 'Mineral Processor 3000', x0: 8, x1: 12 },
  { id: 'junk', name: 'AutoBuy 2000', x0: 18, x1: 22 },
  { id: 'repair', name: 'Emendation Station 3500', x0: 27, x1: 30 },
];

// You're dropped off just right of the fuel station.
export const SPAWN_COL = 6;

/**
 * The save point, the Quantum Particle State Analyzer 6000, hovers about
 * 40 ft up between the Mineral Processor and AutoBuy. Flying the pod into
 * this box (in tiles, inclusive) opens it.
 */
export const SAVE_STATION = { x0: 14, x1: 15, y0: 2, y1: 3 };

export interface World {
  seed: number;
  tiles: Uint8Array;
}

const STONE_FROM = row(1600);
const LAVA_FROM = row(3000);
const GAS_FROM = row(4750);
const GAS_SURGE = row(4950);

const underShop = (x: number) => BUILDINGS.some((b) => x >= b.x0 && x <= b.x1);

export function generateWorld(seed: number): World {
  const rand = mulberry32(seed);
  const tiles = new Uint8Array(WORLD_W * WORLD_H);
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const d = y - SKY_ROWS;
      // The two squares under each shop are solid, empty, and indestructible.
      tiles[y * WORLD_W + x] = d >= 0 && d < 2 && underShop(x) ? T.CONCRETE : groundTile(y, rand);
    }
  }
  return { seed, tiles };
}

function groundTile(y: number, rand: () => number): Tile {
  if (y < SKY_ROWS) return T.AIR;
  if (y === WORLD_H - 1) return T.BEDROCK;
  const d = y - SKY_ROWS;
  if (d < 2) return T.DIRT;
  if (rand() < 0.035) return T.AIR; // natural pockets
  if (d >= STONE_FROM && rand() < 0.02 + ((d - STONE_FROM) / (GROUND_ROWS - STONE_FROM)) * 0.08) return T.ROCK;
  if (d >= LAVA_FROM && rand() < 0.012 + ((d - LAVA_FROM) / (GROUND_ROWS - LAVA_FROM)) * 0.025) return T.LAVA;
  if (d >= GAS_FROM) {
    // Rare at first, then common from about -4,950 ft, and everywhere near the bottom.
    const gas = d < GAS_SURGE ? 0.004 : 0.02 + ((d - GAS_SURGE) / (GROUND_ROWS - GAS_SURGE)) * 0.07;
    if (rand() < gas) return T.GAS;
  }
  // Artifacts turn up at any depth, rarely.
  if (rand() < 0.005) {
    let r = rand() * 100;
    for (const a of ARTIFACTS) {
      if (r < a.odds) return a.tile;
      r -= a.odds;
    }
  }
  const r = rand();
  let acc = 0;
  for (const ore of ORES) {
    if (d < ore.minRow) continue;
    // Ramp from scarce at its first depth to common at its common depth.
    const ramp = ore.commonRow > ore.minRow ? Math.min(1, (d - ore.minRow) / (ore.commonRow - ore.minRow)) : 1;
    acc += ore.chance * (0.15 + 0.85 * ramp);
    if (r < acc) return ore.tile;
  }
  return T.DIRT;
}

export function tileAt(world: World, tx: number, ty: number): Tile {
  if (ty < 0) return T.AIR;
  if (tx < 0 || tx >= WORLD_W || ty >= WORLD_H) return T.BEDROCK;
  return world.tiles[ty * WORLD_W + tx] as Tile;
}

export function setTile(world: World, tx: number, ty: number, tile: Tile) {
  if (tx < 0 || tx >= WORLD_W || ty < 0 || ty >= WORLD_H) return;
  world.tiles[ty * WORLD_W + tx] = tile;
}

export const isSolid = (t: Tile) => t !== T.AIR;
export const isDiggable = (t: Tile) => t !== T.AIR && t !== T.ROCK && t !== T.BEDROCK && t !== T.CONCRETE;
const isBlastable = (t: Tile) => t !== T.AIR && t !== T.BEDROCK && t !== T.CONCRETE;

// --- Upgrades ---------------------------------------------------------------

export type UpgradeKind = 'drill' | 'hull' | 'engine' | 'tank' | 'radiator' | 'cargo';

export interface UpgradeTier {
  name: string;
  price: number;
  value: number;
}

export interface UpgradeLine {
  label: string;
  unit: string;
  tiers: UpgradeTier[];
}

// Tier 0 is what the pod starts with. `value` is drilling speed in ft/s, hull
// points, horsepower, litres, radiator effectiveness in percent, or cargo
// slots. All shop tiers are from the wiki; the Stock Drill's speed is not
// documented, so 20 ft/s is an estimate.
export const UPGRADES: Record<UpgradeKind, UpgradeLine> = {
  drill: {
    label: 'Drill',
    unit: 'ft/s',
    tiers: [
      { name: 'Stock Drill', price: 0, value: 20 },
      { name: 'Silvide Drill', price: 750, value: 28 },
      { name: 'Goldium Drill', price: 2000, value: 40 },
      { name: 'Emerald Drill', price: 5000, value: 50 },
      { name: 'Ruby Drill', price: 20000, value: 70 },
      { name: 'Diamond Drill', price: 100000, value: 95 },
      { name: 'Amazonite Drill', price: 500000, value: 120 },
    ],
  },
  hull: {
    label: 'Hull',
    unit: 'HP',
    tiers: [
      { name: 'Stock Hull', price: 0, value: 10 },
      { name: 'Ironium Hull', price: 750, value: 17 },
      { name: 'Bronzium Hull', price: 2000, value: 30 },
      { name: 'Steel Hull', price: 5000, value: 50 },
      { name: 'Platinium Hull', price: 20000, value: 80 },
      { name: 'Einsteinium Hull', price: 100000, value: 120 },
      { name: 'Energy-Shielded Hull', price: 500000, value: 180 },
    ],
  },
  engine: {
    label: 'Engine',
    unit: 'hp',
    tiers: [
      { name: 'Stock Engine', price: 0, value: 150 },
      { name: 'V4 1600cc', price: 750, value: 160 },
      { name: 'V4 2.0 Ltr Turbo', price: 2000, value: 170 },
      { name: 'V6 3.8 Ltr', price: 5000, value: 180 },
      { name: 'V8 Supercharged 5.0 Ltr', price: 20000, value: 190 },
      { name: 'V12 6.0 Ltr', price: 100000, value: 200 },
      { name: 'V16 Jag Engine', price: 500000, value: 210 },
    ],
  },
  tank: {
    label: 'Fuel Tank',
    unit: 'L',
    tiers: [
      { name: 'Micro Tank', price: 0, value: 10 },
      { name: 'Medium Tank', price: 750, value: 15 },
      { name: 'Huge Tank', price: 2000, value: 25 },
      { name: 'Gigantic Tank', price: 5000, value: 40 },
      { name: 'Titanic Tank', price: 20000, value: 60 },
      { name: 'Leviathan Tank', price: 100000, value: 100 },
      { name: 'Liquid Compression Tank', price: 500000, value: 150 },
    ],
  },
  radiator: {
    label: 'Radiator',
    unit: '%',
    tiers: [
      { name: 'Stock Fan', price: 0, value: 0 },
      { name: 'Dual Fans', price: 2000, value: 10 },
      { name: 'Single Turbine', price: 5000, value: 25 },
      { name: 'Dual Turbines', price: 20000, value: 40 },
      { name: 'Puron Cooling', price: 100000, value: 60 },
      { name: 'Tri-Turbine Freon Array', price: 500000, value: 80 },
    ],
  },
  cargo: {
    label: 'Cargo Bay',
    unit: 'slots',
    tiers: [
      { name: 'Micro Bay', price: 0, value: 7 },
      { name: 'Medium Bay', price: 750, value: 15 },
      { name: 'Huge Bay', price: 2000, value: 25 },
      { name: 'Gigantic Bay', price: 5000, value: 40 },
      { name: 'Titanic Bay', price: 20000, value: 70 },
      { name: 'Leviathan Bay', price: 100000, value: 120 },
    ],
  },
};

export const UPGRADE_KINDS = Object.keys(UPGRADES) as UpgradeKind[];

export const FUEL_PRICE = 1; // dollars per litre
export const REPAIR_PRICE = 15; // dollars per hull point
export const START_CASH = 20;
// You arrive nearly empty and have to refuel first (estimate).
export const START_FUEL = 2;

// Fuel use in litres per second: about 5 L/min idling and 17 L/min flying,
// per the wiki. The starting tank lasts about 30 s of digging.
const BURN_IDLE = 5 / 60;
const BURN_THRUST = 12 / 60;
const BURN_DRILL = 0.25;
const BURN_DRIVE = 0.03;

// --- Items ------------------------------------------------------------------

export type ItemKind = 'fuel' | 'nanobots' | 'dynamite' | 'c4' | 'quantum' | 'matter';

export interface Item {
  name: string;
  price: number;
  key: string; // KeyboardEvent.code
  label: string; // the key as shown to the player
  description: string;
}

export const ITEMS: Record<ItemKind, Item> = {
  fuel: { name: 'Reserve Fuel Tank', price: 2000, key: 'KeyF', label: 'F', description: 'Refuels 25 litres, anywhere.' },
  nanobots: { name: 'Hull Repair Nanobots', price: 7500, key: 'KeyR', label: 'R', description: 'Repairs 30 hull points, anywhere.' },
  dynamite: { name: 'Dynamite', price: 2000, key: 'KeyX', label: 'X', description: 'Blows up a 3×3 area around the pod.' },
  c4: { name: 'Plastic Explosive', price: 5000, key: 'KeyC', label: 'C', description: 'Blows up a 5×5 area around the pod.' },
  quantum: { name: 'Quantum Teleporter', price: 2000, key: 'KeyQ', label: 'Q', description: 'Teleports you near the surface. The landing can be rough.' },
  matter: { name: 'Matter Transmitter', price: 10000, key: 'KeyM', label: 'M', description: 'Teleports you safely next to the Propellant Vendor.' },
};

export const ITEM_KINDS = Object.keys(ITEMS) as ItemKind[];

const RESERVE_FUEL = 25;
const NANOBOT_REPAIR = 30;
const BLAST_RADIUS = { dynamite: 1, c4: 2, gas: 1 } as const;

// --- Hazards ------------------------------------------------------------------

export type Hazard = 'lava' | 'gas';

/**
 * Hull damage from a hazard, from the wiki: lava does about 41 or 58; gas
 * does (depth − 3000) / 15. Both are cut by the radiator's effectiveness.
 */
export function hazardDamage(kind: Hazard, depthFt: number, radiatorPct: number, rand = Math.random): number {
  const base = kind === 'lava' ? (rand() < 0.5 ? 41 : 58) : Math.max(0, (depthFt - 3000) / 15);
  return base * (1 - radiatorPct / 100);
}

/** Fall damage by equivalent fall height, from the wiki's table. Falls of 24 ft or less are free. */
export function fallDamage(heightFt: number): number {
  if (heightFt <= 24) return 0;
  if (heightFt <= 36) return 3;
  if (heightFt <= 66) return 4;
  if (heightFt <= 118) return 5;
  if (heightFt <= 218) return 6;
  if (heightFt <= 575) return 7;
  return 8;
}

// --- Pod --------------------------------------------------------------------

export const POD_W = 26;
export const POD_H = 26;
export const POD_MASS = 1980; // kg, from the wiki
const GRAVITY = 700;
// Lift scales with horsepower over total mass, tuned so the best engine just
// fails to take off at 6,200 kg, as the wiki describes.
const LIFT_K = (GRAVITY * 6200) / 210;
const STOCK_LIFT = (LIFT_K * 150) / POD_MASS;
const MAX_UP = 240;
// Terminal velocity: fall speed stops increasing after a long drop.
const MAX_FALL = 1100;
const ACCEL = 800;
const MAX_VX = 200;
const FRICTION = 900;
const AIR_DRAG = 250;

export type DigDir = 'down' | 'left' | 'right';

export interface Dig {
  tx: number;
  ty: number;
  dir: DigDir;
  tile: Tile;
  t: number;
  dur: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface Pod {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  facing: 1 | -1;
  thrusting: boolean;
  dig: Dig | null;
}

export interface Input {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export type GameOver = 'fuel' | 'hull';

export type GameEvent =
  | { type: 'dug'; tile: Tile; tx: number; ty: number }
  | { type: 'collected'; ore: Ore }
  | { type: 'cargoFull'; ore: Ore }
  | { type: 'artifact'; artifact: Artifact }
  | { type: 'damage'; amount: number }
  | { type: 'hazard'; kind: Hazard; tx: number; ty: number; amount: number }
  | { type: 'blast'; tx: number; ty: number; radius: number }
  | { type: 'teleport' }
  | { type: 'item'; kind: ItemKind }
  | { type: 'transmission'; id: string }
  | { type: 'over'; reason: GameOver };

export interface Game {
  world: World;
  pod: Pod;
  cash: number;
  fuel: number;
  hull: number;
  // Ore tiles in the order they were picked up.
  cargo: Tile[];
  upgrades: Record<UpgradeKind, number>;
  items: Record<ItemKind, number>;
  // Transmissions already received, so each plays (and pays) once.
  story: string[];
  over: GameOver | null;
  // Lifetime bests shown on the game-over screen.
  record: { deepest: number; earned: number };
}

export interface Stats {
  maxFuel: number;
  maxHull: number;
  cargoCap: number;
  drillSpeed: number; // ft/s
  horsepower: number;
  radiator: number; // percent
  mass: number; // kg, pod plus cargo
}

export function tierOf(game: Game, kind: UpgradeKind): UpgradeTier {
  return UPGRADES[kind].tiers[game.upgrades[kind]];
}

export function cargoMass(game: Game): number {
  return game.cargo.reduce<number>((sum, t) => sum + (oreFor(t)?.weight ?? 0), 0);
}

export function stats(game: Game): Stats {
  return {
    maxFuel: tierOf(game, 'tank').value,
    maxHull: tierOf(game, 'hull').value,
    cargoCap: tierOf(game, 'cargo').value,
    drillSpeed: tierOf(game, 'drill').value,
    horsepower: tierOf(game, 'engine').value,
    radiator: tierOf(game, 'radiator').value,
    mass: POD_MASS + cargoMass(game),
  };
}

function surfacePod(col: number): Pod {
  return {
    x: col * TILE + (TILE - POD_W) / 2,
    y: SKY_ROWS * TILE - POD_H,
    vx: 0,
    vy: 0,
    onGround: true,
    facing: 1,
    thrusting: false,
    dig: null,
  };
}

export function newGame(seed: number): Game {
  return {
    cash: START_CASH,
    fuel: START_FUEL,
    hull: UPGRADES.hull.tiers[0].value,
    cargo: [],
    upgrades: { drill: 0, hull: 0, engine: 0, tank: 0, radiator: 0, cargo: 0 },
    items: { fuel: 0, nanobots: 0, dynamite: 0, c4: 0, quantum: 0, matter: 0 },
    story: [],
    over: null,
    record: { deepest: 0, earned: 0 },
    world: generateWorld(seed),
    pod: surfacePod(SPAWN_COL),
  };
}

/** Feet below the surface, measured at the bottom of the pod. Zero on the surface. */
export function depthFeet(pod: Pod): number {
  return Math.max(0, Math.round(((pod.y + POD_H) / TILE - SKY_ROWS) * FEET_PER_TILE));
}

/** Seconds to drill one tile. Soil gets harder with depth (estimate: 2.8× slower at the bottom). */
export function digTime(drillSpeed: number, rowsDeep: number): number {
  return (FEET_PER_TILE / drillSpeed) * (1 + Math.max(0, rowsDeep) / 320);
}

/** First and last tile index covered by a span of pixels. Touching edges don't count. */
function span(start: number, length: number): [number, number] {
  return [Math.floor(start / TILE), Math.ceil((start + length) / TILE) - 1];
}

/** Advance the game by `dt` seconds. Returns what happened during the step. */
export function step(game: Game, input: Input, dt: number): GameEvent[] {
  const pod = game.pod;
  const events: GameEvent[] = [];
  if (game.over) return events;
  pod.thrusting = false;

  if (pod.dig) {
    burn(game, BURN_IDLE + BURN_DRILL, dt, events);
    if (!game.over) advanceDig(game, dt, events);
    checkStory(game, events);
    return events;
  }

  const s = stats(game);
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) pod.facing = dir as 1 | -1;

  if (pod.onGround && !input.up && tryStartDig(game, input, dir)) return events;

  // Heavier loads and weaker engines accelerate and climb more slowly.
  const drive = Math.sqrt((s.horsepower / 150) * (POD_MASS / s.mass));
  if (dir !== 0) {
    pod.vx += dir * ACCEL * drive * dt;
  } else {
    const drag = (pod.onGround ? FRICTION : AIR_DRAG) * dt;
    pod.vx = Math.abs(pod.vx) <= drag ? 0 : pod.vx - Math.sign(pod.vx) * drag;
  }
  const maxVx = MAX_VX * Math.min(1.3, drive);
  pod.vx = Math.max(-maxVx, Math.min(maxVx, pod.vx));

  const lift = (LIFT_K * s.horsepower) / s.mass;
  pod.vy += GRAVITY * dt;
  if (input.up) {
    pod.vy -= lift * dt;
    pod.thrusting = true;
  }
  // Climb speed tracks spare lift; with none to spare, thrust only slows a fall.
  const maxUp = MAX_UP * Math.max(0, Math.min(1.3, (lift - GRAVITY) / (STOCK_LIFT - GRAVITY)));
  pod.vy = Math.max(-maxUp, Math.min(MAX_FALL, pod.vy));

  moveX(game, pod.vx * dt);
  const impact = moveY(game, pod.vy * dt);
  if (impact > 0) {
    const heightFt = (impact * impact) / (2 * GRAVITY) / PX_PER_FT;
    const hurt = fallDamage(heightFt);
    if (hurt > 0) damage(game, hurt, events);
  }

  game.record.deepest = Math.max(game.record.deepest, depthFeet(pod));
  const rate = BURN_IDLE + (dir !== 0 ? BURN_DRIVE : 0) + (pod.thrusting ? BURN_THRUST : 0);
  burn(game, rate, dt, events);
  checkStory(game, events);
  return events;
}

/** Plays each depth-triggered transmission once, paying any reward. */
function checkStory(game: Game, events: GameEvent[]) {
  if (game.over) return;
  const depth = depthFeet(game.pod);
  for (const t of TRANSMISSIONS) {
    if (t.depth === undefined || depth < t.depth || game.story.includes(t.id)) continue;
    game.story.push(t.id);
    game.cash += t.reward ?? 0;
    events.push({ type: 'transmission', id: t.id });
  }
}

/** Marks a non-depth transmission (like the welcome message) as received. */
export function receive(game: Game, id: string): boolean {
  if (game.story.includes(id)) return false;
  game.story.push(id);
  return true;
}

function burn(game: Game, rate: number, dt: number, events: GameEvent[]) {
  if (game.over) return;
  game.fuel = Math.max(0, game.fuel - rate * dt);
  if (game.fuel === 0) end(game, 'fuel', events);
}

function damage(game: Game, amount: number, events: GameEvent[]) {
  if (game.over) return;
  game.hull = Math.max(0, game.hull - amount);
  events.push({ type: 'damage', amount });
  if (game.hull === 0) end(game, 'hull', events);
}

function end(game: Game, reason: GameOver, events: GameEvent[]) {
  game.over = reason;
  game.pod.dig = null;
  events.push({ type: 'over', reason });
}

function tryStartDig(game: Game, input: Input, dir: number): boolean {
  const { pod, world } = game;
  if (input.down) {
    const tx = Math.floor((pod.x + POD_W / 2) / TILE);
    const ty = Math.floor((pod.y + POD_H) / TILE);
    if (!isDiggable(tileAt(world, tx, ty))) return false;
    startDig(game, tx, ty, 'down');
    return true;
  }
  if (dir !== 0) {
    // Only when pressed flush against the wall: the pixel just past the pod's
    // leading edge lands in the wall tile only if there is no gap.
    const tx = dir > 0 ? Math.floor((pod.x + POD_W) / TILE) : Math.floor((pod.x - 1) / TILE);
    const ty = Math.floor((pod.y + POD_H - 1) / TILE);
    const touching = dir > 0 ? pod.x + POD_W === tx * TILE : pod.x === (tx + 1) * TILE;
    if (!touching || !isDiggable(tileAt(world, tx, ty))) return false;
    startDig(game, tx, ty, dir > 0 ? 'right' : 'left');
    return true;
  }
  return false;
}

function startDig(game: Game, tx: number, ty: number, dir: DigDir) {
  const pod = game.pod;
  pod.vx = 0;
  pod.vy = 0;
  pod.dig = {
    tx,
    ty,
    dir,
    tile: tileAt(game.world, tx, ty),
    t: 0,
    dur: digTime(stats(game).drillSpeed, ty - SKY_ROWS),
    fromX: pod.x,
    fromY: pod.y,
    toX: tx * TILE + (TILE - POD_W) / 2,
    toY: ty * TILE + TILE - POD_H,
  };
}

function advanceDig(game: Game, dt: number, events: GameEvent[]) {
  const pod = game.pod;
  const dig = pod.dig!;
  dig.t += dt;
  const k = Math.min(dig.t / dig.dur, 1);
  pod.x = dig.fromX + (dig.toX - dig.fromX) * k;
  pod.y = dig.fromY + (dig.toY - dig.fromY) * k;
  if (k < 1) return;
  setTile(game.world, dig.tx, dig.ty, T.AIR);
  pod.x = dig.toX;
  pod.y = dig.toY;
  pod.dig = null;
  events.push({ type: 'dug', tile: dig.tile, tx: dig.tx, ty: dig.ty });

  const depthFt = (dig.ty - SKY_ROWS + 1) * FEET_PER_TILE;
  if (dig.tile === T.LAVA || dig.tile === T.GAS) {
    const kind = dig.tile === T.LAVA ? 'lava' : 'gas';
    const amount = hazardDamage(kind, depthFt, stats(game).radiator);
    events.push({ type: 'hazard', kind, tx: dig.tx, ty: dig.ty, amount });
    // Gas explodes like dynamite, clearing the tiles around it.
    if (kind === 'gas') blast(game, dig.tx, dig.ty, BLAST_RADIUS.gas, events);
    damage(game, amount, events);
  }
  const ore = oreFor(dig.tile);
  if (ore) {
    if (game.cargo.length < stats(game).cargoCap) {
      game.cargo.push(dig.tile);
      events.push({ type: 'collected', ore });
    } else {
      events.push({ type: 'cargoFull', ore });
    }
  }
  const artifact = artifactFor(dig.tile);
  if (artifact) {
    game.cash += artifact.value;
    game.record.earned += artifact.value;
    events.push({ type: 'artifact', artifact });
  }
  pod.onGround = isSolid(tileAt(game.world, dig.tx, dig.ty + 1));
}

function blast(game: Game, cx: number, cy: number, r: number, events: GameEvent[]) {
  for (let ty = cy - r; ty <= cy + r; ty++) {
    for (let tx = cx - r; tx <= cx + r; tx++) {
      // Minerals and artifacts caught in a blast are destroyed.
      if (ty >= SKY_ROWS && isBlastable(tileAt(game.world, tx, ty))) setTile(game.world, tx, ty, T.AIR);
    }
  }
  game.pod.onGround = false;
  events.push({ type: 'blast', tx: cx, ty: cy, radius: r });
}

function moveX(game: Game, dx: number) {
  const pod = game.pod;
  pod.x += dx;
  const maxX = WORLD_W * TILE - POD_W;
  if (pod.x < 0 || pod.x > maxX) {
    pod.x = Math.max(0, Math.min(maxX, pod.x));
    pod.vx = 0;
  }
  const [top, bottom] = span(pod.y, POD_H);
  if (dx > 0) {
    const tx = span(pod.x, POD_W)[1];
    for (let ty = top; ty <= bottom; ty++) {
      if (isSolid(tileAt(game.world, tx, ty))) {
        pod.x = tx * TILE - POD_W;
        pod.vx = 0;
        return;
      }
    }
  } else if (dx < 0) {
    const tx = span(pod.x, POD_W)[0];
    for (let ty = top; ty <= bottom; ty++) {
      if (isSolid(tileAt(game.world, tx, ty))) {
        pod.x = (tx + 1) * TILE;
        pod.vx = 0;
        return;
      }
    }
  }
}

/** Moves vertically and returns the landing speed if the pod hit the ground, else 0. */
function moveY(game: Game, dy: number): number {
  const pod = game.pod;
  pod.onGround = false;
  pod.y += dy;
  if (pod.y < 0) {
    pod.y = 0;
    pod.vy = 0;
  }
  const [left, right] = span(pod.x, POD_W);
  if (dy > 0) {
    const ty = span(pod.y, POD_H)[1];
    for (let tx = left; tx <= right; tx++) {
      if (isSolid(tileAt(game.world, tx, ty))) {
        const impact = pod.vy;
        pod.y = ty * TILE - POD_H;
        pod.vy = 0;
        pod.onGround = true;
        return impact;
      }
    }
  } else if (dy < 0) {
    const ty = span(pod.y, POD_H)[0];
    for (let tx = left; tx <= right; tx++) {
      if (isSolid(tileAt(game.world, tx, ty))) {
        pod.y = (ty + 1) * TILE;
        pod.vy = 0;
        return 0;
      }
    }
  }
  return 0;
}

// --- Surface stops --------------------------------------------------------------

/** The shop the pod is parked at, if it is on the surface. */
export function buildingAt(game: Game): Building | null {
  const pod = game.pod;
  if (!pod.onGround || pod.dig || pod.y + POD_H !== SKY_ROWS * TILE) return null;
  const col = Math.floor((pod.x + POD_W / 2) / TILE);
  return BUILDINGS.find((b) => col >= b.x0 && col <= b.x1) ?? null;
}

/** Whether the pod is touching the save station. */
export function atSaveStation(game: Game): boolean {
  const pod = game.pod;
  const s = SAVE_STATION;
  return (
    pod.x < (s.x1 + 1) * TILE && pod.x + POD_W > s.x0 * TILE && pod.y < (s.y1 + 1) * TILE && pod.y + POD_H > s.y0 * TILE
  );
}

/**
 * A marsquake: the screen shakes and the underground is almost completely
 * rebuilt. The original rolls a small chance each time you enter a shop.
 */
export const MARSQUAKE_CHANCE = 1 / 150;

export function marsquake(game: Game, seed: number) {
  game.world = generateWorld(seed);
}

// --- Items ----------------------------------------------------------------------

export function buyItem(game: Game, kind: ItemKind): boolean {
  const item = ITEMS[kind];
  if (game.cash < item.price) return false;
  game.cash -= item.price;
  game.items[kind]++;
  return true;
}

/** Whether an item can be used right now. Fuel and nanobots work anywhere; the rest need solid ground. */
export function canUseItem(game: Game, kind: ItemKind): boolean {
  if (game.over || game.items[kind] <= 0) return false;
  if (kind === 'fuel') return game.fuel < stats(game).maxFuel;
  if (kind === 'nanobots') return game.hull < stats(game).maxHull;
  return game.pod.onGround && !game.pod.dig;
}

/** Uses one of an item. Returns what happened, or nothing if it can't be used right now. */
export function useItem(game: Game, kind: ItemKind, rand: () => number = Math.random): GameEvent[] {
  if (!canUseItem(game, kind)) return [];
  const pod = game.pod;
  const s = stats(game);
  const events: GameEvent[] = [{ type: 'item', kind }];
  game.items[kind]--;
  if (kind === 'fuel') {
    game.fuel = Math.min(s.maxFuel, game.fuel + RESERVE_FUEL);
  } else if (kind === 'nanobots') {
    game.hull = Math.min(s.maxHull, game.hull + NANOBOT_REPAIR);
  } else if (kind === 'dynamite' || kind === 'c4') {
    blast(game, Math.floor((pod.x + POD_W / 2) / TILE), Math.floor((pod.y + POD_H / 2) / TILE), BLAST_RADIUS[kind], events);
  } else if (kind === 'matter') {
    // Safely beside the fuel station, on solid ground.
    Object.assign(pod, surfacePod(nearestSolidSurface(game, BUILDINGS[0].x1 + 1)));
    events.push({ type: 'teleport' });
  } else {
    // Just above the fuel station, then flung up or down at random.
    Object.assign(pod, surfacePod(BUILDINGS[0].x1 + 1));
    pod.y -= TILE * 2;
    pod.onGround = false;
    pod.vy = rand() < 0.5 ? -(500 + rand() * 400) : 300 + rand() * 500;
    pod.vx = (rand() - 0.5) * 300;
    events.push({ type: 'teleport' });
  }
  return events;
}

/** The surface column closest to `wanted` that still has ground under it. */
function nearestSolidSurface(game: Game, wanted: number): number {
  for (let d = 0; d < WORLD_W; d++) {
    for (const col of [wanted + d, wanted - d]) {
      if (col >= 0 && col < WORLD_W && isSolid(tileAt(game.world, col, SKY_ROWS))) return col;
    }
  }
  return wanted;
}

// --- Shops ------------------------------------------------------------------------

/** Buys up to `dollars` worth of fuel, limited by tank space and cash. Returns litres bought. */
export function buyFuel(game: Game, dollars: number): number {
  const space = stats(game).maxFuel - game.fuel;
  const litres = Math.max(0, Math.min(dollars / FUEL_PRICE, space, game.cash / FUEL_PRICE));
  game.fuel += litres;
  game.cash = Math.max(0, game.cash - Math.ceil(litres * FUEL_PRICE));
  return litres;
}

export function fillTankCost(game: Game): number {
  return Math.ceil((stats(game).maxFuel - game.fuel) * FUEL_PRICE);
}

/** Sells the whole cargo bay. Returns the money earned. */
export function sellCargo(game: Game): number {
  const total = game.cargo.reduce<number>((sum, t) => sum + (oreFor(t)?.value ?? 0), 0);
  game.cash += total;
  game.record.earned += total;
  game.cargo = [];
  return total;
}

/** Throws one piece of ore out of the cargo bay to shed weight. */
export function discardOre(game: Game, tile: Tile): boolean {
  const i = game.cargo.lastIndexOf(tile);
  if (i < 0) return false;
  game.cargo.splice(i, 1);
  return true;
}

/** Spends up to `dollars` on hull repair. Returns hull points repaired. */
export function repair(game: Game, dollars: number): number {
  const damaged = stats(game).maxHull - game.hull;
  const points = Math.max(0, Math.min(dollars / REPAIR_PRICE, damaged, game.cash / REPAIR_PRICE));
  game.hull += points;
  game.cash = Math.max(0, game.cash - Math.ceil(points * REPAIR_PRICE));
  return points;
}

export function totalRepairCost(game: Game): number {
  return Math.ceil((stats(game).maxHull - game.hull) * REPAIR_PRICE);
}

/**
 * Buys any tier of an upgrade line, replacing what's fitted, as the AutoBuy
 * allows (even a lower one). A new tank arrives full and a new hull arrives
 * fully repaired.
 */
export function buyUpgrade(game: Game, kind: UpgradeKind, tier: number): boolean {
  const t = UPGRADES[kind].tiers[tier];
  if (!t || tier === 0 || tier === game.upgrades[kind] || game.cash < t.price) return false;
  game.cash -= t.price;
  game.upgrades[kind] = tier;
  const s = stats(game);
  if (kind === 'tank') game.fuel = s.maxFuel;
  if (kind === 'hull') game.hull = s.maxHull;
  if (kind === 'cargo') game.cargo = game.cargo.slice(0, s.cargoCap);
  game.fuel = Math.min(game.fuel, s.maxFuel);
  return true;
}
