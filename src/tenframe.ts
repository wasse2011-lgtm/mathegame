/**
 * 10マス（テンフレーム）の絵。
 *
 * 5歳が一人でも「どうしてその答えになるのか」を見て分かるようにするための図。
 * さくらんぼ（記号）だけだと、まだ記号を読めない子には届かない。
 *
 * どのモードでも **大きいほうの数を起点にする**。2 + 8 を「2 から 8 こ かぞえる」
 * と描くと、子どもが実際にやっている「8 から 2 こ かぞえる」と逆向きになる。
 *
 * DOM には触らない。文字列を返すだけなので、CI（verify）から絵の中身まで検査できる。
 */

import { cherry, type Cherry, type Fact } from './curriculum';

export type FrameMode = 'count' | 'tens' | 'make10' | 'carry' | 'place';

export interface FrameArt {
  mode: FrameMode;
  /** <svg> の中身。<svg> 自体は index.html 側にある */
  svg: string;
  /** そのまま setAttribute('viewBox', …) する。モードごとに変わる */
  viewBox: string;
  /** 図の下に出す ことば */
  text: string;
  /**
   * 最後のひと押し。「のこり 3 だから…？」のように、答えの一歩手前で止める。
   *
   * 以前はここに「わかった！」ボタンを置いていたが、押すためのボタンであって
   * 考えるための言葉ではなかった（押せば消えるだけ）。答えを言わずに
   * 「だから…？」で終える一文にしておくと、絵から答えまでを自分でつなぐことになる。
   */
  nudge: string;
  /** 使った枠の数。4つ以上になると答えボタンを画面の外へ押し出す */
  frames: number;
}

/** これより大きい和は図にしない。枠が4つ以上ならぶと画面に入らない */
export const PLACE_MAX = 30;

const CELL = 22;
const GAP = 3;
const COLS = 5;
const ROWS = 2;
const FRAME_W = COLS * CELL + (COLS - 1) * GAP; // 122
const FRAME_H = ROWS * CELL + GAP; //  47
const FRAME_GAP = 18;
const DOT = 8;

/**
 * マスの中身。
 *   a     … 起点（大きいほうの数）
 *   b     … あとから足す数
 *   move  … 「ここから となりの枠へ うつす」玉
 *   rest  … うつしたあとに のこる玉。さくらんぼの右の実と同じ色にする
 *   ghost … 「ここが あく」＝あと何こ要るか
 *   ''    … 空
 */
type Cell = 'a' | 'b' | 'move' | 'rest' | 'ghost' | '';

/** マスの並びを SVG にする。10こで1枠、足りないぶんは空マスで埋める */
function layout(cells: Cell[]): Pick<FrameArt, 'svg' | 'viewBox' | 'frames'> {
  const n = Math.max(1, Math.ceil(cells.length / 10));
  let svg = '';
  for (let i = 0; i < n * 10; i++) {
    const k = cells[i] ?? '';
    const j = i % 10;
    const x = Math.floor(i / 10) * (FRAME_W + FRAME_GAP) + (j % COLS) * (CELL + GAP);
    const y = Math.floor(j / COLS) * (CELL + GAP);
    svg +=
      `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="4"` +
      ` class="tf-cell${k === 'ghost' ? ' ghost' : ''}" />`;
    if (k && k !== 'ghost') {
      svg += `<circle cx="${x + CELL / 2}" cy="${y + CELL / 2}" r="${DOT}" class="tf-dot ${k}" />`;
    }
  }
  return { svg, viewBox: `0 0 ${n * FRAME_W + (n - 1) * FRAME_GAP} ${FRAME_H}`, frames: n };
}

const fill = (n: number, k: Cell): Cell[] => new Array(Math.max(0, n)).fill(k);

/** 枠と枠のあいだの矢印。「こっちへ うつす」を1本で言う */
function arrow(afterFrame: number): string {
  const x = afterFrame * FRAME_W + (afterFrame - 1) * FRAME_GAP;
  const y = FRAME_H / 2;
  const w = FRAME_GAP;
  return (
    `<path d="M ${x + w - 2} ${y} L ${x + 2} ${y}" class="tf-arrow" />` +
    `<path d="M ${x + 7} ${y - 5} L ${x + 2} ${y} L ${x + 7} ${y + 5}" class="tf-arrow" />`
  );
}

/**
 * 玉を n こ 置いただけの絵。ミニゲーム「いくつ？」で使う。
 *
 * show を false にすると、枠だけ同じ形で玉が消える。玉を隠すのに
 * 別の絵（幅のちがう空の枠）に差しかえると、隠した瞬間に絵がずれて
 * 「いま見たもの」と結びつかなくなる。
 */
export function dotsArt(n: number, show = true): Pick<FrameArt, 'svg' | 'viewBox' | 'frames'> {
  return layout(fill(n, show ? 'a' : ''));
}

/**
 * 「n を いくつと いくつに わける」の絵。玉を n こだけ1れつに並べる。
 *
 * ここで 10マスの枠を使うと、聞いていない残り7マスまで空きマスとして並び、
 * 「あと いくつ」を数えるつもりの子が 7 を数えてしまう。
 * 分けたい数のぶんだけ枠を出して、埋まっているほう（filled）を色つきにする。
 */
export function splitArt(total: number, filled: number): Pick<FrameArt, 'svg' | 'viewBox' | 'frames'> {
  const n = Math.max(1, total);
  let svg = '';
  for (let i = 0; i < n; i++) {
    const x = i * (CELL + GAP);
    const ghost = i >= filled;
    svg +=
      `<rect x="${x}" y="0" width="${CELL}" height="${CELL}" rx="4"` +
      ` class="tf-cell${ghost ? ' ghost' : ''}" />`;
    if (!ghost) {
      svg += `<circle cx="${x + CELL / 2}" cy="${CELL / 2}" r="${DOT}" class="tf-dot move" />`;
    }
  }
  return { svg, viewBox: `0 0 ${n * CELL + (n - 1) * GAP} ${CELL}`, frames: 1 };
}

// ------------------------------------------------------------ さくらんぼ

/**
 * さくらんぼ分解の絵。10マスと同じで、文字列を返すだけ。
 *
 * 見せたいのは「**どの数を、どこへ、いくつ わたすのか**」の1本の流れなので、
 * 式ごと1枚の絵にしてある。
 *
 *   ┌───┐        ⑤        ← 上の玉は「分けるほうの数」
 *   │ 8 │  ＋   ╱  ╲
 *   └───┘     ②    ③     ← 左（きいろ）を 8 にわたすと 10 になる
 *      ↖──────┘            ●●    ●●●   ← 数えられるように玉も置く
 *
 * 玉（.cy-dot）を置いてあるのは、数字がまだ「量」に結びついていない子でも
 * 数えれば同じ絵が読めるようにするため。10マスの絵と同じ考えかた。
 *
 * step は「どこまで分かったか」。
 *   0 … どちらも伏せる（? と点線）
 *   1 … わたす数だけ出す。矢印が出て、行き先が見える
 *   2 … 両方出して、左の箱が きりのいい数（10・20…）に変わる
 */
export interface CherryArt {
  svg: string;
  viewBox: string;
}

const CY_VIEWBOX = '0 0 240 162';

/** 玉のかたまり。5こずつ並べる（10マスと同じ区切りかたにする） */
function dotCluster(n: number, cx: number, y: number, cls: string): string {
  if (n <= 0) return '';
  const per = 5;
  const gapX = 11;
  const gapY = 11;
  let out = '';
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / per);
    const inRow = Math.min(n - row * per, per);
    const x = cx - ((inRow - 1) * gapX) / 2 + (i % per) * gapX;
    out += `<circle cx="${x}" cy="${y + row * gapY}" r="4.2" class="cy-dot ${cls}" />`;
  }
  return out;
}

export function cherryArt(c: Cherry, step: 0 | 1 | 2): CherryArt {
  const made = step >= 2;
  const text = (x: number, y: number, cls: string, s: string) =>
    `<text x="${x}" y="${y}" class="${cls}">${s}</text>`;

  // 左の箱。分かったところで「10（20…）ができた」に変わる
  let svg =
    `<rect x="12" y="8" width="72" height="48" rx="14" class="cy-box${made ? ' made' : ''}" />` +
    text(48, 33, 'cy-n big', String(made ? c.ten : c.base)) +
    text(100, 33, 'cy-op', '＋');

  // 分けるほうの数と、そこから伸びる枝
  svg +=
    `<line x1="152" y1="57" x2="106" y2="86" class="cy-branch" />` +
    `<line x1="152" y1="57" x2="198" y2="86" class="cy-branch" />` +
    `<circle cx="152" cy="32" r="25" class="cy-top" />` +
    text(152, 33, 'cy-n', String(c.other));

  // 左の玉（わたす数）。分かるまでは点線の「？」
  svg +=
    `<circle cx="104" cy="104" r="22" class="cy-leaf need${step >= 1 ? '' : ' unknown'}${made ? ' moved' : ''}" />` +
    text(104, 105, 'cy-n', step >= 1 ? String(c.need) : '?');
  if (step >= 1) svg += dotCluster(c.need, 104, 138, 'need');

  // 右の玉（のこり）
  svg +=
    `<circle cx="196" cy="104" r="22" class="cy-leaf rest${made ? '' : ' unknown'}" />` +
    text(196, 105, 'cy-n', made ? String(c.rest) : '?');
  if (made) svg += dotCluster(c.rest, 196, 138, 'rest');

  // 「こっちへ わたす」矢印。わたす数が分かってから出す
  if (step >= 1) {
    svg +=
      `<path d="M 82 100 Q 52 96 48 62" class="cy-arrow" />` +
      `<path d="M 42 70 L 48 58 L 54 70" class="cy-arrow head" />`;
  }

  return { svg, viewBox: CY_VIEWBOX };
}

/**
 * 式に合う絵を返す。図にできない式（けたが大きすぎる）は null。
 *
 * 判定はこの順。上にあるほど「その式で本当に見せたいこと」に近い。
 */
export function frameArt(fact: Fact, blank: boolean): FrameArt | null {
  const { a, b } = fact;
  const sum = a + b;
  const big = Math.max(a, b);
  const small = Math.min(a, b);

  // 「7 + ? = 10」「10 + ? = 13」。あと何こ要るかを、空きマスで見せる
  if (blank) {
    if (sum > PLACE_MAX) return null;
    const art = layout([...fill(a, 'a'), ...fill(sum - a, 'ghost')]);
    return {
      mode: 'make10',
      ...art,
      text: `${a} と いくつで ${sum}?`,
      nudge: 'あいてる ますは いくつ…？',
    };
  }

  // 1枠におさまる足し算。大きいほうを先に置いて、そこから数えさせる
  if (sum <= 10) {
    const art = layout([...fill(big, 'a'), ...fill(small, 'b')]);
    return {
      mode: 'count',
      ...art,
      text: `${big} から ${small} こ かぞえる`,
      nudge: 'ぜんぶで いくつ…？',
    };
  }

  // 10 と いくつ。10 のまとまりが1枠まるごとになるのを見せる
  if (big === 10 && small < 10) {
    const art = layout([...fill(10, 'a'), ...fill(small, 'b')]);
    return {
      mode: 'tens',
      ...art,
      text: `10 の まとまりと ${small}`,
      nudge: `10 と ${small} だから…？`,
    };
  }

  // 繰り上がり。一の位だけを2枠で描く。実数で描くと 39 + 9 が5枠になり画面に入らない
  const c = cherry(fact);
  if (c) {
    const ones = c.base % 10;
    // うつす玉（move・きいろ）と のこる玉（rest・みどり）を色で分ける。
    // さくらんぼの左右の実と同じ色にしてあるので、2つの絵が同じ話だと分かる
    const art = layout([
      ...fill(ones, 'a'),
      ...fill(c.need, 'ghost'),
      ...fill(c.need, 'move'),
      ...fill(c.rest, 'rest'),
    ]);
    return {
      mode: 'carry',
      svg: art.svg + arrow(1),
      viewBox: art.viewBox,
      frames: art.frames,
      text: `${c.base} に ${c.need} を あげて ${c.ten}、のこり ${c.rest}`,
      nudge: `${c.ten} と のこり ${c.rest} だから…？`,
    };
  }

  // 2けた。10 のまとまりが何こあるかを見せる
  if (sum <= PLACE_MAX) {
    const art = layout([...fill(big, 'a'), ...fill(small, 'b')]);
    const tens = Math.floor(sum / 10);
    const ones = sum % 10;
    // 「で 23」まで書くと答えそのものになる。絵の読みかた（まとまりが何こ）で止めて、
    // その先の「20 と 3 だから…？」を最後のひと言にする
    return {
      mode: 'place',
      ...art,
      text: ones > 0 ? `10 の まとまりが ${tens}こ と ${ones}` : `10 の まとまりが ${tens}こ`,
      nudge: ones > 0 ? `${tens * 10} と ${ones} だから…？` : `10 が ${tens}こ だから…？`,
    };
  }

  return null;
}
