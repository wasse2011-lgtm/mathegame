/**
 * ぼくじょうの あそびどうぐ。コインの使いみち その3。
 *
 * ぼくじょうは「持っている子が ぜんぶ歩いている」画面で、なかまが増えるほど
 * にぎやかになる。ただ 40ぴき そろえたあとは、たまごを割っても なかよし度が
 * 上がるだけで、画面は それ以上 変わらなかった。
 * どうぐを置くと、なかまが **じぶんから あそびにいく**。すべりだいを すべり、
 * ブランコを こぎ、いけで およぐ。置くほど ぼくじょうで起きることが増える。
 *
 * 手に入れかたは1つだけ。「つぎの どうぐ」を おく（買う順番は きまっている）。
 * どれも同じ ねだんで、ボタンは1つ。きせかえと同じく、値札の一覧は作らない。
 * 順番を きめてあるのは、「つぎは トランポリン」と目標が見えるほうが
 * コインを ためる理由になるから（ランダムにすると、何が来るか分からない）。
 *
 * 見た目だけ。ペットの力にも 記録にも 一切かかわらない。
 */

import { drawPet } from './petart';
import type { PetArt } from './pets';
import { persist, profile } from './save';

export type ToyId = 'tramp' | 'ball' | 'slide' | 'swing' | 'pond' | 'fountain';

export interface ToyDef {
  id: ToyId;
  name: string;
  /** 置いたとき・さわったときの ひとこと */
  note: string;
  /** 置き場所。ぼくじょうの横（0..1） */
  x: number;
  /** 奥行き。0（さくの前）〜 1（いちばん手前） */
  depth: number;
  /** いっしょに あそべる数 */
  seats: number;
  /** 1回 あそぶ長さ（秒） */
  dur: number;
}

/**
 * 置く順。はじめの1つは、置いた瞬間に いちばん動きが見えるものにする。
 *
 * 置き場所は、ぼくじょうの 右上（空）に おやつの ボタンが浮いているのに合わせてある。
 * さくの前の 右3ぶんの1には 背の高いもの（すべりだい・ブランコ・ふんすい・
 * はねる子）を置かない。置くと ボタンの うしろに かくれる。
 * まんなかの手前には かいぬし（ranch.ts の OWNER_DEPTH）が立っている。
 */
export const TOYS: ToyDef[] = [
  { id: 'tramp', name: 'トランポリン', note: 'ぴょーんと たかく はねる', x: 0.54, depth: 0.1, seats: 1, dur: 2.6 },
  { id: 'ball', name: 'ボール', note: 'けって おいかける', x: 0.64, depth: 0.85, seats: 9, dur: 0 },
  { id: 'slide', name: 'すべりだい', note: 'のぼって しゅーっと すべる', x: 0.12, depth: 0.04, seats: 1, dur: 2.8 },
  { id: 'swing', name: 'ブランコ', note: 'ゆーら ゆーら こぐ', x: 0.33, depth: 0.02, seats: 1, dur: 3.4 },
  { id: 'pond', name: 'いけ', note: 'ぷかぷか およぐ', x: 0.83, depth: 0.12, seats: 2, dur: 3.6 },
  { id: 'fountain', name: 'ふんすい', note: 'みずあびで ぱしゃぱしゃ', x: 0.17, depth: 0.72, seats: 2, dur: 3 },
];

/** 1つの ねだん。たまご（120）より少し高い。順番が決まっていて、ねらって買えるぶん */
export const TOY_COST = 150;

export function toyDef(id: string): ToyDef | null {
  return TOYS.find((t) => t.id === id) ?? null;
}

export function hasToy(id: ToyId): boolean {
  return profile().toys.includes(id);
}

/** 置いてある どうぐ（置く順にならべる） */
export function ownedToys(): ToyDef[] {
  return TOYS.filter((t) => hasToy(t.id));
}

/** つぎに置く どうぐ。ぜんぶ置いていれば null */
export function nextToy(): ToyDef | null {
  return TOYS.find((t) => !hasToy(t.id)) ?? null;
}

/** つぎの どうぐを置く。コインが足りない・ぜんぶ置いてある なら null */
export function buyNextToy(): ToyDef | null {
  const toy = nextToy();
  const p = profile();
  if (!toy || p.coins < TOY_COST) return null;
  p.coins -= TOY_COST;
  p.toys.push(toy.id);
  persist();
  return toy;
}

// ---------------------------------------------------------------- 絵

/** どうぐの大きさの もと。ペットの大きさ（ranch.ts の sizeOf）と同じ ものさし */
export interface ToyView {
  /** 置き場所（画面ピクセル）。地面に接する点 */
  x: number;
  y: number;
  /** その奥行きでの ペットの大きさ */
  s: number;
  t: number;
}

/** いま あそんでいる子の すがた。どうぐの 置き場所からの ずれで持つ */
export interface Pose {
  dx: number;
  dy: number;
  rot: number;
  /** いけ の中。水面（どうぐの 置き場所からの ずれ）より下を 描かない */
  water?: number;
  /** はねているときに 足もとを つぶす（トランポリン） */
  squash?: number;
}

/**
 * あそんでいる子の位置。u は 0（はじめ）→ 1（おわり）。
 * seat は 2人で使える どうぐ（いけ・ふんすい）で、どちら側にいるか。
 */
export function toyPose(toy: ToyDef, u: number, s: number, t: number, seat: number): Pose {
  switch (toy.id) {
    case 'tramp': {
      // 3回 はねる。まんなかが いちばん高い
      const hops = 3;
      const k = (u * hops) % 1;
      const height = [1, 1.35, 1][Math.min(hops - 1, Math.floor(u * hops))];
      return { dx: 0, dy: -s * 0.3 - Math.sin(k * Math.PI) * s * 1.3 * height, rot: 0, squash: k < 0.08 || k > 0.92 ? 0.85 : 1 };
    }
    case 'slide': {
      // はしごを のぼる → 上で ひと息 → しゅーっと すべる
      const lx = -s * 0.95;
      const top = -s * 1.55;
      if (u < 0.42) return { dx: lx, dy: (u / 0.42) * top, rot: 0 };
      if (u < 0.55) return { dx: lx + s * 0.2, dy: top, rot: Math.sin(t * 16) * 0.08 };
      // すべる ところ（drawToy と同じ曲線）の上を たどる。はじめは ゆっくり、下で速く
      const k = Math.min(1, (u - 0.55) / 0.36);
      const c = chute(s, k * k);
      return { dx: c.x, dy: c.y - s * 0.08, rot: 0.5 * (1 - k) };
    }
    case 'swing': {
      const a = swingAngle(u, t);
      const len = s * 1.25;
      const top = -s * 1.9;
      return { dx: Math.sin(a) * len, dy: top + Math.cos(a) * len + s * 0.2, rot: a * 0.6 };
    }
    case 'pond': {
      // 水の中を ゆっくり行ったり来たり。からだの下のほうは水の中
      const side = seat ? 1 : -1;
      const dx = side * s * 0.5 + Math.sin(u * Math.PI * 2 + seat) * s * 0.35;
      const bob = Math.sin(t * 3 + seat * 2) * s * 0.05;
      return { dx, dy: s * 0.3 + bob, rot: Math.sin(t * 2 + seat) * 0.08, water: s * 0.02 };
    }
    case 'fountain': {
      // ふちで ぴょこぴょこ はねて 水をあびる
      const side = seat ? 1 : -1;
      return { dx: side * s * 0.95, dy: -Math.abs(Math.sin(u * Math.PI * 6)) * s * 0.35, rot: 0 };
    }
    default:
      return { dx: 0, dy: 0, rot: 0 };
  }
}

/** すべりだいの すべる ところ。k は 0（上）→ 1（下）。置き場所からの ずれ */
function chute(s: number, k: number): { x: number; y: number } {
  const p = [
    [-0.65, -1.55],
    [0.1, -1.25],
    [0.3, -0.1],
    [1.05, -0.06],
  ];
  const m = 1 - k;
  const w = [m * m * m, 3 * m * m * k, 3 * m * k * k, k * k * k];
  return {
    x: s * (w[0] * p[0][0] + w[1] * p[1][0] + w[2] * p[2][0] + w[3] * p[3][0]),
    y: s * (w[0] * p[0][1] + w[1] * p[1][1] + w[2] * p[2][1] + w[3] * p[3][1]),
  };
}

/** さわって どうぐを当てる ための わく（置き場所からの ずれ） */
export function toyBox(toy: ToyDef, s: number): { l: number; r: number; t: number; b: number } {
  switch (toy.id) {
    case 'tramp': return { l: -s * 1.1, r: s * 1.1, t: -s * 0.6, b: s * 0.15 };
    case 'slide': return { l: -s * 1.3, r: s * 1.15, t: -s * 1.9, b: s * 0.15 };
    case 'swing': return { l: -s * 1.2, r: s * 1.2, t: -s * 2.05, b: s * 0.15 };
    case 'pond': return { l: -s * 1.45, r: s * 1.45, t: -s * 0.5, b: s * 0.5 };
    case 'fountain': return { l: -s * 0.85, r: s * 0.85, t: -s * 1.5, b: s * 0.15 };
    default: return { l: -s * 0.4, r: s * 0.4, t: -s * 0.8, b: s * 0.1 };
  }
}

/** ブランコの ふれ。こぎはじめは小さく、まんなかで大きく、おわりで また小さく */
function swingAngle(u: number, t: number): number {
  const amp = Math.sin(Math.min(1, Math.max(0, u)) * Math.PI) * 0.75;
  return Math.sin(t * 2.8) * amp;
}

/**
 * どうぐを描く。busy は だれかが使っているか（ブランコの座面は その子と一緒に動かす）。
 * u は 使っている子の 進みぐあい（トランポリンの へこみ・ブランコの ふれ に使う）。
 */
export function drawToy(g: CanvasRenderingContext2D, toy: ToyDef, v: ToyView, busy: boolean, u: number): void {
  const { x, y, s, t } = v;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  switch (toy.id) {
    case 'tramp': {
      const w = s * 0.95;
      // あし
      g.strokeStyle = '#6c7a89';
      g.lineWidth = Math.max(2, s * 0.09);
      g.beginPath();
      for (const k of [-0.8, 0, 0.8]) {
        g.moveTo(x + w * k, y - s * 0.18);
        g.lineTo(x + w * k, y);
      }
      g.stroke();
      // へこみ。着地の瞬間だけ まくが下がる
      const k = busy ? (u * 3) % 1 : 1;
      const dip = busy && (k < 0.1 || k > 0.9) ? s * 0.08 : 0;
      g.fillStyle = '#2f3e55';
      g.beginPath();
      g.ellipse(x, y - s * 0.2 + dip, w * 0.86, s * 0.16, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#4dabf7';
      g.lineWidth = Math.max(2, s * 0.12);
      g.beginPath();
      g.ellipse(x, y - s * 0.2, w, s * 0.22, 0, 0, Math.PI * 2);
      g.stroke();
      // ふちの もよう（ばね）
      g.strokeStyle = '#ffd257';
      g.lineWidth = Math.max(1.5, s * 0.06);
      g.setLineDash([s * 0.12, s * 0.16]);
      g.beginPath();
      g.ellipse(x, y - s * 0.2, w, s * 0.22, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      break;
    }
    case 'slide': {
      const lx = x - s * 0.95;
      const top = y - s * 1.55;
      // はしご
      g.strokeStyle = '#8d99a6';
      g.lineWidth = Math.max(2, s * 0.08);
      g.beginPath();
      g.moveTo(lx - s * 0.2, y);
      g.lineTo(lx - s * 0.2, top - s * 0.25);
      g.moveTo(lx + s * 0.2, y);
      g.lineTo(lx + s * 0.2, top - s * 0.25);
      for (let i = 1; i <= 4; i++) {
        const ry = y - (i / 5) * (y - top);
        g.moveTo(lx - s * 0.2, ry);
        g.lineTo(lx + s * 0.2, ry);
      }
      g.stroke();
      // 上の だい
      g.fillStyle = '#ff8a5c';
      g.fillRect(lx - s * 0.28, top - s * 0.02, s * 0.62, s * 0.12);
      // すべる ところ（toyPose の chute と同じ曲線）
      const path = (off: number) => {
        g.beginPath();
        for (let i = 0; i <= 16; i++) {
          const c = chute(s, i / 16);
          if (i === 0) g.moveTo(x + c.x, y + c.y + off);
          else g.lineTo(x + c.x, y + c.y + off);
        }
        g.stroke();
      };
      g.strokeStyle = '#ffc53d';
      g.lineWidth = Math.max(4, s * 0.2);
      path(0);
      g.strokeStyle = '#e8a317';
      g.lineWidth = Math.max(1.5, s * 0.06);
      path(-s * 0.09);
      break;
    }
    case 'swing': {
      const top = y - s * 1.9;
      const half = s * 0.85;
      // わく（ハの字の あし と 上の ぼう）
      g.strokeStyle = '#c0703a';
      g.lineWidth = Math.max(2.5, s * 0.11);
      g.beginPath();
      g.moveTo(x - half - s * 0.25, y);
      g.lineTo(x - half, top);
      g.lineTo(x + half, top);
      g.lineTo(x + half + s * 0.25, y);
      g.stroke();
      // だれも乗っていないときの 座面。風で すこしだけ ゆれる
      if (!busy) drawSwingSeat(g, x, top, s, Math.sin(t * 1.3) * 0.08);
      break;
    }
    case 'pond': {
      const w = s * 1.25;
      g.fillStyle = '#b7e3f5';
      g.beginPath();
      g.ellipse(x, y, w + s * 0.12, s * 0.42, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#5fb8e8';
      g.beginPath();
      g.ellipse(x, y, w, s * 0.33, 0, 0, Math.PI * 2);
      g.fill();
      // はすの は
      g.fillStyle = '#69c07a';
      g.beginPath();
      g.ellipse(x + w * 0.55, y - s * 0.06, s * 0.2, s * 0.08, 0, 0.3, Math.PI * 2);
      g.lineTo(x + w * 0.55, y - s * 0.06);
      g.fill();
      // みずの きらり
      g.strokeStyle = 'rgba(255,255,255,.7)';
      g.lineWidth = Math.max(1.5, s * 0.05);
      const r = ((t * 0.6) % 1) * w * 0.5;
      g.globalAlpha = 1 - ((t * 0.6) % 1);
      g.beginPath();
      g.ellipse(x - w * 0.35, y + s * 0.02, r, r * 0.3, 0, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
      break;
    }
    case 'fountain': {
      const w = s * 0.7;
      // みずの はしら。まんなかから 上がって、左右に こぼれる
      g.strokeStyle = 'rgba(120,200,240,.85)';
      g.lineWidth = Math.max(2, s * 0.08);
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(x, y - s * 0.95);
        g.quadraticCurveTo(x + side * w * 0.5, y - s * 1.45, x + side * w * 0.8, y - s * 0.35);
        g.stroke();
      }
      // しぶき
      g.fillStyle = 'rgba(160,220,250,.9)';
      for (let i = 0; i < 5; i++) {
        const k = (t * 1.4 + i / 5) % 1;
        const side = i % 2 ? 1 : -1;
        g.beginPath();
        g.arc(x + side * w * (0.3 + k * 0.5), y - s * 1.2 + k * k * s * 0.9, Math.max(1, s * 0.05), 0, Math.PI * 2);
        g.fill();
      }
      // はしら
      g.fillStyle = '#c9d4de';
      g.fillRect(x - s * 0.09, y - s * 0.95, s * 0.18, s * 0.7);
      g.fillStyle = '#e6edf3';
      g.beginPath();
      g.ellipse(x, y - s * 0.95, s * 0.2, s * 0.07, 0, 0, Math.PI * 2);
      g.fill();
      // うけざら
      g.fillStyle = '#b8c5d1';
      g.beginPath();
      g.ellipse(x, y - s * 0.12, w, s * 0.24, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#7cc6ee';
      g.beginPath();
      g.ellipse(x, y - s * 0.18, w * 0.84, s * 0.15, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#9aa8b5';
      g.fillRect(x - w, y - s * 0.12, w * 2, s * 0.1);
      break;
    }
    case 'ball':
      // ボールは 動くので ranch.ts が drawBall で描く
      break;
  }
  g.restore();
}

/** ブランコの ロープと 座面。a は ふれの角度 */
function drawSwingSeat(g: CanvasRenderingContext2D, x: number, top: number, s: number, a: number): void {
  const len = s * 1.25;
  const sx = x + Math.sin(a) * len;
  const sy = top + Math.cos(a) * len;
  g.strokeStyle = '#7a6150';
  g.lineWidth = Math.max(1.2, s * 0.045);
  g.beginPath();
  g.moveTo(x - s * 0.22, top);
  g.lineTo(sx - s * 0.24, sy);
  g.moveTo(x + s * 0.22, top);
  g.lineTo(sx + s * 0.24, sy);
  g.stroke();
  g.fillStyle = '#e4675c';
  g.save();
  g.translate(sx, sy);
  g.rotate(a);
  g.fillRect(-s * 0.3, -s * 0.03, s * 0.6, s * 0.1);
  g.restore();
}

/**
 * あそんでいる子を描く。どうぐの形に合わせて、ロープ（ブランコ）や
 * 水面（いけ）も ここで一緒に描く（どうぐの絵と 子の絵の 前後が入れかわるため）。
 */
export function drawToyRider(
  g: CanvasRenderingContext2D,
  toy: ToyDef,
  v: ToyView,
  art: PetArt,
  u: number,
  seat: number,
  phase: number,
): { x: number; y: number } {
  const { x, y, s, t } = v;
  const pose = toyPose(toy, u, s, t, seat);
  const px = x + pose.dx;
  const py = y + pose.dy;

  if (toy.id === 'swing') {
    const top = y - s * 1.9;
    drawSwingSeat(g, x, top, s, swingAngle(u, t));
  }

  g.save();
  if (pose.water !== undefined) {
    // 水面より下は描かない（しずんでいるように見せる）
    const wy = y + pose.water;
    g.beginPath();
    g.rect(px - s * 3, wy - s * 4, s * 6, s * 4);
    g.clip();
  }
  if (pose.rot) {
    g.translate(px, py - s * 0.5);
    g.rotate(pose.rot);
    g.translate(-px, -(py - s * 0.5));
  }
  if (pose.squash && pose.squash !== 1) {
    g.translate(px, py);
    g.scale(1 / pose.squash, pose.squash);
    g.translate(-px, -py);
  }
  drawPet(g, px, py, s, art, t + phase);
  g.restore();

  if (toy.id === 'pond') {
    // からだの まわりの 波の わ
    g.strokeStyle = 'rgba(255,255,255,.75)';
    g.lineWidth = Math.max(1.2, s * 0.05);
    g.beginPath();
    g.ellipse(px, y + (pose.water ?? 0), s * 0.42, s * 0.1, 0, 0, Math.PI * 2);
    g.stroke();
  }
  return { x: px, y: py };
}

/** ボール。ころがる向きに回して見せる */
export function drawBall(g: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number): void {
  g.save();
  g.fillStyle = 'rgba(40,70,40,.14)';
  g.beginPath();
  g.ellipse(x, y + 1, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
  g.fill();
  const cy = y - r;
  g.translate(x, cy);
  g.rotate(spin);
  const colors = ['#ff6b6b', '#ffffff', '#4dabf7', '#ffffff', '#ffd257', '#ffffff'];
  colors.forEach((c, i) => {
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, r, (i / colors.length) * Math.PI * 2, ((i + 1) / colors.length) * Math.PI * 2);
    g.closePath();
    g.fill();
  });
  g.strokeStyle = 'rgba(38,49,61,.25)';
  g.lineWidth = 1;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.beginPath();
  g.arc(-r * 0.35, -r * 0.35, r * 0.25, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/**
 * どうぐの ボタンに出す 小さい絵。ぼくじょうと同じ描きかたで描く
 * （絵文字は 端末ごとに顔がちがい、すべりだいの絵文字は古い iOS に無い）。
 */
export function paintToyIcon(canvas: HTMLCanvasElement, toy: ToyDef, size = 40): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  if (toy.id === 'ball') {
    drawBall(g, size / 2, size * 0.82, size * 0.3, 0.3);
    return;
  }
  // 形ごとに 枠いっぱいになる大きさ。背の高い すべりだい・ブランコ（高さ 約2s）と、
  // ひらたい トランポリン・いけ（はば 約2.8s）で ものさしを変える
  const s = size * (toy.id === 'pond' ? 0.34 : toy.id === 'tramp' ? 0.46 : 0.42);
  const cy = toy.id === 'pond' ? size * 0.6 : toy.id === 'tramp' ? size * 0.72 : size * 0.9;
  drawToy(g, toy, { x: size / 2, y: cy, s, t: 0.6 }, false, 0);
}
