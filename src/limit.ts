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

/**
 * 「あと 12ふん」。制限なし（Infinity）なら ''。
 * @param ended 0 になったときの ことば（タイマーなら「おしまい」）
 */
export function remainText(sec: number, ended = 'きょうは おしまい'): string {
  if (!Number.isFinite(sec)) return '';
  if (sec <= 0) return ended;
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

// ------------------------------------------------------------------ タイマー（いまから ○分）

/**
 * タイマーで えらべる分数。文字盤が 60分なので 60 まで。
 * 10分までは 1分きざみ（「あと 7ふんだけね」を そのまま かけられるように）、
 * そこから上は 5分きざみでは多すぎるので よく使う長さだけ
 */
export const TIMER_CHOICES = [5, 6, 7, 8, 9, 10, 15, 20, 30, 45, 60];

/**
 * 「のばす」ときの分数。おしまいの画面の関門と、かかっているタイマーの画面で使う。
 * のばすのは「あと ちょっと」なので、5〜10分を 1分きざみで
 */
export const EXTEND_CHOICES = [5, 6, 7, 8, 9, 10];

/**
 * 時間になっても、ステージやミニゲームの途中なら ここまでは待つ（秒）。
 * 待たないと 答えている途中の問題がミスとして残る。ただ ハードルのエンドレスは
 * 終わりがないので、待ちっぱなしにはしない
 */
export const GRACE_SEC = 180;

/**
 * 時計の おうぎ形。12時から 時計まわりに見て、のこり p（0〜1）のぶんを
 * 「針 → 12時」の あいだに塗る（タイムタイマーと同じ向き）。
 * 時間がたつと 針が 時計まわりに進み、12時に着いたら おしまい。
 */
export function wedgePath(cx: number, cy: number, r: number, p: number): string {
  const f = (n: number): string => n.toFixed(2);
  if (!(p > 0)) return '';
  if (p >= 0.9995) {
    return `M${f(cx)} ${f(cy - r)}A${f(r)} ${f(r)} 0 1 1 ${f(cx)} ${f(cy + r)}A${f(r)} ${f(r)} 0 1 1 ${f(cx)} ${f(cy - r)}Z`;
  }
  const a = (1 - p) * 2 * Math.PI;
  const x = cx + r * Math.sin(a);
  const y = cy - r * Math.cos(a);
  const large = p > 0.5 ? 1 : 0;
  return `M${f(cx)} ${f(cy)}L${f(x)} ${f(y)}A${f(r)} ${f(r)} 0 ${large} 1 ${f(cx)} ${f(cy - r)}Z`;
}

/** 針の向き（12時から 時計まわりの度）。のこり p のとき */
export function handAngle(p: number): number {
  return (1 - Math.min(1, Math.max(0, p))) * 360;
}

/**
 * タイマーの文字盤を ゆびで回したときの分数。
 * 文字盤は 60分で、12時が 0、反時計まわりに 5・10・15…（タイムタイマーと同じ）。
 * 10分までは 1分きざみ、そこから上は 5分きざみに丸め、5〜60 におさめる
 * （みじかい時間ほど 1分の差が大きい。えらべるボタンと同じ きざみ）。
 * 12時をまたいで 60 ⇄ 5 に跳ばないよう、前の値から 30分より大きく離れたら
 * 近いほうの はしに とどめる。
 */
export function dialMinutes(angleDeg: number, prev: number): number {
  const a = ((angleDeg % 360) + 360) % 360;
  // 12時の すぐ左（a が 360 に近い）は 0分に近い、すぐ右（a が 0 に近い）は 60分に近い
  const raw = (360 - a) / 6;
  let m = raw < 10.5 ? Math.round(raw) : Math.round(raw / 5) * 5;
  m = Math.min(60, Math.max(5, m));
  if (Math.abs(m - prev) > 30) m = prev > 30 ? 60 : 5;
  return m;
}
