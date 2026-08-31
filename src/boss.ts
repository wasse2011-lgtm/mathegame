/**
 * ボスの見た目と遠距離攻撃。
 *
 * ワールドが進むほど「強そう」に見えるように、色・つの・トゲ・はね・オーラを
 * 段階で足していく。強さそのもの（速さ）は runner.ts が持ち、ここは絵だけ。
 * 画像は使わず Canvas で描く（読み込み待ちゼロ・どんな画面サイズでも綺麗）。
 */

import { roundRect } from './sprites';

export type ShotKind = 'rock' | 'beam' | 'fire';

export type BossMode = 'idle' | 'wind' | 'roar' | 'charge' | 'hit' | 'down';

export interface BossState {
  t: number;
  mode: BossMode;
  /** 0 より大きいあいだは白く光る（かわされた瞬間） */
  hit: number;
  /** 1 で通常。踏まれると 0 に近づいてぺしゃんこになる */
  squash: number;
}

export interface BossDef {
  /** ワールドID (1..8)。そのまま見た目の段階になる */
  tier: number;
  name: string;
  body: string;
  shade: string;
  belly: string;
  horn: string;
  /** 目の光。段階が上がるほど光る色になる */
  eye: string;
  /** そのボスが使う遠距離攻撃。前から順に使う */
  shots: ShotKind[];
}

const INK = '#2b3440';

/** ワールドごとのボス。名前は短いカタカナで、口に出して呼べるものにする */
const DEFS: Omit<BossDef, 'tier'>[] = [
  { name: 'ドドン', body: '#8fbf6a', shade: '#63944a', belly: '#e2f2c8', horn: '#f6e3ae', eye: '#ffffff', shots: ['rock'] },
  { name: 'ヒュウガ', body: '#6fb2d8', shade: '#4a89b2', belly: '#dceffa', horn: '#f6e3ae', eye: '#ffffff', shots: ['rock'] },
  { name: 'ゴーレム', body: '#a094b8', shade: '#6d6190', belly: '#e6e1f0', horn: '#efe6cf', eye: '#ffffff', shots: ['rock', 'fire'] },
  { name: 'テンジュウ', body: '#d9a94e', shade: '#a97c2c', belly: '#f8e9c6', horn: '#fff3cf', eye: '#ffffff', shots: ['fire', 'rock'] },
  { name: 'ヤマオニ', body: '#d96b5c', shade: '#a8433c', belly: '#f8ded6', horn: '#fff0d0', eye: '#ffe9a8', shots: ['rock', 'fire', 'beam'] },
  { name: 'ナミロウ', body: '#48a49c', shade: '#2d7a72', belly: '#d8f1ed', horn: '#eafaff', eye: '#ffe9a8', shots: ['beam', 'rock', 'fire'] },
  { name: 'アラシオン', body: '#7b5cae', shade: '#513a7c', belly: '#e7ddf6', horn: '#ffe9a8', eye: '#c9ff6b', shots: ['beam', 'fire', 'rock'] },
  { name: 'ソラガミ', body: '#46506f', shade: '#2a3149', belly: '#dfe4f5', horn: '#bfe9ff', eye: '#9ef3ff', shots: ['beam', 'fire', 'beam', 'rock'] },
];

export function bossDef(worldId: number): BossDef {
  const i = Math.min(Math.max(worldId, 1), DEFS.length) - 1;
  return { tier: i + 1, ...DEFS[i] };
}

/** 何問目にどの攻撃が来るか。同じ順で回るので、子どもが覚えて身構えられる */
export function shotFor(def: BossDef, index: number): ShotKind {
  return def.shots[index % def.shots.length];
}

// ------------------------------------------------------------------ ボス本体

function horns(g: CanvasRenderingContext2D, cx: number, top: number, w: number, s: number, def: BossDef): void {
  const pair = def.tier >= 5 ? 2 : 1; // 段階が上がると 4本になる
  g.fillStyle = def.horn;
  g.strokeStyle = 'rgba(0,0,0,.14)';
  g.lineWidth = Math.max(1, s * 0.02);
  for (let i = 0; i < pair; i++) {
    const spread = w * (0.3 + i * 0.19);
    const len = s * (0.42 + def.tier * 0.035) * (i === 0 ? 1 : 0.72);
    for (const side of [-1, 1]) {
      const bx = cx + side * spread;
      g.beginPath();
      g.moveTo(bx - s * 0.09, top + s * 0.06);
      g.quadraticCurveTo(bx + side * s * 0.16, top - len * 0.6, bx + side * s * 0.1, top - len);
      g.quadraticCurveTo(bx + side * s * 0.02, top - len * 0.5, bx + s * 0.09, top + s * 0.06);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }
}

function backSpikes(g: CanvasRenderingContext2D, cx: number, top: number, h: number, w: number, def: BossDef): void {
  const n = Math.min(def.tier, 6);
  if (n < 2) return;
  g.fillStyle = def.shade;
  for (let i = 0; i < n; i++) {
    const y = top + h * (0.24 + (i / n) * 0.6);
    const size = w * (0.16 + def.tier * 0.008) * (1 - i / (n * 2));
    g.beginPath();
    g.moveTo(cx + w * 0.42, y);
    g.lineTo(cx + w * 0.42 + size, y + size * 0.55);
    g.lineTo(cx + w * 0.42, y + size);
    g.closePath();
    g.fill();
  }
}

function wings(g: CanvasRenderingContext2D, cx: number, top: number, h: number, w: number, def: BossDef, t: number): void {
  if (def.tier < 6) return;
  const flap = Math.sin(t * 4) * 0.22;
  g.fillStyle = def.shade;
  g.globalAlpha = 0.9;
  // 2枚とも背中側（右）へ広げる。左に伸ばすと、前を向いている顔にかぶって
  // 大きな鎌のように見えてしまう
  for (const k of [0, 1]) {
    g.save();
    g.translate(cx + w * 0.12, top + h * (0.2 + k * 0.14));
    g.rotate(-0.34 + k * 0.5 + flap);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(w * 0.85, -h * 0.42, w * 1.02, h * 0.14);
    g.quadraticCurveTo(w * 0.55, h * 0.06, 0, h * 0.3);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.globalAlpha = 1;
}

function aura(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, def: BossDef, t: number): void {
  if (def.tier < 7) return;
  const pulse = r * (1.05 + Math.sin(t * 5) * 0.05);
  const grad = g.createRadialGradient(cx, cy, r * 0.55, cx, cy, pulse);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, def.tier >= 8 ? 'rgba(120,220,255,.42)' : 'rgba(190,140,255,.4)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, pulse, 0, Math.PI * 2);
  g.fill();
}

/**
 * ボスを描く。cx は中心、footY は足もと、size は体の高さ。
 * ボスは右を向いている（プレイヤーは左にいる）ので、顔は左向きに描く。
 */
export function drawBoss(
  g: CanvasRenderingContext2D,
  cx: number,
  footY: number,
  size: number,
  def: BossDef,
  st: BossState,
): void {
  const s = size;
  const h = s * st.squash;
  // つぶれたぶんだけ横に広がる（踏まれた手ごたえ）
  const w = s * 1.12 * (1 + (1 - st.squash) * 0.85);
  const breathe = st.mode === 'down' ? 0 : Math.sin(st.t * (st.mode === 'charge' ? 15 : 3.2)) * s * 0.018;
  const lean = st.mode === 'charge' ? -s * 0.06 : st.mode === 'wind' ? s * 0.05 : 0;
  const top = footY - h + breathe;
  const x = cx - w / 2;

  g.save();
  g.translate(lean, 0);

  aura(g, cx, top + h * 0.5, Math.max(w, h) * 0.8, def, st.t);
  wings(g, cx, top, h, w, def, st.t);

  // しっぽ
  g.fillStyle = def.shade;
  g.beginPath();
  g.moveTo(cx + w * 0.4, footY - h * 0.2);
  g.quadraticCurveTo(
    cx + w * 0.95,
    footY - h * (0.34 + Math.sin(st.t * 3.6) * 0.08),
    cx + w * 0.78,
    footY - h * 0.62,
  );
  g.quadraticCurveTo(cx + w * 0.78, footY - h * 0.3, cx + w * 0.4, footY - h * 0.05);
  g.closePath();
  g.fill();

  backSpikes(g, cx, top, h, w, def);

  // あし
  g.fillStyle = def.shade;
  const legSwing = st.mode === 'charge' ? Math.sin(st.t * 18) * w * 0.12 : 0;
  roundRect(g, x + w * 0.12 + legSwing, footY - h * 0.16, w * 0.3, h * 0.2, s * 0.08);
  g.fill();
  roundRect(g, x + w * 0.58 - legSwing, footY - h * 0.16, w * 0.3, h * 0.2, s * 0.08);
  g.fill();

  horns(g, cx, top, w, s, def);

  // からだ（頭と一体。ずんぐりしているほうが強そうで、こわすぎない）
  g.fillStyle = def.body;
  roundRect(g, x, top, w, h, Math.min(w, h) * 0.34);
  g.fill();

  // おなか
  g.fillStyle = def.belly;
  roundRect(g, x + w * 0.2, top + h * 0.46, w * 0.6, h * 0.48, Math.min(w, h) * 0.26);
  g.fill();
  // おなかの筋（段階が上がるほど鎧っぽくなる）
  if (def.tier >= 4) {
    g.strokeStyle = 'rgba(0,0,0,.12)';
    g.lineWidth = Math.max(1, s * 0.022);
    for (let i = 1; i <= Math.min(def.tier - 2, 4); i++) {
      const y = top + h * (0.5 + i * 0.09);
      g.beginPath();
      g.moveTo(x + w * 0.24, y);
      g.lineTo(x + w * 0.76, y);
      g.stroke();
    }
  }

  // うで（ためのときは振りかぶる）
  g.fillStyle = def.shade;
  const armUp = st.mode === 'wind' ? -h * 0.24 : st.mode === 'charge' ? -h * 0.1 : Math.sin(st.t * 3.2) * h * 0.02;
  roundRect(g, x - w * 0.14, top + h * 0.44 + armUp, w * 0.24, h * 0.34, s * 0.1);
  g.fill();
  roundRect(g, x + w * 0.9, top + h * 0.44, w * 0.24, h * 0.34, s * 0.1);
  g.fill();
  // つめ
  if (def.tier >= 3) {
    g.fillStyle = def.horn;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.arc(x - w * 0.1 + i * w * 0.07, top + h * 0.78 + armUp, s * 0.045, 0, Math.PI * 2);
      g.fill();
    }
  }

  drawFace(g, cx, top, w, h, s, def, st);

  // よけられた瞬間だけ白く光る。色を白で塗りつぶすと別の生き物に見えるので、
  // ふつうに描いた上へ半透明の白をかぶせる
  if (st.hit > 0) {
    g.globalAlpha = Math.min(0.55, st.hit * 2.6);
    g.fillStyle = '#ffffff';
    roundRect(g, x, top, w, h, Math.min(w, h) * 0.34);
    g.fill();
    g.globalAlpha = 1;
  }

  g.restore();
}

function drawFace(
  g: CanvasRenderingContext2D,
  cx: number,
  top: number,
  w: number,
  h: number,
  s: number,
  def: BossDef,
  st: BossState,
): void {
  const ey = top + h * 0.3;
  const down = st.mode === 'down';

  if (down) {
    // やられた顔（ぐるぐる目）
    g.strokeStyle = INK;
    g.lineWidth = Math.max(2, s * 0.045);
    for (const side of [-1, 1]) {
      const ex = cx + side * w * 0.19;
      g.beginPath();
      for (let a = 0; a < 12; a++) {
        const r = s * 0.02 + a * s * 0.008;
        const ang = a * 0.9;
        const px = ex + Math.cos(ang) * r;
        const py = ey + Math.sin(ang) * r;
        if (a === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
    g.beginPath();
    g.arc(cx, top + h * 0.56, s * 0.13, Math.PI, 0);
    g.stroke();
    return;
  }

  // 目。段階が上がると3つ目が開く
  const eyes: number[] = def.tier >= 5 ? [-0.19, 0.19, 0] : [-0.19, 0.19];
  eyes.forEach((f, i) => {
    const third = i === 2;
    const ex = cx + w * f;
    const eyY = third ? top + h * 0.16 : ey;
    const r = s * (third ? 0.07 : 0.1);
    g.fillStyle = def.eye;
    g.beginPath();
    g.ellipse(ex, eyY, r, r * 1.05, 0, 0, Math.PI * 2);
    g.fill();
    // 光る目のボスは、うっすら発光させる
    if (def.tier >= 5) {
      g.globalAlpha = 0.5;
      g.beginPath();
      g.arc(ex, eyY, r * 1.7, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
    g.fillStyle = INK;
    // 左（プレイヤー側）をにらむ
    g.beginPath();
    g.arc(ex - r * 0.3, eyY + r * 0.05, r * 0.5, 0, Math.PI * 2);
    g.fill();
  });

  // まゆ。おこっているほど角度がきつくなる
  g.strokeStyle = INK;
  g.lineWidth = Math.max(2, s * 0.055);
  g.lineCap = 'round';
  const angry = st.mode === 'charge' || st.mode === 'roar' ? 1.5 : 1;
  for (const side of [-1, 1]) {
    const bx = cx + side * w * 0.19;
    g.beginPath();
    g.moveTo(bx - s * 0.11, ey - s * (0.16 + 0.04 * angry) + (side < 0 ? 0 : s * 0.06 * angry));
    g.lineTo(bx + s * 0.11, ey - s * (0.16 + 0.04 * angry) + (side < 0 ? s * 0.06 * angry : 0));
    g.stroke();
  }

  // 口とキバ
  const open = st.mode === 'roar' || st.mode === 'charge' ? 1 : st.mode === 'wind' ? 0.6 : 0.25;
  const my = top + h * 0.54;
  const mw = w * 0.34;
  const mh = s * (0.08 + 0.18 * open);
  g.fillStyle = '#5a2230';
  roundRect(g, cx - mw / 2, my, mw, mh, s * 0.06);
  g.fill();
  g.fillStyle = '#fff';
  const fangs = Math.min(2 + Math.floor(def.tier / 3), 4);
  for (let i = 0; i < fangs; i++) {
    const fx = cx - mw / 2 + ((i + 0.5) / fangs) * mw;
    g.beginPath();
    g.moveTo(fx - s * 0.035, my);
    g.lineTo(fx + s * 0.035, my);
    g.lineTo(fx, my + mh * 0.6);
    g.closePath();
    g.fill();
  }
}

// ------------------------------------------------------------------ 遠距離攻撃

export interface Shot {
  kind: ShotKind;
  x: number;
  y: number;
  /** 左へ進む速さ（px/秒） */
  v: number;
  /** 見た目の大きさ（px） */
  r: number;
  rot: number;
  t: number;
}

/** 攻撃ひとつを描く。def はボスの段階（色と派手さ）を借りるため */
export function drawShot(g: CanvasRenderingContext2D, sh: Shot, def: BossDef): void {
  switch (sh.kind) {
    case 'rock':
      drawRock(g, sh, def);
      break;
    case 'fire':
      drawFire(g, sh, def);
      break;
    default:
      drawBeam(g, sh, def);
  }
}

function drawRock(g: CanvasRenderingContext2D, sh: Shot, def: BossDef): void {
  const r = sh.r;
  // 転がるときの土けむり
  g.fillStyle = 'rgba(160,140,110,.35)';
  for (let i = 1; i <= 3; i++) {
    const d = r * (1.2 + i * 0.7);
    g.beginPath();
    g.arc(sh.x + d, sh.y + r * 0.5, r * (0.5 - i * 0.1), 0, Math.PI * 2);
    g.fill();
  }

  g.save();
  g.translate(sh.x, sh.y);
  g.rotate(sh.rot);
  // ごつごつした多角形
  g.fillStyle = def.tier >= 7 ? '#6b6470' : '#8e8578';
  g.beginPath();
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = r * (0.82 + ((i * 37) % 11) / 40);
    const px = Math.cos(a) * rad;
    const py = Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(0,0,0,.18)';
  g.beginPath();
  g.arc(r * 0.22, r * 0.24, r * 0.55, 0, Math.PI * 2);
  g.fill();
  // ひび
  g.strokeStyle = 'rgba(0,0,0,.28)';
  g.lineWidth = Math.max(1, r * 0.09);
  g.beginPath();
  g.moveTo(-r * 0.5, -r * 0.2);
  g.lineTo(-r * 0.1, r * 0.12);
  g.lineTo(r * 0.4, -r * 0.3);
  g.stroke();
  g.restore();
}

function drawFire(g: CanvasRenderingContext2D, sh: Shot, def: BossDef): void {
  const r = sh.r;
  const flick = Math.sin(sh.t * 26);

  // うしろに残る火の粉
  for (let i = 1; i <= 4; i++) {
    g.globalAlpha = 0.4 - i * 0.07;
    g.fillStyle = '#ff9a3c';
    g.beginPath();
    g.arc(sh.x + r * (1 + i * 0.8), sh.y + Math.sin(sh.t * 14 + i) * r * 0.4, r * (0.55 - i * 0.09), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // 炎の舌（右へ流れる）
  g.fillStyle = def.tier >= 7 ? '#b968ff' : '#ff7a2f';
  g.beginPath();
  g.moveTo(sh.x, sh.y - r);
  g.quadraticCurveTo(sh.x + r * 2.4, sh.y - r * (0.7 + flick * 0.2), sh.x + r * 3.2, sh.y);
  g.quadraticCurveTo(sh.x + r * 2.4, sh.y + r * (0.7 - flick * 0.2), sh.x, sh.y + r);
  g.closePath();
  g.fill();

  g.fillStyle = def.tier >= 7 ? '#e0a6ff' : '#ffb02e';
  g.beginPath();
  g.arc(sh.x, sh.y, r * 0.92, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffe9a8';
  g.beginPath();
  g.arc(sh.x - r * 0.1, sh.y - r * 0.08, r * (0.52 + flick * 0.05), 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(sh.x - r * 0.16, sh.y - r * 0.12, r * 0.24, 0, Math.PI * 2);
  g.fill();
}

function drawBeam(g: CanvasRenderingContext2D, sh: Shot, def: BossDef): void {
  const r = sh.r;
  const len = r * 5.2;
  const core = def.tier >= 8 ? '#9ef3ff' : def.tier >= 7 ? '#d2a6ff' : '#8fe3ff';

  // 外側の光
  const grad = g.createLinearGradient(sh.x - r, sh.y, sh.x + len, sh.y);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.25, core);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalAlpha = 0.55;
  g.fillStyle = grad;
  roundRect(g, sh.x - r, sh.y - r * 1.05, len + r, r * 2.1, r);
  g.fill();
  g.globalAlpha = 1;

  // 芯
  g.fillStyle = core;
  roundRect(g, sh.x - r * 0.6, sh.y - r * 0.5, len * 0.75, r, r * 0.5);
  g.fill();
  g.fillStyle = '#fff';
  roundRect(g, sh.x - r * 0.4, sh.y - r * 0.22, len * 0.6, r * 0.44, r * 0.22);
  g.fill();

  // 先頭のきらめき
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(sh.x - r * 0.35, sh.y, r * (0.6 + Math.sin(sh.t * 30) * 0.08), 0, Math.PI * 2);
  g.fill();

  // ばちばち
  g.strokeStyle = core;
  g.lineWidth = Math.max(1, r * 0.16);
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const bx = sh.x + r * (0.8 + i * 1.4);
    const sway = Math.sin(sh.t * 24 + i * 2) * r * 0.9;
    g.moveTo(bx, sh.y - sway);
    g.lineTo(bx + r * 0.7, sh.y + sway);
  }
  g.stroke();
}

/** 攻撃の日本語名。演出の文字に使う */
export function shotLabel(kind: ShotKind): string {
  return kind === 'rock' ? 'いわ' : kind === 'fire' ? 'ほのお' : 'ビーム';
}
