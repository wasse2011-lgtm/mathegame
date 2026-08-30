/**
 * 出題エンジン。
 * ・習熟度が低い式を優先しつつ、間違えた式は数問あとに必ず戻す
 * ・誤答の選択肢は「実際に子どもがする間違い」から作る（＋1、繰り上げ忘れ、引いた答え…）
 * ・正解が毎回いちばん大きい数にならないよう、上と下に必ず散らす
 */

import { type Fact, type World, factKey } from './curriculum';
import { factStat } from './save';

export interface Question {
  fact: Fact;
  answer: number;
  choices: number[];
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
  push(sum + 10, 3); // 十の位のつけまちがい
  push(sum + 3, 4);
  push(sum - 3, 4);

  return pool;
}

/** tier 順を保ちつつ、同じ tier の中だけランダムにする */
function byTier(list: Distractor[]): number[] {
  return list
    .map((d) => ({ d, k: d.tier + Math.random() * 0.9 }))
    .sort((x, y) => x.k - y.k)
    .map((x) => x.d.v);
}

function buildChoices(sum: number, pool: Distractor[], count: number): number[] {
  const above = byTier(pool.filter((d) => d.v > sum));
  const below = byTier(pool.filter((d) => d.v < sum));
  const picks: number[] = [];

  // ふだんは上下に散らして「いちばん大きいのが正解」を封じる。
  // ただし毎回そうすると今度は「いちばん大きいのは正解じゃない」を覚えてしまうので、
  // ときどきは散らさずに選ぶ。
  const roll = Math.random();
  if (roll > 0.25) {
    if (above.length) picks.push(above.shift() as number);
    if (below.length && picks.length < count - 1) picks.push(below.shift() as number);
  } else if (roll < 0.125 && below.length >= count - 1) {
    picks.push(...below.splice(0, count - 1)); // 正解がいちばん大きい回
  }

  const rest = byTier(pool.filter((d) => !picks.includes(d.v)));
  while (picks.length < count - 1 && rest.length) picks.push(rest.shift() as number);
  // 候補が尽きた場合の保険
  let pad = 1;
  while (picks.length < count - 1) {
    const v = sum + pad;
    if (!picks.includes(v) && v !== sum) picks.push(v);
    pad++;
  }

  return [...picks, sum];
}

export class QuestionPicker {
  private recent: string[] = [];
  private review: { fact: Fact; due: number }[] = [];
  private asked = 0;
  /** 正解が同じ位置に並び続けないようにする */
  private lastSlots: number[] = [];

  constructor(private world: World) {}

  private weight(f: Fact): number {
    const s = factStat(factKey(f));
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

    const pool = this.world.facts.filter((f) => !this.recent.includes(factKey(f)));
    const candidates = pool.length ? pool : this.world.facts;

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
    const answer = fact.a + fact.b;
    const choices = buildChoices(answer, distractorPool(fact.a, fact.b, answer), this.world.choices);

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

    return { fact, answer, choices };
  }

  /** 間違えた式は 2問後と 5問後に戻す */
  markWrong(fact: Fact): void {
    this.review.push({ fact, due: this.asked + 2 });
    this.review.push({ fact, due: this.asked + 5 });
  }
}

/** 正解／不正解を習熟度に反映する */
export function recordAnswer(fact: Fact, ok: boolean, ms: number): void {
  const s = factStat(factKey(fact));
  s.seen++;
  if (ok) {
    s.m = Math.min(5, s.m + (ms <= 3000 ? 2 : 1));
    s.ms = s.ms ? Math.round(s.ms * 0.7 + ms * 0.3) : ms;
  } else {
    s.m = Math.max(0, s.m - 2);
    s.miss++;
  }
}
