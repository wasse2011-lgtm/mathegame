/** キャラと障害物の描画。画像は使わず、すべて Canvas で描く（読み込み待ちゼロ・拡大しても綺麗）。 */

import type { SkinId } from './save';

export interface SkinDef {
  id: SkinId;
  label: string;
  body: string;
  shade: string;
  ear: 'cat' | 'dog' | 'robo' | 'rabbit' | 'round' | 'none';
  /** おなかの白い部分（ぺんぎん） */
  belly?: boolean;
}

export const SKINS: SkinDef[] = [
  { id: 'cat', label: 'ねこ', body: '#f7ab4e', shade: '#e08a29', ear: 'cat' },
  { id: 'dog', label: 'いぬ', body: '#c08b5c', shade: '#9d6c41', ear: 'dog' },
  { id: 'robo', label: 'ロボ', body: '#93b4c9', shade: '#6d90a8', ear: 'robo' },
  { id: 'usa', label: 'うさぎ', body: '#f4f0e8', shade: '#f0b7bd', ear: 'rabbit' },
  { id: 'kuma', label: 'くま', body: '#b1815a', shade: '#8e6242', ear: 'round' },
  { id: 'pen', label: 'ぺんぎん', body: '#546a80', shade: '#3b4d5e', ear: 'none', belly: true },
];

export function skinDef(id: SkinId): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

export interface CharState {
  /** 経過時間（走るアニメの位相） */
  t: number;
  air: boolean;
  /** 0 より大きいあいだは「いたい」顔 */
  hurt: number;
  /** 1 で通常、>1 で縦に伸びる */
  squash: number;
}

const INK = '#2b3440';

function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 ? r * 0.45 : r;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

/** ぼうし。頭のてっぺん (headY) を基準に描く */
export function drawHat(g: CanvasRenderingContext2D, cx: number, headY: number, s: number, hat: string): void {
  switch (hat) {
    case 'hat-cap': {
      g.fillStyle = '#4a90d9';
      g.beginPath();
      g.arc(cx, headY + s * 0.04, s * 0.34, Math.PI, 0);
      g.closePath();
      g.fill();
      roundRect(g, cx - s * 0.06, headY - s * 0.02, s * 0.48, s * 0.1, s * 0.05);
      g.fill();
      g.fillStyle = '#2f6ba8';
      g.beginPath();
      g.arc(cx, headY - s * 0.28, s * 0.05, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'hat-ribbon': {
      g.fillStyle = '#ec7fa4';
      const rx = cx - s * 0.3;
      const ry = headY + s * 0.02;
      g.beginPath();
      g.moveTo(rx, ry);
      g.lineTo(rx - s * 0.24, ry - s * 0.16);
      g.lineTo(rx - s * 0.24, ry + s * 0.14);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(rx, ry);
      g.lineTo(rx + s * 0.24, ry - s * 0.16);
      g.lineTo(rx + s * 0.24, ry + s * 0.14);
      g.closePath();
      g.fill();
      g.fillStyle = '#d55c86';
      g.beginPath();
      g.arc(rx, ry, s * 0.08, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'hat-leaf': {
      g.strokeStyle = '#5f8f3f';
      g.lineWidth = Math.max(2, s * 0.05);
      g.beginPath();
      g.moveTo(cx, headY + s * 0.06);
      g.lineTo(cx, headY - s * 0.16);
      g.stroke();
      g.fillStyle = '#7cc05a';
      g.beginPath();
      g.ellipse(cx + s * 0.16, headY - s * 0.22, s * 0.19, s * 0.1, -0.5, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'hat-star': {
      g.fillStyle = '#ffc53d';
      g.strokeStyle = '#d99a10';
      g.lineWidth = Math.max(1.5, s * 0.035);
      star(g, cx, headY - s * 0.14, s * 0.22);
      g.fill();
      g.stroke();
      break;
    }
    case 'hat-crown': {
      g.fillStyle = '#ffc53d';
      g.strokeStyle = '#d99a10';
      g.lineWidth = Math.max(1.5, s * 0.035);
      const w = s * 0.56;
      const l = cx - w / 2;
      const b = headY + s * 0.04;
      g.beginPath();
      g.moveTo(l, b);
      g.lineTo(l, b - s * 0.3);
      g.lineTo(l + w * 0.25, b - s * 0.12);
      g.lineTo(l + w * 0.5, b - s * 0.36);
      g.lineTo(l + w * 0.75, b - s * 0.12);
      g.lineTo(l + w, b - s * 0.3);
      g.lineTo(l + w, b);
      g.closePath();
      g.fill();
      g.stroke();
      break;
    }
    default:
      break;
  }
}

export function drawChar(
  g: CanvasRenderingContext2D,
  cx: number,
  footY: number,
  size: number,
  skin: SkinId,
  st: CharState,
  hat = '',
): void {
  const def = skinDef(skin);
  const s = size;
  const swing = st.air ? 0 : Math.sin(st.t * 12) * s * 0.14;

  g.save();
  g.translate(cx, footY);
  g.scale(1 / st.squash, st.squash);
  g.translate(-cx, -footY);

  const x = cx - s / 2;
  const y = footY - s;

  // あし
  g.fillStyle = INK;
  roundRect(g, x + s * 0.16 + swing, footY - s * 0.1, s * 0.24, s * 0.16, s * 0.07);
  g.fill();
  roundRect(g, x + s * 0.6 - swing, footY - s * 0.1, s * 0.24, s * 0.16, s * 0.07);
  g.fill();

  // みみ
  g.fillStyle = def.shade;
  if (def.ear === 'cat') {
    g.beginPath();
    g.moveTo(x + s * 0.14, y + s * 0.22);
    g.lineTo(x + s * 0.1, y - s * 0.16);
    g.lineTo(x + s * 0.44, y + s * 0.08);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(x + s * 0.86, y + s * 0.22);
    g.lineTo(x + s * 0.9, y - s * 0.16);
    g.lineTo(x + s * 0.56, y + s * 0.08);
    g.closePath();
    g.fill();
  } else if (def.ear === 'dog') {
    roundRect(g, x - s * 0.08, y + s * 0.02, s * 0.24, s * 0.44, s * 0.11);
    g.fill();
    roundRect(g, x + s * 0.84, y + s * 0.02, s * 0.24, s * 0.44, s * 0.11);
    g.fill();
  } else if (def.ear === 'rabbit') {
    roundRect(g, x + s * 0.16, y - s * 0.52, s * 0.17, s * 0.66, s * 0.085);
    g.fill();
    roundRect(g, x + s * 0.67, y - s * 0.52, s * 0.17, s * 0.66, s * 0.085);
    g.fill();
  } else if (def.ear === 'round') {
    g.beginPath();
    g.arc(x + s * 0.16, y + s * 0.04, s * 0.19, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(x + s * 0.84, y + s * 0.04, s * 0.19, 0, Math.PI * 2);
    g.fill();
  } else if (def.ear === 'robo') {
    g.fillRect(x + s * 0.47, y - s * 0.24, s * 0.06, s * 0.26);
    g.beginPath();
    g.arc(cx, y - s * 0.28, s * 0.11, 0, Math.PI * 2);
    g.fill();
  }

  // からだ
  g.fillStyle = st.hurt > 0 ? '#e4675c' : def.body;
  roundRect(g, x, y, s, s, s * 0.3);
  g.fill();

  if (def.belly && st.hurt <= 0) {
    g.fillStyle = '#f7f4ee';
    roundRect(g, x + s * 0.17, y + s * 0.3, s * 0.66, s * 0.7, s * 0.26);
    g.fill();
  }

  // かお
  g.fillStyle = INK;
  const ey = y + s * 0.42;
  if (st.hurt > 0) {
    g.strokeStyle = INK;
    g.lineWidth = Math.max(2, s * 0.06);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x + s * 0.24, ey - s * 0.08); g.lineTo(x + s * 0.4, ey + s * 0.08);
    g.moveTo(x + s * 0.4, ey - s * 0.08); g.lineTo(x + s * 0.24, ey + s * 0.08);
    g.moveTo(x + s * 0.6, ey - s * 0.08); g.lineTo(x + s * 0.76, ey + s * 0.08);
    g.moveTo(x + s * 0.76, ey - s * 0.08); g.lineTo(x + s * 0.6, ey + s * 0.08);
    g.stroke();
  } else {
    const blink = Math.sin(st.t * 1.7) > 0.985 ? 0.25 : 1;
    g.beginPath();
    g.ellipse(x + s * 0.32, ey, s * 0.075, s * 0.095 * blink, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(x + s * 0.68, ey, s * 0.075, s * 0.095 * blink, 0, 0, Math.PI * 2);
    g.fill();

    g.strokeStyle = INK;
    g.lineWidth = Math.max(2, s * 0.055);
    g.lineCap = 'round';
    g.beginPath();
    if (st.air) {
      g.arc(cx, y + s * 0.62, s * 0.13, 0.15 * Math.PI, 0.85 * Math.PI);
    } else {
      g.arc(cx, y + s * 0.58, s * 0.13, 0.12 * Math.PI, 0.88 * Math.PI);
    }
    g.stroke();
  }

  // ほっぺ
  if (st.hurt <= 0) {
    g.fillStyle = 'rgba(255,138,128,.45)';
    g.beginPath();
    g.arc(x + s * 0.17, y + s * 0.6, s * 0.08, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(x + s * 0.83, y + s * 0.6, s * 0.08, 0, Math.PI * 2);
    g.fill();
  }

  if (hat) drawHat(g, cx, y, s, hat);

  g.restore();
}

export function drawObstacle(
  g: CanvasRenderingContext2D,
  cx: number,
  footY: number,
  size: number,
  boss: boolean,
): void {
  const w = size * (boss ? 1.5 : 0.86);
  const h = size * (boss ? 1.55 : 0.92);
  const x = cx - w / 2;
  const y = footY - h;

  if (boss) {
    g.fillStyle = '#6b4a7a';
    g.beginPath();
    g.moveTo(x + w * 0.1, y + h * 0.16);
    g.lineTo(x - w * 0.08, y - h * 0.14);
    g.lineTo(x + w * 0.34, y + h * 0.04);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(x + w * 0.9, y + h * 0.16);
    g.lineTo(x + w * 1.08, y - h * 0.14);
    g.lineTo(x + w * 0.66, y + h * 0.04);
    g.closePath();
    g.fill();
  }

  g.fillStyle = boss ? '#8a5fa0' : '#7d8b97';
  roundRect(g, x, y, w, h, size * 0.2);
  g.fill();
  g.fillStyle = boss ? 'rgba(0,0,0,.16)' : 'rgba(0,0,0,.12)';
  roundRect(g, x, y + h * 0.62, w, h * 0.38, size * 0.2);
  g.fill();

  // ちょっと怒った顔（こわすぎない程度に）
  g.fillStyle = '#fff';
  const ey = y + h * 0.38;
  g.beginPath(); g.arc(x + w * 0.32, ey, size * 0.1, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(x + w * 0.68, ey, size * 0.1, 0, Math.PI * 2); g.fill();
  g.fillStyle = INK;
  g.beginPath(); g.arc(x + w * 0.33, ey + size * 0.015, size * 0.05, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(x + w * 0.69, ey + size * 0.015, size * 0.05, 0, Math.PI * 2); g.fill();
  g.strokeStyle = INK;
  g.lineWidth = Math.max(2, size * 0.05);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x + w * 0.36, y + h * 0.66);
  g.lineTo(x + w * 0.64, y + h * 0.66);
  g.stroke();
}

/** キャラ選択・きせかえのアイコン用 */
export function paintSkinIcon(canvas: HTMLCanvasElement, skin: SkinId, hat = '', size = 60): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  // うさぎの耳とぼうしが入るよう、上下に余白をとる
  drawChar(g, size / 2, size - size * 0.14, size * 0.5, skin, { t: 0.4, air: false, hurt: 0, squash: 1 }, hat);
}

/** ぼうし単体のアイコン用 */
export function paintHatIcon(canvas: HTMLCanvasElement, hat: string, size = 60): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  if (hat) drawHat(g, size / 2, size * 0.62, size * 0.78, hat);
}
