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

import { cherry, type Fact } from './curriculum';

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
 *   ghost … 「ここが あく」＝あと何こ要るか
 *   ''    … 空
 */
type Cell = 'a' | 'b' | 'move' | 'ghost' | '';

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
    const art = layout([
      ...fill(ones, 'a'),
      ...fill(c.need, 'ghost'),
      ...fill(c.need, 'move'),
      ...fill(c.rest, 'b'),
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
