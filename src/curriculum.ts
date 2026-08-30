/**
 * ワールド定義。レベルは「数が大きくなる」ではなく、算数のつまずきポイントで区切る。
 * とくに W3(10の合成) と W5(繰り上がり) は独立させ、そこだけ繰り返し遊べるようにする。
 */

export interface Fact {
  a: number;
  b: number;
}

export interface World {
  id: number;
  name: string;
  desc: string;
  /** ステージ1で、障害物が届くまでの秒数。ステージが進むと少しずつ短くなる。 */
  answerTime: number;
  /** 選択肢の数 */
  choices: 3 | 4;
  /** 通常ステージ数（この次がボスステージ） */
  stages: number;
  /** true なら「7 + ? = 10」形式で、たす数のほうを問う */
  blank?: boolean;
  facts: Fact[];
}

export const QUESTIONS_PER_STAGE = 10;
export const QUESTIONS_PER_BOSS = 15;

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

export const WORLDS: World[] = [
  {
    id: 1,
    name: 'はじまりの のはら',
    desc: 'こたえが 5 まで',
    answerTime: 7.0,
    choices: 3,
    stages: 8,
    facts: build((a, b) => a + b <= 5, 4, 4, 1, 1),
  },
  {
    id: 2,
    name: 'そよかぜ の おか',
    desc: 'こたえが 10 まで',
    answerTime: 6.5,
    choices: 3,
    stages: 8,
    facts: build((a, b) => a + b >= 6 && a + b <= 10, 9, 9, 1, 1),
  },
  {
    id: 3,
    name: '10 の とびら',
    desc: '10 に するには あと いくつ',
    answerTime: 6.0,
    choices: 3,
    stages: 8,
    // 答えが必ず 10 になるので、ふつうに出すと式を読まずに 10 を押せてしまう。
    // 「7 + ? = 10」の形にして、分解そのものを問う。
    blank: true,
    facts: build((a, b) => a + b === 10, 9, 9, 1, 1),
  },
  {
    id: 4,
    name: 'じゅう の まち',
    desc: '10 と いくつ',
    answerTime: 6.0,
    choices: 3,
    stages: 8,
    facts: build((a) => a === 10, 10, 9, 10, 1),
  },
  {
    id: 5,
    name: 'くりあがり やま',
    desc: 'こたえが 11 〜 18',
    answerTime: 6.5,
    choices: 4,
    stages: 8,
    facts: build((a, b) => a + b >= 11 && a + b <= 18, 9, 9, 2, 2),
  },
  {
    id: 6,
    name: 'ふたけた かいがん',
    desc: '2けた + 1けた（くりあがり なし）',
    answerTime: 5.8,
    choices: 4,
    stages: 8,
    facts: build((a, b) => !carry(a, b), 39, 8, 11, 1),
  },
  {
    id: 7,
    name: 'あらしの みさき',
    desc: '2けた + 1けた（くりあがり あり）',
    answerTime: 6.2,
    choices: 4,
    stages: 8,
    facts: build((a, b) => carry(a, b), 39, 9, 11, 2),
  },
  {
    id: 8,
    name: 'そらの ちょうじょう',
    desc: '2けた + 2けた',
    answerTime: 6.6,
    choices: 4,
    stages: 8,
    facts: build((a, b) => !carry(a, b) && a + b <= 79, 39, 39, 11, 11),
  },
];

export interface Cherry {
  /** きりのいい数にするために足す数 */
  need: number;
  /** 残り */
  rest: number;
  /** 足したあとにできる、きりのいい数。9+4 なら 10、27+8 なら 30 */
  ten: number;
}

/**
 * 繰り上がりの式を「きりのいい数をつくる」形に分解する（さくらんぼ計算）。
 *   9 + 4  → 9 に 1 を あげて 10、のこり 3
 *   27 + 8 → 27 に 3 を あげて 30、のこり 5
 * 繰り上がらない式と、足すとちょうど切りのいい数になる式（ヒントが答えそのもの）は null。
 */
export function cherry(f: Fact): Cherry | null {
  const ones = f.a % 10;
  if (ones === 0) return null;
  const need = 10 - ones;
  const rest = f.b - need;
  if (rest <= 0) return null;
  return { need, rest, ten: f.a - ones + 10 };
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

/** そのワールドで最後のステージ番号（＝ボス） */
export function bossStage(w: World): number {
  return w.stages + 1;
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
  const t = Math.max(w.answerTime - step * 0.14, w.answerTime * 0.62);
  return slow ? t * 1.6 : t;
}

/**
 * ボスに挑めるか。通常ステージをただ通過するだけでなく、★の合計で見る。
 * ★の下限は1なので、当てずっぽうで通過し続けた子は 8★ しか集まらず、
 * ここで足が止まる（ゲームオーバーにはせず、前のステージをやり直せばよい）。
 */
export function bossRequirement(w: World): number {
  return Math.ceil(w.stages * 1.5);
}
