/** キャラと障害物の描画。画像は使わず、すべて Canvas で描く（読み込み待ちゼロ・拡大しても綺麗）。 */

import { colorDef } from './items';
import { profile, type SkinId } from './save';
import type { ObstacleKind } from './theme';

export interface SkinDef {
  id: SkinId;
  label: string;
  body: string;
  shade: string;
  ear: 'cat' | 'dog' | 'robo' | 'rabbit' | 'round' | 'fluff' | 'horn' | 'none';
  /** おなかの白い部分（ぺんぎん・あざらし） */
  belly?: boolean;
  /** とらの しま模様 */
  stripe?: boolean;
  /** ぱんだの 目のまわり */
  patch?: boolean;
  /** ドラゴンっこ の せなかの はね */
  wing?: boolean;
}

export const SKINS: SkinDef[] = [
  { id: 'cat', label: 'ねこ', body: '#f7ab4e', shade: '#e08a29', ear: 'cat' },
  { id: 'dog', label: 'いぬ', body: '#c08b5c', shade: '#9d6c41', ear: 'dog' },
  { id: 'robo', label: 'ロボ', body: '#93b4c9', shade: '#6d90a8', ear: 'robo' },
  { id: 'usa', label: 'うさぎ', body: '#f4f0e8', shade: '#f0b7bd', ear: 'rabbit' },
  { id: 'kuma', label: 'くま', body: '#b1815a', shade: '#8e6242', ear: 'round' },
  { id: 'pen', label: 'ぺんぎん', body: '#546a80', shade: '#3b4d5e', ear: 'none', belly: true },
  { id: 'fox', label: 'きつね', body: '#f0954a', shade: '#c96a28', ear: 'cat', belly: true },
  { id: 'panda', label: 'ぱんだ', body: '#f7f4ee', shade: '#39404a', ear: 'round', patch: true },
  { id: 'sheep', label: 'ひつじ', body: '#fbf7ee', shade: '#d9cfbe', ear: 'fluff' },
  { id: 'tora', label: 'とら', body: '#f5c045', shade: '#b8791a', ear: 'cat', stripe: true },
  { id: 'azarashi', label: 'あざらし', body: '#aec4d6', shade: '#89a3ba', ear: 'none', belly: true },
  { id: 'dora', label: 'ドラゴンっこ', body: '#79c79a', shade: '#4f9f73', ear: 'horn', wing: true, belly: true },
];

export function skinDef(id: SkinId): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/** いま着ているもの一式 */
export interface Look {
  skin: SkinId;
  hat?: string;
  acc?: string;
  color?: string;
}

/** セーブされている、いまの見た目 */
export function currentLook(): Look {
  const p = profile();
  return { skin: p.skin, hat: p.hat, acc: p.acc, color: p.color };
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
    case 'hat-straw': {
      g.fillStyle = '#e8c67a';
      g.beginPath();
      g.ellipse(cx, headY + s * 0.02, s * 0.5, s * 0.12, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(cx, headY + s * 0.02, s * 0.26, Math.PI, 0);
      g.closePath();
      g.fill();
      g.fillStyle = '#c79a48';
      roundRect(g, cx - s * 0.26, headY - s * 0.06, s * 0.52, s * 0.07, s * 0.03);
      g.fill();
      break;
    }
    case 'hat-tall': {
      g.fillStyle = '#3d4653';
      roundRect(g, cx - s * 0.22, headY - s * 0.42, s * 0.44, s * 0.44, s * 0.05);
      g.fill();
      g.beginPath();
      g.ellipse(cx, headY + s * 0.02, s * 0.42, s * 0.09, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#e4675c';
      roundRect(g, cx - s * 0.22, headY - s * 0.1, s * 0.44, s * 0.08, s * 0.03);
      g.fill();
      break;
    }
    case 'hat-santa': {
      g.fillStyle = '#e4675c';
      g.beginPath();
      g.moveTo(cx - s * 0.28, headY + s * 0.02);
      g.quadraticCurveTo(cx - s * 0.1, headY - s * 0.44, cx + s * 0.3, headY - s * 0.3);
      g.lineTo(cx + s * 0.26, headY + s * 0.02);
      g.closePath();
      g.fill();
      g.fillStyle = '#fff';
      roundRect(g, cx - s * 0.32, headY - s * 0.02, s * 0.62, s * 0.11, s * 0.055);
      g.fill();
      g.beginPath();
      g.arc(cx + s * 0.31, headY - s * 0.3, s * 0.09, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'hat-band': {
      g.fillStyle = '#e4675c';
      roundRect(g, cx - s * 0.4, headY + s * 0.06, s * 0.8, s * 0.11, s * 0.05);
      g.fill();
      g.beginPath();
      g.moveTo(cx - s * 0.36, headY + s * 0.1);
      g.lineTo(cx - s * 0.56, headY + s * 0.02);
      g.lineTo(cx - s * 0.52, headY + s * 0.22);
      g.closePath();
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(cx, headY + s * 0.11, s * 0.055, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'hat-horn': {
      g.fillStyle = '#f0e0c0';
      g.strokeStyle = '#c9a86a';
      g.lineWidth = Math.max(1.2, s * 0.03);
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.moveTo(cx + dir * s * 0.18, headY + s * 0.06);
        g.quadraticCurveTo(cx + dir * s * 0.4, headY - s * 0.1, cx + dir * s * 0.3, headY - s * 0.3);
        g.quadraticCurveTo(cx + dir * s * 0.24, headY - s * 0.08, cx + dir * s * 0.08, headY + s * 0.06);
        g.closePath();
        g.fill();
        g.stroke();
      }
      break;
    }
    case 'hat-flower': {
      const fx = cx + s * 0.26;
      const fy = headY - s * 0.06;
      g.fillStyle = '#f7a8c4';
      for (let i = 0; i < 5; i++) {
        const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        g.beginPath();
        g.ellipse(fx + Math.cos(a) * s * 0.11, fy + Math.sin(a) * s * 0.11, s * 0.08, s * 0.08, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#ffd75e';
      g.beginPath();
      g.arc(fx, fy, s * 0.07, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'hat-halo': {
      g.strokeStyle = '#ffd75e';
      g.lineWidth = Math.max(2.5, s * 0.07);
      g.beginPath();
      g.ellipse(cx, headY - s * 0.3, s * 0.26, s * 0.09, 0, 0, Math.PI * 2);
      g.stroke();
      break;
    }
    default:
      break;
  }
}

/** せなかにつけるアクセ（からだより先に描く） */
function drawAccBack(g: CanvasRenderingContext2D, acc: string, x: number, y: number, s: number, t: number): void {
  switch (acc) {
    case 'acc-cape': {
      const wave = Math.sin(t * 8) * s * 0.06;
      g.fillStyle = '#c0392b';
      g.beginPath();
      g.moveTo(x + s * 0.12, y + s * 0.12);
      g.quadraticCurveTo(x - s * 0.5 - wave, y + s * 0.5, x - s * 0.36 - wave, y + s * 1.02);
      g.quadraticCurveTo(x + s * 0.4, y + s * 0.92, x + s * 0.88, y + s * 0.12);
      g.closePath();
      g.fill();
      break;
    }
    case 'acc-wings': {
      const flap = Math.sin(t * 9) * 0.28;
      g.fillStyle = 'rgba(255,255,255,.92)';
      for (const dir of [-1, 1]) {
        g.save();
        g.translate(x + s * 0.5 + dir * s * 0.34, y + s * 0.42);
        g.rotate(dir * (0.35 + flap));
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(dir * s * 0.1, -s * 0.42, dir * s * 0.42, -s * 0.2);
        g.quadraticCurveTo(dir * s * 0.3, s * 0.08, 0, 0);
        g.closePath();
        g.fill();
        g.restore();
      }
      break;
    }
    case 'acc-bag': {
      g.fillStyle = '#4a7fbe';
      roundRect(g, x - s * 0.22, y + s * 0.3, s * 0.4, s * 0.5, s * 0.12);
      g.fill();
      g.fillStyle = '#365f92';
      roundRect(g, x - s * 0.18, y + s * 0.5, s * 0.32, s * 0.14, s * 0.06);
      g.fill();
      break;
    }
    case 'acc-tail': {
      const wag = Math.sin(t * 7) * s * 0.08;
      g.fillStyle = '#e8b24a';
      g.beginPath();
      g.moveTo(x + s * 0.1, y + s * 0.72);
      g.quadraticCurveTo(x - s * 0.42, y + s * 0.8 + wag, x - s * 0.3, y + s * 0.26 + wag);
      g.quadraticCurveTo(x - s * 0.08, y + s * 0.6, x + s * 0.1, y + s * 0.9);
      g.closePath();
      g.fill();
      g.fillStyle = '#fff3d6';
      g.beginPath();
      g.arc(x - s * 0.3, y + s * 0.3 + wag, s * 0.09, 0, Math.PI * 2);
      g.fill();
      break;
    }
    default:
      break;
  }
}

/** からだの上につけるアクセ */
function drawAccFront(g: CanvasRenderingContext2D, acc: string, x: number, y: number, s: number, t: number): void {
  switch (acc) {
    case 'acc-scarf': {
      const sway = Math.sin(t * 8) * s * 0.05;
      g.fillStyle = '#e4675c';
      roundRect(g, x - s * 0.04, y + s * 0.7, s * 1.08, s * 0.16, s * 0.08);
      g.fill();
      g.beginPath();
      g.moveTo(x + s * 0.06, y + s * 0.8);
      g.quadraticCurveTo(x - s * 0.24 + sway, y + s * 0.96, x - s * 0.12 + sway, y + s * 1.18);
      g.lineTo(x + s * 0.16, y + s * 0.92);
      g.closePath();
      g.fill();
      break;
    }
    case 'acc-glasses': {
      const ey = y + s * 0.42;
      g.strokeStyle = '#3d4653';
      g.lineWidth = Math.max(2, s * 0.05);
      g.beginPath();
      g.arc(x + s * 0.32, ey, s * 0.16, 0, Math.PI * 2);
      g.arc(x + s * 0.68, ey, s * 0.16, 0, Math.PI * 2);
      g.moveTo(x + s * 0.48, ey);
      g.lineTo(x + s * 0.52, ey);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.beginPath();
      g.arc(x + s * 0.32, ey, s * 0.15, 0, Math.PI * 2);
      g.arc(x + s * 0.68, ey, s * 0.15, 0, Math.PI * 2);
      g.fill();
      break;
    }
    default:
      break;
  }
}

/** キャラの色。「いろ」を買っていればそれで塗りかえる */
function colorsOf(def: SkinDef, look: Look, t: number): { body: string; shade: string } {
  const c = look.color ? colorDef(look.color) : null;
  if (!c) return { body: def.body, shade: def.shade };
  if (c.rainbow) {
    const h = Math.floor((t * 40) % 360);
    return { body: `hsl(${h} 78% 70%)`, shade: `hsl(${h} 62% 52%)` };
  }
  return { body: c.body, shade: c.shade };
}

export function drawChar(
  g: CanvasRenderingContext2D,
  cx: number,
  footY: number,
  size: number,
  look: Look,
  st: CharState,
): void {
  const def = skinDef(look.skin);
  const s = size;
  const swing = st.air ? 0 : Math.sin(st.t * 12) * s * 0.14;
  const { body, shade } = colorsOf(def, look, st.t);

  g.save();
  g.translate(cx, footY);
  g.scale(1 / st.squash, st.squash);
  g.translate(-cx, -footY);

  const x = cx - s / 2;
  const y = footY - s;

  if (look.acc) drawAccBack(g, look.acc, x, y, s, st.t);

  // ドラゴンっこ の はね
  if (def.wing) {
    const flap = Math.sin(st.t * 9) * 0.3;
    g.fillStyle = shade;
    for (const dir of [-1, 1]) {
      g.save();
      g.translate(cx + dir * s * 0.36, y + s * 0.36);
      g.rotate(dir * (0.4 + flap));
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(dir * s * 0.08, -s * 0.4, dir * s * 0.36, -s * 0.16);
      g.quadraticCurveTo(dir * s * 0.26, s * 0.06, 0, 0);
      g.closePath();
      g.fill();
      g.restore();
    }
  }

  // あし
  g.fillStyle = INK;
  roundRect(g, x + s * 0.16 + swing, footY - s * 0.1, s * 0.24, s * 0.16, s * 0.07);
  g.fill();
  roundRect(g, x + s * 0.6 - swing, footY - s * 0.1, s * 0.24, s * 0.16, s * 0.07);
  g.fill();

  // みみ
  g.fillStyle = shade;
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
  } else if (def.ear === 'fluff') {
    // ひつじ: 頭のうえの もこもこ
    g.fillStyle = body;
    for (const [dx, dy, r] of [
      [0.2, 0.02, 0.16],
      [0.5, -0.06, 0.19],
      [0.8, 0.02, 0.16],
    ] as const) {
      g.beginPath();
      g.arc(x + s * dx, y + s * dy, s * r, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = shade;
    g.beginPath();
    g.ellipse(x + s * 0.02, y + s * 0.24, s * 0.11, s * 0.07, -0.3, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(x + s * 0.98, y + s * 0.24, s * 0.11, s * 0.07, 0.3, 0, Math.PI * 2);
    g.fill();
  } else if (def.ear === 'horn') {
    for (const dir of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + dir * s * 0.2, y + s * 0.1);
      g.quadraticCurveTo(cx + dir * s * 0.4, y - s * 0.12, cx + dir * s * 0.3, y - s * 0.26);
      g.quadraticCurveTo(cx + dir * s * 0.24, y - s * 0.04, cx + dir * s * 0.1, y + s * 0.1);
      g.closePath();
      g.fill();
    }
  }

  // からだ
  g.fillStyle = st.hurt > 0 ? '#e4675c' : body;
  roundRect(g, x, y, s, s, s * 0.3);
  g.fill();

  if (st.hurt <= 0) {
    if (def.stripe) {
      // とらの しま。からだの丸みからはみ出さないよう clip する
      g.save();
      roundRect(g, x, y, s, s, s * 0.3);
      g.clip();
      g.fillStyle = shade;
      for (const dx of [0.12, 0.44, 0.76]) {
        g.beginPath();
        g.ellipse(x + s * dx, y + s * 0.14, s * 0.05, s * 0.14, 0.2, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
    if (def.belly) {
      g.fillStyle = '#f7f4ee';
      roundRect(g, x + s * 0.17, y + s * 0.3, s * 0.66, s * 0.7, s * 0.26);
      g.fill();
    }
    if (def.patch) {
      g.fillStyle = shade;
      g.beginPath();
      g.ellipse(x + s * 0.32, y + s * 0.42, s * 0.16, s * 0.19, -0.2, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(x + s * 0.68, y + s * 0.42, s * 0.16, s * 0.19, 0.2, 0, Math.PI * 2);
      g.fill();
    }
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
    // ぱんだは 黒い模様のうえなので、白目を敷いてから描く
    if (def.patch) {
      g.fillStyle = '#fff';
      g.beginPath();
      g.ellipse(x + s * 0.32, ey, s * 0.085, s * 0.105, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(x + s * 0.68, ey, s * 0.085, s * 0.105, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = INK;
    }
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
  if (st.hurt <= 0 && !def.patch) {
    g.fillStyle = 'rgba(255,138,128,.45)';
    g.beginPath();
    g.arc(x + s * 0.17, y + s * 0.6, s * 0.08, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(x + s * 0.83, y + s * 0.6, s * 0.08, 0, Math.PI * 2);
    g.fill();
  }

  if (look.acc) drawAccFront(g, look.acc, x, y, s, st.t);
  if (look.hat) drawHat(g, cx, y, s, look.hat);

  g.restore();
}

/**
 * 障害物の顔。ぜんぶ共通でここが描く。
 * 「こわい」より「ちょっといじわる」くらいに留める（こわいと遊ばなくなる）。
 */
function face(
  g: CanvasRenderingContext2D,
  cx: number,
  ey: number,
  spread: number,
  size: number,
  opts: { angry?: boolean; mouth?: number } = {},
): void {
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(cx - spread, ey, size * 0.1, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(cx + spread, ey, size * 0.1, 0, Math.PI * 2); g.fill();
  g.fillStyle = INK;
  g.beginPath(); g.arc(cx - spread + size * 0.01, ey + size * 0.015, size * 0.05, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(cx + spread + size * 0.01, ey + size * 0.015, size * 0.05, 0, Math.PI * 2); g.fill();

  g.strokeStyle = INK;
  g.lineWidth = Math.max(2, size * 0.05);
  g.lineCap = 'round';
  if (opts.angry) {
    g.beginPath();
    g.moveTo(cx - spread - size * 0.11, ey - size * 0.19);
    g.lineTo(cx - spread + size * 0.08, ey - size * 0.1);
    g.moveTo(cx + spread + size * 0.11, ey - size * 0.19);
    g.lineTo(cx + spread - size * 0.08, ey - size * 0.1);
    g.stroke();
  }
  const my = ey + (opts.mouth ?? size * 0.26);
  g.beginPath();
  g.moveTo(cx - size * 0.14, my);
  g.lineTo(cx + size * 0.14, my);
  g.stroke();
}

/**
 * 障害物。
 *
 * 同じ岩ばかりだと、3ステージで景色ごと飽きる。ワールドごとに出る種類を変え、
 * さらに 1問ごとに引き直す（theme.ts の obstacles）。動きも種類ごとに変えて、
 * 遠くから来る時点で「お、ちがうやつだ」と分かるようにする。
 *
 * どれも当たり判定は同じ（正解した瞬間に足元を通り抜ける）。見た目だけの違い。
 */
export function drawObstacle(
  g: CanvasRenderingContext2D,
  cx: number,
  footY: number,
  size: number,
  kind: ObstacleKind,
  t: number,
): void {
  switch (kind) {
    case 'boss': {
      const w = size * 1.5;
      const h = size * 1.55 * (1 + Math.sin(t * 6) * 0.03);
      const x = cx - w / 2;
      const y = footY - h;
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
      g.fillStyle = '#8a5fa0';
      roundRect(g, x, y, w, h, size * 0.2);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,.16)';
      roundRect(g, x, y + h * 0.62, w, h * 0.38, size * 0.2);
      g.fill();
      face(g, cx, y + h * 0.38, w * 0.18, size, { angry: true, mouth: h * 0.28 });
      break;
    }

    case 'slime': {
      // ぷるぷる。つぶれるほど横に広がる（体積が変わらないように見せる）
      const k = 1 + Math.sin(t * 7) * 0.14;
      const h = size * 0.82 * k;
      const w = size * 0.94 / k;
      const x = cx - w / 2;
      const y = footY - h;
      g.fillStyle = '#5fc9b4';
      g.beginPath();
      g.moveTo(x, footY);
      g.bezierCurveTo(x - w * 0.06, y + h * 0.1, x + w * 0.2, y - h * 0.14, cx, y - h * 0.14);
      g.bezierCurveTo(x + w * 0.8, y - h * 0.14, x + w * 1.06, y + h * 0.1, x + w, footY);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.beginPath();
      g.ellipse(cx - w * 0.2, y + h * 0.22, w * 0.12, h * 0.09, -0.5, 0, Math.PI * 2);
      g.fill();
      face(g, cx, y + h * 0.42, w * 0.19, size, { mouth: size * 0.2 });
      break;
    }

    case 'bird': {
      // 空を飛ぶ。ジャンプの頂点よりは低いところを通る
      const fly = footY - size * 0.95 + Math.sin(t * 3) * size * 0.12;
      const flap = Math.sin(t * 14);
      const r = size * 0.32;
      g.fillStyle = '#6ab0e8';
      g.beginPath();
      g.moveTo(cx - r * 0.2, fly);
      g.quadraticCurveTo(cx - r * 1.9, fly - flap * r * 1.1, cx - r * 1.4, fly + r * 0.5);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(cx + r * 0.2, fly);
      g.quadraticCurveTo(cx + r * 1.9, fly - flap * r * 1.1, cx + r * 1.4, fly + r * 0.5);
      g.closePath();
      g.fill();
      g.fillStyle = '#8ac5f2';
      g.beginPath();
      g.ellipse(cx, fly, r, r * 0.86, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffb43c';
      g.beginPath();
      g.moveTo(cx - r * 0.85, fly + r * 0.1);
      g.lineTo(cx - r * 1.35, fly + r * 0.3);
      g.lineTo(cx - r * 0.85, fly + r * 0.42);
      g.closePath();
      g.fill();
      face(g, cx - r * 0.1, fly - r * 0.14, r * 0.34, size * 0.72, { mouth: size * 0.24 });
      break;
    }

    case 'ghost': {
      const fly = footY - size * 0.5 + Math.sin(t * 2.4) * size * 0.14;
      const w = size * 0.86;
      const h = size * 0.98;
      const x = cx - w / 2;
      const y = fly - h;
      g.globalAlpha = 0.9;
      g.fillStyle = '#eef2ff';
      g.beginPath();
      g.moveTo(x, fly);
      g.lineTo(x, y + w * 0.5);
      g.arc(cx, y + w * 0.5, w * 0.5, Math.PI, 0);
      g.lineTo(x + w, fly);
      // すそのぎざぎざ。ゆらゆら動かす
      for (let i = 3; i >= 0; i--) {
        const bx = x + (w / 4) * i;
        g.quadraticCurveTo(bx + w * 0.125, fly - size * 0.14 + Math.sin(t * 5 + i) * size * 0.03, bx, fly);
      }
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
      face(g, cx, y + h * 0.42, w * 0.2, size, { mouth: size * 0.24 });
      break;
    }

    case 'mushroom': {
      const h = size * 1.0;
      const capR = size * 0.52;
      const y = footY - h;
      g.fillStyle = '#f6ead2';
      roundRect(g, cx - size * 0.2, y + capR * 0.55, size * 0.4, h - capR * 0.55, size * 0.1);
      g.fill();
      g.fillStyle = '#e4636f';
      g.beginPath();
      g.arc(cx, y + capR * 0.62, capR, Math.PI, 0);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.beginPath();
      g.arc(cx - capR * 0.44, y + capR * 0.3, capR * 0.16, 0, Math.PI * 2);
      g.arc(cx + capR * 0.36, y + capR * 0.22, capR * 0.13, 0, Math.PI * 2);
      g.arc(cx + capR * 0.02, y + capR * 0.02, capR * 0.1, 0, Math.PI * 2);
      g.fill();
      face(g, cx, y + h * 0.78, size * 0.13, size * 0.8, { mouth: size * 0.18 });
      break;
    }

    case 'snowman': {
      const bob = Math.sin(t * 4) * size * 0.03;
      const r = size * 0.34;
      const by = footY - r + bob;
      g.fillStyle = '#fbfdff';
      g.beginPath(); g.arc(cx, by, r, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(cx, by - r * 1.5, r * 0.7, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#8b5e3c';
      g.lineWidth = Math.max(2, size * 0.05);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx - r * 0.9, by - r * 0.2); g.lineTo(cx - r * 1.6, by - r * 0.7);
      g.moveTo(cx + r * 0.9, by - r * 0.2); g.lineTo(cx + r * 1.6, by - r * 0.7);
      g.stroke();
      g.fillStyle = '#e4675c';
      g.beginPath();
      g.moveTo(cx, by - r * 1.5);
      g.lineTo(cx + r * 0.8, by - r * 1.4);
      g.lineTo(cx, by - r * 1.3);
      g.closePath();
      g.fill();
      face(g, cx, by - r * 1.7, r * 0.3, size * 0.7, { mouth: size * 0.2 });
      break;
    }

    case 'crystal': {
      const h = size * 1.05;
      const w = size * 0.62;
      const y = footY - h;
      const glow = 0.35 + 0.25 * Math.sin(t * 4);
      g.fillStyle = `rgba(150,220,255,${glow})`;
      g.beginPath();
      g.arc(cx, footY - h * 0.5, w * 1.1, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#8fd8f5';
      g.beginPath();
      g.moveTo(cx, y);
      g.lineTo(cx + w / 2, y + h * 0.34);
      g.lineTo(cx + w * 0.32, footY);
      g.lineTo(cx - w * 0.32, footY);
      g.lineTo(cx - w / 2, y + h * 0.34);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.5)';
      g.beginPath();
      g.moveTo(cx, y);
      g.lineTo(cx - w / 2, y + h * 0.34);
      g.lineTo(cx - w * 0.32, footY);
      g.lineTo(cx - w * 0.06, footY);
      g.closePath();
      g.fill();
      face(g, cx, footY - h * 0.44, w * 0.24, size * 0.8, { mouth: size * 0.2 });
      break;
    }

    case 'crab': {
      const step = Math.sin(t * 9);
      const w = size * 1.0;
      const h = size * 0.56;
      const y = footY - h - Math.abs(step) * size * 0.05;
      g.strokeStyle = '#c9483c';
      g.lineWidth = Math.max(2, size * 0.06);
      g.lineCap = 'round';
      for (let i = -1; i <= 1; i += 2) {
        for (let l = 0; l < 3; l++) {
          const lx = cx + i * (w * 0.16 + l * w * 0.13);
          g.beginPath();
          g.moveTo(lx, y + h * 0.7);
          g.lineTo(lx + i * w * 0.1, footY + (l % 2 ? step : -step) * size * 0.05);
          g.stroke();
        }
      }
      g.fillStyle = '#e4675c';
      g.beginPath();
      g.ellipse(cx, y + h * 0.5, w * 0.5, h * 0.55, 0, 0, Math.PI * 2);
      g.fill();
      for (let i = -1; i <= 1; i += 2) {
        g.beginPath();
        g.ellipse(cx + i * w * 0.56, y + h * 0.12 - step * size * 0.06, w * 0.15, h * 0.34, i * 0.5, 0, Math.PI * 2);
        g.fill();
      }
      face(g, cx, y + h * 0.34, w * 0.19, size * 0.82, { angry: true, mouth: size * 0.2 });
      break;
    }

    case 'log': {
      // ころころ転がる。年輪が回るので、止まっていないのが分かる
      const r = size * 0.42;
      const cy = footY - r;
      g.save();
      g.translate(cx, cy);
      g.fillStyle = '#a9744a';
      roundRect(g, -size * 0.5, -r, size, r * 2, r * 0.35);
      g.fill();
      g.rotate(-t * 5);
      g.fillStyle = '#c9955f';
      g.beginPath(); g.arc(0, 0, r * 0.9, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#8b5e3c';
      g.lineWidth = Math.max(1.5, size * 0.035);
      for (let i = 1; i <= 2; i++) {
        g.beginPath();
        g.arc(0, 0, r * 0.28 * i, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
      face(g, cx, cy - r * 0.1, r * 0.42, size * 0.62, { mouth: size * 0.16 });
      break;
    }

    case 'bush': {
      const h = size * 0.78;
      const y = footY - h;
      g.fillStyle = '#4f9b52';
      g.beginPath();
      g.arc(cx - h * 0.36, footY - h * 0.32, h * 0.36, 0, Math.PI * 2);
      g.arc(cx + h * 0.36, footY - h * 0.32, h * 0.36, 0, Math.PI * 2);
      g.arc(cx, y + h * 0.34, h * 0.44, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#66b55f';
      g.beginPath();
      g.arc(cx - h * 0.1, y + h * 0.3, h * 0.24, 0, Math.PI * 2);
      g.fill();
      face(g, cx, y + h * 0.44, h * 0.22, size * 0.8, { mouth: size * 0.18 });
      break;
    }

    case 'cone': {
      const h = size * 0.92;
      const y = footY - h;
      g.fillStyle = '#5b6672';
      roundRect(g, cx - size * 0.42, footY - size * 0.1, size * 0.84, size * 0.1, size * 0.04);
      g.fill();
      g.fillStyle = '#f08a3c';
      g.beginPath();
      g.moveTo(cx, y);
      g.lineTo(cx + size * 0.34, footY - size * 0.08);
      g.lineTo(cx - size * 0.34, footY - size * 0.08);
      g.closePath();
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(cx - size * 0.19, footY - size * 0.42);
      g.lineTo(cx + size * 0.19, footY - size * 0.42);
      g.lineTo(cx + size * 0.23, footY - size * 0.28);
      g.lineTo(cx - size * 0.23, footY - size * 0.28);
      g.closePath();
      g.fill();
      face(g, cx, footY - size * 0.55, size * 0.11, size * 0.66, { mouth: size * 0.14 });
      break;
    }

    case 'box': {
      const w = size * 0.82;
      const h = size * 0.82;
      const x = cx - w / 2;
      const y = footY - h;
      g.fillStyle = '#c99a68';
      roundRect(g, x, y, w, h, size * 0.08);
      g.fill();
      g.strokeStyle = '#a87b4c';
      g.lineWidth = Math.max(2, size * 0.06);
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x + w, y + h);
      g.moveTo(x + w, y); g.lineTo(x, y + h);
      g.stroke();
      g.strokeRect(x + size * 0.03, y + size * 0.03, w - size * 0.06, h - size * 0.06);
      face(g, cx, y + h * 0.36, w * 0.2, size * 0.86, { mouth: size * 0.22 });
      break;
    }

    case 'rock':
    default: {
      const w = size * 0.86;
      const h = size * 0.92;
      const x = cx - w / 2;
      const y = footY - h;
      g.fillStyle = '#7d8b97';
      roundRect(g, x, y, w, h, size * 0.2);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,.12)';
      roundRect(g, x, y + h * 0.62, w, h * 0.38, size * 0.2);
      g.fill();
      face(g, cx, y + h * 0.38, w * 0.18, size, { mouth: h * 0.28 });
      break;
    }
  }
}

/** キャラ選択・きせかえのアイコン用 */
export function paintSkinIcon(canvas: HTMLCanvasElement, look: Look, size = 60): void {
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
  drawChar(g, size / 2, size - size * 0.14, size * 0.5, look, { t: 0.4, air: false, hurt: 0, squash: 1 });
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
