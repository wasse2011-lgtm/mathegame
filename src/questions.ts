/**
 * 出題エンジン。
 * ・習熟度が低い式を優先しつつ、間違えた式は数問あとに必ず戻す
 * ・誤答の選択肢は「実際に子どもがする間違い」から作る（＋1、繰り上げ忘れ、引いた答え…）
 * ・正解が毎回いちばん大きい数にならないよう、上と下に必ず散らす
 */

import { type Fact, factKey } from './curriculum';
import { factStat, peekFact } from './save';

export interface Question {
  fact: Fact;
  answer: number;
  choices: number[];
  /** 画面に出す式。「7 + 5 = ?」または「7 + ? = 10」 */
  text: string;
  /** 空欄が「たす数」のほう（10の合成で使う） */
  blank: boolean;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface Distractor {
  v: number;
  /** 小さいほど「ありがちな間違い」。選ぶときはこの順を優先する。 */
  tier: number;
}

function distractorPool(a: number, b: number, sum: number): Distractor[] {
  const pool: Distractor[] = [];
  const push = (v: number, tier: number) => {
    if (v > 0 && v !== sum && !pool.some((d) => d.v === v)) pool.push({ v, tier });
  };

  push(sum + 1, 1); // 数えまちがい（最頻出）
  push(sum - 1, 1);
  if ((a % 10) + (b % 10) >= 10) push(sum - 10, 1); // 繰り上げ忘れ
  push(sum + 2, 2);
  push(sum - 2, 2);
  // 記号の読みまちがい。2けたでは答えが遠すぎて誤答として機能しないので 1けた同士だけ。
  if (a !== b && a < 10 && b < 10) push(Math.abs(a - b), 2);
  // 十の位のつけまちがい。答えが小さいうちは「1+1 に 12」のように明らかすぎるので出さない
  if (sum >= 8) push(sum + 10, 3);
  push(sum + 3, 4);
  push(sum - 3, 4);
  push(sum + 4, 5);
  push(sum - 4, 5);

  return pool;
}

/**
 * 「7 + ? = 10」形式の誤答。たす数そのものを間違える形にする。
 *
 * この形式だけは、正解の位置を一様にしきれない。答えが 1 のとき（9 + ? = 10）、
 * 1 より小さい正の整数が無いので、正解が必ずいちばん小さい選択肢になる。
 * 10 の合成は 9 通りで、そのうち 1 通りがこれに当たるため、
 * 「いちばん小さいのを押す」だけで (1 + 8/3) / 9 = 40.7% 当たる。
 *
 * b - 2、b - 3 のような下側の候補を足しても直らない（1 の下に置ける数が無い）。
 * ここを 33.3% に近づけるには 0 を選択肢に許すしかなく、それは
 * 「9 + 0 = 10」を子どもに見せるかどうかの判断になる。いまは許していない。
 * verify の A) はこの 40.7% を下限として見張っている。
 */
function blankPool(a: number, b: number, sum: number): Distractor[] {
  const pool: Distractor[] = [];
  const push = (v: number, tier: number) => {
    if (v > 0 && v !== b && !pool.some((d) => d.v === v)) pool.push({ v, tier });
  };

  push(b + 1, 1);
  push(b - 1, 1);
  push(sum, 2); // 「こたえ」のほうを書いてしまう（10 の合成でいちばん多い）
  push(a, 2); // たされる数と取りちがえる
  push(b + 2, 3);
  push(b - 2, 3);
  push(b + 3, 4);
  push(b + 4, 5);

  return pool;
}

/** tier 順を保ちつつ、同じ tier の中だけランダムにする */
function byTier(list: Distractor[]): number[] {
  return list
    .map((d) => ({ d, k: d.tier + Math.random() * 0.9 }))
    .sort((x, y) => x.k - y.k)
    .map((x) => x.d.v);
}

/**
 * 選択肢を作る。
 *
 * ここは一度しくじっている。「いちばん大きいのが正解」を封じようとして
 * 上下にひとつずつ置いたら、今度は正解がほぼ必ず「まんなかの大きさ」になり、
 * 計算せずに中くらいのボタンを押すだけで 9割 当たるようになっていた。
 *
 * なので順位そのものを先に決める。正解が下から何番目になるかを毎回
 * 一様ランダムに引き、その形になるように誤答を選ぶ。
 */
function buildChoices(answer: number, pool: Distractor[], count: number): number[] {
  const above = byTier(pool.filter((d) => d.v > answer));
  const below = byTier(pool.filter((d) => d.v < answer));
  const need = count - 1;

  let wantBelow = Math.min(Math.floor(Math.random() * count), below.length, need);
  let wantAbove = Math.min(need - wantBelow, above.length);
  // 片側が足りなければ、もう片側で埋める
  wantBelow = Math.min(need - wantAbove, below.length);

  const picks = [...below.slice(0, wantBelow), ...above.slice(0, wantAbove)];

  // それでも足りなければ候補全体から、最後は答えの近くの数で埋める
  for (const v of byTier(pool)) {
    if (picks.length >= need) break;
    if (!picks.includes(v)) picks.push(v);
  }
  for (let pad = 1; picks.length < need; pad++) {
    for (const v of [answer + pad, answer - pad]) {
      if (picks.length < need && v > 0 && v !== answer && !picks.includes(v)) picks.push(v);
    }
  }

  return [...picks, answer];
}

export class QuestionPicker {
  private recent: string[] = [];
  private review: { fact: Fact; due: number }[] = [];
  private asked = 0;
  /** 正解が同じ位置に並び続けないようにする */
  private lastSlots: number[] = [];

  constructor(private pool: Fact[], private choiceCount: number, private blank = false) {}

  private weight(f: Fact): number {
    const s = peekFact(factKey(f));
    if (s.m <= 1) return 6; // まだ身についていない
    if (s.m <= 3) return 3; // 途中
    return 1; // 得意（気持ちよく走らせるためのごほうび問題）
  }

  private pickFact(): Fact {
    const due = this.review.findIndex((r) => r.due <= this.asked);
    if (due >= 0) {
      const [item] = this.review.splice(due, 1);
      return item.fact;
    }

    const fresh = this.pool.filter((f) => !this.recent.includes(factKey(f)));
    const candidates = fresh.length ? fresh : this.pool;

    let total = 0;
    const weights = candidates.map((f) => {
      const w = this.weight(f);
      total += w;
      return w;
    });

    let r = Math.random() * total;
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  next(): Question {
    const fact = this.pickFact();
    const sum = fact.a + fact.b;
    // 「10 の合成」は答えが必ず 10 なので、ふつうに出すと式を読まなくても当たる。
    // たす数のほうを空欄にして、分解そのものを問う。
    const answer = this.blank ? fact.b : sum;
    const text = this.blank ? `${fact.a} + ? = ${sum}` : `${fact.a} + ${fact.b} = ?`;
    const pool = this.blank
      ? blankPool(fact.a, fact.b, sum)
      : distractorPool(fact.a, fact.b, sum);
    const choices = buildChoices(answer, pool, this.choiceCount);

    shuffle(choices);
    // 3回続けて同じ位置に正解が来たら、隣と入れ替える
    let slot = choices.indexOf(answer);
    if (this.lastSlots.length >= 2 && this.lastSlots.every((s) => s === slot)) {
      const other = (slot + 1) % choices.length;
      [choices[slot], choices[other]] = [choices[other], choices[slot]];
      slot = other;
    }
    this.lastSlots.push(slot);
    if (this.lastSlots.length > 2) this.lastSlots.shift();

    this.recent.push(factKey(fact));
    if (this.recent.length > 3) this.recent.shift();
    this.asked++;

    return { fact, answer, choices, text, blank: this.blank };
  }

  /** 間違えた式は 2問後と 5問後に戻す */
  markWrong(fact: Fact): void {
    this.review.push({ fact, due: this.asked + 2 });
    this.review.push({ fact, due: this.asked + 5 });
  }
}

/** 習熟度 4 以上を「おぼえた」とみなす（図鑑のカードが光る境目） */
export const MASTERED = 4;

/**
 * 正解／不正解を習熟度に反映する。戻り値は「いま初めておぼえた」かどうか。
 *
 * 速く答えたら +2 にしていたが、それだと 3択でまぐれ当たり2回でも
 * 「おぼえた」になってしまい、図鑑も親向けの数字も当てにならなかった。
 * 上げ幅は必ず +1 で、4回きれいに正解して初めて「おぼえた」。
 * 速さは ms（平均解答時間）のほうにだけ反映する。
 */
export function recordAnswer(fact: Fact, ok: boolean, ms: number): boolean {
  const s = factStat(factKey(fact));
  const before = s.m;
  s.seen++;
  if (ok) {
    s.m = Math.min(5, s.m + 1);
    s.ms = s.ms ? Math.round(s.ms * 0.7 + ms * 0.3) : ms;
  } else {
    s.m = Math.max(0, s.m - 2);
    s.miss++;
  }
  return before < MASTERED && s.m >= MASTERED;
}

/**
 * デイリーチャレンジ用に「いま苦手な式」を選ぶ。
 * 一度でも出した式を習熟度の低い順に取り、足りなければ未出題から埋める。
 */
export function weakestFacts(pool: Fact[], n: number): Fact[] {
  const seen: { f: Fact; score: number }[] = [];
  const unseen: Fact[] = [];

  for (const f of pool) {
    const s = peekFact(factKey(f));
    // 少しゆらぎを入れる。完全に決まっていると、毎日おなじ5問になる
    if (s.seen > 0) seen.push({ f, score: s.m * 10 - Math.min(s.miss, 5) + Math.random() * 4 });
    else unseen.push(f);
  }

  seen.sort((a, b) => a.score - b.score);
  const out = seen.slice(0, n).map((x) => x.f);
  while (out.length < n && unseen.length) {
    out.push(unseen.splice(Math.floor(Math.random() * unseen.length), 1)[0]);
  }
  return out;
}
