/**
 * ぶき と フィニッシュ演出。
 *
 * ぶきは「強さ」ではなく「終わりかた」を えらぶもの。
 * 当たるかどうかの判定は無く、正解すれば必ず当たる。ゲームの難しさには
 * 一切ひびかない（きせかえの他の品と同じ扱い）。
 *
 * 効くのは1か所だけ:
 *   ステージ／きょうの5もん／にがて たいじ の **さいごの1問**を当てたとき、
 *   えらんだ ぶきで 大げさに とどめを刺す。
 *
 * これは ごほうびの置きかたの問題。5歳は面の途中で手を止めてしまうことがある。
 * 「あと1問で、じぶんの えらんだ ぶきの フィニッシュが見られる」を
 * いちばん最後に置くと、そこまで走りきる理由になる。
 * 途中でやめると見られない（コインの フィニッシュボーナスも付かない）。
 *
 * 絵はぜんぶ Canvas で描く（sprites.ts と同じ。読み込み待ちゼロ）。
 */

/** とどめの型。ぶきの見た目そのものより、この5つで手ざわりが変わる */
export type WeaponStyle =
  /** ためて 撃つ（銃・ゆみや・ロケットパンチ・シャボン） */
  | 'shot'
  /** 踏みこんで 斬る（けん） */
  | 'slash'
  /** 投げて もどってくる（ブーメラン） */
  | 'throw'
  /** 上から たたく（ハンマー） */
  | 'smash'
  /** 空から ふらせる（つえ・ステッキ・ロッド） */
  | 'rain';

/** ぶきの形。1本につき1つ。持っている絵と、飛んでいく絵の両方に使う */
export type WeaponMotif =
  | 'fist' | 'beam' | 'arrow' | 'bubble' | 'blade' | 'boomerang' | 'hammer'
  | 'star' | 'heart' | 'bolt';

export interface WeaponDef {
  id: string;
  label: string;
  /** えらんだときに出す ひとこと。「なにが起きるか」だけを言う */
  note: string;
  style: WeaponStyle;
  motif: WeaponMotif;
  /** 主な色 */
  color: string;
  /** 光る色（フチ・粒） */
  glow: string;
  /** 持っているときの かたむき（ラジアン） */
  hold: number;
  /** 最初から持っているか */
  free?: boolean;
}

/**
 * ぶきの一覧。
 *
 * ロケットパンチだけ最初から持っている。ぶきは「外す」ことができない
 * （キャラと同じで、必ず1つ身につけている）ので、ここが空だと
 * さいごの1問で何も起きない画面になってしまう。
 */
export const WEAPONS: WeaponDef[] = [
  { id: 'wp-punch', label: 'ロケットパンチ', note: 'こぶしが とんでいく', style: 'shot', motif: 'fist', color: '#f0803c', glow: '#ffd7ad', hold: -0.2, free: true },
  { id: 'wp-beam', label: 'ビームガン', note: 'まっすぐ うちぬく', style: 'shot', motif: 'beam', color: '#4fb8ee', glow: '#d8f4ff', hold: -0.25 },
  { id: 'wp-bow', label: 'ひかりの ゆみや', note: 'とおくから いぬく', style: 'shot', motif: 'arrow', color: '#6cbf5f', glow: '#e8ffdc', hold: 0 },
  { id: 'wp-bubble', label: 'シャボンほう', note: 'つつんで ぽん', style: 'shot', motif: 'bubble', color: '#8fd8f5', glow: '#ffffff', hold: -0.25 },
  { id: 'wp-sword', label: 'ひかりの けん', note: 'ひとふりで きりさく', style: 'slash', motif: 'blade', color: '#ffd75e', glow: '#fff6d0', hold: -0.5 },
  { id: 'wp-boomerang', label: 'ブーメランエッジ', note: 'とんで まわって もどる', style: 'throw', motif: 'boomerang', color: '#9fd8ff', glow: '#eaf8ff', hold: 0.25 },
  { id: 'wp-hammer', label: 'だいハンマー', note: 'うえから たたきつぶす', style: 'smash', motif: 'hammer', color: '#9aa7b4', glow: '#ffe3a8', hold: -0.55 },
  { id: 'wp-wand', label: 'まほうの つえ', note: 'ほしが ふってくる', style: 'rain', motif: 'star', color: '#b79ae0', glow: '#ffe9a8', hold: -0.4 },
  { id: 'wp-heart', label: 'ハートステッキ', note: 'ハートが はじける', style: 'rain', motif: 'heart', color: '#ff8fb1', glow: '#ffe1ec', hold: -0.4 },
  { id: 'wp-thunder', label: 'かみなりロッド', note: 'かみなりが おちる', style: 'rain', motif: 'bolt', color: '#ffd75e', glow: '#fff8d0', hold: -0.4 },
];

/** 最初から持っている1本。セーブに何も入っていないときの既定 */
export const DEFAULT_WEAPON = 'wp-punch';

export function weaponDef(id: string): WeaponDef {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}

// ------------------------------------------------------------------ 形（共通の下じき）

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
}

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot = 0): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2 + rot;
    const rad = i % 2 ? r * 0.44 : r;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

function heartPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  g.moveTo(cx, cy + r * 0.9);
  g.bezierCurveTo(cx - r * 1.5, cy - r * 0.2, cx - r * 0.55, cy - r * 1.15, cx, cy - r * 0.35);
  g.bezierCurveTo(cx + r * 0.55, cy - r * 1.15, cx + r * 1.5, cy - r * 0.2, cx, cy + r * 0.9);
  g.closePath();
}

function boltPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  g.moveTo(cx + r * 0.28, cy - r);
  g.lineTo(cx - r * 0.52, cy + r * 0.12);
  g.lineTo(cx - r * 0.04, cy + r * 0.12);
  g.lineTo(cx - r * 0.3, cy + r);
  g.lineTo(cx + r * 0.56, cy - r * 0.16);
  g.lineTo(cx + r * 0.06, cy - r * 0.16);
  g.closePath();
}

/** ぶきの絵ひとつぶん。飛んでいく玉にも、手に持つ絵にも、同じものを使う */
function motifPath(g: CanvasRenderingContext2D, motif: WeaponMotif, cx: number, cy: number, r: number, rot: number): void {
  switch (motif) {
    case 'heart':
      heartPath(g, cx, cy, r);
      break;
    case 'bolt':
      boltPath(g, cx, cy, r);
      break;
    case 'star':
    default:
      starPath(g, cx, cy, r, rot);
      break;
  }
}

// ------------------------------------------------------------------ 持っている絵

/**
 * ぶきそのものを描く。中心 (cx, cy)・全長 len・かたむき angle。
 * きせかえのマス（大きく）にも、走っているキャラの手もと（小さく）にも使う。
 */
export function drawWeaponShape(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  len: number,
  id: string,
  t: number,
  angle?: number,
): void {
  const def = weaponDef(id);
  const L = len;
  g.save();
  g.translate(cx, cy);
  g.rotate(angle ?? def.hold);
  g.lineJoin = 'round';
  g.lineCap = 'round';

  switch (def.motif) {
    case 'fist': {
      // うでのついた こぶし。うしろに小さな噴射
      g.fillStyle = '#ffb03a';
      g.beginPath();
      g.moveTo(-L * 0.5, -L * 0.1);
      g.lineTo(-L * 0.5, L * 0.1);
      g.lineTo(-L * 0.28, L * 0.16);
      g.lineTo(-L * 0.28, -L * 0.16);
      g.closePath();
      g.fill();
      g.fillStyle = def.color;
      rr(g, -L * 0.3, -L * 0.24, L * 0.5, L * 0.48, L * 0.18);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.5)';
      rr(g, -L * 0.22, -L * 0.16, L * 0.16, L * 0.14, L * 0.06);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,.18)';
      g.lineWidth = Math.max(1, L * 0.035);
      for (let i = 0; i < 3; i++) {
        const y = -L * 0.13 + i * L * 0.13;
        g.beginPath();
        g.moveTo(L * 0.06, y);
        g.lineTo(L * 0.18, y);
        g.stroke();
      }
      break;
    }

    case 'beam': {
      // ちいさな ブラスター。にぎりと銃身だけの単純な形にする
      g.fillStyle = '#5a6a78';
      rr(g, -L * 0.34, -L * 0.02, L * 0.2, L * 0.34, L * 0.06);
      g.fill();
      g.fillStyle = def.color;
      rr(g, -L * 0.4, -L * 0.2, L * 0.7, L * 0.24, L * 0.08);
      g.fill();
      g.fillStyle = '#e9f6ff';
      rr(g, L * 0.24, -L * 0.15, L * 0.22, L * 0.14, L * 0.06);
      g.fill();
      g.fillStyle = def.glow;
      g.globalAlpha = 0.6 + Math.abs(Math.sin(t * 5)) * 0.4;
      g.beginPath();
      g.arc(L * 0.46, -L * 0.08, L * 0.08, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      break;
    }

    case 'arrow': {
      // ゆみ。弦は細く、矢は1本つがえておく
      g.strokeStyle = '#a9744a';
      g.lineWidth = Math.max(2, L * 0.09);
      g.beginPath();
      g.arc(L * 0.08, 0, L * 0.42, Math.PI * 0.62, Math.PI * 1.38);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.9)';
      g.lineWidth = Math.max(1, L * 0.03);
      g.beginPath();
      g.moveTo(L * 0.08 + Math.cos(Math.PI * 0.62) * L * 0.42, Math.sin(Math.PI * 0.62) * L * 0.42);
      g.lineTo(L * 0.08 + Math.cos(Math.PI * 1.38) * L * 0.42, Math.sin(Math.PI * 1.38) * L * 0.42);
      g.stroke();
      g.strokeStyle = def.color;
      g.lineWidth = Math.max(2, L * 0.07);
      g.beginPath();
      g.moveTo(-L * 0.32, 0);
      g.lineTo(L * 0.34, 0);
      g.stroke();
      g.fillStyle = def.glow;
      g.beginPath();
      g.moveTo(L * 0.46, 0);
      g.lineTo(L * 0.28, -L * 0.12);
      g.lineTo(L * 0.28, L * 0.12);
      g.closePath();
      g.fill();
      break;
    }

    case 'bubble': {
      // シャボンの ふきだし棒。先の輪から玉が出ている
      g.fillStyle = '#f0f6fa';
      rr(g, -L * 0.44, -L * 0.08, L * 0.5, L * 0.16, L * 0.07);
      g.fill();
      g.strokeStyle = def.color;
      g.lineWidth = Math.max(2, L * 0.08);
      g.beginPath();
      g.arc(L * 0.16, 0, L * 0.16, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 0.75;
      g.fillStyle = def.color;
      for (let i = 0; i < 3; i++) {
        const p = (t * 0.6 + i * 0.33) % 1;
        g.beginPath();
        g.arc(L * (0.3 + p * 0.3), -L * p * 0.3, L * 0.08 * (1 - p * 0.4), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      break;
    }

    case 'blade': {
      // ひかりの けん。刃は上向き
      g.fillStyle = '#7b8794';
      rr(g, -L * 0.09, L * 0.2, L * 0.18, L * 0.26, L * 0.07);
      g.fill();
      g.fillStyle = '#c9a13c';
      rr(g, -L * 0.26, L * 0.12, L * 0.52, L * 0.11, L * 0.05);
      g.fill();
      g.fillStyle = def.color;
      g.beginPath();
      g.moveTo(0, -L * 0.5);
      g.lineTo(L * 0.13, -L * 0.24);
      g.lineTo(L * 0.11, L * 0.12);
      g.lineTo(-L * 0.11, L * 0.12);
      g.lineTo(-L * 0.13, -L * 0.24);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.beginPath();
      g.moveTo(0, -L * 0.46);
      g.lineTo(L * 0.05, -L * 0.2);
      g.lineTo(L * 0.04, L * 0.1);
      g.lineTo(-L * 0.02, L * 0.1);
      g.closePath();
      g.fill();
      break;
    }

    case 'boomerang': {
      // 3日月の刃。まわりに うすい光
      g.rotate(t * 0.8);
      g.fillStyle = def.color;
      g.beginPath();
      g.arc(0, 0, L * 0.46, Math.PI * 0.15, Math.PI * 1.25);
      g.arc(0, 0, L * 0.26, Math.PI * 1.25, Math.PI * 0.15, true);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.7)';
      g.beginPath();
      g.arc(0, 0, L * 0.42, Math.PI * 0.25, Math.PI * 0.7);
      g.arc(0, 0, L * 0.33, Math.PI * 0.7, Math.PI * 0.25, true);
      g.closePath();
      g.fill();
      break;
    }

    case 'hammer': {
      g.strokeStyle = '#a9744a';
      g.lineWidth = Math.max(2, L * 0.11);
      g.beginPath();
      g.moveTo(0, L * 0.5);
      g.lineTo(0, -L * 0.16);
      g.stroke();
      g.fillStyle = def.color;
      rr(g, -L * 0.34, -L * 0.46, L * 0.68, L * 0.34, L * 0.1);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.45)';
      rr(g, -L * 0.28, -L * 0.4, L * 0.2, L * 0.12, L * 0.05);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,.15)';
      rr(g, -L * 0.34, -L * 0.2, L * 0.68, L * 0.08, L * 0.04);
      g.fill();
      break;
    }

    // つえ・ステッキ・ロッド。棒の先に 星／ハート／いなずま が付く
    default: {
      // 棒は白い紙の上（きせかえのマス）でも見えるところまで濃くする
      g.strokeStyle = '#9fb0bd';
      g.lineWidth = Math.max(2, L * 0.11);
      g.beginPath();
      g.moveTo(0, L * 0.5);
      g.lineTo(0, -L * 0.1);
      g.stroke();
      g.strokeStyle = '#e8eef3';
      g.lineWidth = Math.max(1, L * 0.045);
      g.beginPath();
      g.moveTo(-L * 0.015, L * 0.46);
      g.lineTo(-L * 0.015, -L * 0.06);
      g.stroke();
      const r = L * 0.26;
      const cy2 = -L * 0.26;
      g.fillStyle = def.glow;
      g.globalAlpha = 0.5 + Math.abs(Math.sin(t * 3)) * 0.3;
      g.beginPath();
      g.arc(0, cy2, r * 1.5, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = def.color;
      g.strokeStyle = 'rgba(255,255,255,.85)';
      g.lineWidth = Math.max(1, L * 0.045);
      motifPath(g, def.motif, 0, cy2, r, 0);
      g.fill();
      g.stroke();
      break;
    }
  }

  g.restore();
}

/**
 * キャラの手もとに持たせる。
 * x, y はキャラの箱の左上（sprites.ts の drawAccFront と同じ約束）。
 */
export function drawWeaponHeld(
  g: CanvasRenderingContext2D,
  id: string,
  x: number,
  y: number,
  s: number,
  t: number,
): void {
  const def = weaponDef(id);
  // 走るのに合わせて、手もとが小さく上下する
  const bob = Math.sin(t * 12) * s * 0.04;
  drawWeaponShape(g, x + s * 1.0, y + s * 0.66 + bob, s * 0.72, def.id, t);
}

/** きせかえのマス用。ぶき単体を大きく描く */
export function paintWeaponIcon(canvas: HTMLCanvasElement, id: string, size = 56): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  drawWeaponShape(g, size / 2, size / 2, size * 0.82, id, 0.4);
}

// ------------------------------------------------------------------ フィニッシュ

/** ため（光がふくらむ・まほうじんが出る・ハンマーが上がる） */
export const FIN_CHARGE = 0.62;
/** 飛んでいく／振りおろす */
export const FIN_FLY = 0.26;
/** 当たったあとの余韻。ここで帯とコインを見せる */
export const FIN_AFTER = 1.5;
export const FIN_TOTAL = FIN_CHARGE + FIN_FLY + FIN_AFTER;

export interface FinishView {
  /** フィニッシュが始まってからの秒数 */
  t: number;
  /** 画面の拡大率（runner の this.s） */
  s: number;
  /** 撃つ人の手もと */
  fromX: number;
  fromY: number;
  /** 相手のまんなか */
  toX: number;
  toY: number;
}

/** ためのあいだ、手もとに集まってくる光 */
function drawCharge(g: CanvasRenderingContext2D, def: WeaponDef, v: FinishView, k: number): void {
  const s = v.s;
  const r = (5 + k * 13) * s;
  const grad = g.createRadialGradient(v.fromX, v.fromY, 0, v.fromX, v.fromY, r * 1.9);
  grad.addColorStop(0, 'rgba(255,255,255,.95)');
  grad.addColorStop(0.45, def.glow);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.save();
  g.globalAlpha = 0.85;
  g.fillStyle = grad;
  g.beginPath();
  g.arc(v.fromX, v.fromY, r * 1.9, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // 吸いこまれてくる粒
  g.save();
  g.strokeStyle = def.glow;
  g.lineWidth = 2.4 * s;
  g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = v.t * 8 + (i * Math.PI * 2) / 6;
    const d = (34 - k * 24) * s;
    g.beginPath();
    g.moveTo(v.fromX + Math.cos(a) * d, v.fromY + Math.sin(a) * d * 0.7);
    g.lineTo(v.fromX + Math.cos(a) * (d - 8 * s), v.fromY + Math.sin(a) * (d - 8 * s) * 0.7);
    g.stroke();
  }
  g.restore();
}

/**
 * 空にかまえる高さ。
 * まほうじん も 振りかぶったハンマー もここに出す。画面の上に はみ出すと
 * 何をしているのか見えないので、canvas の中に必ず収める。
 */
function skyY(v: FinishView): number {
  return Math.max(v.toY - 72 * v.s, 34 * v.s);
}

/** 空にひらく まほうじん（rain のとき、相手の上に出る） */
function drawCircle(g: CanvasRenderingContext2D, def: WeaponDef, v: FinishView, k: number): void {
  const s = v.s;
  const cx = v.toX;
  const cy = skyY(v);
  const r = 30 * s * Math.min(1, k * 1.3);
  if (r <= 0) return;
  g.save();
  g.globalAlpha = Math.min(1, k * 2);
  g.translate(cx, cy);
  // 先に つぶしてから回す。順番が逆だと 輪が縦にも横にも見えて、
  // 空に浮かんだ「まほうじん」ではなく ただの ぐらぐらした楕円になる
  g.scale(1, 0.42);
  g.rotate(v.t * 2.2);
  g.strokeStyle = def.color;
  g.lineWidth = 3 * s;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = def.glow;
  g.lineWidth = 2 * s;
  g.setLineDash([6 * s, 5 * s]);
  g.beginPath();
  g.arc(0, 0, r * 0.72, 0, Math.PI * 2);
  g.stroke();
  g.restore();

  // つえから まほうじんへ のびる光
  g.save();
  g.globalAlpha = Math.min(1, k * 1.6) * 0.7;
  g.strokeStyle = def.glow;
  g.lineWidth = 3 * s;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(v.fromX, v.fromY);
  g.quadraticCurveTo((v.fromX + cx) / 2, cy - 10 * s, cx, cy);
  g.stroke();
  g.restore();
}

/** 飛んでいく本体 */
function drawFlying(g: CanvasRenderingContext2D, def: WeaponDef, v: FinishView, fly: number, after: number): void {
  const s = v.s;
  const dx = v.toX - v.fromX;
  const dy = v.toY - v.fromY;

  switch (def.style) {
    case 'shot': {
      const tipX = v.fromX + dx * fly;
      const tipY = v.fromY + dy * fly;
      const fade = Math.max(0, 1 - after / 0.4);
      if (fade <= 0) return;
      g.save();
      g.globalAlpha = fade;

      if (def.motif === 'beam') {
        const h = (9 + Math.sin(v.t * 40) * 2) * s;
        const glow = g.createLinearGradient(0, v.fromY - h * 2, 0, v.fromY + h * 2);
        glow.addColorStop(0, 'rgba(255,255,255,0)');
        glow.addColorStop(0.5, def.color);
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = glow;
        g.fillRect(v.fromX, v.fromY - h * 2, tipX - v.fromX, h * 4);
        g.fillStyle = 'rgba(255,255,255,.95)';
        g.fillRect(v.fromX, v.fromY - h * 0.5, tipX - v.fromX, h);
      } else {
        // 尾を引かせる。うしろに小さくなる玉を並べる
        g.fillStyle = def.glow;
        for (let i = 1; i <= 5; i++) {
          const p = Math.max(0, fly - i * 0.07);
          g.globalAlpha = fade * (0.4 - i * 0.06);
          g.beginPath();
          g.arc(v.fromX + dx * p, v.fromY + dy * p, (11 - i * 1.4) * s, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = fade;
        if (def.motif === 'bubble') {
          g.fillStyle = 'rgba(200,240,255,.55)';
          g.beginPath();
          g.arc(tipX, tipY, 15 * s, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = '#fff';
          g.lineWidth = 2 * s;
          g.stroke();
          g.fillStyle = 'rgba(255,255,255,.8)';
          g.beginPath();
          g.arc(tipX - 5 * s, tipY - 5 * s, 3.4 * s, 0, Math.PI * 2);
          g.fill();
        } else if (def.motif === 'arrow') {
          g.translate(tipX, tipY);
          g.rotate(Math.atan2(dy, dx));
          g.fillStyle = def.color;
          g.beginPath();
          g.moveTo(16 * s, 0);
          g.lineTo(0, -8 * s);
          g.lineTo(0, 8 * s);
          g.closePath();
          g.fill();
          g.strokeStyle = def.glow;
          g.lineWidth = 4 * s;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(-2 * s, 0);
          g.lineTo(-24 * s, 0);
          g.stroke();
        } else {
          // ロケットパンチ
          drawWeaponShape(g, tipX, tipY, 44 * s, def.id, v.t, Math.atan2(dy, dx));
        }
      }
      g.restore();
      break;
    }

    case 'slash': {
      // 斬りぬけた 光のすじ
      const fade = Math.max(0, 1 - after / 0.5);
      if (fade <= 0) return;
      g.save();
      g.globalAlpha = fade;
      g.strokeStyle = def.color;
      g.lineWidth = 8 * s;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(v.fromX, v.fromY + 14 * s);
      g.quadraticCurveTo((v.fromX + v.toX) / 2, v.fromY - 26 * s, v.fromX + dx * Math.max(fly, 0.2), v.toY);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.9)';
      g.lineWidth = 3 * s;
      g.stroke();
      g.restore();
      break;
    }

    case 'throw': {
      // 行きは 山なり、帰りは 手もとへ。当たったあとも まわりつづける
      const back = Math.max(0, Math.min(1, after / 0.6));
      const p = after > 0 ? 1 - back : fly;
      const arc = Math.sin(p * Math.PI) * 46 * s;
      const x = v.fromX + dx * p;
      const y = v.fromY + dy * p - arc;
      g.save();
      g.globalAlpha = after > 0 ? Math.max(0, 1 - back) : 1;
      g.strokeStyle = def.glow;
      g.lineWidth = 3 * s;
      for (let i = 1; i <= 4; i++) {
        const q = Math.max(0, p - i * 0.06);
        g.globalAlpha *= 0.75;
        g.beginPath();
        g.arc(v.fromX + dx * q, v.fromY + dy * q - Math.sin(q * Math.PI) * 46 * s, (14 - i * 2) * s, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = after > 0 ? Math.max(0, 1 - back) : 1;
      drawWeaponShape(g, x, y, 46 * s, def.id, v.t * 6);
      g.restore();
      break;
    }

    case 'smash': {
      // 上から たたきつける。当てたあとは しばらく のせたまま
      const drop = Math.min(1, fly + after * 2);
      const x = v.toX;
      const top = skyY(v) + 8 * s;
      const y = top + (v.toY - 22 * s - top) * drop;
      g.save();
      g.globalAlpha = Math.max(0, 1 - after / 0.8);
      drawWeaponShape(g, x, y, 78 * s, def.id, v.t, 0.15);
      g.restore();
      break;
    }

    // rain。まほうじんから 星／ハート／いなずま が落ちてくる
    default: {
      const cy = skyY(v);
      const y = cy + (v.toY - cy) * fly;
      const fade = Math.max(0, 1 - after / 0.5);
      if (fade <= 0) return;
      g.save();
      g.globalAlpha = fade;
      if (def.motif === 'bolt') {
        g.strokeStyle = def.color;
        g.lineWidth = 6 * s;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(v.toX, cy);
        let py = cy;
        for (let i = 0; i < 4 && py < y; i++) {
          py = Math.min(y, cy + ((y - cy) / 4) * (i + 1));
          g.lineTo(v.toX + (i % 2 ? 1 : -1) * 9 * s, py);
        }
        g.stroke();
        g.strokeStyle = 'rgba(255,255,255,.9)';
        g.lineWidth = 2.5 * s;
        g.stroke();
      } else {
        g.fillStyle = def.color;
        g.strokeStyle = 'rgba(255,255,255,.9)';
        g.lineWidth = 2.5 * s;
        motifPath(g, def.motif, v.toX, y, 20 * s, v.t * 5);
        g.fill();
        g.stroke();
      }
      g.restore();
      break;
    }
  }
}

/** 当たった瞬間から広がっていく印。ぶきごとに形が変わる */
function drawImpact(g: CanvasRenderingContext2D, def: WeaponDef, v: FinishView, after: number): void {
  const s = v.s;
  const k = Math.min(1, after / 0.55);
  const fade = Math.max(0, 1 - after / 0.75);
  if (fade <= 0) return;

  g.save();
  g.globalAlpha = fade;

  if (def.style === 'slash') {
    // ばってん の 斬りあと
    g.strokeStyle = '#fff';
    g.lineWidth = 9 * s * (1 - k * 0.5);
    g.lineCap = 'round';
    const r = (24 + k * 30) * s;
    for (const dir of [-1, 1]) {
      g.beginPath();
      g.moveTo(v.toX - r * dir, v.toY - r);
      g.lineTo(v.toX + r * dir, v.toY + r);
      g.stroke();
    }
    g.strokeStyle = def.color;
    g.lineWidth = 4 * s * (1 - k * 0.5);
    for (const dir of [-1, 1]) {
      g.beginPath();
      g.moveTo(v.toX - r * dir, v.toY - r);
      g.lineTo(v.toX + r * dir, v.toY + r);
      g.stroke();
    }
  } else {
    // ふくらむ 大きな しるし
    const r = (18 + k * 44) * s;
    g.globalAlpha = fade * 0.85;
    g.fillStyle = def.glow;
    if (def.motif === 'heart' || def.motif === 'bolt' || def.motif === 'star' || def.style === 'rain') {
      motifPath(g, def.motif, v.toX, v.toY, r, v.t * 2);
      g.fill();
    } else {
      g.beginPath();
      g.arc(v.toX, v.toY, r, 0, Math.PI * 2);
      g.fill();
    }
  }

  // 光の すじ。どのぶきでも共通で出す
  g.globalAlpha = fade * 0.9;
  g.strokeStyle = '#fff';
  g.lineWidth = 3.5 * s;
  g.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8 + 0.3;
    const d0 = (16 + k * 30) * s;
    const d1 = d0 + (16 + k * 26) * s;
    g.beginPath();
    g.moveTo(v.toX + Math.cos(a) * d0, v.toY + Math.sin(a) * d0);
    g.lineTo(v.toX + Math.cos(a) * d1, v.toY + Math.sin(a) * d1);
    g.stroke();
  }
  g.restore();
}

/**
 * フィニッシュの絵ぜんぶ。runner は毎フレームこれを呼ぶだけでよい。
 * 当たった判定（＝粒や音を出すタイミング）は runner が持つ。
 */
export function drawFinish(g: CanvasRenderingContext2D, def: WeaponDef, v: FinishView): void {
  if (v.t > FIN_TOTAL) return;
  const charge = Math.min(1, v.t / FIN_CHARGE);
  const fly = Math.max(0, Math.min(1, (v.t - FIN_CHARGE) / FIN_FLY));
  const after = Math.max(0, v.t - FIN_CHARGE - FIN_FLY);

  if (v.t < FIN_CHARGE) {
    if (def.style === 'rain') drawCircle(g, def, v, charge);
    else if (def.style === 'smash') {
      // ハンマーが 相手の上に 振りかぶられていく
      const top = skyY(v) + 8 * v.s;
      g.save();
      g.globalAlpha = Math.min(1, charge * 2);
      drawWeaponShape(g, v.toX, v.toY - 30 * v.s - (v.toY - 30 * v.s - top) * charge, 78 * v.s, def.id, v.t, 0.15 - charge * 0.5);
      g.restore();
      drawCharge(g, def, v, charge * 0.6);
    } else drawCharge(g, def, v, charge);
    return;
  }

  if (def.style === 'rain') drawCircle(g, def, v, 1);
  drawFlying(g, def, v, fly, after);
  if (after > 0) drawImpact(g, def, v, after);
}
