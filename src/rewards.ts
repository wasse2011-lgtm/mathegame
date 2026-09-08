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
/**
 * にがて たいじ を やりきったごほうび。
 * デイリーより軽いのは、にがてが残っているかぎり何度でも挑めるから。
 * （倒した式は「にがて」から外れていくので、稼ぎ続けることはできない）
 */
export const COIN_HUNT = 30;
/**
 * ミニゲームを1回やりきったときのコイン。
 *
 * 1日1回めだけ多く、2回めからは少額。ミニゲームは何度でも遊べるので、
 * ここを一定にすると「いちばん短いミニゲームを回す」のがコインの最適解になり、
 * 走る理由が消える（ステージの周回に REPLAY_RATE を置いたのと同じ理由）。
 * それでも 2回め以降を 0 にはしない。0 だと「もう やっても むだ」になる。
 */
export const MINI_FIRST = 40;
export const MINI_AGAIN = 10;
/** ミニゲームを ひとつも まちがえずに やりきったときの上乗せ */
export const MINI_PERFECT = 15;

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

/**
 * ★3 を取り終えたステージを、もう一度あそんだときの倍率。
 *
 * ここまで全ワールド・全周回で同じ枚数を払っていたので、
 * 「いちばん速く終わる いちばん易しい面を回す」のが数え上げで最適だった。
 * 子どもはそれを見つけただけ。練習は自由にできるまま、周回だけ割に合わなくする。
 *
 * ワールドごとの倍率は World.coinRate（curriculum.ts）にある。
 * ここに id をキーにした表を置くと、ワールドの中身を入れかえたときに
 * 黙ってずれる（theme.ts の LANDS と同じ罠）。
 */
export const REPLAY_RATE = 0.4;

/** はじめて クリアした（★がついた）ときの上乗せ */
export const COIN_FIRST_CLEAR = 20;
/** はじめて ★3 を とったときの上乗せ */
export const COIN_FIRST_PERFECT = 40;

/** 倍率を掛けて整数にする。0枚にはしない（「もらった」という手ざわりが消える） */
export function scaled(base: number, rate: number): number {
  return base <= 0 ? 0 : Math.max(1, Math.round(base * rate));
}

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
  /** はじめての クリア／★3。周回では 0 */
  first: number;
  /** ぶつかって おとしたぶん（正の数で持つ） */
  lost: number;
}

export function gainTotal(g: CoinGain): number {
  return Math.max(0, g.correct + g.combo + g.weak + g.perfect + g.bonus + g.first - g.lost);
}
