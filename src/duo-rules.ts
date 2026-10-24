/**
 * ふたりで ボス（iPad の 2人プレイ・ボスラッシュ）の決まりと数字。
 *
 * DOM にも canvas にも触らない。verify（npm run verify の L）から そのまま読んで
 * 「持ち時間が 3.3秒を切らないか」「ダメージの補正が左右で同じになるか」「CPU が強すぎないか」を見る。
 * 仕様と、数字を決めた経緯は docs/duo-boss-plan.md。
 *
 * 前提にしていること（コードで確かめた事実）:
 *  ・記録の ms（平均解答時間）は、ヒントで止めていた時間を数えていない（runner.ts の qElapsed）。
 *    ストップに頼っている子ほど速く見えるので、持ち時間とダメージは ここで その場の速さを測って決める
 *  ・「おぼえた」はヒントを出したままでも +1 される。なので出す式は「おぼえた式」ではなく、
 *    1つ前の世界までの式から始める
 */

import {
  TIER_TIME_FLOOR,
  WORLDS,
  blankFor,
  bossStage,
  factKey,
  tierDef,
  worldById,
  type Fact,
  type Tier,
  type World,
} from './curriculum';
import { QuestionPicker, isWeakStat, type Question, type StatReader } from './questions';
import { starKey, type FactStat, type Profile } from './save';

// ------------------------------------------------------------------ ボスの並び

/** 出す式の段。上へ行くほど むずかしい */
export type DuoPool = 'older' | 'mix' | 'now';
export const DUO_POOL_ORDER: readonly DuoPool[] = ['older', 'mix', 'now'];

export interface DuoBoss {
  /** 見た目と攻撃を借りる ワールド（boss.ts の段階） */
  world: number;
  /** 体力（ダメージの単位。1問ぶんの ふつうの ダメージが 1） */
  hp: number;
  /** 攻撃が届くまでの時間 ＝ その場で測った答える時間 × これ */
  timeK: number;
  /** 攻撃が片づいてから、つぎの攻撃が出るまでの秒数 */
  gap: number;
  pool: DuoPool;
}

/**
 * 8体。最初は弱くて すぐ倒せて、だんだん強くなる。
 *
 * 強くするのは 体力・持ち時間・あいだ の3つ。いちばん効くのは「あいだ」で、
 * 長いうちは 片方が たおれても、相方が つぎの攻撃が来る前に 1問 解いて起こせる。
 * 短くなるほど 起こす前に自分が攻撃を受ける（負けるのは 2人が つづけて失敗したときだけ）。
 * 数字は仮。遊ばせて、おうちのかたの画面の「たおれた割合」を見てから合わせる。
 */
export const DUO_BOSSES: readonly DuoBoss[] = [
  { world: 1, hp: 15, timeK: 2.5, gap: 5, pool: 'older' },
  { world: 2, hp: 20, timeK: 2.35, gap: 4.5, pool: 'older' },
  { world: 3, hp: 25, timeK: 2.2, gap: 4, pool: 'older' },
  { world: 4, hp: 30, timeK: 2.05, gap: 3.5, pool: 'mix' },
  { world: 5, hp: 34, timeK: 1.9, gap: 3, pool: 'mix' },
  { world: 6, hp: 38, timeK: 1.75, gap: 2.6, pool: 'mix' },
  // 7・8体目は はじめ 45・60（あいだ 2・1.5秒）だった。8体目だけ 飛びぬけて長く、負けの ほとんどが そこに集まる
  // （レビューの見積もり。速い子でも 1体 2分半）。体力と あいだを ゆるめて、のこりの山を なだらかにする
  { world: 7, hp: 42, timeK: 1.6, gap: 2.3, pool: 'now' },
  { world: 8, hp: 50, timeK: 1.5, gap: 2, pool: 'now' },
];

export const DUO_BOSS_COUNT = DUO_BOSSES.length;

/**
 * 片方が たおれたあと、もう片方への つぎの攻撃までは 少なくとも これだけ あける（秒）。
 *
 * 起き上がるのは「相方が 1問 正解したとき」なので、あいだが 1〜2秒しかない 終盤のボスでは
 * 起こす前に 相方が攻撃を受けて、たおれる＝ほぼ負け になっていた。「たすける」場面を 残す
 */
export const DUO_REVIVE_GAP = 4;

// ------------------------------------------------------------------ 速さ・持ち時間・ダメージ

/** この数だけ答えるまでは、世界の持ち時間をそのまま使う（まだ測れていない） */
export const DUO_FIRST_MEASURE = 5;
/** 測る1回ぶんの はば（ミリ秒）。押しまちがいの 0.2秒や、よそ見の 1分を 平均に入れない */
export const DUO_SAMPLE_MIN = 600;
export const DUO_SAMPLE_MAX = 20000;
/** 持ち時間の上限（秒）。長すぎると「攻撃が来ている」が絵から読めなくなる */
export const DUO_TIME_MAX = 20;
/** 「ゆっくり」設定（main の settings.slow）。curriculum.ts の answerTimeFor と同じ 1.6倍 */
export const DUO_SLOW = 1.6;

/** ダメージの基準（ミリ秒）。いつも 4秒の子の 1問が 1 */
export const DUO_DMG_REF = 4000;
export const DUO_DMG_MIN = 0.5;
export const DUO_DMG_MAX = 2.5;

/** まちがえた（攻撃されていないとき）あと、ボタンを止める秒数。でたらめに押して稼がせない */
export const DUO_WRONG_LOCK = 2;

/** 測った時間を 1回ぶん足す。押した1回で ゆれすぎないよう 3割だけ寄せる（questions.ts の ms と同じ） */
export function nextMeasure(prev: number, sampleMs: number): number {
  const x = Math.min(DUO_SAMPLE_MAX, Math.max(DUO_SAMPLE_MIN, sampleMs));
  return prev > 0 ? Math.round(prev * 0.7 + x * 0.3) : Math.round(x);
}

export interface AttackTimeArgs {
  /** その場で測った（または持ちこした）答える時間。0 は まだ測れていない */
  measuredMs: number;
  /** まだ測れていないときに使う、世界の持ち時間（秒） */
  worldTime: number;
  boss: number;
  tier: Tier;
  /** ゆっくり設定。CPU には効かせない */
  slow: boolean;
  /** その場の自動調整の段（0〜2）。ふつうだけ */
  ease: number;
  /** ペットの時間のばし（0〜0.25）。ベリーハードでは 0 を渡す */
  petSlow: number;
  /** パワーアップ「ゆっくり」 */
  powerSlow: boolean;
}

/**
 * 攻撃が届くまでの秒数。
 *
 * 下限（3.3秒）は ゆっくり設定・パワーアップの前に効かせる（curriculum.ts の answerTimeFor と同じ順）。
 * 下限を 後に置くと、ベリーハードの ×0.75 を ゆっくりで打ち消してから 切り上げる形になり、
 * 「ゆっくり」が効いていないように見える。
 */
export function attackTime(a: AttackTimeArgs): number {
  const def = DUO_BOSSES[Math.min(Math.max(a.boss, 0), DUO_BOSS_COUNT - 1)];
  let t = a.measuredMs > 0 ? (a.measuredMs / 1000) * def.timeK : a.worldTime;
  t *= tierDef(a.tier).timeRate;
  t *= 1 + DUO_EASE_STEP * a.ease;
  t *= 1 + a.petSlow;
  t = Math.max(t, TIER_TIME_FLOOR);
  if (a.powerSlow) t += DUO_POWER_SLOW;
  if (a.slow) t *= DUO_SLOW;
  return Math.min(t, DUO_TIME_MAX);
}

/**
 * 1問のダメージ。いつもの答える時間に比例させるので、2人とも いつもどおりの速さなら
 * ボスに入るダメージは 1秒あたり同じ（1 / DUO_DMG_REF）になる。
 * 速い子が ぜんぶ倒してしまい、ゆっくりな子が「よけるだけ」になるのを防ぐ。
 */
export function damageOf(measuredMs: number, power: boolean): number {
  const k = measuredMs > 0 ? Math.min(DUO_DMG_MAX, Math.max(DUO_DMG_MIN, measuredMs / DUO_DMG_REF)) : 1;
  return k * (power ? DUO_POWER_DMG : 1);
}

// ------------------------------------------------------------------ その場の自動調整（ふつうだけ）

/** 1段で 持ち時間を何割のばすか */
export const DUO_EASE_STEP = 0.2;
export const DUO_EASE_MAX = 2;
/** 同じボスで これだけ たおれたら 1段やさしくする */
export const DUO_EASE_DOWNS = 2;
/** これだけ つづけて よけたら 1段もどす */
export const DUO_EASE_BACK = 3;

/** そのボスで出す式の段。自動調整の段だけ 下げる（いちばん下で止まる） */
export function poolLevel(boss: number, ease: number): DuoPool {
  const base = DUO_POOL_ORDER.indexOf(DUO_BOSSES[Math.min(boss, DUO_BOSS_COUNT - 1)].pool);
  return DUO_POOL_ORDER[Math.max(0, base - ease)];
}

// ------------------------------------------------------------------ ヒント

/**
 * 1人が ボス1体で押せるヒントの回数。null は 何回でも。
 *
 * ふつうは 最後のボスまで 何回でも（本編の ふつうは 最後のボスだけ 2回だが、それは持ちこまない。
 * いまの世界まで ストップを使って来ている子が、ここで急に使えなくなるため）。
 * ハードは 2回に ペットの上乗せ（もとの回数まで）。ベリーハードは なし。
 */
export const DUO_HARD_HINTS = 2;
export function duoHintQuota(tier: Tier, petHints: number): number | null {
  if (tier === 0) return null;
  if (tier === 1) return DUO_HARD_HINTS + Math.min(petHints, DUO_HARD_HINTS);
  return 0;
}

// ------------------------------------------------------------------ パワーアップ（ふつう・ハード）

export type PowerId = 'slow' | 'guard' | 'power';
export interface PowerDef {
  id: PowerId;
  icon: string;
  label: string;
  note: string;
}

/** パワーアップ「ゆっくり」で 足す秒数 */
export const DUO_POWER_SLOW = 1;
/** パワーアップ「つよく」の ダメージ倍率 */
export const DUO_POWER_DMG = 1.3;

// note は やすみの ボタンに 小さく出す（字が読めなくても 絵と ならべて分かる 短さにする）。
// 🛡 は 文字ではなく 絵で出るよう U+FE0F を付ける（付けないと 線だけの字になる端末がある）
export const DUO_POWERS: readonly PowerDef[] = [
  { id: 'slow', icon: '⏳', label: 'ゆっくり', note: 'じかんが のびる' },
  { id: 'guard', icon: '🛡️', label: 'まもり', note: '1かい まもる' },
  { id: 'power', icon: '💥', label: 'つよく', note: 'こうげき アップ' },
];

export function powerDef(id: string): PowerDef | null {
  return DUO_POWERS.find((p) => p.id === id) ?? null;
}

/** パワーアップを えらぶか（ベリーハードは 自分の力だけ） */
export function powersOn(tier: Tier): boolean {
  return tier < 2;
}

/** CPU の パワーアップ。左の子が えらばなかったものから 1つ */
export function cpuPower(taken: string, rnd: number): PowerId {
  const rest = DUO_POWERS.filter((p) => p.id !== taken);
  return rest[Math.min(rest.length - 1, Math.floor(rnd * rest.length))].id;
}

// ------------------------------------------------------------------ CPU

/** CPU の速さ。左の子の答える時間 × この はば */
export const DUO_CPU_SPEED: readonly [number, number] = [0.8, 1.2];
/** CPU が 正しく答える割合の はば（左の子に合わせる） */
export const DUO_CPU_ACC: readonly [number, number] = [0.85, 0.97];
/** 左の子が まだ これだけしか答えていないあいだは 0.9 */
export const DUO_CPU_ACC_START = 0.9;
/** 左の子が まだ測れていないときの CPU の速さ（ミリ秒） */
export const DUO_CPU_DEFAULT_MS = 3500;
/** 「てで あそぶ」にしてから、これだけ さわらなければ CPU に戻す（秒） */
export const DUO_CPU_IDLE = 20;

/** CPU が 1問に かける時間（ミリ秒）。rnd は 0〜1 */
export function cpuDelay(leftMs: number, rnd: number): number {
  const base = leftMs > 0 ? leftMs : DUO_CPU_DEFAULT_MS;
  const k = DUO_CPU_SPEED[0] + (DUO_CPU_SPEED[1] - DUO_CPU_SPEED[0]) * rnd;
  return Math.round(Math.min(DUO_SAMPLE_MAX, Math.max(1200, base * k)));
}

/** CPU が 正しく答える割合。左の子の その場の正答率に合わせる */
export function cpuAccuracy(leftCorrect: number, leftTotal: number): number {
  if (leftTotal < DUO_FIRST_MEASURE) return DUO_CPU_ACC_START;
  return Math.min(DUO_CPU_ACC[1], Math.max(DUO_CPU_ACC[0], leftCorrect / leftTotal));
}

/**
 * CPU が まちがえるときに押す答え。こたえに いちばん近い数（数えまちがい・繰り上げ忘れ）。
 * 誤答の選択肢は もともと「実際に子どもがする まちがい」から作ってある（questions.ts）。
 */
export function cpuWrongChoice(q: Question, rnd: number): number {
  const wrong = q.choices.filter((v) => v !== q.answer);
  const best = Math.min(...wrong.map((v) => Math.abs(v - q.answer)));
  const near = wrong.filter((v) => Math.abs(v - q.answer) === best);
  return near[Math.min(near.length - 1, Math.floor(rnd * near.length))];
}

// ------------------------------------------------------------------ 出す式

/** 1つの式と、その式を出す形（7 + ? = 10 の穴埋めか） */
export interface DuoEntry {
  fact: Fact;
  blank: boolean;
}

/** 本編で いま どこにいるか（その きろくの★から読む。main.ts の currentSpot と同じ決まり） */
export function spotOf(p: Profile): { worldId: number; stage: number } {
  const stars = (w: number, s: number): number => p.stars[starKey(w, s)] ?? 0;
  const open = (id: number): boolean => {
    if (id === 1) return true;
    const prev = worldById(id - 1);
    return stars(prev.id, bossStage(prev)) > 0;
  };
  for (const w of WORLDS) {
    if (!open(w.id)) continue;
    for (let stage = 1; stage <= bossStage(w); stage++) {
      if (stars(w.id, stage) === 0) return { worldId: w.id, stage };
    }
  }
  const last = WORLDS[WORLDS.length - 1];
  return { worldId: last.id, stage: bossStage(last) };
}

function entriesOf(w: World, steps: number): DuoEntry[] {
  const out: DuoEntry[] = [];
  for (let i = 0; i < Math.min(steps, w.steps.length); i++) {
    const blank = blankFor(w, i + 1);
    for (const fact of w.steps[i].facts) out.push({ fact, blank });
  }
  return out;
}

/** 同じ式・同じ形は 1つにまとめる（重みが2倍にならないように） */
function uniq(list: DuoEntry[]): DuoEntry[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const k = `${factKey(e.fact)}${e.blank ? '?' : ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * その子の3つの段。**本編で もう通った小ステップの式だけ**を出す。
 *  older … 1つ前の世界までの式
 *  mix   … 1つ前の世界の式 ＋ いまの世界の 前半のうち 通った小ステップ
 *  now   … いまの世界の 通った小ステップ（いまの小ステップと その先は 出さない。そこは まだ練習中）
 *
 * @param stage 本編で いま いる小ステップ（spotOf）。1〜(stage−1) が 通ったところ
 *
 * はじめは stage を見ておらず、いまの世界の8つ ぜんぶから出していた。まだ進んでいない小ステップの式
 * （1つめの面にいる子に 7面めの 1+9 など）が まざり、しかも 出たことのない式ほど重みが高いので
 * いちばん よく出ていた（レビューで見つかった）。
 * 1つめの世界の 1面めにいる子は 通ったところが まだ無いので、1面めの式を使う。
 * どの段も 空になるときは 1つ下の段を使う（いまの世界の 1面めにいる子の now は mix と同じ）。
 */
export function duoPools(worldId: number, stage: number): Record<DuoPool, DuoEntry[]> {
  const w = worldById(worldId);
  const done = Math.max(0, Math.min(stage - 1, w.steps.length));
  const half = Math.ceil(w.steps.length / 2);
  const before = WORLDS.filter((x) => x.id < w.id);
  const prevWorld = before[before.length - 1];
  // 1つめの世界の 1面めの子。通った式が 1つも無いので、いま いる 1面めだけを使う
  const first = entriesOf(w, Math.max(1, done));
  const older = uniq(before.flatMap((x) => entriesOf(x, x.steps.length)));
  const prev = prevWorld ? entriesOf(prevWorld, prevWorld.steps.length) : [];
  const mix = uniq([...prev, ...entriesOf(w, Math.min(half, done))]);
  const now = uniq(entriesOf(w, done));
  const pick = (...lists: DuoEntry[][]) => lists.find((l) => l.length > 0) ?? first;
  const o = pick(older, mix, first);
  const m = pick(mix, o);
  return { older: o, mix: m, now: pick(now, m) };
}

/** 選択肢の数。いまの世界にそろえる（同じ子が、式によって 3択と4択を行き来しないように） */
export function duoChoices(worldId: number): 3 | 4 {
  return worldById(worldId).choices;
}

/** 世界の持ち時間（まだ測れていないとき）。その世界の 1面めの長さ（いちばん長い） */
export function duoWorldTime(worldId: number): number {
  return worldById(worldId).answerTime;
}

const EMPTY: Readonly<FactStat> = { m: 0, ms: 0, miss: 0, seen: 0 };

/** その きろくの記録を読む。ゲストは null（何も記録がない） */
export function statsOf(p: Profile | null): StatReader {
  return (key) => (p ? (p.facts[key] ?? EMPTY) : EMPTY);
}

/**
 * ふたりで ボス の出題。
 *
 * 選びかたは QuestionPicker と同じ（まだ身についていない式を重く、直前の3問は出さない）。
 * ちがうのは 2つ:
 *  ・世界をまたいだ式を 1つの束で出すので、穴埋め（10 の とびら）かどうかを 式ごとに持つ
 *  ・にがて と記録された式は出さない。どの問題も 攻撃される問題になりうるため
 *    （にがて は「にがて たいじ」で 時間制限なしに相手をする）
 * 記録は読むだけで、動かさない（★・図鑑・おぼえた は本編だけが動かす）。
 */
export class DuoPicker {
  private entries: DuoEntry[];
  private plain: QuestionPicker;
  private blank: QuestionPicker;
  private recent: string[] = [];

  constructor(entries: DuoEntry[], choices: 3 | 4, private stat: StatReader) {
    const safe = entries.filter((e) => !isWeakStat(stat(factKey(e.fact))));
    // にがてを抜いて空になる子（ぜんぶ にがて）は、抜かずに出す。出す式が無いよりいい
    this.entries = safe.length ? safe : entries;
    this.plain = new QuestionPicker([], choices, false, stat);
    this.blank = new QuestionPicker([], choices, true, stat);
  }

  get size(): number {
    return this.entries.length;
  }

  private weight(e: DuoEntry): number {
    const s = this.stat(factKey(e.fact));
    if (s.m <= 1) return 6;
    if (s.m <= 3) return 3;
    return 1;
  }

  next(rnd: () => number = Math.random): Question {
    const key = (e: DuoEntry) => `${factKey(e.fact)}${e.blank ? '?' : ''}`;
    const fresh = this.entries.filter((e) => !this.recent.includes(key(e)));
    const list = fresh.length ? fresh : this.entries;
    let total = 0;
    const w = list.map((e) => {
      const x = this.weight(e);
      total += x;
      return x;
    });
    let r = rnd() * total;
    let pick = list[list.length - 1];
    for (let i = 0; i < list.length; i++) {
      r -= w[i];
      if (r <= 0) {
        pick = list[i];
        break;
      }
    }
    this.recent.push(key(pick));
    if (this.recent.length > 3) this.recent.shift();
    return (pick.blank ? this.blank : this.plain).question(pick.fact);
  }
}

// ------------------------------------------------------------------ 段階・ごほうび・コイン

/** むずかしさが開いているか。2人の どちらかが 1つ下を 最後まで倒していればよい */
export function duoTierOpen(tier: Tier, left: Profile, right: Profile | null): boolean {
  if (tier === 0) return true;
  const done = (p: Profile | null) => Boolean(p && p.duo.best[tier - 1] >= DUO_BOSS_COUNT);
  return done(left) || done(right);
}

/** 段階ごとの記念きせかえ（items.ts の prize つきの品） */
export const DUO_PRIZES: readonly string[] = ['hat-chibiboss', 'hat-bosshelm', 'acc-flamecape'];

/** ボスを倒すごとのコイン（何体目か 0 始まり）。むずかしさの倍率と、1日の2回目からの割引を掛ける */
export const DUO_COIN_BASE = 10;
export const DUO_COIN_STEP = 5;
export const DUO_COIN_CLEAR = 80;
export const DUO_COIN_AGAIN = 0.25;

export function duoBossCoins(boss: number, tier: Tier, again: boolean): number {
  return Math.round((DUO_COIN_BASE + DUO_COIN_STEP * boss) * tierDef(tier).coinRate * (again ? DUO_COIN_AGAIN : 1));
}

export function duoClearCoins(tier: Tier, again: boolean): number {
  return Math.round(DUO_COIN_CLEAR * tierDef(tier).coinRate * (again ? DUO_COIN_AGAIN : 1));
}

/** 中断の保存キー。右の相手は きろくの枠の番号、ゲストは てでも CPU でも 'g' */
export function duoSaveKey(tier: Tier, partner: number | 'g'): string {
  return `${tier}:${partner === 'g' ? 'g' : `p${partner}`}`;
}

// ------------------------------------------------------------------ 端末

/** iPad 相当か。画面の短い辺が これ以上の タッチ画面だけで出す */
export const DUO_MIN_SIDE = 700;

export function duoDevice(screenW: number, screenH: number, touch: boolean): boolean {
  return touch && Math.min(screenW, screenH) >= DUO_MIN_SIDE;
}

// ------------------------------------------------------------------ 見込み（verify と docs の数字）

/** 体力の合計 */
export function duoTotalHp(): number {
  return DUO_BOSSES.reduce((n, b) => n + b.hp, 0);
}

/**
 * 最後まで行ける確率の見込み。
 * 負けるのは「片方が たおれ、そのすぐ次の攻撃で 相方も失敗したとき」なので、
 * 1回の攻撃で失敗する割合を p、受ける攻撃の数を n とすると おおよそ (1 − p²)^n。
 */
export function duoSurvival(p: number, attacks: number): number {
  return (1 - p * p) ** attacks;
}
