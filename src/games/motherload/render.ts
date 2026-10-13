// Motherload renderer: draws the world, the surface, and the pod onto the
// canvas, in the style of the 2004 original: speckled dirt, flat tan tunnels
// with rounded corners, streaky ore, rose-stone buildings, an olive drill pod.
// Everything is drawn in code; tiles are drawn once into cached sprites. The
// canvas is SCALE times the view size, so shapes can use half-pixel detail.

import {
  T,
  TILE,
  WORLD_W,
  WORLD_H,
  SKY_ROWS,
  POD_W,
  POD_H,
  ORES,
  BUILDINGS,
  SAVE_STATION,
  oreFor,
  tileAt,
  isSolid,
  depthFeet,
  stats,
  mulberry32,
  type Building,
  type Game,
  type Tile,
  type Pod,
} from './engine.ts';

export const VIEW_W = 512;
export const VIEW_H = 384;
export const SCALE = 2;
const SURFACE_Y = SKY_ROWS * TILE;
const TAU = Math.PI * 2;
// Rounding radius for tunnel corners.
const CORNER = 9;
const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

type Ctx = CanvasRenderingContext2D;

/** Deterministic per-tile hash, so a tile looks the same every frame. */
function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** Mix a #rrggbb colour toward white (amt > 0) or black (amt < 0). */
function shade(hex: string, amt: number): string {
  const to = amt < 0 ? 0 : 255;
  const k = Math.abs(amt);
  const [r, g, b] = rgb(hex).map((c) => Math.round(c + (to - c) * k));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Blend two #rrggbb colours. */
function mix(a: string, b: string, k: number): string {
  const ca = rgb(a);
  const cb = rgb(b);
  const [r, g, bl] = ca.map((c, i) => Math.round(c + (cb[i] - c) * k));
  return `rgb(${r},${g},${bl})`;
}

function alpha(hex: string, a: number): string {
  return `rgba(${rgb(hex).join(',')},${a})`;
}

function poly(g: Ctx, pts: number[][]) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

function circle(g: Ctx, x: number, y: number, r: number) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
}

/** Bold display text with a dark offset outline, like the original's signs and HUD. */
function outlinedText(g: Ctx, text: string, x: number, y: number, size: number, fill: string) {
  g.font = `900 ${size}px "Arial Black", "Arial Rounded MT Bold", Impact, system-ui, sans-serif`;
  g.lineJoin = 'round';
  g.lineWidth = size * 0.22;
  g.strokeStyle = '#2b1a0c';
  g.strokeText(text, x + size * 0.06, y + size * 0.06);
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

// ---------------------------------------------------------------------------
// Tiles

// Strata: the dirt darkens and shifts hue with depth; tunnels follow suit.
const BANDS = [
  { from: 0, dirt: '#4c3327', tunnel: '#7e6446' },
  { from: 60, dirt: '#45302a', tunnel: '#755c42' },
  { from: 150, dirt: '#4d2c26', tunnel: '#6f5040' },
  { from: 260, dirt: '#423839', tunnel: '#665a52' },
  { from: 380, dirt: '#3b3242', tunnel: '#5e5260' },
];
const VARIANTS = 4;
const METALS = 5; // the first five ores are streaky metal lumps; the rest are gems

function bandFor(tx: number, ty: number): number {
  // Jitter the boundary so strata edges are ragged rather than ruler-straight.
  const d = ty - SKY_ROWS + ((hash(tx, ty, 1) % 13) - 6);
  let band = 0;
  for (let i = 0; i < BANDS.length; i++) if (d >= BANDS[i].from) band = i;
  return band;
}

function makeSprite(draw: (g: Ctx) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE * SCALE;
  c.height = TILE * SCALE;
  const g = c.getContext('2d')!;
  g.scale(SCALE, SCALE);
  draw(g);
  return c;
}

/** The original's dirt is dense salt-and-pepper noise, so draw it pixel by pixel. */
function drawDirt(g: Ctx, band: number, variant: number) {
  const base = BANDS[band].dirt;
  // Highlights lean warm, toward a reddish tan, rather than toward grey.
  const warm = (k: number) => rgb(base).map((c, i) => Math.round(c + ([176, 118, 86][i] - c) * k));
  const palette = (
    [
      [rgb(base), 0.3],
      [warm(0.25), 0.22],
      [rgb(shade(base, -0.3)), 0.2],
      [warm(0.5), 0.12],
      [rgb(shade(base, -0.55)), 0.1],
      [warm(0.75), 0.06],
    ] as const
  ).map(([c, w]) => [c, w] as const);
  const rnd = mulberry32(band * 1000 + variant * 7 + 1);
  const size = TILE * SCALE;
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    let r = rnd();
    let color = palette[0][0];
    for (const [c, w] of palette) {
      if (r < w) {
        color = c;
        break;
      }
      r -= w;
    }
    img.data.set([color[0], color[1], color[2], 255], i * 4);
  }
  g.putImageData(img, 0, 0);
}

/** Traces a smooth, irregular blob outline as the current path. */
function blob(g: Ctx, cx: number, cy: number, r: number, rnd: () => number, points = 10) {
  const pts: number[][] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * TAU;
    const k = 0.72 + rnd() * 0.32;
    pts.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k * 0.88]);
  }
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[pts.length - 1], pts[0]);
  g.beginPath();
  g.moveTo(start[0], start[1]);
  for (let i = 0; i < pts.length; i++) {
    const m = mid(pts[i], pts[(i + 1) % pts.length]);
    g.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  g.closePath();
}

/** Metal ore: an irregular lump covered in slanted flakes. Ironium is spotted instead. */
function drawLump(g: Ctx, tile: Tile, color: string, variant: number) {
  const rnd = mulberry32(tile * 131 + variant * 17);
  g.save();
  blob(g, 16 + (rnd() - 0.5) * 1.5, 16 + (rnd() - 0.5) * 1.5, 16.5, rnd);
  g.translate(0.8, 1);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fill();
  g.translate(-0.8, -1);
  g.fillStyle = color;
  g.fill();
  g.clip();
  if (tile === T.IRONIUM) {
    for (let i = 0; i < 9; i++) {
      g.fillStyle = shade(color, -0.45 - rnd() * 0.2);
      g.beginPath();
      g.ellipse(5 + rnd() * 22, 5 + rnd() * 22, 1.5 + rnd() * 2, 1 + rnd() * 1.6, rnd() * 3, 0, TAU);
      g.fill();
    }
    g.strokeStyle = shade(color, 0.3);
    g.lineWidth = 0.8;
    for (let i = 0; i < 6; i++) {
      const x = 4 + rnd() * 24;
      const y = 4 + rnd() * 24;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 3 + rnd() * 3, y - 2 - rnd() * 2);
      g.stroke();
    }
  } else {
    g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const dark = i % 2 === 0;
      g.strokeStyle = dark ? shade(color, -0.4) : shade(color, 0.32);
      g.lineWidth = dark ? 1.6 : 1;
      const x = 2 + rnd() * 26;
      const y = 3 + rnd() * 26;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 3, y - 3, x + 6 + rnd() * 4, y - 5 - rnd() * 3);
      g.stroke();
    }
  }
  g.restore();
}

function drawCrystal(g: Ctx, x: number, y: number, h: number, w: number, angle: number, color: string) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  const outline = [
    [0, -h],
    [w, -h * 0.45],
    [w, h * 0.55],
    [0, h],
    [-w, h * 0.55],
    [-w, -h * 0.45],
  ];
  g.fillStyle = shade(color, -0.6);
  poly(g, outline.map(([px, py]) => [px * 1.18, py * 1.08]));
  g.fill();
  g.fillStyle = shade(color, 0.2);
  poly(g, [[0, -h * 0.15], [0, h], [-w, h * 0.55], [-w, -h * 0.45]]);
  g.fill();
  g.fillStyle = shade(color, -0.2);
  poly(g, [[0, -h * 0.15], [w, -h * 0.45], [w, h * 0.55], [0, h]]);
  g.fill();
  g.fillStyle = shade(color, 0.55);
  poly(g, [[0, -h], [w, -h * 0.45], [0, -h * 0.15], [-w, -h * 0.45]]);
  g.fill();
  g.restore();
}

function sparkle(g: Ctx, x: number, y: number, r: number) {
  g.fillStyle = 'rgba(255,255,255,0.95)';
  poly(g, [[x, y - r], [x + r * 0.25, y], [x, y + r], [x - r * 0.25, y]]);
  g.fill();
  poly(g, [[x - r, y], [x, y - r * 0.25], [x + r, y], [x, y + r * 0.25]]);
  g.fill();
}

function drawOre(g: Ctx, tile: Tile, band: number, variant: number) {
  drawDirt(g, band, variant);
  const ore = oreFor(tile)!;
  if (ORES.indexOf(ore) < METALS) return drawLump(g, tile, ore.color, variant);
  if (tile === T.EINSTEINIUM || tile === T.AMAZONITE) {
    const glow = g.createRadialGradient(16, 17, 1, 16, 17, 15);
    glow.addColorStop(0, alpha(ore.color, 0.55));
    glow.addColorStop(1, alpha(ore.color, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, TILE, TILE);
  }
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(16, 25, 11, 3.5, 0, 0, TAU);
  g.fill();
  drawCrystal(g, 10, 18, 7.5, 3.4, -0.5, ore.color);
  drawCrystal(g, 22, 19, 7, 3.2, 0.55, ore.color);
  drawCrystal(g, 16, 15, 10.5, 4, 0.05, ore.color);
  sparkle(g, 14.5, 9, 3.2);
}

function drawRock(g: Ctx, band: number, variant: number) {
  drawDirt(g, band, variant);
  const rnd = mulberry32(500 + variant);
  g.save();
  blob(g, 16, 17, 15, rnd, 11);
  g.translate(1, 1.5);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fill();
  g.translate(-1, -1.5);
  g.fillStyle = '#6f6c6a';
  g.fill();
  g.clip();
  g.fillStyle = '#56534f';
  g.beginPath();
  g.ellipse(21, 24, 14, 9, -0.4, 0, TAU);
  g.fill();
  g.fillStyle = '#8f8b87';
  g.beginPath();
  g.ellipse(11, 10, 9, 6, -0.5, 0, TAU);
  g.fill();
  g.strokeStyle = '#3d3a37';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(14, 5);
  g.lineTo(16, 12);
  g.lineTo(12, 18);
  g.moveTo(16, 12);
  g.lineTo(23, 15);
  g.stroke();
  g.restore();
}

/** Lava pocket: a glowing molten blob, plainly visible so it can be avoided. */
function drawLava(g: Ctx, band: number, variant: number) {
  drawDirt(g, band, variant);
  const rnd = mulberry32(700 + variant);
  const glow = g.createRadialGradient(16, 16, 2, 16, 16, 17);
  glow.addColorStop(0, 'rgba(255,150,40,0.55)');
  glow.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, TILE, TILE);
  g.save();
  blob(g, 16, 16, 15, rnd, 9);
  g.fillStyle = '#5a1206';
  g.fill();
  g.clip();
  const molten = g.createRadialGradient(13, 12, 1, 16, 16, 15);
  molten.addColorStop(0, '#fff3a0');
  molten.addColorStop(0.35, '#ffb02e');
  molten.addColorStop(0.75, '#ef5a12');
  molten.addColorStop(1, '#9e1f08');
  g.fillStyle = molten;
  blob(g, 16, 16, 13.5, mulberry32(700 + variant), 9);
  g.fill();
  // Dark crust floating on top.
  g.fillStyle = 'rgba(90,20,6,0.55)';
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.ellipse(6 + rnd() * 20, 6 + rnd() * 20, 2 + rnd() * 3, 1 + rnd() * 1.5, rnd() * 3, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** Artifacts, each with its own little picture on the dirt. */
function drawArtifact(g: Ctx, tile: Tile, band: number, variant: number) {
  drawDirt(g, band, variant);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (tile === T.BONES) {
    for (const [x0, y0, x1, y1] of [
      [7, 9, 25, 23],
      [7, 23, 25, 9],
    ]) {
      g.strokeStyle = '#3d3026';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      g.strokeStyle = '#efe6cf';
      g.lineWidth = 3;
      g.stroke();
      for (const [x, y] of [
        [x0, y0],
        [x1, y1],
      ]) {
        g.fillStyle = '#3d3026';
        circle(g, x, y, 3.6);
        g.fill();
        g.fillStyle = '#efe6cf';
        circle(g, x, y, 2.6);
        g.fill();
      }
    }
  } else if (tile === T.TREASURE) {
    g.fillStyle = '#2b1a0c';
    g.fillRect(5, 11, 22, 16);
    g.fillStyle = '#8a5326';
    g.fillRect(6, 15, 20, 11);
    g.fillStyle = '#a8662f';
    g.beginPath();
    g.roundRect(6, 11, 20, 6, [5, 5, 0, 0]);
    g.fill();
    g.fillStyle = '#e8b51f';
    g.fillRect(6, 16, 20, 1.6);
    g.fillRect(9, 11, 1.6, 15);
    g.fillRect(22.4, 11, 1.6, 15);
    g.fillRect(14.5, 15, 3, 4);
    sparkle(g, 24, 9, 3);
  } else if (tile === T.SKELETON) {
    g.fillStyle = '#3d3026';
    circle(g, 16, 14, 9);
    g.fill();
    g.fillRect(11, 18, 10, 8);
    g.fillStyle = '#e9e1cc';
    circle(g, 16, 14, 8);
    g.fill();
    g.fillRect(12, 18, 8, 7);
    g.fillStyle = '#2b2018';
    g.beginPath();
    g.ellipse(12.5, 14, 2.4, 3, 0.2, 0, TAU);
    g.ellipse(19.5, 14, 2.4, 3, -0.2, 0, TAU);
    g.fill();
    for (let x = 13; x < 20; x += 2) g.fillRect(x, 22, 0.8, 3);
  } else {
    // A golden ankh.
    g.strokeStyle = '#4a3208';
    g.lineWidth = 5.5;
    g.beginPath();
    g.ellipse(16, 9.5, 4.5, 5.5, 0, 0, TAU);
    g.moveTo(16, 15);
    g.lineTo(16, 28);
    g.moveTo(8, 17);
    g.lineTo(24, 17);
    g.stroke();
    g.strokeStyle = '#f1c232';
    g.lineWidth = 3.2;
    g.stroke();
    sparkle(g, 22, 6, 3);
  }
}

function drawBedrock(g: Ctx) {
  g.fillStyle = '#26262b';
  g.fillRect(0, 0, TILE, TILE);
  g.fillStyle = '#34343a';
  for (let i = -TILE; i < TILE; i += 8) {
    poly(g, [[i, TILE], [i + TILE, 0], [i + TILE + 3, 0], [i + 3, TILE]]);
    g.fill();
  }
}

function drawConcrete(g: Ctx, band: number, variant: number) {
  // A grey slab along the top of the surface row, dirt below its lip.
  drawDirt(g, band, variant);
  g.fillStyle = '#9d9c98';
  g.fillRect(0, 0, TILE, 7);
  g.fillStyle = '#c4c3bf';
  g.fillRect(0, 0, TILE, 2);
  g.fillStyle = '#6f6e6a';
  g.fillRect(0, 6, TILE, 1);
  g.fillRect(variant % 2 ? 11 : 23, 0, 0.75, 6);
}

function drawGrass(g: Ctx, band: number, variant: number) {
  drawDirt(g, band, variant);
  // A thin, lumpy band of dark grass along the top edge.
  const rnd = mulberry32(300 + variant);
  g.fillStyle = '#2f5a1e';
  g.beginPath();
  g.moveTo(0, 0);
  for (let x = 0; x <= TILE; x += 2) g.lineTo(x, 2.5 + rnd() * 1.6);
  g.lineTo(TILE, 0);
  g.closePath();
  g.fill();
  g.fillStyle = '#4c7d2c';
  g.fillRect(0, 0, TILE, 1);
}

class SpriteCache {
  private cache = new Map<string, HTMLCanvasElement>();

  private get(key: string, draw: (g: Ctx) => void): HTMLCanvasElement {
    let s = this.cache.get(key);
    if (!s) {
      s = makeSprite(draw);
      this.cache.set(key, s);
    }
    return s;
  }

  dirt(tx: number, ty: number): HTMLCanvasElement {
    const variant = hash(tx, ty) % VARIANTS;
    const band = bandFor(tx, ty);
    return this.get(`dirt${band}.${variant}`, (g) => drawDirt(g, band, variant));
  }

  tile(tile: Tile, tx: number, ty: number): HTMLCanvasElement {
    const variant = hash(tx, ty) % VARIANTS;
    const band = bandFor(tx, ty);
    switch (tile) {
      case T.BEDROCK:
        return this.get('bedrock', drawBedrock);
      case T.CONCRETE:
        // Only the top pad row shows as a slab; the one below looks like dirt.
        return ty === SKY_ROWS
          ? this.get(`concrete${band}.${variant}`, (g) => drawConcrete(g, band, variant))
          : this.dirt(tx, ty);
      case T.ROCK:
        return this.get(`rock${band}.${variant}`, (g) => drawRock(g, band, variant));
      case T.LAVA:
        return this.get(`lava${band}.${variant}`, (g) => drawLava(g, band, variant));
      case T.BONES:
      case T.TREASURE:
      case T.SKELETON:
      case T.RELIC:
        return this.get(`artifact${tile}.${band}.${variant}`, (g) => drawArtifact(g, tile, band, variant));
      // Gas pockets are disguised as ordinary dirt.
      case T.DIRT:
      case T.GAS:
        return ty === SKY_ROWS
          ? this.get(`grass${band}.${variant}`, (g) => drawGrass(g, band, variant))
          : this.dirt(tx, ty);
      default:
        return this.get(`ore${tile}.${band}.${variant}`, (g) => drawOre(g, tile, band, variant));
    }
  }
}

// ---------------------------------------------------------------------------
// Surface: sky, sun, buildings, and the save station

const SKY_TOP = '#4b8fd3';
const SKY_LOW = '#86c9ee';
const NIGHT_TOP = '#0f1f4f';
const NIGHT_LOW = '#22377a';

function drawSky(ctx: Ctx, cy: number, dark: number) {
  const horizon = SURFACE_Y - cy;
  const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
  sky.addColorStop(0, mix(SKY_TOP, NIGHT_TOP, dark));
  sky.addColorStop(1, mix(SKY_LOW, NIGHT_LOW, dark));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, horizon);
  if (dark >= 1) return;

  // A big white sun with soft rings, fixed in the upper-left of the screen.
  ctx.save();
  ctx.globalAlpha = 1 - dark;
  const sx = 36;
  const sy = 96 - Math.max(0, 140 - horizon) * 0.4;
  for (let i = 5; i >= 1; i--) {
    ctx.fillStyle = `rgba(220,240,255,${0.12 + (5 - i) * 0.04})`;
    circle(ctx, sx, sy, 38 + i * 6);
    ctx.fill();
  }
  ctx.fillStyle = '#fff7a8';
  circle(ctx, sx, sy, 40);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  circle(ctx, sx, sy, 38);
  ctx.fill();
  ctx.restore();
}

// Rose-stone palette shared by the buildings.
const STONE = '#a67f79';
const STONE_DARK = '#7a5753';
const STONE_LIGHT = '#c8a39c';
const OUTLINE = '#4a3230';

function signBoard(ctx: Ctx, cx: number, y: number, lines: string[], size: number, posts: boolean) {
  ctx.font = `900 ${size}px "Arial Black", Impact, system-ui, sans-serif`;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 1.2;
  const h = lines.length * size * 1.1 + size * 0.6;
  const x = cx - w / 2;
  if (posts) {
    ctx.fillStyle = '#d8d6d0';
    ctx.fillRect(x + w * 0.25, y + h, 1.5, 6);
    ctx.fillRect(x + w * 0.75, y + h, 1.5, 6);
  }
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.roundRect(x - 1.2, y - 1.2, w + 2.4, h + 2.4, 3);
  ctx.fill();
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, '#7a5848');
  grad.addColorStop(1, '#5a3e32');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 2.5);
  ctx.fill();
  ctx.textAlign = 'center';
  lines.forEach((line, i) => outlinedText(ctx, line, cx, y + size * 0.3 + (i + 1) * size * 1.02, size, '#f6cf3d'));
  ctx.textAlign = 'start';
}

/** A chunky bevelled stone block, the basic shape of the original's buildings. */
function stoneBlock(ctx: Ctx, x: number, y: number, w: number, h: number, slant = 4) {
  poly(ctx, [[x + slant, y], [x + w - slant, y], [x + w, y + h], [x, y + h]]);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, STONE_LIGHT);
  grad.addColorStop(0.35, STONE);
  grad.addColorStop(1, STONE_DARK);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,235,230,0.35)';
  poly(ctx, [[x + slant, y], [x + w - slant, y], [x + w - slant - 1, y + 2], [x + slant + 1, y + 2]]);
  ctx.fill();
  // Weathering cracks.
  ctx.strokeStyle = 'rgba(70,40,38,0.35)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.2, y + h * 0.3);
  ctx.lineTo(x + w * 0.24, y + h * 0.45);
  ctx.moveTo(x + w * 0.8, y + h * 0.6);
  ctx.lineTo(x + w * 0.76, y + h * 0.75);
  ctx.stroke();
}

function door(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 1);
  ctx.fillStyle = STONE_DARK;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = STONE;
  ctx.fillRect(x + 1.5, y + 1.5, w / 2 - 2.5, h - 1.5);
  ctx.fillRect(x + w / 2 + 1, y + 1.5, w / 2 - 2.5, h - 1.5);
}

function barrels(ctx: Ctx, x: number, base: number) {
  const bands = ['#7d84a0', '#c25a4a', '#8a90aa'];
  for (let i = 0; i < 3; i++) {
    const y = base - 6 - i * 6;
    ctx.fillStyle = OUTLINE;
    ctx.beginPath();
    ctx.roundRect(x - 0.8, y - 0.8, 22.6, 7.6, 2);
    ctx.fill();
    ctx.fillStyle = bands[i];
    ctx.beginPath();
    ctx.roundRect(x, y, 21, 6, 1.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + 1, y + 1, 19, 1.2);
  }
  ctx.fillStyle = '#b8945a';
  ctx.beginPath();
  ctx.ellipse(x + 10.5, base - 19, 10, 3, 0, 0, TAU);
  ctx.fill();
}

function chainHose(ctx: Ctx, x0: number, x1: number, base: number) {
  ctx.strokeStyle = '#4a4a4a';
  ctx.lineWidth = 1.2;
  for (let x = x0; x < x1; x += 3) {
    ctx.beginPath();
    ctx.ellipse(x, base - 2 - Math.sin((x - x0) * 0.25) * 0.8, 1.6, 1.1, 0, 0, TAU);
    ctx.stroke();
  }
}

function drawFuelStation(ctx: Ctx, x: number, base: number, w: number) {
  const bx = x + 26;
  const bw = w - 44;
  stoneBlock(ctx, bx, base - 46, bw, 46, 6);
  // Window slots under the roof line.
  ctx.fillStyle = '#26202a';
  ctx.fillRect(bx + 10, base - 38, bw - 20, 7);
  ctx.fillStyle = STONE_DARK;
  for (let i = 1; i < 6; i++) ctx.fillRect(bx + 10 + ((bw - 20) * i) / 6, base - 38, 1.2, 7);
  door(ctx, bx + bw / 2 - 12, base - 24, 24, 24);
  // Pump column with a coiled hose.
  stoneBlock(ctx, x + w - 22, base - 30, 9, 30, 1);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + w - 13, base - 24);
  ctx.bezierCurveTo(x + w - 4, base - 30, x + w - 4, base - 18, x + w - 10, base - 18);
  ctx.stroke();
  ctx.fillStyle = '#c45a2a';
  ctx.fillRect(x + w - 14, base - 33, 2, 6);
  barrels(ctx, bx + 6, base);
  chainHose(ctx, x + 2, bx + 6, base);
  signBoard(ctx, bx + bw / 2, base - 74, ['FUEL'], 15, true);
}

function pipe(ctx: Ctx, pts: number[][], width: number) {
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py);
  ctx.strokeStyle = '#5c5c5c';
  ctx.lineWidth = width + 2;
  ctx.stroke();
  ctx.strokeStyle = '#a9a9a6';
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = width * 0.3;
  ctx.stroke();
}

function drawProcessing(ctx: Ctx, x: number, base: number, w: number) {
  const bx = x + 40;
  const bw = w - 46;
  // Tall back block, lower front block with a big intake pipe.
  stoneBlock(ctx, bx + 16, base - 92, bw - 30, 92, 5);
  ctx.fillStyle = STONE_DARK;
  ctx.fillRect(bx + 26, base - 96, bw - 50, 5);
  ctx.fillStyle = '#9a9a96';
  ctx.fillRect(bx + bw / 2 - 1, base - 104, 1.5, 9);
  stoneBlock(ctx, bx, base - 50, bw, 50, 4);
  ctx.strokeStyle = 'rgba(70,40,38,0.5)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(bx + 8, base - 44, bw - 16, 18);
  // Intake: a fat stone cylinder poking out to the right.
  const iy = base - 22;
  const tube = ctx.createLinearGradient(0, iy - 10, 0, iy + 10);
  tube.addColorStop(0, STONE_LIGHT);
  tube.addColorStop(1, STONE_DARK);
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(bx + bw - 26, iy - 11, 32, 22);
  ctx.fillStyle = tube;
  ctx.fillRect(bx + bw - 26, iy - 10, 32, 20);
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(bx + bw + 6, iy, 8.5, 11, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = STONE_DARK;
  ctx.beginPath();
  ctx.ellipse(bx + bw + 6, iy, 7.5, 10, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2a1e1e';
  ctx.beginPath();
  ctx.ellipse(bx + bw + 6, iy, 5, 7.5, 0, 0, TAU);
  ctx.fill();
  // Elbow pipes on the left side.
  pipe(ctx, [[bx + 2, base - 34], [x + 18, base - 34], [x + 18, base - 4]], 7);
  pipe(ctx, [[bx + 2, base - 20], [x + 6, base - 20], [x + 6, base - 4]], 6);
  ctx.fillStyle = '#8a8a86';
  ctx.fillRect(x + 1, base - 5, 26, 5);
  signBoard(ctx, bx + bw / 2 + 2, base - 90, ['MINERAL', 'PROCESSING'], 9, false);
}

/** The Emendation Station 3500: repairs and items. The only shop without a sign. */
function drawEmendation(ctx: Ctx, x: number, base: number, w: number, time: number) {
  const bx = x + 10;
  const bw = w - 20;
  stoneBlock(ctx, bx, base - 58, bw, 58, 6);
  ctx.fillStyle = STONE_DARK;
  ctx.fillRect(bx + 8, base - 62, bw - 16, 5);
  // Wide garage opening with a hoist inside.
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(bx + 18, base - 34, bw - 36, 34);
  ctx.fillStyle = '#2a2026';
  ctx.fillRect(bx + 20, base - 32, bw - 40, 32);
  ctx.fillStyle = '#6a6a66';
  ctx.fillRect(bx + 24, base - 29, bw - 48, 2);
  ctx.fillRect(bx + bw / 2 - 1, base - 27, 2, 10);
  ctx.strokeStyle = '#8a8a86';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(bx + bw / 2, base - 14, 3, 0, Math.PI);
  ctx.stroke();
  // A slowly turning cog on the roof.
  ctx.save();
  ctx.translate(bx + bw - 22, base - 72);
  ctx.rotate(time * 0.6);
  ctx.fillStyle = OUTLINE;
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.rotate((i / 8) * TAU);
    ctx.fillRect(-2.2, -11, 4.4, 5);
    ctx.restore();
  }
  ctx.fillStyle = '#9b9a94';
  circle(ctx, 0, 0, 8);
  ctx.fill();
  ctx.fillStyle = OUTLINE;
  circle(ctx, 0, 0, 3);
  ctx.fill();
  ctx.restore();
}

/** The AutoBuy 2000, a.k.a. the Junk Shop: a brown dome with a chimney and a spare tyre. */
function drawJunkShop(ctx: Ctx, x: number, base: number, w: number) {
  const cx = x + w / 2 + 8;
  const r = w / 2 - 14;
  ctx.fillStyle = '#3e2a22';
  ctx.beginPath();
  ctx.ellipse(cx, base, r + 1.5, r * 0.9 + 1.5, 0, Math.PI, 0);
  ctx.fill();
  const dome = ctx.createRadialGradient(cx - r * 0.4, base - r * 0.6, 4, cx, base - r * 0.3, r * 1.1);
  dome.addColorStop(0, '#b48d6f');
  dome.addColorStop(1, '#6e4f3e');
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.ellipse(cx, base, r, r * 0.9, 0, Math.PI, 0);
  ctx.fill();
  const wx = cx + r * 0.25;
  const wy = base - r * 0.55;
  ctx.fillStyle = '#3e2a22';
  ctx.beginPath();
  ctx.roundRect(wx - 9, wy - 7, 18, 14, [7, 7, 1, 1]);
  ctx.fill();
  ctx.fillStyle = '#5e4436';
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) ctx.fillRect(wx - 7 + i * 5, wy - 4 + j * 5, 4, 4);
  pipe(ctx, [[cx + 2, base - r * 0.85], [cx + 2, base - r - 12], [cx + 10, base - r - 14]], 4);
  ctx.fillStyle = '#b8473a';
  ctx.fillRect(cx + 9, base - r - 17, 4, 6);
  const tx = x + 20;
  ctx.fillStyle = '#1d1d1d';
  ctx.beginPath();
  ctx.ellipse(tx, base - 10, 8, 10, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#7a7a7a';
  ctx.beginPath();
  ctx.ellipse(tx, base - 10, 4, 5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#3a3a3a';
  ctx.beginPath();
  ctx.ellipse(tx, base - 10, 1.6, 2, 0, 0, TAU);
  ctx.fill();
  signBoard(ctx, cx - 10, base - r - 34, ['JUNK SHOP'], 9, false);
}

/** The save station: a riveted sphere hanging on a cable from somewhere above. */
function drawSaveStation(ctx: Ctx, cx: number, cy: number, time: number) {
  const y = cy + Math.sin(time * 1.4) * 1.2;
  ctx.fillStyle = '#5b5b58';
  ctx.fillRect(cx - 0.6, -10, 1.2, y - 4);
  // Coil antenna on the left.
  ctx.strokeStyle = '#6e6e6a';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(cx - 12, y - 4);
  ctx.lineTo(cx - 16, y - 4);
  ctx.lineTo(cx - 16, y - 22);
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.ellipse(cx - 16, y - 22 - i * 1.4, 1.6, 0.6, 0, 0, TAU);
    ctx.stroke();
  }
  // Prongs on the right.
  ctx.fillStyle = '#b9b9b4';
  ctx.fillRect(cx + 12, y - 4, 10, 1.4);
  ctx.fillRect(cx + 12, y, 10, 1.4);
  // The sphere.
  ctx.fillStyle = '#3a3a37';
  circle(ctx, cx, y, 14.5);
  ctx.fill();
  const shell = ctx.createRadialGradient(cx - 5, y - 6, 2, cx, y, 15);
  shell.addColorStop(0, '#d5d4ce');
  shell.addColorStop(0.6, '#8f8e88');
  shell.addColorStop(1, '#5e5d58');
  ctx.fillStyle = shell;
  circle(ctx, cx, y, 13.5);
  ctx.fill();
  ctx.fillStyle = '#4c4c48';
  for (let a = 0; a < TAU; a += TAU / 12) {
    circle(ctx, cx + Math.cos(a) * 11, y + Math.sin(a) * 11, 0.6);
    ctx.fill();
  }
  // Porthole.
  ctx.fillStyle = '#2e2e2c';
  circle(ctx, cx + 2, y - 2, 6.5);
  ctx.fill();
  const glass = ctx.createRadialGradient(cx, y - 4, 1, cx + 2, y - 2, 6);
  glass.addColorStop(0, '#ffffff');
  glass.addColorStop(0.4, '#a9c6dc');
  glass.addColorStop(1, '#3f5c74');
  ctx.fillStyle = glass;
  circle(ctx, cx + 2, y - 2, 5.2);
  ctx.fill();
  // Clamp underneath.
  ctx.fillStyle = '#6e6d68';
  ctx.fillRect(cx - 7, y + 12, 14, 5);
  ctx.fillStyle = '#4c4c48';
  ctx.fillRect(cx - 9, y + 16, 3, 7);
  ctx.fillRect(cx + 6, y + 16, 3, 7);
  ctx.fillRect(cx - 4, y + 16, 8, 2);
}

const BUILDING_ART: Record<Building['id'], (ctx: Ctx, x: number, base: number, w: number, time: number) => void> = {
  fuel: drawFuelStation,
  processing: drawProcessing,
  junk: drawJunkShop,
  repair: drawEmendation,
};

// ---------------------------------------------------------------------------
// The pod: an olive dome with a black visor band on treads, drawn facing
// right and mirrored for left. It is drawn a little larger than its hitbox,
// as in the original, so it fills the tunnels it digs.

const POD_ART_SCALE = 1.35;

function drawPod(ctx: Ctx, pod: Pod, x: number, y: number, time: number) {
  const dig = pod.dig;
  const spinning = !!dig;
  const facing = dig?.dir === 'left' ? -1 : dig?.dir === 'right' ? 1 : pod.facing;
  ctx.save();
  ctx.translate(x + POD_W / 2, y + POD_H + (spinning ? Math.sin(time * 90) * 0.4 : 0));
  ctx.scale(facing * POD_ART_SCALE, POD_ART_SCALE);
  ctx.translate(-POD_W / 2, -POD_H);

  // Exhaust pipes on the roof.
  ctx.lineCap = 'round';
  for (const [bx, tx, ty] of [
    [10, 15.5, 1.5],
    [12.5, 18.5, 2.8],
  ]) {
    ctx.beginPath();
    ctx.moveTo(bx, 8);
    ctx.quadraticCurveTo(bx + 1, ty, tx, ty);
    ctx.strokeStyle = '#4a4636';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.strokeStyle = '#ecebe2';
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  // Treads.
  ctx.fillStyle = '#2f2d22';
  ctx.beginPath();
  ctx.roundRect(0.5, 18.5, 25, 7.5, 3.5);
  ctx.fill();
  ctx.fillStyle = '#5d5a45';
  ctx.beginPath();
  ctx.roundRect(1.5, 19.5, 23, 5.5, 2.8);
  ctx.fill();
  const roll = ((((pod.x * facing) / 1.5) % 3) + 3) % 3;
  ctx.fillStyle = '#3d3b2d';
  for (let tx = 2 + roll; tx < 24; tx += 3) ctx.fillRect(tx, 19.6, 1, 5.3);

  // Dome body.
  ctx.fillStyle = '#2b2a1f';
  ctx.beginPath();
  ctx.ellipse(13, 19.5, 12.4, 13.2, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  const shell = ctx.createLinearGradient(4, 7, 22, 20);
  shell.addColorStop(0, '#a19e7c');
  shell.addColorStop(0.45, '#77745a');
  shell.addColorStop(1, '#4e4c3a');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.ellipse(13, 19.5, 11.6, 12.4, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  // Visor band, clipped to the dome.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#121212';
  ctx.beginPath();
  ctx.moveTo(0, 11.5);
  ctx.quadraticCurveTo(13, 9.2, 26, 11.5);
  ctx.lineTo(26, 15.5);
  ctx.quadraticCurveTo(13, 13.4, 0, 15.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(14, 11.1);
  ctx.quadraticCurveTo(19, 11, 23, 11.8);
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 17, 26, 3);
  ctx.restore();
  // A pale tusk at the front, and a highlight on the dome.
  ctx.strokeStyle = '#e9e7da';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(18, 17.5);
  ctx.quadraticCurveTo(22, 17.5, 23.5, 15.5);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,240,0.35)';
  ctx.beginPath();
  ctx.ellipse(8.5, 9.5, 3.5, 1.6, -0.6, 0, TAU);
  ctx.fill();

  if (dig?.dir === 'down') drillBit(ctx, 13, 25.5, 9, true, time, spinning);
  else drillBit(ctx, 24, 14.5, spinning ? 9 : 7, false, time, spinning);
  ctx.restore();
}

/** A ribbed silver cone with its base at (x, y), `len` long. */
function drillBit(ctx: Ctx, x: number, y: number, len: number, down: boolean, time: number, spinning: boolean) {
  ctx.save();
  ctx.translate(x, y);
  if (down) ctx.rotate(Math.PI / 2);
  const half = 5;
  ctx.fillStyle = '#4b4b48';
  ctx.fillRect(-1.5, -half - 0.6, 2.4, half * 2 + 1.2);
  ctx.fillStyle = '#2f2f2c';
  poly(ctx, [[0, -half - 0.6], [len + 0.8, 0], [0, half + 0.6]]);
  ctx.fill();
  const metal = ctx.createLinearGradient(0, -half, 0, half);
  metal.addColorStop(0, '#f2f2ee');
  metal.addColorStop(0.45, '#b9b9b4');
  metal.addColorStop(1, '#6a6a66');
  ctx.fillStyle = metal;
  poly(ctx, [[0, -half], [len, 0], [0, half]]);
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = 'rgba(50,50,46,0.7)';
  ctx.lineWidth = 0.7;
  const shift = spinning ? (time * 40) % 2.2 : 0;
  for (let i = 0.5; i < len + 2; i += 2.2) {
    ctx.beginPath();
    ctx.moveTo(i + shift, -half);
    ctx.lineTo(i + shift, half);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Renderer

/** Colour of debris thrown up while drilling a tile. */
function debrisColor(tile: Tile, tx: number, ty: number): string {
  const ore = oreFor(tile);
  if (ore && Math.random() < 0.5) return ore.color;
  if (tile === T.ROCK) return '#6f6c6a';
  const band = BANDS[bandFor(tx, ty)];
  return Math.random() < 0.5 ? band.tunnel : shade(band.dirt, 0.2);
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  // Debris is a solid colour; puffs are an "r,g,b" triple so they can fade.
  color: string;
  puff: boolean;
}

interface FloatText {
  text: string;
  color: string;
  x: number;
  y: number;
  life: number;
}

const FLOAT_LIFE = 1.3;

export type BurstKind = 'lava' | 'gas' | 'blast';

export interface Renderer {
  draw(game: Game, dt: number, time: number): void;
  reset(game: Game): void;
  /** Show a short label that rises from the pod and fades, like a pickup notice. */
  floatText(game: Game, text: string, color?: string): void;
  /** An explosion of fire, gas, or dynamite centred on a tile. */
  burst(tx: number, ty: number, radius: number, kind: BurstKind): void;
  /** Shake the screen, as in a marsquake. */
  shake(seconds: number): void;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d')!;
  const sprites = new SpriteCache();
  const particles: Particle[] = [];
  const labels: FloatText[] = [];
  const cam = { x: 0, y: 0 };
  let puffTimer = 0;
  let flash = 0;
  let shaking = 0;

  function target(pod: Pod) {
    const x = pod.x + POD_W / 2 - VIEW_W / 2;
    const y = pod.y + POD_H / 2 - VIEW_H * 0.45;
    return {
      x: Math.max(0, Math.min(WORLD_W * TILE - VIEW_W, x)),
      y: Math.max(0, Math.min(WORLD_H * TILE - VIEW_H, y)),
    };
  }

  function reset(game: Game) {
    Object.assign(cam, target(game.pod));
    particles.length = 0;
    labels.length = 0;
  }

  function floatText(game: Game, text: string, color = '#ffd23a') {
    labels.push({ text, color, x: game.pod.x + POD_W / 2, y: game.pod.y - 6, life: FLOAT_LIFE });
  }

  function emit(p: Omit<Particle, 'max'>) {
    particles.push({ ...p, max: p.life });
  }

  function burst(tx: number, ty: number, radius: number, kind: BurstKind) {
    const cx = (tx + 0.5) * TILE;
    const cy = (ty + 0.5) * TILE;
    const colors = {
      lava: ['#ff6a1a', '#ffb02e', '#d32a10'],
      gas: ['#8dff5a', '#3fc93a', '#e2ffc0'],
      blast: ['#ffcf4a', '#ff7a2a', '#ffffff'],
    }[kind];
    for (let i = 0; i < 40 + radius * 30; i++) {
      const a = Math.random() * TAU;
      const sp = 60 + Math.random() * (140 + radius * 60);
      emit({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 0.4 + Math.random() * 0.5,
        size: 1.5 + Math.random() * 2,
        color: colors[i % colors.length],
        puff: false,
      });
    }
    for (let i = 0; i < 10 + radius * 6; i++) {
      emit({
        x: cx + (Math.random() - 0.5) * TILE * (radius + 1),
        y: cy + (Math.random() - 0.5) * TILE * (radius + 1),
        vx: (Math.random() - 0.5) * 30,
        vy: -20 - Math.random() * 30,
        life: 0.8 + Math.random() * 0.6,
        size: 4,
        color: kind === 'gas' ? '110,200,90' : '90,80,75',
        puff: true,
      });
    }
    flash = 0.25;
  }

  function draw(game: Game, dt: number, time: number) {
    const t = target(game.pod);
    const ease = Math.min(1, dt * 8);
    cam.x += (t.x - cam.x) * ease;
    cam.y += (t.y - cam.y) * ease;
    let cx = Math.round(cam.x * SCALE) / SCALE;
    let cy = Math.round(cam.y * SCALE) / SCALE;
    if (shaking > 0) {
      shaking = Math.max(0, shaking - dt);
      cx += Math.round((Math.random() - 0.5) * 10);
      cy += Math.round((Math.random() - 0.5) * 10);
    }

    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    // The sky goes to night as soon as you head underground, as in the original.
    const dark = Math.min(1, depthFeet(game.pod) / 30);
    if (cy < SURFACE_Y) drawSky(ctx, cy, dark);
    drawTiles(game, cx, cy);
    if (cy < SURFACE_Y + 10) drawSurface(cx, cy, time);
    drawDigProgress(game, cx, cy);
    updateParticles(game, dt);
    drawParticles(cx, cy, false);
    const px = Math.round(game.pod.x * SCALE) / SCALE - cx;
    const py = Math.round(game.pod.y * SCALE) / SCALE - cy;
    drawPod(ctx, game.pod, px, py, time);
    drawParticles(cx, cy, true);
    drawLabels(cx, cy, dt);
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,230,180,${flash * 1.6})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      flash = Math.max(0, flash - dt);
    }
  }

  function drawTiles(game: Game, cx: number, cy: number) {
    const x0 = Math.floor(cx / TILE);
    const y0 = Math.max(SKY_ROWS, Math.floor(cy / TILE));
    const x1 = Math.min(WORLD_W - 1, Math.floor((cx + VIEW_W) / TILE));
    const y1 = Math.min(WORLD_H - 1, Math.floor((cy + VIEW_H) / TILE));
    const w = game.world;
    // The sky counts as open, so surface tunnels round off toward it too.
    const solid = (tx: number, ty: number) => ty >= SKY_ROWS && isSolid(tileAt(w, tx, ty));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = tileAt(w, tx, ty);
        const sx = tx * TILE - cx;
        const sy = ty * TILE - cy;
        const tunnel = BANDS[bandFor(tx, ty)].tunnel;
        if (isSolid(tile)) {
          ctx.drawImage(sprites.tile(tile, tx, ty), sx, sy, TILE, TILE);
          // Round off dirt corners that poke out into a tunnel.
          for (const [dx, dy] of CORNERS) {
            if (ty + dy < SKY_ROWS) continue;
            if (!solid(tx + dx, ty) && !solid(tx, ty + dy) && !solid(tx + dx, ty + dy)) {
              cornerPatch(sx, sy, dx, dy, () => {
                ctx.fillStyle = tunnel;
                ctx.fillRect(sx, sy, TILE, TILE);
              });
            }
          }
          continue;
        }
        // A dug-out tunnel: flat tan, with dirt filling its inside corners.
        ctx.fillStyle = tunnel;
        ctx.fillRect(sx, sy, TILE, TILE);
        for (const [dx, dy] of CORNERS) {
          if (solid(tx + dx, ty) && solid(tx, ty + dy)) {
            const sprite = sprites.dirt(tx + dx, ty);
            cornerPatch(sx, sy, dx, dy, () => ctx.drawImage(sprite, sx, sy, TILE, TILE));
          }
        }
      }
    }
  }

  /** Paints `fill` into one corner of a tile, outside a quarter circle, to round it. */
  function cornerPatch(sx: number, sy: number, dx: number, dy: number, fill: () => void) {
    const x = dx > 0 ? sx + TILE : sx; // the tile corner
    const y = dy > 0 ? sy + TILE : sy;
    const ix = x - dx * CORNER; // centre of the rounding arc
    const iy = y - dy * CORNER;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ix, y);
    ctx.arc(ix, iy, CORNER, dy > 0 ? Math.PI / 2 : -Math.PI / 2, dx > 0 ? 0 : dy > 0 ? Math.PI : -Math.PI, dx === dy);
    ctx.closePath();
    ctx.clip();
    fill();
    ctx.restore();
  }

  function drawSurface(cx: number, cy: number, time: number) {
    const base = SURFACE_Y - cy;
    for (const b of BUILDINGS) {
      const x = b.x0 * TILE - cx;
      const w = (b.x1 - b.x0 + 1) * TILE;
      if (x > VIEW_W + 60 || x + w < -60) continue;
      BUILDING_ART[b.id](ctx, x, base, w, time);
    }
    const s = SAVE_STATION;
    drawSaveStation(ctx, ((s.x0 + s.x1 + 1) / 2) * TILE - cx, ((s.y0 + s.y1 + 1) / 2) * TILE - cy, time);
  }

  function drawDigProgress(game: Game, cx: number, cy: number) {
    const dig = game.pod.dig;
    if (!dig) return;
    // The tile crumbles into tunnel colour as the drill works through it.
    ctx.globalAlpha = Math.min(dig.t / dig.dur, 1) * 0.85;
    ctx.fillStyle = BANDS[bandFor(dig.tx, dig.ty)].tunnel;
    ctx.fillRect(dig.tx * TILE - cx, dig.ty * TILE - cy, TILE, TILE);
    ctx.globalAlpha = 1;
  }

  function updateParticles(game: Game, dt: number) {
    const pod = game.pod;
    const dig = pod.dig;
    if (dig) {
      const tip =
        dig.dir === 'down'
          ? { x: pod.x + POD_W / 2, y: pod.y + POD_H + 6 }
          : { x: dig.dir === 'right' ? pod.x + POD_W + 6 : pod.x - 6, y: pod.y + POD_H - 10 };
      for (let i = 0; i < 2; i++) {
        emit({
          x: tip.x,
          y: tip.y,
          vx: (Math.random() - 0.5) * 160 + (dig.dir === 'right' ? -60 : dig.dir === 'left' ? 60 : 0),
          vy: -Math.random() * 160 - 40,
          life: 0.35 + Math.random() * 0.3,
          size: 1.5,
          color: debrisColor(dig.tile, dig.tx, dig.ty),
          puff: false,
        });
      }
    }
    // Pale blue exhaust rings drift from the roof pipes: a few at idle, many
    // while flying, and dark smoke instead once the hull is badly hurt.
    puffTimer -= dt;
    if (!game.over && puffTimer <= 0) {
      const hurt = game.hull / stats(game).maxHull < 0.3;
      const f = dig?.dir === 'left' ? -1 : dig?.dir === 'right' ? 1 : pod.facing;
      puffTimer = pod.thrusting ? 0.06 : 0.45;
      emit({
        x: pod.x + POD_W / 2 + f * 5 * POD_ART_SCALE,
        y: pod.y + POD_H - (POD_H - 2) * POD_ART_SCALE,
        vx: (Math.random() - 0.5) * 12 - f * 6,
        vy: -18 - Math.random() * 14,
        life: 1.1 + Math.random() * 0.5,
        size: 3,
        color: hurt ? '70,70,70' : '170,205,230',
        puff: true,
      });
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      if (!p.puff) p.vy += 600 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function drawParticles(cx: number, cy: number, puffs: boolean) {
    for (const p of particles) {
      if (p.puff !== puffs) continue;
      if (puffs) {
        const k = 1 - p.life / p.max;
        ctx.fillStyle = `rgba(${p.color},${0.45 * (1 - k)})`;
        circle(ctx, p.x - cx, p.y - cy, p.size + k * 7);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - cx, p.y - cy, p.size, p.size);
      }
    }
  }

  function drawLabels(cx: number, cy: number, dt: number) {
    ctx.textAlign = 'center';
    for (let i = labels.length - 1; i >= 0; i--) {
      const l = labels[i];
      l.life -= dt;
      if (l.life <= 0) {
        labels.splice(i, 1);
        continue;
      }
      const k = 1 - l.life / FLOAT_LIFE;
      ctx.globalAlpha = Math.min(1, l.life / 0.4);
      outlinedText(ctx, l.text, l.x - cx, l.y - cy - k * 26, 11, l.color);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }

  function shake(seconds: number) {
    shaking = seconds;
  }

  return { draw, reset, floatText, burst, shake };
}
