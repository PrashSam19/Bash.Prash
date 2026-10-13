import assert from 'node:assert/strict';
import { T, SPAWN_COL, TILE, POD_W, newGame, type Tile } from './engine.ts';
import { serialize, deserialize, SAVE_VERSION } from './save.ts';

// A save keeps progress, not tunnels: it loads onto a fresh world at the spawn point.
{
  const game = newGame(12345);
  game.cash = 1234;
  game.upgrades.drill = 2;
  game.upgrades.radiator = 1;
  game.fuel = 4.5;
  game.hull = 6.25;
  game.cargo = [T.GOLDIUM as Tile];
  game.items.dynamite = 3;
  game.story = ['welcome', 'bonus500'];
  game.record = { deepest: 640, earned: 1500 };
  game.pod.x = 0;

  const loaded = deserialize(JSON.parse(JSON.stringify(serialize(game))), 777)!;
  assert.ok(loaded, 'loads');
  assert.equal(loaded.world.seed, 777, 'onto a new world');
  assert.equal(Math.floor((loaded.pod.x + POD_W / 2) / TILE), SPAWN_COL, 'back at the drop-off point');
  assert.equal(loaded.cash, 1234);
  assert.equal(loaded.fuel, 4.5);
  assert.equal(loaded.hull, 6.25);
  assert.deepEqual(loaded.cargo, [T.GOLDIUM]);
  assert.deepEqual(loaded.upgrades, game.upgrades);
  assert.equal(loaded.items.dynamite, 3);
  assert.deepEqual(loaded.story, ['welcome', 'bonus500'], 'bonuses are not paid twice');
  assert.deepEqual(loaded.record, game.record);
  console.log('round trip ok');
}

// Malformed or tampered saves are rejected instead of crashing.
{
  const good = serialize(newGame(5));
  const bad: unknown[] = [
    null,
    'nope',
    {},
    { ...good, version: 2 },
    { ...good, version: SAVE_VERSION + 1 },
    { ...good, upgrades: { ...good.upgrades, drill: 99 } },
    { ...good, upgrades: { ...good.upgrades, radiator: undefined } },
    { ...good, fuel: 1e9 },
    { ...good, cash: -5 },
    { ...good, cargo: [T.DIRT] },
    { ...good, cargo: new Array(50).fill(T.IRONIUM) },
    { ...good, items: { ...good.items, dynamite: -1 } },
    { ...good, story: ['not-a-real-message'] },
    { ...good, record: undefined },
  ];
  for (const b of bad) assert.equal(deserialize(b, 1), null, `rejects ${JSON.stringify(b)?.slice(0, 60)}`);
  assert.ok(deserialize(good, 1), 'the untampered save still loads');
  console.log('validation ok');
}

console.log('all motherload save tests passed');
