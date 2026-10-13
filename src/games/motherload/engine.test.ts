import assert from 'node:assert/strict';
import {
  T,
  TILE,
  WORLD_W,
  WORLD_H,
  SKY_ROWS,
  POD_W,
  POD_H,
  FEET_PER_TILE,
  BUILDINGS,
  SPAWN_COL,
  SAVE_STATION,
  UPGRADES,
  ORES,
  START_CASH,
  START_FUEL,
  newGame,
  generateWorld,
  tileAt,
  setTile,
  step,
  stats,
  depthFeet,
  digTime,
  fallDamage,
  hazardDamage,
  buildingAt,
  atSaveStation,
  buyFuel,
  fillTankCost,
  sellCargo,
  discardOre,
  repair,
  buyUpgrade,
  buyItem,
  useItem,
  canUseItem,
  marsquake,
  receive,
  type Game,
  type Input,
  type Tile,
} from './engine.ts';

const DT = 1 / 60;
const idle: Input = { left: false, right: false, up: false, down: false };
const press = (keys: Partial<Input>): Input => ({ ...idle, ...keys });
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

function run(game: Game, input: Input, seconds: number) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) events.push(...step(game, input, DT));
  return events;
}

/** Hold `input` until one tile is dug, then release so no second dig starts. */
function digOnce(game: Game, input: Input) {
  for (let i = 0; i < 600; i++) {
    const events = step(game, input, DT);
    if (events.some((e) => e.type === 'dug')) return events;
  }
  return [];
}

/** A rich test world: plain dirt everywhere except the shop pads, plenty of fuel. */
function flatGame(): Game {
  const game = newGame(1);
  for (let y = SKY_ROWS; y < WORLD_H - 1; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      if (tileAt(game.world, x, y) !== T.CONCRETE) setTile(game.world, x, y, T.DIRT);
    }
  }
  game.upgrades.tank = UPGRADES.tank.tiers.length - 1;
  game.fuel = stats(game).maxFuel;
  return game;
}

const podCol = (g: Game) => Math.floor((g.pod.x + POD_W / 2) / TILE);

// World generation follows the original's layout and depths.
{
  const a = generateWorld(42);
  assert.deepEqual(a.tiles, generateWorld(42).tiles, 'same seed, same world');
  assert.notDeepEqual(a.tiles, generateWorld(43).tiles, 'different seed, different world');
  assert.equal(WORLD_W, 32, 'the original map is 32 squares wide');
  for (let x = 0; x < WORLD_W; x++) {
    for (let y = 0; y < SKY_ROWS; y++) assert.equal(tileAt(a, x, y), T.AIR, 'sky is open');
    const shop = BUILDINGS.some((b) => x >= b.x0 && x <= b.x1);
    for (const y of [SKY_ROWS, SKY_ROWS + 1]) {
      assert.equal(tileAt(a, x, y) === T.CONCRETE, shop, 'the two squares under each shop are indestructible');
    }
    assert.equal(tileAt(a, x, WORLD_H - 1), T.BEDROCK, 'floor is bedrock');
  }
  // Nothing appears shallower than the wiki says it should.
  const firstRow = new Map<number, number>();
  for (let s = 1; s <= 5; s++) {
    const w = generateWorld(s);
    for (let i = 0; i < w.tiles.length; i++) {
      const t = w.tiles[i];
      const r = Math.floor(i / WORLD_W) - SKY_ROWS;
      if (!firstRow.has(t) || r < firstRow.get(t)!) firstRow.set(t, r);
    }
  }
  for (const ore of ORES) assert.ok(firstRow.get(ore.tile)! >= ore.minRow, `${ore.name} not above ${ore.minRow * FEET_PER_TILE} ft`);
  assert.ok(firstRow.get(T.ROCK)! * FEET_PER_TILE >= 1600, 'boulders start around -1,600 ft');
  assert.ok(firstRow.get(T.LAVA)! * FEET_PER_TILE >= 3000, 'lava starts around -3,000 ft');
  assert.ok(firstRow.get(T.GAS)! * FEET_PER_TILE >= 4750, 'gas starts around -4,750 ft');
  for (const t of [T.AMAZONITE, T.BONES, T.TREASURE, T.SKELETON, T.RELIC]) assert.ok(firstRow.has(t), `tile ${t} exists`);
  console.log('world generation ok');
}

// You start right of the fuel station, with $20 and almost no fuel.
{
  const game = newGame(7);
  assert.equal(game.cash, START_CASH);
  assert.equal(game.fuel, START_FUEL);
  assert.equal(podCol(game), SPAWN_COL);
  assert.ok(SPAWN_COL > BUILDINGS[0].x1, 'spawn is right of the Propellant Vendor');
  console.log('start ok');
}

// Fuel: about 5 L/min idling and 17 L/min flying, per the wiki.
{
  const game = flatGame();
  let before = game.fuel;
  run(game, idle, 12);
  assert.ok(near(before - game.fuel, 1, 0.02), `idle burns 1 L in 12 s (got ${before - game.fuel})`);
  before = game.fuel;
  run(game, press({ up: true }), 3);
  assert.ok(near(before - game.fuel, (17 / 60) * 3, 0.02), 'flying burns 17 L/min');
  game.fuel = 0.01;
  run(game, idle, 1);
  assert.equal(game.over, 'fuel', 'running dry ends the game');
  console.log('fuel ok');
}

// Weight: a stock pod flies; a pod loaded past 6,200 kg can't take off even with the best engine.
{
  const light = flatGame();
  const y0 = light.pod.y;
  run(light, press({ up: true }), 0.5);
  assert.ok(light.pod.y < y0 - 20, 'an empty stock pod climbs');

  const heavy = flatGame();
  heavy.upgrades.engine = UPGRADES.engine.tiers.length - 1;
  heavy.cargo = new Array(40).fill(T.AMAZONITE) as Tile[]; // 4,800 kg of ore
  assert.ok(stats(heavy).mass > 6200);
  const y1 = heavy.pod.y;
  run(heavy, press({ up: true }), 1);
  assert.equal(heavy.pod.y, y1, 'too heavy to lift off');
  console.log('weight ok');
}

// Fall damage follows the wiki's table: up to 24 ft is free.
{
  assert.equal(fallDamage(24), 0);
  assert.equal(fallDamage(30), 3);
  assert.equal(fallDamage(50), 4);
  assert.equal(fallDamage(100), 5);
  assert.equal(fallDamage(200), 6);
  assert.equal(fallDamage(400), 7);
  assert.equal(fallDamage(800), 8);
  const drop = (tiles: number) => {
    const g = flatGame();
    g.upgrades.hull = 6;
    g.hull = stats(g).maxHull;
    g.pod.y -= tiles * TILE;
    g.pod.onGround = false;
    run(g, idle, 3);
    return stats(g).maxHull - g.hull;
  };
  assert.equal(drop(1), 0, 'a 12.5 ft drop is harmless');
  assert.equal(drop(4), 4, 'a 50 ft drop does 4');
  console.log('fall damage ok');
}

// Digging speed comes from the drill (ft/s) and slows with depth.
{
  assert.ok(near(digTime(20, 0), 12.5 / 20), 'stock drill: 0.625 s per square at the surface');
  assert.ok(digTime(20, 400) > digTime(20, 0) * 2, 'deep soil is much harder');
  assert.ok(digTime(120, 0) * 5 < digTime(20, 0), 'the Amazonite Drill is six times faster');
  const game = flatGame();
  const tx = podCol(game);
  const events = digOnce(game, press({ down: true }));
  assert.ok(events.some((e) => e.type === 'dug'));
  assert.equal(tileAt(game.world, tx, SKY_ROWS), T.AIR);
  assert.equal(game.pod.y, SKY_ROWS * TILE + TILE - POD_H, 'pod sits in the dug square');
  assert.equal(depthFeet(game.pod), 13);
  console.log('digging ok');
}

// Sideways digging needs solid ground; there's no digging up; boulders and pads refuse.
{
  const game = flatGame();
  digOnce(game, press({ down: true }));
  const tx = podCol(game);
  const ty = SKY_ROWS;
  assert.ok(digOnce(game, press({ right: true })).length, 'dug sideways');
  assert.equal(tileAt(game.world, tx + 1, ty), T.AIR);
  setTile(game.world, tx + 2, ty, T.ROCK);
  assert.equal(run(game, press({ right: true }), 1).filter((e) => e.type === 'dug').length, 0, 'boulders block');
  setTile(game.world, tx + 1, ty - 0, T.AIR);
  run(game, press({ up: true }), 0.4);
  assert.equal(tileAt(game.world, tx + 1, ty - 1), T.AIR, 'nothing above to dig anyway');

  const pad = flatGame();
  pad.pod.x = BUILDINGS[0].x0 * TILE + 3;
  run(pad, idle, 0.2);
  assert.equal(run(pad, press({ down: true }), 1).filter((e) => e.type === 'dug').length, 0, 'shop pads are undiggable');
  console.log('dig rules ok');
}

// Hazards: lava 41 or 58, gas (depth − 3000) / 15, both reduced by the radiator.
{
  assert.equal(hazardDamage('lava', 3500, 0, () => 0.1), 41);
  assert.equal(hazardDamage('lava', 3500, 0, () => 0.9), 58);
  assert.ok(near(hazardDamage('lava', 3500, 25, () => 0.9), 43.5), 'single turbine cuts 25%');
  assert.ok(near(hazardDamage('gas', 4950, 0), 130), 'gas at -4,950 ft');
  assert.ok(near(hazardDamage('gas', 4950, 80), 26), 'tri-turbine cuts 80%');

  const game = flatGame();
  game.upgrades.hull = 6;
  game.hull = stats(game).maxHull;
  const tx = podCol(game);
  setTile(game.world, tx, SKY_ROWS, T.GAS);
  setTile(game.world, tx + 1, SKY_ROWS + 1, T.GOLDIUM);
  const events = digOnce(game, press({ down: true }));
  assert.ok(events.some((e) => e.type === 'hazard' && e.kind === 'gas'));
  assert.ok(events.some((e) => e.type === 'blast'), 'gas explodes like dynamite');
  assert.equal(tileAt(game.world, tx + 1, SKY_ROWS + 1), T.AIR, 'and destroys what is around it');
  console.log('hazards ok');
}

// Artifacts pay cash on the spot instead of going into the cargo bay.
{
  const game = flatGame();
  setTile(game.world, podCol(game), SKY_ROWS, T.RELIC);
  const cash = game.cash;
  digOnce(game, press({ down: true }));
  assert.equal(game.cash, cash + 50000);
  assert.equal(game.cargo.length, 0);
  console.log('artifacts ok');
}

// Cargo fills up, and ore can be thrown out to shed weight.
{
  const game = flatGame();
  for (let i = 0; i < 9; i++) {
    setTile(game.world, podCol(game), Math.floor((game.pod.y + POD_H) / TILE), T.GOLDIUM);
    digOnce(game, press({ down: true }));
  }
  assert.equal(game.cargo.length, 7, 'Micro Bay holds 7');
  assert.ok(discardOre(game, T.GOLDIUM));
  assert.equal(game.cargo.length, 6);
  assert.equal(sellCargo(game), 6 * 250);
  console.log('cargo ok');
}

// Shops: fuel at $1/L, repair at $15/HP, any AutoBuy tier, new tanks full and new hulls repaired.
{
  const game = newGame(3);
  game.cash = 20;
  assert.equal(fillTankCost(game), 8);
  buyFuel(game, 5);
  assert.equal(game.fuel, 7);
  assert.equal(game.cash, 15);
  buyFuel(game, 50);
  assert.equal(game.fuel, 10, 'tops up, no further');
  assert.equal(game.cash, 12, 'matches the screenshot: $20 → $12 for 8 L');

  game.hull = 4;
  game.cash = 50;
  repair(game, 50);
  assert.ok(near(game.hull, 4 + 50 / 15, 1e-9));
  game.cash = 1000;
  repair(game, 1e9);
  assert.equal(game.hull, 10);

  game.cash = 100000;
  game.fuel = 1;
  assert.ok(buyUpgrade(game, 'tank', 2));
  assert.equal(game.fuel, 25, 'a new tank arrives full');
  assert.ok(buyUpgrade(game, 'tank', 1), 'you can buy a lower tier');
  assert.equal(stats(game).maxFuel, 15);
  game.hull = 1;
  assert.ok(buyUpgrade(game, 'hull', 3));
  assert.equal(game.hull, 50, 'a new hull arrives repaired');
  assert.equal(buyUpgrade(game, 'hull', 3), false, 'already fitted');
  assert.ok(buyUpgrade(game, 'radiator', 2));
  assert.equal(stats(game).radiator, 25);
  console.log('shops ok');
}

// Items: fuel and nanobots work anywhere; explosives and teleports need the ground.
{
  const game = flatGame();
  game.cash = 1e6;
  for (const k of ['fuel', 'nanobots', 'dynamite', 'c4', 'quantum', 'matter'] as const) assert.ok(buyItem(game, k));

  // Open ground between AutoBuy and the Emendation Station, clear of shop pads.
  game.pod.x = 24 * TILE + (TILE - POD_W) / 2;
  run(game, press({ up: true }), 0.4);
  assert.equal(game.pod.onGround, false);
  assert.equal(canUseItem(game, 'dynamite'), false, 'no dynamite mid-air');
  game.fuel = 1;
  assert.ok(useItem(game, 'fuel').length, 'reserve fuel works mid-air');
  assert.equal(game.fuel, 26);
  run(game, idle, 2);

  digOnce(game, press({ down: true }));
  digOnce(game, press({ down: true }));
  run(game, idle, 0.1);
  const tx = podCol(game);
  const ty = Math.floor((game.pod.y + POD_H / 2) / TILE);
  setTile(game.world, tx + 1, ty, T.ROCK);
  assert.ok(useItem(game, 'dynamite').some((e) => e.type === 'blast'));
  assert.equal(tileAt(game.world, tx + 1, ty), T.AIR, 'dynamite clears boulders');
  assert.notEqual(tileAt(game.world, tx + 2, ty), T.AIR, 'but only 3×3');
  run(game, idle, 1);
  useItem(game, 'c4');
  assert.equal(tileAt(game.world, tx + 2, ty), T.AIR, 'plastic explosive reaches 5×5');

  run(game, idle, 1);
  useItem(game, 'matter');
  assert.equal(game.pod.y, SKY_ROWS * TILE - POD_H, 'matter transmitter lands on the surface');
  assert.ok(podCol(game) > BUILDINGS[0].x1, 'right of the Propellant Vendor');
  assert.notEqual(tileAt(game.world, podCol(game), SKY_ROWS), T.AIR, 'on solid ground');
  console.log('items ok');
}

// Transmissions play once at their depths, and the bonuses pay once.
{
  const game = flatGame();
  assert.ok(receive(game, 'welcome'));
  assert.equal(receive(game, 'welcome'), false);
  const cash = game.cash;
  game.pod.y = (SKY_ROWS + 40) * TILE - POD_H; // 500 ft
  game.pod.onGround = false;
  setTile(game.world, podCol(game), SKY_ROWS + 40, T.DIRT);
  const events = run(game, idle, 0.5);
  assert.ok(events.some((e) => e.type === 'transmission' && e.id === 'bonus500'));
  assert.equal(game.cash, cash + 1000);
  run(game, idle, 0.5);
  assert.equal(game.cash, cash + 1000, 'paid once');
  console.log('story ok');
}

// Shops, the save station, and marsquakes.
{
  const game = flatGame();
  game.pod.x = BUILDINGS[1].x0 * TILE + 3;
  run(game, idle, 0.2);
  assert.equal(buildingAt(game)?.id, 'processing');
  game.pod.x = SAVE_STATION.x0 * TILE + 3;
  game.pod.y = SAVE_STATION.y1 * TILE;
  assert.ok(atSaveStation(game));
  digOnce(newGame(1), press({ down: true }));
  const before = game.world.tiles.slice();
  marsquake(game, 999);
  assert.notDeepEqual(game.world.tiles, before, 'a marsquake rebuilds the underground');
  console.log('surface ok');
}

console.log('all motherload engine tests passed');
