// Icons for the shop screens: upgrade tiers, categories, items, and minerals.
// Each is drawn in code onto a small canvas, in the spirit of the original's
// rendered thumbnails.

import { ORES, oreFor, type ItemKind, type Tile, type UpgradeKind } from './engine.ts';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

function canvas(size: number, draw: (g: Ctx, s: number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = 2;
  c.width = size * dpr;
  c.height = size * dpr;
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  draw(g, size);
  return c;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const to = amt < 0 ? 0 : 255;
  const k = Math.abs(amt);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * k));
  return `rgb(${c.join(',')})`;
}

function poly(g: Ctx, pts: number[][]) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
  g.closePath();
}

function circle(g: Ctx, x: number, y: number, r: number) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
}

/** A ribbed cone pointing left, like the drill thumbnails in the AutoBuy. */
function cone(g: Ctx, s: number, color: string) {
  const bx = s * 0.72;
  const tip = s * 0.12;
  const h = s * 0.34;
  const cy = s * 0.5;
  // The olive mount behind it.
  g.fillStyle = '#5b5a46';
  g.beginPath();
  g.roundRect(s * 0.66, s * 0.3, s * 0.3, s * 0.42, 6);
  g.fill();
  g.fillStyle = '#e8d78a';
  g.fillRect(s * 0.86, s * 0.56, s * 0.06, s * 0.06);
  const grad = g.createLinearGradient(0, cy - h, 0, cy + h);
  grad.addColorStop(0, shade(color, 0.55));
  grad.addColorStop(0.45, color);
  grad.addColorStop(1, shade(color, -0.45));
  g.fillStyle = grad;
  poly(g, [[bx, cy - h], [tip, cy], [bx, cy + h]]);
  g.fill();
  g.save();
  poly(g, [[bx, cy - h], [tip, cy], [bx, cy + h]]);
  g.clip();
  g.strokeStyle = shade(color, -0.35);
  g.lineWidth = s * 0.018;
  for (let x = tip + 4; x < bx; x += s * 0.06) {
    g.beginPath();
    g.moveTo(x, cy - h);
    g.lineTo(x - s * 0.04, cy + h);
    g.stroke();
  }
  g.restore();
  g.fillStyle = shade(color, -0.3);
  g.beginPath();
  g.ellipse(bx, cy, s * 0.05, h, 0, 0, TAU);
  g.fill();
}

const DRILL_COLORS = ['#a9a89f', '#d9d9d4', '#d8b84a', '#3fae4a', '#c0505a', '#f2f6f8', '#3fa9a0'];
const HULL_COLORS = ['#77745a', '#7d7f86', '#c27a3a', '#8a99a8', '#8e6bc4', '#5fd14e', '#5fe0ff'];

function hullPlate(g: Ctx, s: number, color: string, tier: number) {
  const pts = [
    [s * 0.5, s * 0.1],
    [s * 0.86, s * 0.24],
    [s * 0.8, s * 0.66],
    [s * 0.5, s * 0.9],
    [s * 0.2, s * 0.66],
    [s * 0.14, s * 0.24],
  ];
  if (tier === 6) {
    g.fillStyle = 'rgba(95,224,255,0.25)';
    circle(g, s * 0.5, s * 0.5, s * 0.46);
    g.fill();
  }
  g.fillStyle = shade(color, -0.6);
  poly(g, pts.map(([x, y]) => [s * 0.5 + (x - s * 0.5) * 1.08, s * 0.5 + (y - s * 0.5) * 1.08]));
  g.fill();
  const grad = g.createLinearGradient(s * 0.15, s * 0.1, s * 0.85, s * 0.9);
  grad.addColorStop(0, shade(color, 0.45));
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, shade(color, -0.4));
  g.fillStyle = grad;
  poly(g, pts);
  g.fill();
  g.fillStyle = shade(color, -0.45);
  for (const [x, y] of [[0.3, 0.3], [0.7, 0.3], [0.32, 0.6], [0.68, 0.6], [0.5, 0.78]]) {
    circle(g, s * x, s * y, s * 0.025);
    g.fill();
  }
  g.strokeStyle = shade(color, -0.35);
  g.lineWidth = s * 0.02;
  g.beginPath();
  g.moveTo(s * 0.5, s * 0.14);
  g.lineTo(s * 0.5, s * 0.86);
  g.stroke();
}

function engineBlock(g: Ctx, s: number, tier: number) {
  const cyl = [4, 4, 4, 6, 8, 12, 16][tier];
  const rows = cyl > 8 ? 2 : 1;
  const per = Math.ceil(cyl / rows);
  const body = tier >= 4 ? '#8a3a2a' : '#6f6f6a';
  g.fillStyle = '#2f2f2c';
  g.beginPath();
  g.roundRect(s * 0.12, s * 0.42, s * 0.76, s * 0.38, 4);
  g.fill();
  const grad = g.createLinearGradient(0, s * 0.42, 0, s * 0.8);
  grad.addColorStop(0, shade(body, 0.35));
  grad.addColorStop(1, shade(body, -0.35));
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(s * 0.14, s * 0.44, s * 0.72, s * 0.34, 3);
  g.fill();
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < per; i++) {
      const w = (s * 0.68) / per;
      const x = s * 0.16 + i * w;
      const y = s * (0.22 + r * 0.1);
      g.fillStyle = '#2f2f2c';
      g.fillRect(x, y, w - 2, s * 0.2);
      g.fillStyle = '#b9b9b4';
      g.fillRect(x + 1, y + 1, w - 4, s * 0.18);
    }
  }
  if (tier === 2 || tier === 4) {
    // Turbo or supercharger snail.
    g.fillStyle = '#d6d2c4';
    circle(g, s * 0.84, s * 0.38, s * 0.1);
    g.fill();
    g.strokeStyle = '#6f6f6a';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(s * 0.84, s * 0.38, s * 0.05, 0, TAU * 0.8);
    g.stroke();
  }
  if (tier === 6) {
    g.fillStyle = '#ffd23a';
    g.font = `900 ${s * 0.14}px "Arial Black", sans-serif`;
    g.fillText('JAG', s * 0.34, s * 0.7);
  }
}

function fuelTank(g: Ctx, s: number, tier: number) {
  const k = 0.45 + tier * 0.08;
  const w = s * 0.3 * k + s * 0.12;
  const h = s * 0.7 * Math.min(1, 0.6 + tier * 0.07);
  const x = s * 0.5 - w / 2;
  const y = s * 0.9 - h;
  g.fillStyle = '#2f2f2c';
  g.beginPath();
  g.roundRect(x - 2, y - 2, w + 4, h + 4, w / 2);
  g.fill();
  const grad = g.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, '#e2c27a');
  grad.addColorStop(0.4, '#b98a52');
  grad.addColorStop(1, '#6f4e26');
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(x, y, w, h, w / 2);
  g.fill();
  g.fillStyle = '#6f6f6a';
  g.fillRect(x - 3, y + h * 0.25, w + 6, 4);
  g.fillRect(x - 3, y + h * 0.7, w + 6, 4);
  g.fillStyle = '#4b4b48';
  g.fillRect(s * 0.47, y - 6, s * 0.06, 6);
}

function fan(g: Ctx, x: number, y: number, r: number, blades: number, color: string) {
  g.fillStyle = '#2f2f2c';
  circle(g, x, y, r + 2);
  g.fill();
  g.fillStyle = '#4b4b48';
  circle(g, x, y, r);
  g.fill();
  g.fillStyle = color;
  for (let i = 0; i < blades; i++) {
    g.save();
    g.translate(x, y);
    g.rotate((i / blades) * TAU);
    g.beginPath();
    g.ellipse(r * 0.5, 0, r * 0.45, r * 0.18, 0.4, 0, TAU);
    g.fill();
    g.restore();
  }
  g.fillStyle = '#d6d2c4';
  circle(g, x, y, r * 0.18);
  g.fill();
}

function radiator(g: Ctx, s: number, tier: number) {
  const layouts: number[][][] = [
    [[0.5, 0.5, 0.26]],
    [[0.3, 0.5, 0.2], [0.7, 0.5, 0.2]],
    [[0.5, 0.5, 0.32]],
    [[0.3, 0.5, 0.2], [0.7, 0.5, 0.2]],
    [[0.5, 0.5, 0.3]],
    [[0.22, 0.5, 0.15], [0.5, 0.5, 0.15], [0.78, 0.5, 0.15]],
  ];
  g.fillStyle = '#3d3d3a';
  g.beginPath();
  g.roundRect(s * 0.06, s * 0.2, s * 0.88, s * 0.6, 6);
  g.fill();
  if (tier === 4) {
    // Puron coolant coils.
    g.strokeStyle = '#6fb8e8';
    g.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(s * 0.12, s * (0.28 + i * 0.13));
      g.lineTo(s * 0.88, s * (0.28 + i * 0.13));
      g.stroke();
    }
  }
  const color = tier >= 2 ? '#c9c6bc' : '#9a9a94';
  for (const [x, y, r] of layouts[tier]) fan(g, s * x, s * y, s * r, tier >= 2 && tier !== 4 ? 9 : 4, tier === 5 ? '#8fd1ff' : color);
}

function crate(g: Ctx, s: number, tier: number) {
  const k = 0.42 + tier * 0.1;
  const w = s * k;
  const h = s * k * 0.8;
  const x = s * 0.5 - w / 2;
  const y = s * 0.88 - h;
  g.fillStyle = '#2b2218';
  g.fillRect(x - 2, y - 2, w + 4, h + 4);
  g.fillStyle = '#8a6a44';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#6b5032';
  for (let i = 1; i < 4; i++) g.fillRect(x, y + (h * i) / 4, w, 1.5);
  g.strokeStyle = '#4a3622';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y + h);
  g.moveTo(x + w, y);
  g.lineTo(x, y + h);
  g.stroke();
  g.strokeRect(x, y, w, h);
}

/** The thumbnail for one tier of an upgrade line. */
export function upgradeIcon(kind: UpgradeKind, tier: number, size = 88): HTMLCanvasElement {
  return canvas(size, (g, s) => {
    if (kind === 'drill') cone(g, s, DRILL_COLORS[tier]);
    else if (kind === 'hull') hullPlate(g, s, HULL_COLORS[tier], tier);
    else if (kind === 'engine') engineBlock(g, s, tier);
    else if (kind === 'tank') fuelTank(g, s, tier);
    else if (kind === 'radiator') radiator(g, s, tier);
    else crate(g, s, tier);
  });
}

/** The small category button icons along the top of the AutoBuy. */
export function categoryIcon(kind: UpgradeKind | 'exit', size = 30): HTMLCanvasElement {
  return canvas(size, (g, s) => {
    g.fillStyle = '#d6d2c4';
    g.strokeStyle = '#d6d2c4';
    g.lineWidth = 2;
    if (kind === 'drill') {
      poly(g, [[s * 0.3, s * 0.2], [s * 0.7, s * 0.2], [s * 0.5, s * 0.85]]);
      g.fill();
      g.strokeStyle = '#3d3d3a';
      for (let y = 0.32; y < 0.7; y += 0.12) {
        g.beginPath();
        g.moveTo(s * 0.32, s * y);
        g.lineTo(s * 0.68, s * (y + 0.06));
        g.stroke();
      }
    } else if (kind === 'hull') {
      g.fillRect(s * 0.15, s * 0.3, s * 0.7, s * 0.14);
      g.fillRect(s * 0.15, s * 0.56, s * 0.7, s * 0.14);
    } else if (kind === 'engine') {
      g.fillRect(s * 0.2, s * 0.45, s * 0.6, s * 0.3);
      for (let i = 0; i < 3; i++) g.fillRect(s * (0.24 + i * 0.19), s * 0.25, s * 0.13, s * 0.18);
    } else if (kind === 'tank') {
      g.beginPath();
      g.roundRect(s * 0.32, s * 0.15, s * 0.36, s * 0.7, s * 0.18);
      g.fill();
    } else if (kind === 'radiator') {
      g.strokeRect(s * 0.18, s * 0.18, s * 0.64, s * 0.64);
      g.beginPath();
      g.moveTo(s * 0.22, s * 0.22);
      g.lineTo(s * 0.78, s * 0.78);
      g.moveTo(s * 0.78, s * 0.22);
      g.lineTo(s * 0.22, s * 0.78);
      g.stroke();
    } else if (kind === 'cargo') {
      poly(g, [[s * 0.5, s * 0.15], [s * 0.85, s * 0.32], [s * 0.85, s * 0.7], [s * 0.5, s * 0.87], [s * 0.15, s * 0.7], [s * 0.15, s * 0.32]]);
      g.stroke();
      g.beginPath();
      g.moveTo(s * 0.15, s * 0.32);
      g.lineTo(s * 0.5, s * 0.5);
      g.lineTo(s * 0.85, s * 0.32);
      g.moveTo(s * 0.5, s * 0.5);
      g.lineTo(s * 0.5, s * 0.87);
      g.stroke();
    } else {
      g.strokeRect(s * 0.2, s * 0.15, s * 0.4, s * 0.7);
      g.beginPath();
      g.moveTo(s * 0.85, s * 0.5);
      g.lineTo(s * 0.45, s * 0.5);
      g.moveTo(s * 0.58, s * 0.37);
      g.lineTo(s * 0.45, s * 0.5);
      g.lineTo(s * 0.58, s * 0.63);
      g.stroke();
    }
  });
}

/** Item thumbnails for the Emendation Station. */
export function itemIcon(kind: ItemKind, size = 64): HTMLCanvasElement {
  return canvas(size, (g, s) => {
    if (kind === 'fuel') {
      g.save();
      g.translate(s * 0.5, s * 0.5);
      g.rotate(-0.4);
      g.fillStyle = '#3a1a10';
      g.beginPath();
      g.roundRect(-s * 0.32, -s * 0.2, s * 0.64, s * 0.4, s * 0.12);
      g.fill();
      const grad = g.createLinearGradient(0, -s * 0.18, 0, s * 0.18);
      grad.addColorStop(0, '#e07a4a');
      grad.addColorStop(1, '#8e3416');
      g.fillStyle = grad;
      g.beginPath();
      g.roundRect(-s * 0.3, -s * 0.18, s * 0.6, s * 0.36, s * 0.1);
      g.fill();
      g.fillStyle = '#c9c6bc';
      g.fillRect(-s * 0.2, -s * 0.18, s * 0.04, s * 0.36);
      g.fillRect(s * 0.16, -s * 0.18, s * 0.04, s * 0.36);
      g.fillRect(s * 0.3, -s * 0.04, s * 0.12, s * 0.08);
      g.restore();
    } else if (kind === 'nanobots') {
      g.save();
      g.translate(s * 0.5, s * 0.5);
      g.rotate(-0.4);
      g.fillStyle = '#3d3d3a';
      g.beginPath();
      g.roundRect(-s * 0.34, -s * 0.18, s * 0.68, s * 0.36, 4);
      g.fill();
      g.fillStyle = '#e8c45a';
      g.fillRect(s * 0.18, -s * 0.16, s * 0.14, s * 0.32);
      g.strokeStyle = '#e9e7da';
      g.lineWidth = s * 0.05;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-s * 0.18, s * 0.08);
      g.lineTo(s * 0.05, -s * 0.08);
      g.stroke();
      circle(g, -s * 0.2, s * 0.1, s * 0.05);
      g.stroke();
      g.restore();
    } else if (kind === 'dynamite') {
      g.save();
      g.translate(s * 0.5, s * 0.5);
      g.rotate(-0.5);
      for (let i = -1; i <= 1; i++) {
        g.fillStyle = '#5a1206';
        g.beginPath();
        g.roundRect(-s * 0.32, i * s * 0.12 - s * 0.065, s * 0.64, s * 0.13, s * 0.06);
        g.fill();
        g.fillStyle = '#d33a2c';
        g.beginPath();
        g.roundRect(-s * 0.31, i * s * 0.12 - s * 0.055, s * 0.62, s * 0.11, s * 0.05);
        g.fill();
      }
      g.fillStyle = '#3d3d3a';
      g.fillRect(-s * 0.1, -s * 0.2, s * 0.22, s * 0.4);
      g.fillStyle = '#5dff7a';
      g.fillRect(-s * 0.06, -s * 0.08, s * 0.14, s * 0.1);
      g.restore();
    } else if (kind === 'c4') {
      g.save();
      g.translate(s * 0.5, s * 0.5);
      g.rotate(-0.35);
      g.fillStyle = '#5a4520';
      g.beginPath();
      g.roundRect(-s * 0.34, -s * 0.22, s * 0.68, s * 0.44, 6);
      g.fill();
      g.fillStyle = '#d9b46a';
      g.beginPath();
      g.roundRect(-s * 0.32, -s * 0.2, s * 0.64, s * 0.4, 5);
      g.fill();
      g.fillStyle = '#2f2f2c';
      g.fillRect(-s * 0.12, -s * 0.1, s * 0.24, s * 0.16);
      g.fillStyle = '#7a7a74';
      g.fillRect(-s * 0.34, -s * 0.02, s * 0.68, s * 0.04);
      g.restore();
    } else if (kind === 'quantum') {
      g.fillStyle = '#4b4b48';
      g.beginPath();
      g.ellipse(s * 0.5, s * 0.8, s * 0.3, s * 0.08, 0, 0, TAU);
      g.fill();
      const grad = g.createRadialGradient(s * 0.42, s * 0.36, 2, s * 0.5, s * 0.45, s * 0.32);
      grad.addColorStop(0, '#ffd1ec');
      grad.addColorStop(0.6, '#c2457e');
      grad.addColorStop(1, '#6a1a40');
      g.fillStyle = grad;
      circle(g, s * 0.5, s * 0.45, s * 0.3);
      g.fill();
      g.strokeStyle = '#eaf6ff';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(s * 0.52, s * 0.2);
      g.lineTo(s * 0.45, s * 0.42);
      g.lineTo(s * 0.55, s * 0.48);
      g.lineTo(s * 0.48, s * 0.7);
      g.stroke();
    } else {
      g.strokeStyle = '#c9c6bc';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(s * 0.32, s * 0.35);
      g.lineTo(s * 0.26, s * 0.12);
      g.moveTo(s * 0.68, s * 0.35);
      g.lineTo(s * 0.74, s * 0.12);
      g.stroke();
      g.fillStyle = '#c9c6bc';
      circle(g, s * 0.26, s * 0.12, 3);
      g.fill();
      circle(g, s * 0.74, s * 0.12, 3);
      g.fill();
      g.fillStyle = '#6a8fd8';
      g.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.12);
      g.fillStyle = '#4a6ab0';
      g.beginPath();
      g.roundRect(s * 0.32, s * 0.44, s * 0.36, s * 0.34, 4);
      g.fill();
      g.fillStyle = '#9fb8f0';
      for (let i = 0; i < 4; i++) g.fillRect(s * 0.34, s * (0.48 + i * 0.07), s * 0.32, s * 0.025);
      g.fillStyle = '#7a7a74';
      g.fillRect(s * 0.44, s * 0.78, s * 0.12, s * 0.1);
    }
  });
}

/** A small lump of ore for the cargo and processor lists. */
export function oreIcon(tile: Tile, size = 26): HTMLCanvasElement {
  const ore = oreFor(tile)!;
  const gem = ORES.indexOf(ore) >= 5;
  return canvas(size, (g, s) => {
    if (gem) {
      poly(g, [[s * 0.5, s * 0.1], [s * 0.85, s * 0.4], [s * 0.5, s * 0.92], [s * 0.15, s * 0.4]]);
      g.fillStyle = ore.color;
      g.fill();
      poly(g, [[s * 0.5, s * 0.1], [s * 0.85, s * 0.4], [s * 0.5, s * 0.4], [s * 0.15, s * 0.4]]);
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.fill();
      return;
    }
    g.fillStyle = shade(ore.color, -0.5);
    g.beginPath();
    g.ellipse(s * 0.5, s * 0.55, s * 0.42, s * 0.32, -0.2, 0, TAU);
    g.fill();
    g.fillStyle = ore.color;
    g.beginPath();
    g.ellipse(s * 0.48, s * 0.52, s * 0.38, s * 0.28, -0.2, 0, TAU);
    g.fill();
    g.strokeStyle = shade(ore.color, 0.35);
    g.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(s * (0.25 + i * 0.15), s * 0.62);
      g.lineTo(s * (0.38 + i * 0.15), s * 0.4);
      g.stroke();
    }
  });
}

/** The mining pod, for transmissions from other miners and the cargo header. */
export function podIcon(size = 64): HTMLCanvasElement {
  return canvas(size, (g, s) => {
    g.fillStyle = '#2f2d22';
    g.beginPath();
    g.roundRect(s * 0.12, s * 0.66, s * 0.72, s * 0.2, s * 0.1);
    g.fill();
    g.fillStyle = '#77745a';
    g.beginPath();
    g.ellipse(s * 0.48, s * 0.68, s * 0.34, s * 0.4, 0, Math.PI, 0);
    g.fill();
    g.fillStyle = '#121212';
    g.fillRect(s * 0.14, s * 0.42, s * 0.68, s * 0.1);
    g.fillStyle = '#c9c9c4';
    poly(g, [[s * 0.82, s * 0.46], [s * 0.98, s * 0.55], [s * 0.82, s * 0.64]]);
    g.fill();
  });
}
