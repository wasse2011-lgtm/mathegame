/**
 * 1日にあそべる時間まわりの、画面に さわらない部分。
 * DOM を持たないので、CI（tools/verify-questions.mjs）から そのまま検査できる。
 */

/** おうちのかたが えらべる分数。0 は制限なし。以前の選択肢（10・15・20・30）は必ず残す */
export const LIMIT_CHOICES = [0, 10, 15, 20, 30, 45, 60, 90];

/** 「ふん」と「ぷん」。1・3・4・6・8・0 でおわる数は ぷん（いっぷん・じゅっぷん） */
export function minuteWord(n: number): string {
  return [1, 3, 4, 6, 8, 0].includes(n % 10) ? 'ぷん' : 'ふん';
}

/**
 * のこり秒 → 画面に出す分。くりあげにする。
 * のこり 1分10秒 は「2ふん」、さいごの 1分間が「1ぷん」。0 になるのは おわったときだけ。
 */
export function minutesLeft(sec: number): number {
  return Math.max(0, Math.ceil(sec / 60));
}

/** 「あと 12ふん」。制限なし（Infinity）なら '' */
export function remainText(sec: number): string {
  if (!Number.isFinite(sec)) return '';
  if (sec <= 0) return 'きょうは おしまい';
  const m = minutesLeft(sec);
  return `あと ${m}${minuteWord(m)}`;
}

export type TimeLevel = 'high' | 'mid' | 'low' | 'over';

/**
 * 時計の色。みどり → きいろ（半分をきった）→ あか（のこり 3分）→ おしまい。
 * あかは割合ではなく のこりの長さで決める。90分の設定で「2割」にすると
 * 18分も前から あかになり、急かす時間が長すぎる。
 */
export function timeLevel(sec: number, ratio: number): TimeLevel {
  if (sec <= 0) return 'over';
  if (sec <= 3 * 60) return 'low';
  return ratio <= 0.5 ? 'mid' : 'high';
}

/**
 * おうちのかたの関門の問題に使う組。2けた（12〜19）× 1けた（6〜9）で、こたえが 3けたのもの。
 *
 * 以前は 2けたの足し算だったが、このアプリは W8 で 2けたの足し算そのものを
 * 練習させる。遊びこんだ子ほど通れてしまうので、かけ算に替えた（2けた × 1けたは
 * 小学3年の内容）。こたえが 2けたの組（12 × 6 など）は、足し算を くりかえせば
 * 届いてしまうので外す。大人なら暗算で数秒。
 */
export const GATE_PAIRS: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  for (let a = 12; a <= 19; a++) {
    for (let b = 6; b <= 9; b++) if (a * b >= 100) out.push([a, b]);
  }
  return out;
})();

/** 関門の問題を1つ作る。引きなおしの ループを持たないので、どんな乱数でも必ず返る */
export function makeGate(rand: () => number = Math.random): { text: string; answer: number } {
  const i = Math.min(GATE_PAIRS.length - 1, Math.max(0, Math.floor(rand() * GATE_PAIRS.length)));
  const [a, b] = GATE_PAIRS[i];
  return { text: `${a} × ${b} = ?`, answer: a * b };
}

/** 全角の数字も受ける。日本語入力のまま打つと「１３６」になる */
export function toHalfWidth(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}
