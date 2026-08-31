/**
 * コインの値。
 *
 * 1問1枚だと、10問走っても「10」。増えた実感が出ないので、
 * 1ステージで 30〜100枚くらい動くようにしてある。数字が大きく動くほど、
 * リザルトのカウントアップは効く。たまごの値段も同じ倍率で上げてあるので、
 * 実際に手に入るきせかえの数は変わらない。
 */

/** 1問目から正解（初回で当てた）1問につき */
export const COIN_CORRECT = 3;
/** 5れんぞく以上でさらに1問につき */
export const COIN_COMBO = 3;
/** ノーミス（★3）のごほうび */
export const COIN_PERFECT = 30;
/** ボスステージのごほうび */
export const COIN_BOSS = 60;
/** きょうの5もんのごほうび */
export const COIN_DAILY = 60;
/** 時間切れでぶつかったとき落とす枚数 */
export const COIN_MISS = 3;
/** にがてな式（まちがえた回数の多い式）を、初回で正解したときの上乗せ */
export const COIN_WEAK = 3;

/**
 * 旧レート（1問1枚）からの倍率。
 * セーブに econ が無い＝旧レートで貯めたコインなので、読みこむときに掛けて
 * 買えるものの数を合わせる。
 */
export const COIN_SCALE = 3;

/** ステージ1回ぶんのコインの内訳。リザルトで1行ずつ見せる */
export interface CoinGain {
  /** せいかい */
  correct: number;
  /** れんぞく ボーナス */
  combo: number;
  /** にがて げきは */
  weak: number;
  /** ノーミス ボーナス */
  perfect: number;
  /** ボス／デイリー ボーナス */
  bonus: number;
  /** ぶつかって おとしたぶん（正の数で持つ） */
  lost: number;
}

export function gainTotal(g: CoinGain): number {
  return Math.max(0, g.correct + g.combo + g.weak + g.perfect + g.bonus - g.lost);
}
