/**
 * おやつ・はなび。コインで買って、その場で使いきるもの。
 *
 * ガチャ（90）・たまご（120）は 1〜3ステージ走らないと届かない。そのあいだ
 * コインは「ただの数字」で、使って何かが起きるのは 何ステージかに1回だけだった。
 * ここは その すきまを埋める **小さい使いみち**。押した瞬間に 画面が返してくれる。
 *
 *   ・おやつ … ぼくじょうに落ちてきて、なかまが走ってきて食べる（ranch.ts）
 *   ・はなび … ホームの空に上がって、広場の なかまが跳ねる（hanabi.ts）
 *
 * どちらも見た目だけ。なかよし度も 強さも 記録も動かさない。
 *
 * 1日の数に上限を置く。安くて すぐ反応が返るぶん、上限が無いと
 * 1回の気まぐれで たまごの ぶんまで 使いきってしまう。それぞれ 1日 5こ × 10枚。
 * 両方 使いきっても 1日 100枚（1〜2ステージぶん）で止まる。のこりの数は ボタンに出す。
 */

import { persist, profile, today } from './save';

export type TreatKind = 'snack' | 'hanabi';

/** 1こ の ねだん。どちらも同じにして、損得の計算を持ちこませない */
export const TREAT_COST: Record<TreatKind, number> = { snack: 10, hanabi: 10 };

/** 1日に使える数（それぞれ） */
export const TREATS_PER_DAY = 5;

/** きょう使った数。日付が変わっていれば 0（書きこみを待たない） */
function usedToday(kind: TreatKind): number {
  const t = profile().treat;
  return t.date === today() ? t[kind] : 0;
}

/** きょう あと いくつ使えるか */
export function treatsLeft(kind: TreatKind): number {
  return Math.max(0, TREATS_PER_DAY - usedToday(kind));
}

/** いま買えないわけ。買えるなら null */
export function treatBlock(kind: TreatKind): 'day' | 'coins' | null {
  if (treatsLeft(kind) <= 0) return 'day';
  if (profile().coins < TREAT_COST[kind]) return 'coins';
  return null;
}

/** 1こ 使う。買えなければ false（コインも数も動かさない） */
export function useTreat(kind: TreatKind): boolean {
  if (treatBlock(kind)) return false;
  const p = profile();
  const now = today();
  if (p.treat.date !== now) p.treat = { date: now, snack: 0, hanabi: 0 };
  p.treat[kind] += 1;
  p.coins -= TREAT_COST[kind];
  persist();
  return true;
}
