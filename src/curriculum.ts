/**
 * ワールド定義。レベルは「数が大きくなる」ではなく、算数のつまずきポイントで区切る。
 * とくに W3(10の合成) と W5(繰り上がり) は独立させ、そこだけ繰り返し遊べるようにする。
 */

export interface Fact {
  a: number;
  b: number;
}

/**
 * ヒントの出しかた。
 *   always … 問題が出た時点から見えている（はじめて習うところ）
 *   stuck  … 詰まったときだけ出る（いままでの挙動）
 *   none   … 自動では出ないし、ヒントボタンも押せない（しあげ）
 */
export type HintPolicy = 'always' | 'stuck' | 'none';

/**
 * ステージ1つぶん＝公文のプリント1枚にあたる小ステップ。
 *
 * 以前は8ステージが全部おなじ問題プールから引いていたので、
 * 「＋2 → ＋2のおおきいかず → ＋3」のような段階が作れなかった。
 */
export interface Step {
  /** マップのマスに出る名まえ。「＋2」「9に たす」「しあげ」など */
  name: string;
  facts: Fact[];
  /** 省略時は 'stuck'（いままでどおり、詰まったときだけ） */
  hint?: HintPolicy;
  /** この小ステップだけ「10 + ? = 13」形式にする。省略時は World.blank */
  blank?: boolean;
  /**
   * 障害物が届くまでの秒数。省略時はワールドの逓減式。
   * 後半の小ステップは内容そのものが難しくなるので、時間まで最短にすると
   * 難易度の崖ができる。必要なところだけ秒数を買いもどすための逃げ道。
   */
  time?: number;
}

export interface World {
  id: number;
  name: string;
  desc: string;
  /** マップでの目じるし。「どんな場所か」を一目で分ける */
  emoji: string;
  /** マップの見出しやステージの道に使う色 */
  color: string;
  /** ステージ1で、障害物が届くまでの秒数。ステージが進むと少しずつ短くなる。 */
  answerTime: number;
  /** 選択肢の数 */
  choices: 3 | 4;
  /**
   * コインの倍率。やさしいワールドを周回して稼げないようにする。
   * ここではなく rewards.ts に id をキーにした表を置くと、ワールドの中身を
   * 入れかえたときに黙ってずれる（theme.ts の LANDS と同じ罠）。
   */
  coinRate: number;
  /** true なら「7 + ? = 10」形式で、たす数のほうを問う */
  blank?: boolean;
  /**
   * 通常ステージ。**かならず8つ**。
   *
   * ★は "${worldId}-${stage}" で保存され、ボスは steps.length + 1 番。
   * ここの数を変えると、旧セーブの「3-7」が新しいボスとして読まれて
   * 進捗が壊れる。数を変えたくなったら save.ts に移行処理が要る。
   */
  steps: Step[];
}

export const QUESTIONS_PER_STAGE = 10;

/**
 * ボス戦の問題数。
 *
 * ボスは1問でも落とすとその場で負けなので、通常ステージより長くしない。
 * 15問のノーミスは6歳には遠すぎて、挑む前にあきらめる。10問なら
 * 「あと3つ」が見えるところまで必ず届く。
 * 内訳は 遠距離攻撃6発 → 1割はやい攻撃3発 → 最後に突撃1回。
 */
export const QUESTIONS_PER_BOSS = 10;

/** 終盤（攻撃が1割はやくなる）に入る問題数。突撃をふくめた最後の4問 */
export const BOSS_RUSH_TAIL = 4;

/** 終盤で攻撃が何倍はやくなるか */
export const BOSS_RUSH_RATE = 1.1;

export function factKey(f: Fact): string {
  return `${f.a}+${f.b}`;
}

function build(pred: (a: number, b: number) => boolean, aMax: number, bMax: number, aMin = 0, bMin = 0): Fact[] {
  const out: Fact[] = [];
  for (let a = aMin; a <= aMax; a++) {
    for (let b = bMin; b <= bMax; b++) {
      if (pred(a, b)) out.push({ a, b });
    }
  }
  return out;
}

const carry = (a: number, b: number) => (a % 10) + (b % 10) >= 10;

/** プールの中から、条件に合う式だけ取り出す（小ステップを書くための道具） */
function only(pool: Fact[], pred: (a: number, b: number) => boolean): Fact[] {
  return pool.filter((f) => pred(f.a, f.b));
}

// 各ワールドの全問題。小ステップはここから切り出す。
// 最後の2ステップを丸ごと使うので、和集合はかならず元のプールと一致する
// （ずかんの81マスは W1+W2+W3+W5 でちょうど埋まる、という前提が崩れない）。
const P1 = build((a, b) => a + b <= 5, 4, 4, 1, 1);
const P2 = build((a, b) => a + b >= 6 && a + b <= 10, 9, 9, 1, 1);
const P3 = build((a, b) => a + b === 10, 9, 9, 1, 1);
// 「10 と いくつ」。10+n だけだと式を読まずに「1x」と答えられるので、
// n+10 の向きも入れて、どちらの数が 10 なのかを見させる。
const P4 = [...build((a) => a === 10, 10, 9, 10, 1), ...build((_, b) => b === 10, 9, 10, 1, 10)];
const P5 = build((a, b) => a + b >= 11 && a + b <= 18, 9, 9, 2, 2);
const P6 = build((a, b) => !carry(a, b), 39, 8, 11, 1);
const P7 = build((a, b) => carry(a, b), 39, 9, 11, 2);
const P8 = build((a, b) => !carry(a, b) && a + b <= 79, 39, 39, 11, 11);

export const WORLDS: World[] = [
  {
    id: 1,
    emoji: '🌱',
    color: '#5fb85f',
    name: 'はじまりの のはら',
    desc: 'こたえが 5 まで',
    answerTime: 7.0,
    choices: 3,
    coinRate: 0.6,
    steps: [
      { name: '＋1', facts: only(P1, (_, b) => b === 1), hint: 'always' },
      { name: '1と いくつ', facts: only(P1, (a) => a === 1), hint: 'always' },
      { name: '＋2', facts: only(P1, (_, b) => b === 2) },
      { name: '2と いくつ', facts: only(P1, (a) => a === 2) },
      { name: '＋3・＋4', facts: only(P1, (_, b) => b >= 3) },
      { name: '3と 4と', facts: only(P1, (a) => a >= 3) },
      { name: 'まぜこぜ', facts: P1 },
      { name: 'しあげ', facts: P1, hint: 'none' },
    ],
  },
  {
    id: 2,
    emoji: '🍃',
    color: '#3fae8e',
    name: 'そよかぜ の おか',
    desc: 'こたえが 10 まで',
    answerTime: 6.5,
    choices: 3,
    coinRate: 0.8,
    // 公文の「たす1 → たす2 → …」に合わせて、たす数を1つずつ上げていく
    steps: [
      { name: '＋1', facts: only(P2, (_, b) => b === 1), hint: 'always' },
      { name: '＋2', facts: only(P2, (_, b) => b === 2) },
      { name: '＋3', facts: only(P2, (_, b) => b === 3) },
      { name: '＋4', facts: only(P2, (_, b) => b === 4) },
      { name: '＋5', facts: only(P2, (_, b) => b === 5) },
      { name: '＋6・＋7', facts: only(P2, (_, b) => b === 6 || b === 7) },
      { name: '＋8・＋9', facts: only(P2, (_, b) => b >= 8) },
      { name: 'しあげ', facts: P2, hint: 'none' },
    ],
  },
  {
    id: 3,
    emoji: '🚪',
    color: '#e08a29',
    name: '10 の とびら',
    desc: '10 に するには あと いくつ',
    // ここが一番きつい。穴埋め形式そのものが重いので、ワールドの持ち時間を
    // W1 と同じところまで戻し、10マスの絵も前半は出しっぱなしにする。
    answerTime: 7.0,
    choices: 3,
    coinRate: 1.0,
    // 答えが必ず 10 になるので、ふつうに出すと式を読まずに 10 を押せてしまう。
    // 「7 + ? = 10」の形にして、分解そのものを問う。
    blank: true,
    // 9通りしかないので、ペアを2つずつ足していく形にする。
    // 「9 + ? = 10」（答えが 1）だけは、1 より小さい正の整数が無いせいで
    // かならず最小の選択肢になる。単独で1ステップにすると「いちばん小さいのを押す」
    // だけで通ってしまうので、答えの大きい式と必ず混ぜる。
    steps: [
      { name: '1と9・2と8', facts: only(P3, (a) => a === 1 || a === 2 || a === 5), hint: 'always' },
      { name: '3と7・4と6', facts: only(P3, (a) => a === 3 || a === 4 || a === 5), hint: 'always' },
      { name: '5と5・6と4', facts: only(P3, (a) => a >= 3 && a <= 6), hint: 'always' },
      { name: '7と3・8と2', facts: only(P3, (a) => a === 7 || a === 8 || a === 2 || a === 3 || a === 5) },
      { name: '9と1', facts: only(P3, (a) => a === 9 || a === 1 || a === 8 || a === 2 || a === 5) },
      { name: 'まぜこぜ', facts: P3 },
      { name: 'はやく', facts: P3 },
      { name: 'しあげ', facts: P3, hint: 'none' },
    ],
  },
  {
    id: 4,
    emoji: '🏙️',
    color: '#4a8fd6',
    name: 'じゅう の まち',
    desc: '10 と いくつ',
    // 一番やさしいところなので、時間は締めて選択肢も4つにする
    answerTime: 5.5,
    choices: 4,
    coinRate: 0.7,
    steps: [
      { name: '10と 1〜5', facts: only(P4, (a, b) => a === 10 && b <= 5), hint: 'always' },
      { name: '10と 6〜9', facts: only(P4, (a, b) => a === 10 && b >= 6) },
      { name: 'いれかえ 1〜5', facts: only(P4, (a, b) => b === 10 && a <= 5), hint: 'always' },
      { name: 'いれかえ 6〜9', facts: only(P4, (a, b) => b === 10 && a >= 6) },
      // 逆から問う。答えが 1〜9 に散るので、当てずっぽうに強い
      { name: '10と ?で', facts: only(P4, (a) => a === 10), blank: true },
      { name: 'まぜこぜ', facts: P4 },
      { name: 'はやく', facts: P4 },
      { name: 'しあげ', facts: P4, hint: 'none' },
    ],
  },
  {
    id: 5,
    emoji: '⛰️',
    color: '#9a6fd0',
    name: 'くりあがり やま',
    desc: 'こたえが 11 〜 18',
    answerTime: 6.5,
    choices: 4,
    coinRate: 1.3,
    // 「大きいほうから数える」を身につけるところ。9 を起点にする式から入る
    steps: [
      { name: '9に たす', facts: only(P5, (a) => a === 9), hint: 'always' },
      { name: '9を たす', facts: only(P5, (_, b) => b === 9), hint: 'always' },
      { name: '8に たす', facts: only(P5, (a) => a === 8) },
      { name: '8を たす', facts: only(P5, (_, b) => b === 8) },
      { name: '7と いくつ', facts: only(P5, (a, b) => a === 7 || b === 7) },
      { name: '6・5と いくつ', facts: only(P5, (a) => a === 6 || a === 5) },
      { name: 'まぜこぜ', facts: P5 },
      { name: 'しあげ', facts: P5, hint: 'none' },
    ],
  },
  {
    id: 6,
    emoji: '🏖️',
    color: '#2fa9c4',
    name: 'ふたけた かいがん',
    desc: '2けた + 1けた（くりあがり なし）',
    answerTime: 5.8,
    choices: 4,
    coinRate: 1.4,
    steps: [
      { name: '10だい', facts: only(P6, (a) => a <= 19), hint: 'always' },
      { name: '20だい', facts: only(P6, (a) => a >= 20 && a <= 29) },
      { name: '30だい', facts: only(P6, (a) => a >= 30) },
      { name: '＋1・＋2', facts: only(P6, (_, b) => b <= 2) },
      { name: '＋3・＋4', facts: only(P6, (_, b) => b === 3 || b === 4) },
      { name: '＋5・＋6', facts: only(P6, (_, b) => b === 5 || b === 6) },
      { name: '＋7・＋8', facts: only(P6, (_, b) => b >= 7) },
      { name: 'しあげ', facts: P6, hint: 'none' },
    ],
  },
  {
    id: 7,
    emoji: '🌩️',
    color: '#6b7ac9',
    name: 'あらしの みさき',
    desc: '2けた + 1けた（くりあがり あり）',
    answerTime: 6.2,
    choices: 4,
    coinRate: 1.6,
    steps: [
      { name: '10だい', facts: only(P7, (a) => a <= 19), hint: 'always' },
      { name: '20だい', facts: only(P7, (a) => a >= 20 && a <= 29) },
      { name: '30だい', facts: only(P7, (a) => a >= 30) },
      { name: '＋9', facts: only(P7, (_, b) => b === 9) },
      { name: '＋8', facts: only(P7, (_, b) => b === 8) },
      { name: '＋7・＋6', facts: only(P7, (_, b) => b === 6 || b === 7) },
      { name: 'まぜこぜ', facts: P7 },
      { name: 'しあげ', facts: P7, hint: 'none' },
    ],
  },
  {
    id: 8,
    emoji: '☁️',
    color: '#e0648c',
    name: 'そらの ちょうじょう',
    desc: '2けた + 2けた',
    answerTime: 6.6,
    choices: 4,
    coinRate: 1.8,
    steps: [
      { name: '10だい どうし', facts: only(P8, (a, b) => a <= 19 && b <= 19), hint: 'always' },
      { name: '10だいと 20だい', facts: only(P8, (a, b) => Math.min(a, b) <= 19 && Math.max(a, b) <= 29) },
      { name: '20だい どうし', facts: only(P8, (a, b) => a <= 29 && b <= 29) },
      { name: '30だいが でる', facts: only(P8, (a, b) => a >= 30 || b >= 30) },
      { name: '一のくらいが おおきい', facts: only(P8, (a, b) => (a % 10) + (b % 10) >= 7) },
      { name: 'まぜこぜ', facts: P8 },
      { name: 'はやく', facts: P8 },
      { name: 'しあげ', facts: P8, hint: 'none' },
    ],
  },
];

/**
 * デイリーチャレンジ（きょうの 5もん）専用のワールド。
 *
 * 式は weakestFacts() が解放済みの全ワールドから苦手な順に選ぶので facts は空でよい。
 * ここでワールドを借りると choices と blank まで借りてしまい、W3（10 のとびら）まで
 * 進んだ子のデイリーが、W1 の式まで「2 + ? = 5」の穴埋めに化ける。穴埋めは
 * たし算ではなく 10 の分解を問う別のスキルなので、復習のつもりが未習の形式になる。
 *
 * 選択肢は 3。デイリーは苦手な式ばかりが並ぶので、当てにくさより「毎日ひらく」を優先する。
 */
export const DAILY_WORLD: World = {
  id: 0,
  emoji: '📅',
  color: '#e8a33d',
  name: 'きょうの 5もん',
  desc: 'にがてな しきを 5もん',
  answerTime: 7.0,
  choices: 3,
  coinRate: 1,
  steps: [{ name: 'きょうの 5もん', facts: [] }],
};

export interface Cherry {
  /** 起点。ここを きりのいい数まで もっていく（＝大きいほうの数） */
  base: number;
  /** 分けるほうの数（小さいほう） */
  other: number;
  /** きりのいい数にするために base へ足す数 */
  need: number;
  /** other の のこり */
  rest: number;
  /** 足したあとにできる、きりのいい数。9+4 なら 10、27+8 なら 30 */
  ten: number;
}

/**
 * 繰り上がりの式を「きりのいい数をつくる」形に分解する（さくらんぼ計算）。
 *   9 + 4  → 9 に 1 を あげて 10、のこり 3
 *   27 + 8 → 27 に 3 を あげて 30、のこり 5
 * 繰り上がらない式と、足すとちょうど切りのいい数になる式（ヒントが答えそのもの）は null。
 *
 * 起点は必ず大きいほう。ここを a で決め打ちにすると、4 + 9 が
 * 「4 に 6 を あげて 10」になる。子どもが実際にやっているのは
 * 「9 から 4 こ かぞえる」なので、教わっている手順と逆向きのヒントになってしまう。
 */
export function cherry(f: Fact): Cherry | null {
  const base = Math.max(f.a, f.b);
  const other = Math.min(f.a, f.b);
  const ones = base % 10;
  if (ones === 0) return null;
  // 繰り上がるかどうかは「一の位どうしの和」で決まる。other そのものの大きさで
  // 見ると、34 + 31（4 + 1 で繰り上がらない）まで対象に入り、
  // 「31 を 6 と 25 に分ける」という、元の式より難しいヒントになる。
  if (ones + (other % 10) < 10) return null;
  const need = 10 - ones;
  const rest = other - need;
  if (rest <= 0) return null;
  return { base, other, need, rest, ten: base - ones + 10 };
}

/** たしざん図鑑の一辺。1〜9 の 9×9 = 81 マス */
export const ZUKAN_MAX = 9;

/**
 * たしざん図鑑のマス。1〜9 どうしの 81 通り。
 * W1・W2・W3・W5 を合わせるとちょうどこの 81 枚が埋まる。
 */
export const BASIC_FACTS: Fact[] = build(() => true, ZUKAN_MAX, ZUKAN_MAX, 1, 1);

export function worldById(id: number): World {
  return WORLDS.find((w) => w.id === id) ?? WORLDS[0];
}

/** 通常ステージの数 */
export function stageCount(w: World): number {
  return w.steps.length;
}

/** ステージ番号（1始まり）の小ステップ。ボス・デイリーでは null */
export function stepOf(w: World, stage: number): Step | null {
  return w.steps[stage - 1] ?? null;
}

/**
 * ワールド全体の式。小ステップが重なっても factKey で1つにまとめる。
 * 重複を残すと、ボスのプールでその式だけ重みが2倍になり、
 * ずかんの枚数の勘定も合わなくなる。
 */
const ALL_FACTS = new WeakMap<World, Fact[]>();
export function allFacts(w: World): Fact[] {
  let out = ALL_FACTS.get(w);
  if (!out) {
    const seen = new Set<string>();
    out = [];
    for (const st of w.steps) {
      for (const f of st.facts) {
        const k = factKey(f);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(f);
        }
      }
    }
    ALL_FACTS.set(w, out);
  }
  return out;
}

/** そのステージで出す式。ボスは全ステップの和集合 */
export function factsFor(w: World, stage: number): Fact[] {
  return stepOf(w, stage)?.facts ?? allFacts(w);
}

/** その問題形式。小ステップの指定がワールドの既定に優先する */
export function blankFor(w: World, stage: number): boolean {
  return stepOf(w, stage)?.blank ?? Boolean(w.blank);
}

/** ヒントの出しかた。ボス・デイリーは 'stuck'（負ける前の最後の助け） */
export function hintPolicyFor(w: World, stage: number): HintPolicy {
  return stepOf(w, stage)?.hint ?? 'stuck';
}

/** そのワールドで最後のステージ番号（＝ボス） */
export function bossStage(w: World): number {
  return w.steps.length + 1;
}

export function isBoss(w: World, stage: number): boolean {
  return stage === bossStage(w);
}

export function questionCount(w: World, stage: number): number {
  return isBoss(w, stage) ? QUESTIONS_PER_BOSS : QUESTIONS_PER_STAGE;
}

/**
 * ステージごとの制限時間（秒）。奥に進むほど少し短くなるが、
 * 短くしすぎると「考える」より「当てる」ゲームになるので下限を置く。
 */
export function answerTimeFor(w: World, stage: number, slow: boolean): number {
  // デイリー（stage = 0）は「ステージ1と同じ」扱いにする
  const step = Math.max(stage, 1) - 1;
  const fixed = stepOf(w, stage)?.time;
  const t = fixed ?? Math.max(w.answerTime - step * 0.14, w.answerTime * 0.62);
  return slow ? t * 1.6 : t;
}

/**
 * ボスに挑めるか。通常ステージをただ通過するだけでなく、★の合計で見る。
 * ★の下限は1なので、当てずっぽうで通過し続けた子は 8★ しか集まらず、
 * ここで足が止まる（ゲームオーバーにはせず、前のステージをやり直せばよい）。
 */
export function bossRequirement(w: World): number {
  return Math.ceil(w.steps.length * 1.5);
}
