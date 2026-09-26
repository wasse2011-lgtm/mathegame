/**
 * ぶき と フィニッシュ演出。
 *
 * ぶきは「強さ」ではなく「終わりかた」を えらぶもの。
 * 当たるかどうかの判定は無く、正解すれば必ず当たる。ゲームの難しさには
 * 一切ひびかない（きせかえの他の品と同じ扱い）。
 *
 * 効くのは1か所だけ:
 *   ステージ／きょうの もんだい／にがて たいじ の **さいごの1問**を当てたとき、
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
  /** ためて 撃つ（銃・ゆみや・ロケットパンチ・シャボン・しゅりけん） */
  | 'shot'
  /** 踏みこんで 斬る（けん・ドリル） */
  | 'slash'
  /** 投げて もどってくる（ブーメラン・ヨーヨー） */
  | 'throw'
  /** 上から たたく（ハンマー・ピコピコハンマー） */
  | 'smash'
  /** 空から ふらせる（つえ・ステッキ・ロッド・タクト） */
  | 'rain';

/** ぶきの形。1本につき1つ。持っている絵と、飛んでいく絵の両方に使う */
export type WeaponMotif =
  | 'fist' | 'beam' | 'arrow' | 'bubble' | 'blade' | 'boomerang' | 'hammer'
  | 'star' | 'heart' | 'bolt'
  | 'shuriken' | 'drill' | 'yoyo' | 'pico' | 'snow' | 'note'
  /** ぶき なし。手には何も持たず、からだごと ぶつかる */
  | 'none';

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
 * ロケットパンチだけ最初から持っている。
 *
 * 縦に長い ぶき（けん・ハンマー・つえ）の hold は **プラス**（先が 相手のほう＝右へ たおれる）。
 * マイナスにすると先が キャラの顔のほうへ たおれて、剣先や つえの光が
 * 右目・ほっぺに かぶる（キャラは右を向いていて、ぶきは顔の右はしで持つ）。
 * よこに長い ぶき（銃・こぶし）は 少しだけ上へ向けるので マイナスのまま。
 */
export const WEAPONS: WeaponDef[] = [
  { id: 'wp-punch', label: 'ロケットパンチ', note: 'こぶしが とんでいく', style: 'shot', motif: 'fist', color: '#f0803c', glow: '#ffd7ad', hold: -0.2, free: true },
  { id: 'wp-beam', label: 'ビームガン', note: 'まっすぐ うちぬく', style: 'shot', motif: 'beam', color: '#4fb8ee', glow: '#d8f4ff', hold: -0.25 },
  { id: 'wp-bow', label: 'ひかりの ゆみや', note: 'とおくから いぬく', style: 'shot', motif: 'arrow', color: '#6cbf5f', glow: '#e8ffdc', hold: 0 },
  { id: 'wp-bubble', label: 'シャボンほう', note: 'つつんで ぽん', style: 'shot', motif: 'bubble', color: '#8fd8f5', glow: '#ffffff', hold: -0.25 },
  { id: 'wp-sword', label: 'ひかりの けん', note: 'ひとふりで きりさく', style: 'slash', motif: 'blade', color: '#ffd75e', glow: '#fff6d0', hold: 0.5 },
  { id: 'wp-boomerang', label: 'ブーメランエッジ', note: 'とんで まわって もどる', style: 'throw', motif: 'boomerang', color: '#9fd8ff', glow: '#eaf8ff', hold: 0.25 },
  { id: 'wp-hammer', label: 'だいハンマー', note: 'とびかかって たたきつぶす', style: 'smash', motif: 'hammer', color: '#9aa7b4', glow: '#ffe3a8', hold: 0.55 },
  { id: 'wp-wand', label: 'まほうの つえ', note: 'ほしが ふってくる', style: 'rain', motif: 'star', color: '#b79ae0', glow: '#ffe9a8', hold: 0.4 },
  { id: 'wp-heart', label: 'ハートステッキ', note: 'ハートが はじける', style: 'rain', motif: 'heart', color: '#ff8fb1', glow: '#ffe1ec', hold: 0.4 },
  { id: 'wp-thunder', label: 'かみなりロッド', note: 'かみなりが おちる', style: 'rain', motif: 'bolt', color: '#ffd75e', glow: '#fff8d0', hold: 0.4 },
  // 型は いまの5つのまま、形（motif）で ちがいを出す。
  // 型を増やすと runner の うごき（ふみこみ・ため）まで作りなおしになる
  { id: 'wp-shuriken', label: 'しゅりけん', note: 'くるくる まわって ささる', style: 'shot', motif: 'shuriken', color: '#5b6b86', glow: '#dfe8f5', hold: 0 },
  { id: 'wp-drill', label: 'ドリル', note: 'まわって つきやぶる', style: 'slash', motif: 'drill', color: '#f2a23a', glow: '#fff0c8', hold: 0 },
  { id: 'wp-yoyo', label: 'ヨーヨー', note: 'のびて もどってくる', style: 'throw', motif: 'yoyo', color: '#e4675c', glow: '#ffe0dc', hold: 0 },
  { id: 'wp-pico', label: 'ピコピコハンマー', note: 'とびかかって ピコッと たたく', style: 'smash', motif: 'pico', color: '#ff6f6f', glow: '#fff3a8', hold: 0.55 },
  { id: 'wp-ice', label: 'こおりの つえ', note: 'ゆきの けっしょうが ふる', style: 'rain', motif: 'snow', color: '#7fd0f5', glow: '#e8faff', hold: 0.4 },
  { id: 'wp-note', label: 'おんぷの タクト', note: 'おんぷが ふってくる', style: 'rain', motif: 'note', color: '#ff9d3c', glow: '#fff1c8', hold: 0.4 },
];

/**
 * ぶき なし。きせかえの「なし」をえらぶと これになる（セーブの weapon は ''）。
 *
 * 手には何も持たないが、さいごの1問の フィニッシュそのものは消さない。
 * 消すと「なし」だけ さいごの1問で何も起きず、フィニッシュのコインも付かない
 * ＝ えらんだだけで損をする品になる。からだごと ぶつかる（slash と同じ ふみこみ）で しめくくる。
 * WEAPONS には入れない（ガチャの中身・あつめた数に数えない）。
 */
export const NO_WEAPON: WeaponDef = {
  id: '', label: 'たいあたり', note: 'からだごと ぶつかる', style: 'slash', motif: 'none', color: '#ff9f43', glow: '#fff1c4', hold: 0,
};

/** 最初から持っている1本。セーブに何も入っていないときの既定 */
export const DEFAULT_WEAPON = 'wp-punch';

/** id から ぶきを引く。'' は「なし」、知らない id は 最初の1本に落とす */
export function weaponDef(id: string): WeaponDef {
  if (id === '') return NO_WEAPON;
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

/** とがった先が n 本の星形。しゅりけん（4本）と ゆきの けっしょう（6本）に使う */
function spikePath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number, inner: number, rot: number): void {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI / n) * i - Math.PI / 2 + rot;
    const rad = i % 2 ? r * inner : r;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

/** 八分おんぷ。たま・ぼう・はた を1つの道にして、塗り1回で描けるようにする */
function notePath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const hx = cx - r * 0.2;
  const hy = cy + r * 0.52;
  g.beginPath();
  g.ellipse(hx, hy, r * 0.42, r * 0.31, -0.4, 0, Math.PI * 2);
  g.moveTo(hx + r * 0.26, hy);
  g.lineTo(hx + r * 0.26, cy - r);
  g.quadraticCurveTo(hx + r * 0.62, cy - r * 0.62, hx + r * 0.98, cy - r * 0.34);
  g.quadraticCurveTo(hx + r * 0.62, cy - r * 0.46, hx + r * 0.44, cy - r * 0.5);
  g.lineTo(hx + r * 0.44, hy);
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
    case 'shuriken':
      spikePath(g, cx, cy, r, 4, 0.34, rot);
      break;
    case 'snow':
      spikePath(g, cx, cy, r, 6, 0.46, rot);
      break;
    case 'note':
      notePath(g, cx, cy, r);
      break;
    case 'star':
    default:
      starPath(g, cx, cy, r, rot);
      break;
  }
}

/** ヨーヨーの本体。手に持つ絵（ひもつき）と、のびていく絵（ひもは別に引く）で共通 */
function yoyoDisc(g: CanvasRenderingContext2D, def: WeaponDef, cx: number, cy: number, r: number, t: number): void {
  g.fillStyle = def.color;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = def.glow;
  g.beginPath();
  g.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = def.color;
  for (let i = 0; i < 3; i++) {
    const a = t * 4 + (i * Math.PI * 2) / 3;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r * 0.36, cy + Math.sin(a) * r * 0.36, r * 0.13, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx, cy, r * 0.14, 0, Math.PI * 2);
  g.fill();
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
      // ゆみ。弓の しなりは 相手のほう（右）へ ふくらみ、弦は 手前（左）で
      // 矢を つがえて 引いている。以前は 弧と弦が 逆むき（弦が 相手がわ）だった
      const bx = -L * 0.16;
      const br = L * 0.42;
      const end = Math.PI * 0.36;
      const ex = bx + Math.cos(end) * br;
      const ey = Math.sin(end) * br;
      const nock = -L * 0.3;
      g.strokeStyle = '#a9744a';
      g.lineWidth = Math.max(2, L * 0.09);
      g.beginPath();
      g.arc(bx, 0, br, -end, end);
      g.stroke();
      // 弦は 両はしから 引いた手もとへ「く」の字。白い紙の上（きせかえのマス）でも
      // 暗くした空の前（カットイン）でも見える、中くらいの明るさにする
      g.strokeStyle = '#c9b48f';
      g.lineWidth = Math.max(1, L * 0.035);
      g.beginPath();
      g.moveTo(ex, -ey);
      g.lineTo(nock, 0);
      g.lineTo(ex, ey);
      g.stroke();
      g.strokeStyle = def.color;
      g.lineWidth = Math.max(2, L * 0.07);
      g.beginPath();
      g.moveTo(nock, 0);
      g.lineTo(L * 0.38, 0);
      g.stroke();
      g.fillStyle = def.glow;
      g.strokeStyle = def.color;
      g.lineWidth = Math.max(1, L * 0.025);
      g.beginPath();
      g.moveTo(L * 0.52, 0);
      g.lineTo(L * 0.34, -L * 0.12);
      g.lineTo(L * 0.34, L * 0.12);
      g.closePath();
      g.fill();
      g.stroke();
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

    case 'shuriken': {
      // 4まいの刃。持っているあいだも ゆっくり回して「まわるもの」だと見せる
      g.rotate(t * 1.5);
      g.fillStyle = def.color;
      motifPath(g, 'shuriken', 0, 0, L * 0.46, 0);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.4)';
      motifPath(g, 'shuriken', -L * 0.03, -L * 0.03, L * 0.28, 0);
      g.fill();
      g.fillStyle = def.glow;
      g.beginPath();
      g.arc(0, 0, L * 0.09, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2b3440';
      g.beginPath();
      g.arc(0, 0, L * 0.04, 0, Math.PI * 2);
      g.fill();
      break;
    }

    case 'drill': {
      // にぎり → つば → 先のとがった円すい。すじが流れて、回っているように見せる
      g.fillStyle = '#5a6a78';
      rr(g, -L * 0.48, -L * 0.1, L * 0.24, L * 0.2, L * 0.06);
      g.fill();
      g.fillStyle = '#9aa7b4';
      rr(g, -L * 0.27, -L * 0.22, L * 0.13, L * 0.44, L * 0.05);
      g.fill();
      const cone = (): void => {
        g.beginPath();
        g.moveTo(-L * 0.16, -L * 0.21);
        g.lineTo(L * 0.5, 0);
        g.lineTo(-L * 0.16, L * 0.21);
        g.closePath();
      };
      g.fillStyle = def.color;
      cone();
      g.fill();
      g.save();
      cone();
      g.clip();
      g.strokeStyle = 'rgba(255,255,255,.6)';
      g.lineWidth = Math.max(1, L * 0.05);
      const ph = (t * 2.5) % 1;
      for (let i = -1; i < 6; i++) {
        const x0 = -L * 0.16 + (i + ph) * L * 0.13;
        g.beginPath();
        g.moveTo(x0, L * 0.24);
        g.lineTo(x0 + L * 0.12, -L * 0.24);
        g.stroke();
      }
      g.restore();
      break;
    }

    case 'yoyo': {
      // 指にかけた ひもと、まるい本体。もようが回る
      const cx2 = L * 0.1;
      const cy2 = L * 0.12;
      const r = L * 0.3;
      g.strokeStyle = 'rgba(56,68,80,.7)';
      g.lineWidth = Math.max(1, L * 0.03);
      g.beginPath();
      g.moveTo(-L * 0.36, -L * 0.36);
      g.lineTo(cx2, cy2);
      g.stroke();
      yoyoDisc(g, def, cx2, cy2, r, t);
      break;
    }

    case 'pico': {
      // おもちゃの ハンマー。まんなかは じゃばら、両はしは きいろの ふた
      g.strokeStyle = '#ffd75e';
      g.lineWidth = Math.max(2, L * 0.12);
      g.beginPath();
      g.moveTo(0, L * 0.5);
      g.lineTo(0, -L * 0.16);
      g.stroke();
      g.fillStyle = def.color;
      rr(g, -L * 0.28, -L * 0.44, L * 0.56, L * 0.3, L * 0.06);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,.16)';
      g.lineWidth = Math.max(1, L * 0.03);
      for (let i = 1; i < 5; i++) {
        const x = -L * 0.28 + (L * 0.56 * i) / 5;
        g.beginPath();
        g.moveTo(x, -L * 0.42);
        g.lineTo(x, -L * 0.16);
        g.stroke();
      }
      g.fillStyle = '#ffd75e';
      rr(g, -L * 0.42, -L * 0.47, L * 0.16, L * 0.36, L * 0.07);
      g.fill();
      rr(g, L * 0.26, -L * 0.47, L * 0.16, L * 0.36, L * 0.07);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)';
      rr(g, -L * 0.2, -L * 0.4, L * 0.16, L * 0.08, L * 0.04);
      g.fill();
      break;
    }

    // ぶき なし。手には何も描かない
    case 'none':
      break;

    // つえ・ステッキ・ロッド・タクト。棒の先に 星／ハート／いなずま／けっしょう／おんぷ が付く
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
  drawWeaponShape(g, x + s * HELD_X, y + s * HELD_Y + bob, s * HELD_LEN, def.id, t);
}

/**
 * 手もとの置き場所（キャラの箱の左上から、大きさ s の何倍か）と、持っているときの長さ。
 * ハンマーの ふりおろし（smashPose）も ここから始まって ここへ戻るので、同じ数を使う
 */
const HELD_X = 1.0;
const HELD_Y = 0.66;
const HELD_LEN = 0.72;

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

/**
 * ため（光がふくらむ・まほうじんが出る・ハンマーが上がる）。
 *
 * ここは わざと長い。5歳には「いま なにが始まったのか」を飲みこむ間がいる。
 * 短いと、ぶきが出た・当たった・終わった が ひとかたまりになって、
 * 「じぶんの ぶきで たおした」ところだけが記憶に残らない。
 */
export const FIN_CHARGE = 0.88;
/** 飛んでいく／振りおろす */
export const FIN_FLY = 0.26;
/**
 * 当たった瞬間、絵をぴたりと止める時間（ヒットストップ）。
 * ここで一拍おくと、当たったコマそのものが目に焼きつく。
 */
export const FIN_STOP = 0.14;
/** 当たったあとの余韻。ここでコインを見せる */
export const FIN_AFTER = 1.5;
export const FIN_TOTAL = FIN_CHARGE + FIN_FLY + FIN_AFTER;

/** カットインが すべりこむ／出ている／引っこむ 時間 */
const CUT_IN = 0.16;
const CUT_HOLD = 0.42;
const CUT_OUT = 0.16;
/** カットインぜんぶ。ため（FIN_CHARGE）より短くしてある */
export const FIN_CUT_TOTAL = CUT_IN + CUT_HOLD + CUT_OUT;

export interface FinishView {
  /** フィニッシュが始まってからの秒数 */
  t: number;
  /** 画面の拡大率（runner の this.s） */
  s: number;
  /** canvas の大きさ。暗転とカットインの置き場所に使う */
  W: number;
  H: number;
  /** 撃つ人の手もと */
  fromX: number;
  fromY: number;
  /** 相手のまんなか */
  toX: number;
  toY: number;
  /**
   * 主人公が もともと立っている足もとの まんなか（ふみこみ・とびかかりの ずれを入れない）と、
   * 主人公の大きさ。ハンマーは ここから とびかかる
   */
  homeX: number;
  homeY: number;
  charSize: number;
  /**
   * 主人公が じぶんで とどめを刺しにいくか（ふつうの フィニッシュ）。
   * ボスの踏みつけでは false（主人公は踏みつけの動きをしていて、ハンマーを振れない）
   */
  leap: boolean;
}

/** ためのあいだ、手もと（ハンマーは 振りかぶった頭）に集まってくる光 */
function drawCharge(
  g: CanvasRenderingContext2D,
  def: WeaponDef,
  v: FinishView,
  k: number,
  x = v.fromX,
  y = v.fromY,
): void {
  const s = v.s;
  const r = (5 + k * 13) * s;
  // 光の広がりは 顔（手もとの左）まで とどかない大きさにとどめる。
  // 1.9 倍にしていたころは、ためきると 右目が 白く うもれていた
  const R = r * 1.5;
  const grad = g.createRadialGradient(x, y, 0, x, y, R);
  grad.addColorStop(0, 'rgba(255,255,255,.95)');
  grad.addColorStop(0.45, def.glow);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.save();
  g.globalAlpha = 0.85;
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, R, 0, Math.PI * 2);
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
    g.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7);
    g.lineTo(x + Math.cos(a) * (d - 8 * s), y + Math.sin(a) * (d - 8 * s) * 0.7);
    g.stroke();
  }
  g.restore();
}

/**
 * 空にかまえる高さ。
 * まほうじん（と、ボスの踏みつけで 上から のせるハンマー）をここに出す。
 * 画面の上に はみ出すと 何をしているのか見えないので、canvas の中に必ず収める。
 *
 * 下限が 46*s なのは カットインの板（画面の左上）より下に置くため。
 * ここを浅くすると、まほうじんが 板のうしろに隠れて、
 * いちばん見せたい「何が起きているか」が読めなくなる。
 */
function skyY(v: FinishView): number {
  return Math.max(v.toY - 72 * v.s, 46 * v.s);
}

// ------------------------------------------------------------------ ハンマーの ふりおろし

/*
 * ハンマー（smash）は 主人公が じぶんで振る。
 *
 * 以前は 相手の上に 大きなハンマーが浮かんで、ほぼ まっすぐ下へ落ちるだけだった。
 * 振りかぶりも 弧も無いので、「たたいた」ではなく「上から物が落ちてきた」に見える。
 * いまは次の順に動かす:
 *   1. 頭の上へ 振りかぶる（柄の下のほうへ持ちかえながら 大きくなる）
 *   2. ぐっと しゃがんで、さらに うしろへ引く（タメ）
 *   3. とびかかりながら、頭の上を通る大きな弧で 振りおろす（ここだけ速い）
 *   4. 当てたまま一拍おいて、はねかえって 元の場所へ もどる（持っている絵に戻る）
 *
 * 主人公の位置（smashLeap → runner の pxOff・py）と ハンマーの向き（smashPose）は
 * 同じ時間の式から出す。別々に動かすと、手もとと 柄が はなれる。
 * 振りかぶるときの にぎりは 頭の上に置く。手もと（顔の右はし）のまま頭の上へ振りかぶると、
 * 柄が 顔の前を横切る。
 */

/** 振りかぶりおわる秒数 */
const SM_RAISE = 0.42;
/** 放つ この秒数まえから しゃがんで、さらに引く */
const SM_CROUCH = 0.3;
/** 当てたあと、のせたまま止まっている秒数 */
const SM_PRESS = 0.22;
/** はねかえって 元の場所へ もどる秒数 */
const SM_BACK = 0.46;
/** 着地の しゃがみが もどる秒数 */
const SM_LAND = 0.2;
/** ここまでは フィニッシュの絵がハンマーを描く（runner は 手もとの絵を消す） */
const SM_END = FIN_CHARGE + FIN_FLY + SM_PRESS + SM_BACK + SM_LAND;

/**
 * 振るときの長さ（キャラの大きさの何倍か）。持っているとき（HELD_LEN）から ここまで大きくなる。
 * これより長くすると、横長の画面（空が 地面から 113*s しかない）で
 * 頭の上を通る いちばん高いところが 画面の上に はみ出す
 */
const SM_LEN = 1.45;
/** 振るときに にぎる所。ぶきの まんなかから 長さの何倍ぶん下か（柄の下のほう） */
const SM_GRIP = 0.44;
/** 振りかぶった かたむき（頭が うしろ上） */
const SM_UP = -0.55;
/** タメで さらに引いた かたむき */
const SM_PULL = -0.95;
/** たたきつけた かたむき。柄が ほぼ よこになり、頭の たたく面が 真下を向く */
const SM_HIT = Math.PI / 2 + 0.12;

/** にぎる所。キャラの足もとの まんなかから、大きさの何倍か（上がマイナス） */
const SM_AT_UP = { x: 0.16, y: -0.98 };
const SM_AT_HIT = { x: 0.45, y: -0.62 };
/** 頭の まんなか（ぶきの まんなかから 長さの何倍ぶん上か）。hammer も pico も同じ */
const SM_HEAD = 0.29;

const clamp01 = (k: number): number => Math.max(0, Math.min(1, k));
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);
const easeInOut = (k: number): number => k * k * (3 - 2 * k);

interface SmashPose {
  /** にぎる所（キャラの足もとの まんなかから、大きさの何倍か） */
  ax: number;
  ay: number;
  angle: number;
  /** 長さ（キャラの大きさの何倍か） */
  len: number;
  /** にぎる所が ぶきの まんなかから どれだけ下か（長さの何倍か） */
  grip: number;
  /** とびかかりの すすみぐあい。0 = 元の場所、1 = 当てる場所 */
  go: number;
  /** 山なりの高さ（キャラの大きさの何倍か。上がプラス） */
  hop: number;
  /** キャラの つぶれ（1 で そのまま、1 より小さいと しゃがむ） */
  squash: number;
}

/** t 秒めの かまえ。時間だけで決まる（位置は smashBody が 相手の場所から出す） */
function smashPose(def: WeaponDef, t: number): SmashPose {
  const heldX = HELD_X - 0.5;
  const heldY = HELD_Y - 1;
  const hit = FIN_CHARGE + FIN_FLY;
  const crouch = FIN_CHARGE - SM_CROUCH;

  if (t < crouch) {
    // 1. 振りかぶる。そのあとは 力をためて 小さく ふるえる
    const k = easeInOut(clamp01(t / SM_RAISE));
    const shake = t > SM_RAISE ? Math.sin(t * 46) * 0.035 : 0;
    return {
      ax: lerp(heldX, SM_AT_UP.x, k), ay: lerp(heldY, SM_AT_UP.y, k),
      angle: lerp(def.hold, SM_UP, k) + shake,
      len: lerp(HELD_LEN, SM_LEN, k), grip: lerp(0, SM_GRIP, k),
      go: 0, hop: 0, squash: 1,
    };
  }
  if (t < FIN_CHARGE) {
    // 2. しゃがんで、さらに うしろへ引く
    const k = easeOut((t - crouch) / SM_CROUCH);
    return {
      ax: SM_AT_UP.x, ay: SM_AT_UP.y, angle: lerp(SM_UP, SM_PULL, k),
      len: SM_LEN, grip: SM_GRIP, go: 0, hop: 0, squash: 1 - 0.15 * k,
    };
  }
  if (t < hit) {
    // 3. とびかかりながら 振りおろす。振りは あとになるほど速い
    //    （ふりはじめは重く、当たる直前がいちばん速い）
    const k = (t - FIN_CHARGE) / FIN_FLY;
    return {
      ax: lerp(SM_AT_UP.x, SM_AT_HIT.x, k), ay: lerp(SM_AT_UP.y, SM_AT_HIT.y, k),
      angle: lerp(SM_PULL, SM_HIT, k * k),
      len: SM_LEN, grip: SM_GRIP,
      go: easeOut(k), hop: Math.sin(k * Math.PI) * 0.2, squash: lerp(1.14, 1, k),
    };
  }
  const a = t - hit;
  if (a < SM_PRESS) {
    // 4. 当てたまま。すこし めりこんでから もどる
    return {
      ax: SM_AT_HIT.x, ay: SM_AT_HIT.y, angle: SM_HIT + Math.sin((a / SM_PRESS) * Math.PI) * 0.09,
      len: SM_LEN, grip: SM_GRIP, go: 1, hop: 0, squash: 1,
    };
  }
  if (a < SM_PRESS + SM_BACK) {
    // はねかえって 元の場所へ。ハンマーも 持っている絵の大きさ・向きへ もどしていく
    const k = easeInOut((a - SM_PRESS) / SM_BACK);
    return {
      ax: lerp(SM_AT_HIT.x, heldX, k), ay: lerp(SM_AT_HIT.y, heldY, k),
      angle: lerp(SM_HIT, def.hold, k),
      len: lerp(SM_LEN, HELD_LEN, k), grip: lerp(SM_GRIP, 0, k),
      go: 1 - k, hop: Math.sin(k * Math.PI) * 0.45, squash: 1,
    };
  }
  // 着地。しゃがんで もどる
  const k = clamp01((a - SM_PRESS - SM_BACK) / SM_LAND);
  return {
    ax: heldX, ay: heldY, angle: def.hold, len: HELD_LEN, grip: 0,
    go: 0, hop: 0, squash: 1 - 0.12 * (1 - k),
  };
}

/**
 * 当てたときに 主人公の足もとが どこまで行くか（元の場所からの ずれ）。
 * たたく面（頭の 前の面）が 相手の頭の上に来るところから 逆算する
 */
function smashReach(def: WeaponDef, v: FinishView): { x: number; y: number } {
  const size = v.charSize;
  const len = SM_LEN * size;
  const head = (SM_HEAD + SM_GRIP) * len;
  const face = (def.motif === 'pico' ? 0.42 : 0.34) * len;
  const sin = Math.sin(SM_HIT);
  const cos = Math.cos(SM_HIT);
  // にぎる所から たたく面までの ずれ
  const fx = head * sin + face * cos;
  const fy = -head * cos + face * sin;
  const footX = v.toX - fx - SM_AT_HIT.x * size;
  const footY = v.toY - size * 0.22 - fy - SM_AT_HIT.y * size;
  return {
    // 相手が近すぎても うしろへは とばない（その場で 振りおろす）
    x: Math.max(0, footX - v.homeX),
    y: Math.min(-size * 0.3, footY - v.homeY),
  };
}

/** t 秒めの 主人公の ずれと つぶれ */
function smashBody(def: WeaponDef, v: FinishView, t: number): { dx: number; dy: number; squash: number; pose: SmashPose } {
  const pose = smashPose(def, t);
  const reach = smashReach(def, v);
  return {
    dx: reach.x * pose.go,
    dy: reach.y * pose.go - pose.hop * v.charSize,
    squash: pose.squash,
    pose,
  };
}

/**
 * ハンマーで とびかかっている あいだの 主人公の ずれ（runner は pxOff・py・つぶれ に入れる）。
 * ハンマーでないとき・ボスの踏みつけのときは null（runner は いつもの動きのまま）
 */
export function smashLeap(def: WeaponDef, v: FinishView): { dx: number; dy: number; squash: number } | null {
  if (def.style !== 'smash' || !v.leap) return null;
  const b = smashBody(def, v, Math.min(v.t, SM_END));
  return { dx: b.dx, dy: b.dy, squash: b.squash };
}

/**
 * いま ぶきを フィニッシュの絵のほうで描いているか。
 * true のあいだは runner が キャラの手もとの ぶきを消す（2本に見えないように）
 */
export function finishHoldsWeapon(def: WeaponDef, v: FinishView): boolean {
  return def.style === 'smash' && v.leap && v.t < SM_END;
}

/** t 秒めの ハンマーの置き場所（画面の座標） */
function smashWorld(def: WeaponDef, v: FinishView, t: number) {
  const size = v.charSize;
  const b = smashBody(def, v, t);
  const { pose } = b;
  // つぶれは 足もとを中心に かかる（sprites.ts の drawChar と同じ）
  const px = v.homeX + b.dx + (pose.ax * size) / pose.squash;
  const py = v.homeY + b.dy + pose.ay * size * pose.squash;
  const len = pose.len * size;
  const sin = Math.sin(pose.angle);
  const cos = Math.cos(pose.angle);
  const toCenter = pose.grip * len;
  const toHead = (SM_HEAD + pose.grip) * len;
  return {
    /** にぎる所 */
    px, py,
    /** ぶきの まんなか（drawWeaponShape に渡す点） */
    cx: px + sin * toCenter,
    cy: py - cos * toCenter,
    /** 頭の まんなか */
    hx: px + sin * toHead,
    hy: py - cos * toHead,
    toHead, len, angle: pose.angle,
  };
}

/** 主人公が振る ハンマー。振りおろしている あいだは 残像と 弧のすじを うしろに引く */
function drawSmash(g: CanvasRenderingContext2D, def: WeaponDef, v: FinishView): void {
  if (v.t >= SM_END) return;
  const s = v.s;
  const now = smashWorld(def, v, v.t);
  const swing = FIN_CHARGE;
  const hit = FIN_CHARGE + FIN_FLY;

  if (v.t >= swing && v.t < hit + 0.14) {
    // 弧のすじ。頭が通ってきた道を 太い光で残す（速さを 形で見せる）
    // （当てたあとの めりこみで 向きが 行って戻るので、戻る向きのときは 引かない。
    //   逆向きに arc を引くと、ほぼ1周の輪になる）
    const from = smashPose(def, Math.max(swing, v.t - 0.12)).angle;
    const fade = v.t < hit ? 1 : 1 - (v.t - hit) / 0.14;
    if (now.angle > from + 0.02) {
      g.save();
      g.lineCap = 'round';
      for (const [w, color, alpha] of [[22, def.glow, 0.45], [9, '#ffffff', 0.85]] as const) {
        g.globalAlpha = alpha * fade;
        g.strokeStyle = color;
        g.lineWidth = w * s;
        g.beginPath();
        g.arc(now.px, now.py, now.toHead, from - Math.PI / 2, now.angle - Math.PI / 2);
        g.stroke();
      }
      g.restore();
    }

    // 残像。すこし前の ハンマーを うすく重ねる
    for (let i = 3; i >= 1; i--) {
      const t0 = v.t - i * 0.03;
      if (t0 < swing) continue;
      const w = smashWorld(def, v, t0);
      g.save();
      g.globalAlpha = 0.16 * (4 - i) * fade;
      drawWeaponShape(g, w.cx, w.cy, w.len, def.id, v.t, w.angle);
      g.restore();
    }
  }

  drawWeaponShape(g, now.cx, now.cy, now.len, def.id, v.t, now.angle);

  // ためのあいだ、振りかぶった頭に 光が集まる
  if (v.t < swing) {
    const k = clamp01((v.t - SM_RAISE * 0.5) / (swing - SM_RAISE * 0.5));
    if (k > 0) drawCharge(g, def, v, k * 0.7, now.hx, now.hy);
  }
}

// ------------------------------------------------------------------ 暗転とカットイン

/**
 * まわりを どれだけ暗くするか（0〜1）。
 * ためのあいだに 暗くなり、当たったあとの余韻でゆっくり戻る。
 */
export function finishDim(t: number): number {
  if (t <= 0) return 0;
  const rise = Math.min(1, t / (FIN_CHARGE * 0.75));
  const back = t - (FIN_CHARGE + FIN_FLY + 0.6);
  return back > 0 ? Math.max(0, rise * (1 - back / 0.55)) : rise;
}

/**
 * まわりを 暗くする。
 *
 * 景色を描いたあと、主人公と相手を描く **前** に呼ぶこと。そうすると
 * 暗くなるのは うしろの世界だけで、向かい合っている2人と ぶきの光は
 * 明るいまま残る。「どこを見ればいいか」が、字をひとつも出さずに決まる。
 */
export function drawFinishDim(g: CanvasRenderingContext2D, v: FinishView, k: number): void {
  if (k <= 0) return;
  const s = v.s;
  // 明かりは 相手のところに置く。主人公も ぶきの光も この暗幕より
  // あとに描かれるので、ここを暗くしても影響を受けない（暗くなるのは景色だけ）。
  // ＝「これから ここで 何かが起きる」を、指をささずに指させる
  const cx = v.toX;
  const cy = v.toY;
  const r = Math.min(150 * s, Math.max(v.W, v.H) * 0.62);

  g.save();
  g.translate(cx, cy);
  g.scale(1, 0.82);
  // グラデーションの座標は「いまの座標系」で読まれるので、つぶしたあとに作る
  const grad = g.createRadialGradient(0, 0, r * 0.16, 0, 0, r);
  grad.addColorStop(0, `rgba(8,13,26,${(0.06 * k).toFixed(3)})`);
  grad.addColorStop(0.55, `rgba(8,13,26,${(0.38 * k).toFixed(3)})`);
  grad.addColorStop(1, `rgba(8,13,26,${(0.66 * k).toFixed(3)})`);
  g.fillStyle = grad;
  // つぶしたぶん外へはみ出すので、画面より大きく敷く
  // （円のそとは いちばん外の色で塗られるので、これで四すみまで暗くなる）
  g.fillRect(-v.W * 2, -v.H * 3, v.W * 5, v.H * 7);
  g.restore();
}

/**
 * ぶきの名まえの カットイン。
 *
 * 画面をまたぐ帯は使わない。帯はいちばん見せたい「まほうじん」や
 * 「振りかぶったハンマー」の前に出てしまい、何で倒したのかが見えなくなる。
 * かわりに 左上の小さな板で名まえだけ言い、**放つ前に引っこむ**。
 * とどめの瞬間は、画面から字が消えている。
 *
 * t は カットインが出てからの秒数。
 */
export function drawFinishCutIn(
  g: CanvasRenderingContext2D,
  def: WeaponDef,
  v: FinishView,
  t: number,
): void {
  if (t < 0 || t > FIN_CUT_TOTAL) return;
  const s = v.s;
  const ease = (k: number): number => 1 - (1 - k) * (1 - k) * (1 - k);
  const inK = ease(Math.min(1, t / CUT_IN));
  const outK = ease(Math.max(0, Math.min(1, (t - CUT_IN - CUT_HOLD) / CUT_OUT)));
  const slide = inK - outK;
  if (slide <= 0) return;

  const h = Math.min(30 * s, v.H * 0.18);
  const edge = h * 0.18;   // ぶきの色の ふち（板の左はし）
  const pad = h * 0.24;
  const icon = h * 0.84;
  const size = h * 0.45;

  g.save();
  g.font = `700 ${size.toFixed(1)}px "Hiragino Maru Gothic ProN", sans-serif`;
  const text = g.measureText(def.label).width;
  const lead = edge + pad + icon + pad * 0.8;  // 名まえが始まる位置（板の左はしから）
  // 板は画面の左半分まで。ここを広げると、近くで止まった相手の頭にかぶる
  const w = Math.min(v.W * 0.46, lead + text + pad);
  const y = Math.min(8 * s, v.H * 0.05);
  const x = -w + (w + 9 * s) * slide;

  g.globalAlpha = Math.min(1, slide * 1.6);
  // 板。ぶきの色のふちを左に立てて、絵と名まえをひとつながりに見せる
  g.fillStyle = 'rgba(16,22,36,.88)';
  rr(g, x, y, w, h, h * 0.28);
  g.fill();
  g.fillStyle = def.color;
  rr(g, x, y, edge, h, edge * 0.5);
  g.fill();

  if (def.motif === 'none') {
    // ぶき なし は 持っている絵が無いので、当たるときの「ドン」を小さく出す
    g.fillStyle = def.glow;
    g.strokeStyle = def.color;
    g.lineWidth = Math.max(1, icon * 0.07);
    g.lineJoin = 'round';
    spikePath(g, x + edge + pad + icon / 2, y + h / 2, icon * 0.46, 9, 0.62, 0);
    g.fill();
    g.stroke();
  } else {
    drawWeaponShape(g, x + edge + pad + icon / 2, y + h / 2, icon, def.id, t * 3);
  }

  g.fillStyle = '#fff';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  // 名まえが長い ぶきでも板からはみ出さないところまで縮める
  const room = w - lead - pad;
  if (text > room && room > 0) {
    g.font = `700 ${(size * (room / text)).toFixed(1)}px "Hiragino Maru Gothic ProN", sans-serif`;
  }
  g.fillText(def.label, x + lead, y + h / 2 + h * 0.03);
  g.restore();
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
        } else if (def.motif === 'shuriken') {
          // むきは そろえず、くるくる回しながら まっすぐ とばす
          drawWeaponShape(g, tipX, tipY, 40 * s, def.id, 0, v.t * 20);
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
      if (def.motif === 'none') {
        // たいあたり。ふみこんだ からだの うしろに、よこの すじを引く
        // （fromX は ふみこんだ いまの手もと。うしろは 元の立ち位置まで）
        const tail = v.homeX - v.charSize * 0.3;
        const head = v.fromX - v.charSize * 1.3;
        if (head > tail) {
          g.strokeStyle = def.glow;
          g.lineCap = 'round';
          const mid = v.homeY - v.charSize * 0.5;
          for (const [off, w, back] of [[-0.3, 2.5, 0.3], [0, 5, 0], [0.3, 2.5, 0.2]] as const) {
            g.lineWidth = w * s;
            g.beginPath();
            g.moveTo(tail + (head - tail) * back, mid + off * v.charSize);
            g.lineTo(head, mid + off * v.charSize);
            g.stroke();
          }
        }
        g.restore();
        break;
      }
      if (def.motif === 'drill') {
        // ドリルは 斬らずに まっすぐ つく。弧ではなく よこ一直線の すじを引く
        const tip = v.fromX + dx * Math.max(fly, 0.2);
        g.strokeStyle = def.glow;
        g.lineCap = 'round';
        for (const [off, w] of [[-9, 2.5], [0, 5], [9, 2.5]] as const) {
          g.lineWidth = w * s;
          g.beginPath();
          g.moveTo(v.fromX, v.toY + off * s);
          g.lineTo(tip, v.toY + off * s);
          g.stroke();
        }
        g.restore();
        break;
      }
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
      const x0 = v.fromX + dx * p;
      const y0 = v.fromY + dy * p;
      g.save();
      g.globalAlpha = after > 0 ? Math.max(0, 1 - back) : 1;
      if (def.motif === 'yoyo') {
        // ヨーヨーは ひもで つながったまま まっすぐ のびて、まっすぐ もどる。
        // 手もとから のびる ひもが見えると「なげたのではなく のばした」と分かる
        g.strokeStyle = 'rgba(255,255,255,.9)';
        g.lineWidth = 2 * s;
        g.beginPath();
        g.moveTo(v.fromX, v.fromY);
        g.lineTo(x0, y0);
        g.stroke();
        yoyoDisc(g, def, x0, y0, 13 * s, v.t * 3);
        g.restore();
        break;
      }
      const arc = Math.sin(p * Math.PI) * 46 * s;
      const x = x0;
      const y = y0 - arc;
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
      // ふつうの フィニッシュは 主人公が じぶんで振る（drawSmash）
      if (v.leap) break;
      // ボスの踏みつけ。主人公は踏みつけの動きをしているので、上から のせるだけにする
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

/**
 * ためきる直前。相手のまわりで 輪がしぼんでいく。
 *
 * これが「タメ」の目に見えるぶん。つぎの瞬間どこで何が起きるかを
 * 先に指さしておくと、当たったところを見のがさない。
 * k は 0（出はじめ）〜1（放つ直前）。
 */
function drawLockOn(g: CanvasRenderingContext2D, def: WeaponDef, v: FinishView, k: number): void {
  if (k <= 0) return;
  const s = v.s;
  const r = (17 + (1 - k) * 54) * s;

  g.save();
  g.globalAlpha = Math.min(1, k * 1.6) * 0.9;
  g.strokeStyle = def.glow;
  g.lineWidth = 3 * s;
  g.setLineDash([7 * s, 6 * s]);
  g.lineDashOffset = -v.t * 44 * s;
  g.beginPath();
  g.arc(v.toX, v.toY, r, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);

  // 四すみの かぎかっこ。輪だけより「ねらっている」が強く出る
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2.6 * s;
  g.lineCap = 'round';
  const c = r * 0.8;
  const len = r * 0.36;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      g.beginPath();
      g.moveTo(v.toX + sx * c, v.toY + sy * (c - len));
      g.lineTo(v.toX + sx * c, v.toY + sy * c);
      g.lineTo(v.toX + sx * (c - len), v.toY + sy * c);
      g.stroke();
    }
  }
  g.restore();
}

/** 当たった瞬間から広がっていく印。ぶきごとに形が変わる */
function drawImpact(g: CanvasRenderingContext2D, def: WeaponDef, v: FinishView, after: number): void {
  const s = v.s;
  const k = Math.min(1, after / 0.55);
  const fade = Math.max(0, 1 - after / 0.75);
  if (fade <= 0) return;

  g.save();
  g.globalAlpha = fade;

  if (def.style === 'smash') {
    // 地面を つたわる ゆれ。たたきつけた重さを 足もとの輪で見せる
    g.strokeStyle = '#fff';
    g.lineWidth = 3.5 * s * (1 - k * 0.6);
    g.beginPath();
    g.ellipse(v.toX, v.homeY, (18 + k * 72) * s, (4 + k * 10) * s, 0, 0, Math.PI * 2);
    g.stroke();
  }

  if (def.motif === 'none') {
    // たいあたり。ぎざぎざの「ドン」が ふくらむ
    const r = (20 + k * 40) * s;
    g.fillStyle = def.glow;
    g.strokeStyle = def.color;
    g.lineWidth = 4 * s * (1 - k * 0.5);
    g.lineJoin = 'round';
    spikePath(g, v.toX, v.toY, r, 9, 0.62, v.t * 0.8);
    g.fill();
    g.stroke();
  } else if (def.motif === 'drill') {
    // うずまき。つきやぶった あとが まわりながら広がる
    g.strokeStyle = '#fff';
    g.lineWidth = 6 * s * (1 - k * 0.5);
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i <= 36; i++) {
      const a = i * 0.42 + v.t * 7;
      const d = (3 + i * 1.3) * s * (0.6 + k * 0.9);
      const px = v.toX + Math.cos(a) * d;
      const py = v.toY + Math.sin(a) * d;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    g.strokeStyle = def.color;
    g.lineWidth = 2.6 * s * (1 - k * 0.5);
    g.stroke();
  } else if (def.style === 'slash') {
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
    if (def.motif === 'heart' || def.motif === 'bolt' || def.motif === 'star' || def.motif === 'shuriken' || def.style === 'rain') {
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

  // ハンマーは 主人公が 振りかぶって・とびかかって・振りおろす（ため から 着地まで）
  const smash = def.style === 'smash' && v.leap;

  if (v.t < FIN_CHARGE) {
    if (def.style === 'rain') drawCircle(g, def, v, charge);
    else if (smash) drawSmash(g, def, v);
    else drawCharge(g, def, v, charge);
    // ための後半だけ、相手に照準を寄せる（タメの目に見えるぶん）
    drawLockOn(g, def, v, Math.max(0, (charge - 0.55) / 0.45));
    return;
  }

  if (def.style === 'rain') drawCircle(g, def, v, 1);
  drawFlying(g, def, v, fly, after);
  if (after > 0) drawImpact(g, def, v, after);
  // ハンマーは はじける光より手前。たたきつけた面が 光に うもれないように
  if (smash) drawSmash(g, def, v);
}
