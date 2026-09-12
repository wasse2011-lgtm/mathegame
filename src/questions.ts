/**
 * 出題エンジン。
 * ・習熟度が低い式を優先しつつ、間違えた式は数問あとに必ず戻す
 * ・誤答の選択肢は「実際に子どもがする間違い」から作る（＋1、繰り上げ忘れ、引いた答え…）
 * ・正解が毎回いちばん大きい数にならないよう、上と下に必ず散らす
 */

import { type Fact, factKey } from './curriculum';
import { factStat, peekFact, profile } from './save';

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

export interface Distractor {
  v: number;
  /** 小さいほど「ありがちな間違い」。選ぶときはこの順を優先する。 */
  tier: number;
}

/**
 * export しているのは verify のため。
 * 「正解の下に置ける候補が何個あるか」で、位置だけで当てる手の上限が決まる。
 * その上限を手で表に書くと、問題の中身を変えたときに黙ってずれるので、
 * 検査のほうからこのプールを直接読ませる。
 */
export function distractorPool(a: number, b: number, sum: number): Distractor[] {
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
export function blankPool(a: number, b: number, sum: number): Distractor[] {
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
    return this.question(this.pickFact());
  }

  /**
   * 式を指定して1問つくる。リベンジ（まちがえた式のやりなおし）で使う。
   * 出す式は決め打ちでも、選択肢の作りかたと正解の位置の散らしかたは next() と同じにする。
   */
  question(fact: Fact): Question {
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

/** これだけまちがえたら「にがて」。1回では、たまたま押しまちがえただけのことが多い */
export const WEAK_MISS = 2;

/**
 * にがてな式か。
 *
 * miss はいままで親の画面でしか使っていなかったが、同じデータを子ども向けに
 * 「たおすべき相手」として見せなおす（プレイ中の障害物と、図鑑のしるし）。
 * おぼえた式は、まちがえた回数が残っていても外す。過去のミスをいつまでも
 * 突きつけないため。
 */
export function isWeakFact(f: Fact): boolean {
  const s = peekFact(factKey(f));
  return s.miss >= WEAK_MISS && s.m < MASTERED;
}

/**
 * 正解／不正解を習熟度に反映する。戻り値は「いま初めておぼえた」かどうか。
 *
 * 速く答えたら +2 にしていたが、それだと 3択でまぐれ当たり2回でも
 * 「おぼえた」になってしまい、図鑑も親向けの数字も当てにならなかった。
 * 上げ幅は必ず +1 で、4回きれいに正解して初めて「おぼえた」。
 * 速さは ms（平均解答時間）のほうにだけ反映する。
 */
export function recordAnswer(fact: Fact, ok: boolean, ms: number): boolean {
  const key = factKey(fact);
  const s = factStat(key);
  const before = s.m;
  s.seen++;
  if (ok) {
    s.m = Math.min(5, s.m + 1);
    s.ms = s.ms ? Math.round(s.ms * 0.7 + ms * 0.3) : ms;
  } else {
    s.m = Math.max(0, s.m - 2);
    s.miss++;
  }
  const learned = before < MASTERED && s.m >= MASTERED;
  // ずかんを見にいく理由をここで作る。「あたらしいカードが待っている」を
  // ホームに出したいので、まだ見ていないぶんを覚えておく（ずかんを開くと消える）
  if (learned) {
    const p = profile();
    if (!p.zukanNew.includes(key)) p.zukanNew.push(key);
  }
  return learned;
}

/**
 * にがて たいじ に出す式。
 *
 * デイリー（weakestFacts）とちがって、ほんとうに「にがて」と記録された式
 * （isWeakFact）だけを返す。1ぴきも居ないときは空配列で、そのときは
 * ステージそのものを出さない（ホームのカードが押せなくなる）。
 * にがてでもない式を水増しして並べると、「にがてを たおした」が嘘になる。
 *
 * 並び順は にがてな順（習熟度が低く、まちがえた回数が多いほど先）。
 * 最初の1ぴきがいちばん手ごわい相手になるが、時間切れが無いモードなので
 * ここで詰まってもゲームは止まらない。
 */
export function weakFacts(pool: Fact[], n: number): Fact[] {
  return pool
    .filter(isWeakFact)
    .map((f) => {
      const s = peekFact(factKey(f));
      return { f, score: s.m * 10 - Math.min(s.miss, 9) };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
    .map((x) => x.f);
}

/** いま にがてな式が いくつあるか。ホームのカードに出す */
export function weakFactCount(pool: Fact[]): number {
  return pool.reduce((n, f) => n + (isWeakFact(f) ? 1 : 0), 0);
}

/**
 * 「いま わりと かんたんに とける式」を えらぶ。
 *
 * きょうの もんだい の前半に出す。以前は5問ぜんぶ weakestFacts（いちばん苦手な式）
 * だったので、毎日ひらくたびに その子にとって いちばん重い5問が並んでいた。
 * 助走で「解ける」を数回ふませてから、さいごの1問だけ いまのレベルに当てる。
 *
 * 効かせる順は 習熟度 ＞ まちがえた回数 ＞ 和の小ささ。ゆらぎを足しているのは、
 * 毎日おなじ顔ぶれにしないため。記録がまだ無い子は全部が未出題（m = 0）なので、
 * 和の小さい式が自然に前に来る。
 *
 * @param exclude ここに入っている式は出さない（さいごの1問と重ねない）
 */
export function easiestFacts(pool: Fact[], n: number, exclude: Fact[] = []): Fact[] {
  if (n <= 0) return [];
  const skip = new Set(exclude.map(factKey));
  const scored = pool
    .filter((f) => !skip.has(factKey(f)))
    .map((f) => {
      const s = peekFact(factKey(f));
      return { f, score: s.m * 12 - Math.min(s.miss, 5) * 5 - (f.a + f.b) * 0.2 + Math.random() * 8 };
    })
    .sort((a, b) => b.score - a.score);

  // 「にがて」と記録された式は、どれだけ点が高くても やさしい側には回さない。
  // 足りないときだけ、うしろから借りる（5問ぶん埋まらないほうが困る）
  const easy = scored.filter((x) => !isWeakFact(x.f));
  const list = easy.length >= n ? easy : [...easy, ...scored.filter((x) => isWeakFact(x.f))];
  return list.slice(0, n).map((x) => x.f);
}

/**
 * デイリーチャレンジ用に「いま苦手な式」を選ぶ。
 * 一度でも出した式を習熟度の低い順に取り、足りなければ未出題から埋める。
 *
 * **返す式は かならず ぜんぶ ちがう式になる。**
 * 渡されるプール（unlockedFacts）はワールドをつないだだけなので、`9+1` のように
 * 2つのワールドに出てくる式は 2こ入っている。重複を落とさないと、5問のうち
 * 2問が同じ式、ということが起きる。呼ぶ側は「n問ぶんの ちがう式」のつもりで
 * 使っているので、ここで落としておく。
 *
 * **1回に n こ まとめて取ること。**`weakestFacts(pool, 1)` をラウンドごとに
 * 呼ぶと、ミニゲームは記録を動かさない（習熟度が変わらない）ので、
 * いちばん にがてな式が毎回そのまま返ってくる。
 * かずの ものさし で `2+7` が 4回つづけて出ていたのは これが原因。
 */
export function weakestFacts(pool: Fact[], n: number): Fact[] {
  const seen: { f: Fact; score: number }[] = [];
  const unseen: Fact[] = [];
  const dup = new Set<string>();

  for (const f of pool) {
    const key = factKey(f);
    if (dup.has(key)) continue;
    dup.add(key);
    const s = peekFact(key);
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
