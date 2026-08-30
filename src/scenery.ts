/**
 * 背景の描画。theme.ts が決めた色と種類を、そのまま絵にする。
 *
 * 画像は使わない（読み込み待ちゼロ・どんな解像度でも綺麗）。
 * 遠いものほどゆっくり流すと、走っている距離が見た目で伝わる。
 */

import { roundRect } from './sprites';
import type { Theme } from './theme';

export interface SceneView {
  W: number;
  H: number;
  /** 1 を基準にした拡大率 */
  s: number;
  groundY: number;
  /** 走った距離（px） */
  scroll: number;
  /** 経過時間（秒）。ゆらぎのある動きに使う */
  t: number;
  /**
   * 画面のてっぺんから canvas の上端までの距離と、画面ぜんたいの高さ。
   * 空のグラデーションを画面と同じ位置から始めるために使う。
   * canvas の中だけで色を作ると、canvas の上端で色が飛んで線が見える。
   */
  skyTop: number;
  skyH: number;
}

/** #rrggbb を rgba() にする（グラデーションの端を透明にするため） */
function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 決まった順で「でたらめ」を返す。ステージが同じなら毎回同じ並びになる */
function rnd(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// ------------------------------------------------------------------ 空

function drawSky(g: CanvasRenderingContext2D, th: Theme, v: SceneView): void {
  const grad = g.createLinearGradient(0, -v.skyTop, 0, v.skyH - v.skyTop);
  grad.addColorStop(0, th.sky[0]);
  grad.addColorStop(1, th.sky[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, v.W, v.groundY + 1);

  if (th.stars) {
    for (let i = 0; i < 26; i++) {
      const x = rnd(i + 1) * v.W;
      const y = rnd(i + 40) * v.groundY * 0.72;
      const tw = 0.55 + 0.45 * Math.sin(v.t * 2.2 + i);
      const r = (0.9 + rnd(i + 90) * 1.3) * v.s;
      g.fillStyle = `rgba(255,255,255,${0.35 + tw * 0.5})`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }

  // 太陽・月は画面の右上に置く（キャラは左寄りなので重ならない）
  if (th.sun !== 'none') {
    const cx = v.W * 0.8;
    const cy = v.groundY * 0.26;
    const r = 18 * v.s;
    // 光のにじみ。単色の円で描くと、空より暗い灰色の輪に見えてしまう
    const glow = g.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * 2.1);
    glow.addColorStop(0, hexAlpha(th.sunColor, 0.5));
    glow.addColorStop(1, hexAlpha(th.sunColor, 0));
    g.fillStyle = glow;
    g.beginPath();
    g.arc(cx, cy, r * 2.1, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = th.sunColor;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    if (th.sun === 'moon') {
      // 右上を空の色でくり抜いて三日月にする
      g.fillStyle = th.sky[0];
      g.beginPath();
      g.arc(cx + r * 0.42, cy - r * 0.34, r * 0.92, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function drawClouds(g: CanvasRenderingContext2D, th: Theme, v: SceneView): void {
  const span = v.W + 240 * v.s;
  const off = (v.scroll * 0.06) % span;
  g.fillStyle = th.cloud;
  for (let i = 0; i < 3; i++) {
    const cx = ((i * (span / 3) - off + span) % span) - 60 * v.s;
    const cy = (24 + i * 17) * v.s;
    const r = (14 + i * 3) * v.s;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.arc(cx + r * 0.9, cy + r * 0.15, r * 0.75, 0, Math.PI * 2);
    g.arc(cx - r * 0.85, cy + r * 0.2, r * 0.62, 0, Math.PI * 2);
    g.fill();
  }
}

function drawHills(g: CanvasRenderingContext2D, v: SceneView, rate: number, radius: number, color: string): void {
  const step = radius * 1.7;
  const off = (v.scroll * rate) % step;
  g.fillStyle = color;
  g.beginPath();
  for (let i = -1; i < v.W / step + 2; i++) {
    const cx = i * step - off + step * 0.4;
    g.moveTo(cx - radius, v.groundY);
    g.arc(cx, v.groundY, radius, Math.PI, 0);
  }
  g.fill();
}

// ------------------------------------------------------------------ 地面に生えているもの

function drawDeco(g: CanvasRenderingContext2D, th: Theme, v: SceneView, x: number, k: number): void {
  const s = v.s;
  const y = v.groundY;
  const scale = 0.8 + rnd(k * 7 + 3) * 0.5;

  switch (th.deco) {
    case 'tree': {
      const h = 34 * s * scale;
      g.fillStyle = th.decoB;
      g.fillRect(x - 3 * s, y - h * 0.45, 6 * s, h * 0.45);
      g.fillStyle = th.decoA;
      g.beginPath();
      g.arc(x, y - h * 0.62, h * 0.36, 0, Math.PI * 2);
      g.arc(x - h * 0.24, y - h * 0.46, h * 0.27, 0, Math.PI * 2);
      g.arc(x + h * 0.24, y - h * 0.46, h * 0.27, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'pine': {
      const h = 40 * s * scale;
      g.fillStyle = th.decoB;
      g.fillRect(x - 2.5 * s, y - h * 0.16, 5 * s, h * 0.16);
      g.fillStyle = th.decoA;
      for (let i = 0; i < 3; i++) {
        const w = h * (0.34 - i * 0.07);
        const top = y - h * (0.28 + i * 0.24);
        g.beginPath();
        g.moveTo(x, top - h * 0.3);
        g.lineTo(x - w, top);
        g.lineTo(x + w, top);
        g.closePath();
        g.fill();
      }
      break;
    }
    case 'palm': {
      const h = 44 * s * scale;
      g.strokeStyle = th.decoB;
      g.lineWidth = 5 * s;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x - 6 * s, y - h * 0.6, x + 4 * s, y - h);
      g.stroke();
      g.fillStyle = th.decoA;
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i / 4) * Math.PI;
        g.beginPath();
        g.ellipse(x + 4 * s + Math.cos(a) * h * 0.2, y - h + Math.sin(a) * h * 0.1,
          h * 0.24, h * 0.075, a * 0.5, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'flower': {
      const h = 16 * s * scale;
      g.strokeStyle = th.decoB;
      g.lineWidth = 2.5 * s;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - h);
      g.stroke();
      g.fillStyle = th.decoA;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.beginPath();
        g.arc(x + Math.cos(a) * 4 * s, y - h + Math.sin(a) * 4 * s, 3.2 * s, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#ffd76b';
      g.beginPath();
      g.arc(x, y - h, 2.6 * s, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'mushroom': {
      const h = 22 * s * scale;
      g.fillStyle = th.decoB;
      roundRect(g, x - h * 0.16, y - h * 0.5, h * 0.32, h * 0.5, h * 0.1);
      g.fill();
      g.fillStyle = th.decoA;
      g.beginPath();
      g.arc(x, y - h * 0.5, h * 0.42, Math.PI, 0);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.beginPath();
      g.arc(x - h * 0.14, y - h * 0.62, h * 0.07, 0, Math.PI * 2);
      g.arc(x + h * 0.17, y - h * 0.58, h * 0.06, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'building': {
      const h = (40 + rnd(k * 3 + 11) * 40) * s * scale;
      const w = 26 * s;
      g.fillStyle = th.decoB;
      g.fillRect(x - w / 2, y - h, w, h);
      g.fillStyle = th.decoA;
      for (let r = 0; r < Math.floor(h / (10 * s)) - 1; r++) {
        for (let c = 0; c < 3; c++) {
          if (rnd(k * 31 + r * 5 + c) > 0.45) continue;
          g.fillRect(x - w / 2 + (4 + c * 7) * s, y - h + (6 + r * 10) * s, 4 * s, 5 * s);
        }
      }
      break;
    }
    case 'rock': {
      const h = 20 * s * scale;
      g.fillStyle = th.decoA;
      g.beginPath();
      g.moveTo(x - h * 0.7, y);
      g.lineTo(x - h * 0.25, y - h);
      g.lineTo(x + h * 0.3, y - h * 0.8);
      g.lineTo(x + h * 0.75, y);
      g.closePath();
      g.fill();
      g.fillStyle = th.decoB;
      g.beginPath();
      g.moveTo(x - h * 0.25, y - h);
      g.lineTo(x + h * 0.3, y - h * 0.8);
      g.lineTo(x + h * 0.75, y);
      g.closePath();
      g.fill();
      break;
    }
    case 'cloud': {
      const r = 13 * s * scale;
      g.fillStyle = th.decoA;
      g.beginPath();
      g.arc(x, y - r * 0.2, r, 0, Math.PI * 2);
      g.arc(x + r * 0.95, y - r * 0.05, r * 0.72, 0, Math.PI * 2);
      g.arc(x - r * 0.9, y, r * 0.6, 0, Math.PI * 2);
      g.fill();
      break;
    }
    default:
      break;
  }
}

function drawDecoRow(g: CanvasRenderingContext2D, th: Theme, v: SceneView): void {
  const step = 118 * v.s;
  const off = (v.scroll * 0.55) % step;
  for (let i = -1; i < v.W / step + 2; i++) {
    const k = Math.floor((v.scroll * 0.55) / step) + i;
    const x = i * step - off + step * 0.5;
    drawDeco(g, th, v, x, k);
  }
}

// ------------------------------------------------------------------ 地面

function drawGround(g: CanvasRenderingContext2D, th: Theme, v: SceneView): void {
  const { W, H, s, groundY } = v;
  g.fillStyle = th.grass;
  g.fillRect(0, groundY, W, H - groundY);
  g.fillStyle = th.dirt;
  g.fillRect(0, groundY + 8 * s, W, H - groundY - 8 * s);
  g.fillStyle = th.grassEdge;
  g.fillRect(0, groundY, W, 3 * s);

  // 走っている感じを出すための地面の線
  g.fillStyle = 'rgba(255,255,255,.32)';
  const step = 26 * s;
  const off = v.scroll % step;
  for (let i = -1; i < W / step + 1; i++) {
    roundRect(g, i * step - off, groundY + 12 * s, 12 * s, 3 * s, 2 * s);
    g.fill();
  }
}

// ------------------------------------------------------------------ 天気（キャラの手前）

/** 粒は 22個。数を増やすより、動きの違いで「別の場所」に見せる */
const DROPS = 22;

export function drawWeather(g: CanvasRenderingContext2D, th: Theme, v: SceneView): void {
  if (th.weather === 'none') return;
  const { W, H, s, t } = v;

  for (let i = 0; i < DROPS; i++) {
    const seed = i + 1;
    const speed = 0.35 + rnd(seed) * 0.75;
    const x0 = rnd(seed * 3) * W;
    const sway = Math.sin(t * (1 + rnd(seed * 5)) + i) * 12 * s;

    switch (th.weather) {
      case 'petal':
      case 'leaf': {
        const y = ((t * 44 * speed * s + rnd(seed * 7) * H) % (H + 20)) - 10;
        const x = (x0 + sway - v.scroll * 0.12) % W;
        g.fillStyle = th.weather === 'petal' ? 'rgba(255,190,214,.9)' : 'rgba(240,180,90,.85)';
        g.save();
        g.translate((x + W) % W, y);
        g.rotate(t * 2 + i);
        g.beginPath();
        g.ellipse(0, 0, 4.4 * s, 2.4 * s, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
        break;
      }
      case 'snow': {
        const y = ((t * 40 * speed * s + rnd(seed * 7) * H) % (H + 20)) - 10;
        const x = ((x0 + sway - v.scroll * 0.1) % W + W) % W;
        g.fillStyle = 'rgba(255,255,255,.92)';
        g.beginPath();
        g.arc(x, y, (1.6 + rnd(seed * 11) * 1.8) * s, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case 'rain': {
        const y = ((t * 420 * speed * s + rnd(seed * 7) * H) % (H + 30)) - 20;
        const x = ((x0 - v.scroll * 0.3) % W + W) % W;
        g.strokeStyle = 'rgba(210,230,245,.6)';
        g.lineWidth = 1.6 * s;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - 3 * s, y + 13 * s);
        g.stroke();
        break;
      }
      case 'bubble': {
        const y = H - ((t * 34 * speed * s + rnd(seed * 7) * H) % (H + 20));
        const x = ((x0 + sway) % W + W) % W;
        const r = (2.2 + rnd(seed * 13) * 3.2) * s;
        g.strokeStyle = 'rgba(255,255,255,.75)';
        g.lineWidth = 1.4 * s;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
        break;
      }
      case 'firefly':
      case 'star': {
        const x = ((x0 + sway * 1.6) % W + W) % W;
        const y = (rnd(seed * 17) * 0.72 + 0.05) * H + Math.sin(t * 1.6 + i * 2) * 9 * s;
        const a = 0.35 + 0.5 * Math.abs(Math.sin(t * 2.4 + i));
        g.fillStyle = th.weather === 'firefly' ? `rgba(255,240,150,${a})` : `rgba(255,255,255,${a})`;
        g.beginPath();
        g.arc(x, y, (1.7 + rnd(seed * 19) * 1.6) * s, 0, Math.PI * 2);
        g.fill();
        break;
      }
      default:
        break;
    }
  }
}

/** 空・丘・木・地面まで。キャラと障害物はこのあとに描く */
export function drawScene(g: CanvasRenderingContext2D, th: Theme, v: SceneView): void {
  drawSky(g, th, v);
  drawClouds(g, th, v);
  drawHills(g, v, 0.16, Math.min(118 * v.s, v.H * 0.34), th.hillFar);
  drawHills(g, v, 0.34, Math.min(84 * v.s, v.H * 0.24), th.hillNear);
  drawDecoRow(g, th, v);
  drawGround(g, th, v);
}
