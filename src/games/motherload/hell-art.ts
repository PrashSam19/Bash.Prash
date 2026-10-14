// Hell and its resident, drawn in code like the rest of the game. Dr. Prash's
// face is the site owner's headshot, cropped to an oval; everything else
// (horns, hooves, the suit, the cyborg second form) is drawn on top.
//
// Boss art is drawn in "local" coordinates: origin at the middle of his feet
// on the floor, +x the way he faces, -y up. The engine's monocle() and
// shoulder() positions line up with the art, so the laser leaves the monocle
// and the claw swings from the shoulder.

import {
  TILE,
  FLOOR_Y,
  CEILING_ROW,
  FIREBALL_R,
  BOSS_SIZE,
  sweepLine,
  mulberry32,
  type Boss,
  type Fireball,
} from './engine.ts';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const ARENA_TOP_Y = (CEILING_ROW + 1) * TILE;

function poly(g: Ctx, pts: number[][]) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.max(0, Math.min(1, k));

// ---------------------------------------------------------------------------
// The arena

/** Basalt for Hell's ceiling and floor, with glowing cracks. */
export function drawHellRock(g: Ctx, variant: number, ceiling: boolean) {
  const rnd = mulberry32(900 + variant * 7 + (ceiling ? 1 : 0));
  g.fillStyle = '#1d1412';
  g.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 7; i++) {
    g.fillStyle = rnd() < 0.5 ? '#2a1c18' : '#150e0d';
    const x = rnd() * TILE;
    const y = rnd() * TILE;
    poly(g, [[x, y], [x + 4 + rnd() * 6, y + rnd() * 3], [x + 2 + rnd() * 5, y + 4 + rnd() * 5]]);
    g.fill();
  }
  // Cracks glowing with the heat below.
  g.strokeStyle = '#ff5a1a';
  g.lineWidth = 0.8;
  g.beginPath();
  let x = rnd() * TILE;
  let y = ceiling ? TILE : 0;
  g.moveTo(x, y);
  for (let i = 0; i < 4; i++) {
    x += (rnd() - 0.5) * 12;
    y += (ceiling ? -1 : 1) * (3 + rnd() * 5);
    g.lineTo(x, y);
  }
  g.stroke();
  if (ceiling) {
    // Stalactites along the underside.
    g.fillStyle = '#120b0a';
    for (let sx = 2 + rnd() * 6; sx < TILE - 3; sx += 7 + rnd() * 6) {
      poly(g, [[sx - 3, TILE - 6], [sx + 3, TILE - 6], [sx + 0.5, TILE + 0]]);
      g.fill();
    }
  } else {
    // A crust of embers along the top.
    const crust = g.createLinearGradient(0, 0, 0, 6);
    crust.addColorStop(0, 'rgba(255,120,40,0.75)');
    crust.addColorStop(1, 'rgba(255,60,10,0)');
    g.fillStyle = crust;
    g.fillRect(0, 0, TILE, 6);
  }
}

/** The open arena: a red-black cavern with distant spires and floor flames. */
export function drawHellBackdrop(g: Ctx, cx: number, cy: number, viewW: number, viewH: number, time: number) {
  const top = ARENA_TOP_Y - cy;
  const floor = FLOOR_Y - cy;
  if (floor < 0 || top > viewH) return;
  const sky = g.createLinearGradient(0, top, 0, floor);
  sky.addColorStop(0, '#160303');
  sky.addColorStop(0.55, '#3a0805');
  sky.addColorStop(1, '#7c1c07');
  g.fillStyle = sky;
  g.fillRect(0, top, viewW, floor - top);

  // Far-off spires, scrolling at half speed for depth.
  g.save();
  g.beginPath();
  g.rect(0, top, viewW, floor - top);
  g.clip();
  const par = cx * 0.5;
  const first = Math.floor(par / 40) - 1;
  g.fillStyle = '#250605';
  for (let i = first; i < first + viewW / 40 + 3; i++) {
    const r = mulberry32(i * 31 + 7)();
    const x = i * 40 - par;
    const h = 40 + r * 120;
    poly(g, [[x - 18, floor], [x - 5, floor - h * 0.6], [x + 2, floor - h], [x + 9, floor - h * 0.55], [x + 22, floor]]);
    g.fill();
  }
  // Heat haze glowing up from the floor.
  const glow = g.createLinearGradient(0, floor - 70, 0, floor);
  glow.addColorStop(0, 'rgba(255,90,20,0)');
  glow.addColorStop(1, `rgba(255,110,30,${0.32 + Math.sin(time * 5) * 0.05})`);
  g.fillStyle = glow;
  g.fillRect(0, floor - 70, viewW, 70);
  // Flames licking along the floor.
  const step = 14;
  const firstFlame = Math.floor(cx / step);
  for (let i = firstFlame; i < firstFlame + viewW / step + 2; i++) {
    const x = i * step - cx;
    const h = 7 + Math.sin(time * 7 + i * 1.7) * 3 + Math.sin(time * 13 + i * 0.6) * 2;
    flame(g, x, floor, 5, h, '#ff5a14');
    flame(g, x, floor, 2.5, h * 0.55, '#ffd25a');
  }
  g.restore();
}

function flame(g: Ctx, x: number, base: number, w: number, h: number, color: string) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x - w, base);
  g.quadraticCurveTo(x - w * 0.8, base - h * 0.6, x, base - h);
  g.quadraticCurveTo(x + w * 0.8, base - h * 0.6, x + w, base);
  g.closePath();
  g.fill();
}

// ---------------------------------------------------------------------------
// Dr. Prash's face

// The crop of the (square) headshot used for his head, as fractions, and
// where his eyes fall inside that crop.
const CROP = { x: 270 / 900, y: 40 / 900, w: 400 / 900, h: 580 / 900 };
const EYES = [
  [0.3875, 0.445],
  [0.7875, 0.431],
];

let tinted: { src: HTMLImageElement; canvas: HTMLCanvasElement } | null = null;

/** The face, reddened for his true form. Built once, after the photo loads. */
function demonFace(face: HTMLImageElement): HTMLCanvasElement {
  if (tinted?.src === face) return tinted.canvas;
  const c = document.createElement('canvas');
  c.width = face.naturalWidth;
  c.height = face.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(face, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = '#ff5a48';
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(120,0,0,0.25)';
  g.fillRect(0, 0, c.width, c.height);
  tinted = { src: face, canvas: c };
  return c;
}

/** His head: the photo in an oval (or a plain face until it loads), with glowing eyes. */
function head(g: Ctx, hx: number, hy: number, rx: number, ry: number, face: HTMLImageElement | null, demon: boolean, time: number) {
  g.save();
  g.beginPath();
  g.ellipse(hx, hy, rx, ry, 0, 0, TAU);
  g.fillStyle = demon ? '#8f2a1c' : '#9a6a4c';
  g.fill();
  g.clip();
  if (face?.complete && face.naturalWidth) {
    const src = demon ? demonFace(face) : face;
    const w = face.naturalWidth;
    const h = face.naturalHeight;
    g.drawImage(src, CROP.x * w, CROP.y * h, CROP.w * w, CROP.h * h, hx - rx, hy - ry, rx * 2, ry * 2);
  }
  g.restore();
  g.strokeStyle = demon ? '#3a0a06' : '#2a1a14';
  g.lineWidth = 1.2;
  g.beginPath();
  g.ellipse(hx, hy, rx, ry, 0, 0, TAU);
  g.stroke();
  // Red eyes, "even in human guise".
  const pulse = 0.75 + Math.sin(time * 6) * 0.25;
  for (const [fx, fy] of EYES) {
    const ex = hx - rx + fx * rx * 2;
    const ey = hy - ry + fy * ry * 2;
    const r = demon ? 5.5 : 4;
    const glow = g.createRadialGradient(ex, ey, 0, ex, ey, r);
    glow.addColorStop(0, `rgba(255,240,200,${pulse})`);
    glow.addColorStop(0.35, `rgba(255,30,20,${pulse})`);
    glow.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(ex, ey, r, 0, TAU);
    g.fill();
  }
}

/** Where an eye lands, for placing the monocle. */
function eyeAt(hx: number, hy: number, rx: number, ry: number, i: number) {
  return { x: hx - rx + EYES[i][0] * rx * 2, y: hy - ry + EYES[i][1] * ry * 2 };
}

function horn(g: Ctx, x: number, y: number, len: number, curl: number, color: string) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x - len * 0.18, y);
  g.quadraticCurveTo(x + curl * 0.2, y - len * 0.7, x + curl, y - len);
  g.quadraticCurveTo(x + curl * 0.15 + len * 0.1, y - len * 0.5, x + len * 0.18, y);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 0.7;
  g.stroke();
}

function hoof(g: Ctx, x: number) {
  g.fillStyle = '#121010';
  poly(g, [[x - 6, 0], [x - 5, -8], [x + 5, -8], [x + 7, 0]]);
  g.fill();
  g.strokeStyle = '#3a3330';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(x + 0.5, 0);
  g.lineTo(x + 0.5, -4);
  g.stroke();
}

function tail(g: Ctx, x: number, y: number, time: number, color: string) {
  const sway = Math.sin(time * 2.5) * 6;
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x, y);
  g.bezierCurveTo(x - 26, y + 6, x - 38 + sway, y + 30, x - 26 + sway, y + 44);
  g.stroke();
  g.fillStyle = color;
  const tx = x - 26 + sway;
  const ty = y + 44;
  poly(g, [[tx, ty + 7], [tx - 6, ty - 1], [tx, ty - 4], [tx + 6, ty - 1]]);
  g.fill();
}

// ---------------------------------------------------------------------------
// First form: Dr. Prash in his burgundy suit and lab coat, with a staff.

function staffAngle(b: Boss): number {
  // The angle of the staff's long end from his hand: straight down at rest,
  // cocked up behind him, swung through to just below level, then back down.
  const down = Math.PI / 2;
  const back = down + 2.5;
  const through = Math.PI * 2 + 0.35;
  if (b.move !== 'staff') return down;
  if (b.t < 0.45) return lerp(down, back, b.t / 0.45);
  if (b.t < 0.7) return lerp(back, through, (b.t - 0.45) / 0.25);
  return lerp(through, Math.PI * 2 + down, (b.t - 0.7) / 0.2);
}

function drawFormOne(g: Ctx, b: Boss, time: number, face: HTMLImageElement | null) {
  const walk = b.move === 'walk' ? Math.sin(time * 9) : 0;
  tail(g, -8, -52, time, '#9c1712');

  // Legs, ending in hooves.
  for (const [hip, swing, shade] of [[-6, -walk, '#151317'], [6, walk, '#201d23']] as const) {
    const foot = hip + swing * 6;
    g.fillStyle = shade;
    poly(g, [[hip - 5, -54], [hip + 5, -54], [foot + 5, -8], [foot - 5, -8]]);
    g.fill();
    hoof(g, foot);
  }

  // The lab coat's back, then the suit.
  g.fillStyle = '#d9d8d2';
  poly(g, [[-22, -94], [22, -94], [30, -30], [-30, -30]]);
  g.fill();
  g.fillStyle = '#4a1420';
  poly(g, [[-18, -94], [18, -94], [14, -50], [-14, -50]]);
  g.fill();
  // Shirt, lapels, and a bow tie.
  g.fillStyle = '#f4f2ec';
  poly(g, [[-7, -94], [7, -94], [0, -66]]);
  g.fill();
  g.fillStyle = '#2d0b13';
  poly(g, [[-7, -94], [-1, -70], [-11, -88]]);
  g.fill();
  poly(g, [[7, -94], [1, -70], [11, -88]]);
  g.fill();
  g.fillStyle = '#0d0d0d';
  poly(g, [[-5, -93], [0, -91], [5, -93], [5, -88], [0, -90], [-5, -88]]);
  g.fill();
  // The coat's open front panels.
  g.fillStyle = '#efeee8';
  poly(g, [[-22, -94], [-12, -94], [-13, -30], [-30, -30]]);
  g.fill();
  poly(g, [[22, -94], [12, -94], [13, -30], [30, -30]]);
  g.fill();
  g.strokeStyle = '#a9a8a0';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(-12, -94);
  g.lineTo(-13, -30);
  g.moveTo(12, -94);
  g.lineTo(13, -30);
  g.stroke();

  // Back arm.
  g.strokeStyle = '#d9d8d2';
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-16, -88);
  g.lineTo(-22 - walk * 3, -58);
  g.stroke();

  // Head: monocle eye at the engine's monocle position (+7, -128).
  const hx = -3.9;
  const hy = -124.4;
  const rx = 19;
  const ry = 26;
  g.fillStyle = '#7a5440';
  g.fillRect(-4, -100, 8, 8);
  horn(g, hx - 9, hy - ry + 6, 14, -6, '#b3261c');
  horn(g, hx + 9, hy - ry + 5, 14, 6, '#b3261c');
  head(g, hx, hy, rx, ry, face, false, time);
  // The laser monocle, glowing as it charges.
  const eye = eyeAt(hx, hy, rx, ry, 1);
  const charge = b.move === 'laser' ? Math.min(1, b.t / 0.5) : 0;
  g.strokeStyle = '#e2b53b';
  g.lineWidth = 1.4;
  g.beginPath();
  g.arc(eye.x, eye.y, 5, 0, TAU);
  g.stroke();
  g.beginPath();
  g.moveTo(eye.x + 3, eye.y + 4);
  g.quadraticCurveTo(eye.x + 6, eye.y + 18, eye.x - 2, eye.y + 30);
  g.lineWidth = 0.6;
  g.stroke();
  if (charge > 0) {
    const glow = g.createRadialGradient(eye.x, eye.y, 0, eye.x, eye.y, 6 + charge * 10);
    glow.addColorStop(0, 'rgba(255,255,255,0.95)');
    glow.addColorStop(0.3, 'rgba(255,40,30,0.85)');
    glow.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(eye.x, eye.y, 6 + charge * 10, 0, TAU);
    g.fill();
  }

  // Front arm and the Staff of Hell.
  const a = staffAngle(b);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const sx = 14;
  const sy = -88;
  const hand = { x: sx + dx * 28, y: sy + dy * 28 };
  g.strokeStyle = '#e8e7e0';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(sx, sy);
  g.lineTo(hand.x, hand.y);
  g.stroke();
  g.strokeStyle = '#2a1508';
  g.lineWidth = 3.2;
  g.beginPath();
  g.moveTo(hand.x - dx * 12, hand.y - dy * 12);
  g.lineTo(hand.x + dx * 62, hand.y + dy * 62);
  g.stroke();
  g.fillStyle = '#e2b53b';
  g.beginPath();
  g.arc(hand.x - dx * 13, hand.y - dy * 13, 4, 0, TAU);
  g.fill();
  g.fillStyle = '#ff2a1a';
  g.beginPath();
  g.arc(hand.x - dx * 13, hand.y - dy * 13, 1.8, 0, TAU);
  g.fill();
  g.fillStyle = '#7a5440';
  g.beginPath();
  g.arc(hand.x, hand.y, 3.5, 0, TAU);
  g.fill();
}

// ---------------------------------------------------------------------------
// Second form: a cyborg demon with a claw arm and a furnace in his chest.

function drawFormTwo(g: Ctx, b: Boss, time: number, face: HTMLImageElement | null) {
  const walk = b.move === 'walk' ? Math.sin(time * 8) : 0;
  tail(g, -12, -66, time, '#7a120d');

  // Digitigrade legs: red thighs, steel shins, hooves.
  for (const [hip, swing] of [[-11, -walk], [11, walk]] as const) {
    const foot = hip + swing * 7;
    const knee = { x: hip + 7 + swing * 2, y: -38 };
    g.strokeStyle = '#8e1d14';
    g.lineWidth = 12;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(hip, -64);
    g.lineTo(knee.x, knee.y);
    g.stroke();
    g.strokeStyle = '#8a8d94';
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(knee.x, knee.y);
    g.lineTo(foot, -9);
    g.stroke();
    g.fillStyle = '#c9ccd2';
    g.beginPath();
    g.arc(knee.x, knee.y, 3.5, 0, TAU);
    g.fill();
    hoof(g, foot);
  }

  // Back arm: bare red, with talons.
  g.strokeStyle = '#7d1810';
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(-22, -110);
  g.lineTo(-30 - walk * 3, -72);
  g.stroke();

  // Torso, with a steel chest plate.
  g.fillStyle = '#9b2015';
  poly(g, [[-32, -118], [32, -118], [22, -60], [-22, -60]]);
  g.fill();
  g.fillStyle = '#7d8088';
  poly(g, [[-20, -114], [24, -114], [18, -70], [-16, -70]]);
  g.fill();
  g.strokeStyle = '#42444a';
  g.lineWidth = 1;
  g.stroke();
  for (const [rx, ry] of [[-16, -110], [20, -110], [-13, -74], [15, -74]]) {
    g.fillStyle = '#42444a';
    g.beginPath();
    g.arc(rx, ry, 1.2, 0, TAU);
    g.fill();
  }
  // The furnace: its door swings open before a fireball.
  const open = b.move === 'fireball' ? Math.min(1, b.t / 0.5) : 0;
  const fx = 3;
  const fy = -92;
  const inner = g.createRadialGradient(fx, fy, 1, fx, fy, 12);
  inner.addColorStop(0, '#fff2a0');
  inner.addColorStop(0.5, '#ff7a1a');
  inner.addColorStop(1, '#5a0a04');
  g.fillStyle = open > 0 ? inner : '#2b1210';
  g.beginPath();
  g.arc(fx, fy, 12, 0, TAU);
  g.fill();
  g.fillStyle = '#55585f';
  g.beginPath();
  g.ellipse(fx + open * 13, fy, 12 * (1 - open * 0.8), 12, 0, 0, TAU);
  g.fill();
  if (open < 0.5) {
    g.strokeStyle = '#ff6a1a';
    g.lineWidth = 1.4;
    for (const gy of [-5, 0, 5]) {
      g.beginPath();
      g.moveTo(fx - 7, fy + gy);
      g.lineTo(fx + 7, fy + gy);
      g.stroke();
    }
  }

  // Head, with ram horns.
  const hx = 0;
  const hy = -141;
  const rx = 21;
  const ry = 28;
  horn(g, hx - 12, hy - ry + 10, 26, -16, '#d8c9a0');
  horn(g, hx + 12, hy - ry + 10, 26, 16, '#d8c9a0');
  head(g, hx, hy, rx, ry, face, true, time);
  // A steel jaw plate.
  g.fillStyle = '#8a8d94';
  poly(g, [[hx - 13, hy + 15], [hx + 13, hy + 15], [hx + 8, hy + ry + 1], [hx - 8, hy + ry + 1]]);
  g.fill();

  clawArm(g, b, time);
}

/** The mechanical arm, from the shoulder at the engine's shoulder() position (+18, -112). */
function clawArm(g: Ctx, b: Boss, time: number) {
  const sx = 18;
  const sy = -112;
  // Angles here are local (facing right), so mirror the engine's world angles.
  const local = (a: number) => (b.facing > 0 ? a : Math.PI - a);
  let angle = 1.25; // hanging down and forward at rest
  let len = 52;
  let open = 0.3;
  if (b.move === 'claw') {
    const line = sweepLine(b);
    if (line) {
      angle = local(Math.atan2(line.y1 - line.y0, line.x1 - line.x0));
      len = Math.hypot(line.x1 - line.x0, line.y1 - line.y0);
      open = 1;
    } else {
      // Winding up: cocked back, claw opening.
      const k = b.t / 0.5;
      angle = lerp(1.25, local(b.aim), k);
      len = lerp(52, 64, k);
      open = lerp(0.3, 1, k);
    }
  }
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const ex = sx + dx * len;
  const ey = sy + dy * len;
  // Telescoping steel segments.
  g.lineCap = 'round';
  g.strokeStyle = '#4a4c52';
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(sx, sy);
  g.lineTo(ex, ey);
  g.stroke();
  g.strokeStyle = '#a7aab2';
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = '#2e3035';
  for (let d = 18; d < len - 6; d += 22) {
    g.beginPath();
    g.arc(sx + dx * d, sy + dy * d, 4.2, 0, TAU);
    g.fill();
  }
  g.fillStyle = '#c9ccd2';
  g.beginPath();
  g.arc(sx, sy, 6, 0, TAU);
  g.fill();
  // Three talons.
  g.strokeStyle = '#e8e2d0';
  g.lineWidth = 2.6;
  for (const spread of [-0.7, 0, 0.7]) {
    const a = angle + spread * open;
    g.beginPath();
    g.moveTo(ex, ey);
    g.quadraticCurveTo(ex + Math.cos(a) * 9, ey + Math.sin(a) * 9, ex + Math.cos(a + 0.5) * 15, ey + Math.sin(a + 0.5) * 15);
    g.stroke();
  }
  if (b.move === 'claw' && b.t >= 0.5) {
    // A blur trailing the swing. Mirrored into local angles, the swing
    // always turns clockwise.
    g.fillStyle = `rgba(255,255,255,${0.08 + Math.sin(time * 40) * 0.03})`;
    g.beginPath();
    g.moveTo(sx, sy);
    g.arc(sx, sy, len, local(b.aim), angle);
    g.closePath();
    g.fill();
  }
}

// ---------------------------------------------------------------------------

/**
 * Draws him with his feet at (sx, floorY) on screen. Sinking and rising
 * slide him through the floor; a hit makes him blink.
 */
export function drawBoss(g: Ctx, b: Boss, sx: number, floorY: number, time: number, face: HTMLImageElement | null) {
  const h = BOSS_SIZE[b.form].h + 10;
  let sink = 0;
  if (b.move === 'sinking') sink = Math.min(1, b.t / b.dur) * h;
  else if (b.move === 'rising') sink = (1 - Math.min(1, b.t / b.dur)) * h;
  else if (b.move === 'dying') sink = Math.max(0, (b.t - 1.2) / (b.dur - 1.2)) * h;
  const shake = b.move === 'dying' || b.move === 'sinking' ? (Math.random() - 0.5) * 4 : 0;

  g.save();
  // Nothing of him shows below the floor.
  g.beginPath();
  g.rect(sx - 300, floorY - 400, 600, 400);
  g.clip();
  g.translate(sx + shake, floorY + sink);
  g.scale(b.facing, 1);
  if (b.hurt > 0 && Math.floor(time * 30) % 2) g.globalAlpha = 0.45;
  if (b.form === 1) drawFormOne(g, b, time, face);
  else drawFormTwo(g, b, time, face);
  g.restore();
}

/** The laser beam, in screen coordinates, drawn over everything it passes through. */
export function drawLaser(g: Ctx, b: Boss, cx: number, cy: number, time: number) {
  if (b.move !== 'laser') return;
  const line = sweepLine(b);
  if (!line) return;
  const x0 = line.x0 - cx;
  const y0 = line.y0 - cy;
  const x1 = line.x1 - cx;
  const y1 = line.y1 - cy;
  g.lineCap = 'round';
  g.strokeStyle = `rgba(255,30,20,${0.35 + Math.sin(time * 50) * 0.1})`;
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.strokeStyle = '#ff5a40';
  g.lineWidth = 4;
  g.stroke();
  g.strokeStyle = '#fff0e0';
  g.lineWidth = 1.5;
  g.stroke();
}

export function drawFireball(g: Ctx, f: Fireball, sx: number, sy: number, time: number) {
  const r = FIREBALL_R + Math.sin(time * 30 + f.x) * 1.2;
  const halo = g.createRadialGradient(sx, sy, 0, sx, sy, r * 1.9);
  halo.addColorStop(0, 'rgba(255,200,80,0.6)');
  halo.addColorStop(1, 'rgba(255,60,10,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(sx, sy, r * 1.9, 0, TAU);
  g.fill();
  const core = g.createRadialGradient(sx - 2, sy - 2, 1, sx, sy, r);
  core.addColorStop(0, '#fffbe0');
  core.addColorStop(0.4, '#ffc23a');
  core.addColorStop(0.8, '#ff5a14');
  core.addColorStop(1, '#b3200a');
  g.fillStyle = core;
  g.beginPath();
  g.arc(sx, sy, r, 0, TAU);
  g.fill();
}
